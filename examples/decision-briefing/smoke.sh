#!/usr/bin/env bash
# =====================================================================================
# cc-master — decision-briefing + discuss-loop end-to-end smoke (the runnable proof)
# =====================================================================================
# 这是 walkthrough.md 背后**可无人值守跑**的证明。它把「网页触发 → 模拟讨论结束 → master 消化」
# 这条闭环里**可机验**的部分逐步跑出来、逐步断言，最后以 `DEMO E2E PASSED` / 非零退出收尾。
#
# 它跑的是真实产物，不是 mock：
#   - 按 board.md §decision_package 的 canonical 契约逐字段断言决策包完整；
#   - 用真 inputs_hash 定义（每个直接 dep 串 <dep-id>\n<artifact 字节长度>\n<artifact>\n + 末尾 goal 同形，
#     取 payload sha256；长度前缀 + dep-id 锁死依赖边界，commands/discuss.md §2）
#     重算并比对 → 证明 freshness-check 在「输入未变」时判 fresh、在「上游 artifact 改变」时判 stale；
#   - 模拟 discuss session 收尾：版本化、append-only 地写 sidecar——<board-stem>--<node-id>--<STAMP>.decision.md，
#     STAMP=YYYYMMDDTHHMMSSZ 紧凑 UTC（path-safe、字典序=时间序）。模拟「聊了 2 次」写**两份**不同 STAMP 的
#     sidecar（round 1 + round 2，TL;DR 不同），断言 append-only 不覆盖、两份都在；
#   - 模拟 webview 历史区：起真 view-server.js（CC_MASTER_BOARD 指向沙箱 fixture）、node http GET /decisions.json，
#     断言返回含 D1 的 2 条、round=1/2 顺序对、各自 tldr 抽取正确、node_id 对（webview 卡片「💬 已讨论 N 次」据此渲染）；
#   - 模拟 master recon 拾取：master 取该 node **最新**那份 sidecar 消化——断言它存在 + 结构合法 + 能解析出 TL;DR
#     与选定 option，且选定 option id 属于 board 节点 decision_package.options 之一（证明 master「用得上」这份数据）。
#
# Run:   bash examples/decision-briefing/smoke.sh
# Needs: bash + node（红线 1：禁 jq / python）。零联网（红线 5）。自带沙箱 home，不污染真实 .claude/cc-master/。
# =====================================================================================
set -uo pipefail

# ── 定位 plugin 根（本文件在 <root>/examples/decision-briefing/）+ 真实脚本 ────────────────
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VIEW_SERVER="$ROOT/skills/orchestrating-to-completion/scripts/view-server.js"
FIXTURE="$ROOT/examples/decision-briefing/fixture.board.json"
NODE_ID="D1"

# ── 沙箱 home：把 fixture 拷进一个 throwaway $CC_MASTER_HOME，绝不碰真实 home ──────────────
HOME_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ccm-decbrief.XXXXXX")"
BOARD="$HOME_DIR/20260619T093000-0000.board.json"
# sidecar 命名带 board-stem（board 文件名去 .board.json）防共享 home 多板互撞 / 误消化；
# 且**版本化、append-only**：<board-stem>--<node-id>--<STAMP>.decision.md，STAMP=YYYYMMDDTHHMMSSZ 紧凑 UTC
# （无 :，path-safe、字典序=时间序）。每次 discuss 写一份新 sidecar、永不覆盖——「聊过 N 次」= 该 node 的 sidecar 数。
# 注：NODE_ID="D1" 本就 path-safe（^[A-Za-z0-9._-]+$、非 ./..）——discuss.md §5 落 sidecar 前会
#     guard 校验 node id path-safe（含 / 或 .. 即报错停手，绝不拼路径逃出 board home）。fixture 用 D1，guard 必过。
BOARD_STEM="20260619T093000-0000"
# 两次讨论的 STAMP（字典序 = 时间序：round 1 早于 round 2）+ 各自 sidecar 路径
STAMP_R1="20260619T114200Z"
STAMP_R2="20260619T161530Z"
SIDECAR_R1="$HOME_DIR/$BOARD_STEM--$NODE_ID--$STAMP_R1.decision.md"
SIDECAR_R2="$HOME_DIR/$BOARD_STEM--$NODE_ID--$STAMP_R2.decision.md"
# master 取「最新」那份消化（latest round = 最大 STAMP）
SIDECAR_LATEST="$SIDECAR_R2"
cleanup() { rm -rf "$HOME_DIR"; }
trap cleanup EXIT
cp "$FIXTURE" "$BOARD"

# ── 展示 + 计分 helper（零依赖）───────────────────────────────────────────────────────
if [ -t 1 ]; then B=$'\033[1m'; G=$'\033[32m'; R=$'\033[31m'; C=$'\033[36m'; Y=$'\033[33m'; Z=$'\033[0m'
else B=''; G=''; R=''; C=''; Y=''; Z=''; fi
PASS=0; FAIL=0
step() { printf '\n%s━━ STEP %s ━━%s\n' "$B" "$*" "$Z"; }
say()  { printf '   %s\n' "$*"; }
what() { printf '   %swhat happened:%s %s\n' "$C" "$Z" "$*"; }
ok()   { PASS=$((PASS+1)); printf '   %s✓ %s%s\n' "$G" "$*" "$Z"; }
no()   { FAIL=$((FAIL+1)); printf '   %s✗ %s%s\n' "$R" "$*" "$Z"; }
# assert: 真值（"yes"）→ ok，否则 no
assert() { if [ "$2" = "yes" ]; then ok "$1"; else no "$1"; fi; }
# contains: haystack 含 needle → "yes"
contains() { case "$1" in *"$2"*) echo yes;; *) echo no;; esac; }

# recompute_hash <board-path> <node-id>
#   按 commands/discuss.md §2 / board.md §inputs_hash MVP 定义重算（长度前缀 + dep-id 锁死边界）：
#   对每个直接 dep 按 deps 顺序串接 <dep-id>\n<artifact 字节长度>\n<artifact>\n（无 artifact 计空串/长度0），
#   末尾接 goal\n<goal 字节长度>\n<goal>，对 payload 取 sha256。长度前缀让 ["ab","c"] 与 ["a","bc"] 区分开。
#   纯 node（红线 1：禁 jq/python）。打到 stdout，形如 sha256:<hex>。
recompute_hash() {
  node -e '
    const fs=require("fs"), crypto=require("crypto");
    const board=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    const nodeId=process.argv[2];
    const byId=Object.fromEntries(board.tasks.map(t=>[t.id,t]));
    const node=byId[nodeId];
    if(!node){console.error("node not found: "+nodeId);process.exit(2);}
    const deps=Array.isArray(node.deps)?node.deps:[];
    const blen=s=>Buffer.byteLength(s,"utf8");
    // 每个直接 dep：<dep-id>\n<artifact 字节长度>\n<artifact>\n（长度前缀 + dep-id 锁死边界）
    let payload="";
    for(const d of deps){
      const dep=byId[d];
      const a=(dep && typeof dep.artifact==="string") ? dep.artifact : "";
      payload += d+"\n"+blen(a)+"\n"+a+"\n";
    }
    // 末尾：goal\n<goal 字节长度>\n<goal>
    const g=(typeof board.goal==="string") ? board.goal : "";
    payload += "goal\n"+blen(g)+"\n"+g;
    process.stdout.write("sha256:"+crypto.createHash("sha256").update(payload,"utf8").digest("hex"));
  ' "$1" "$2"
}

# node_field <board> <node-id> <jsonpath-ish>  —— 取一个标量字段（纯 node，禁 jq）
pkg_field() {
  node -e '
    const fs=require("fs");
    const b=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    const t=b.tasks.find(x=>x.id===process.argv[2]);
    const pkg=t&&t.decision_package;
    if(!pkg){process.exit(1);}
    const key=process.argv[3];
    let v=pkg[key];
    if(v===undefined||v===null){process.exit(1);}
    process.stdout.write(typeof v==="string"?v:JSON.stringify(v));
  ' "$1" "$2" "$3"
}

printf '%s╭───────────────────────────────────────────────────────────────────╮%s\n' "$B" "$Z"
printf '%s│  cc-master — decision-briefing + discuss-loop e2e（可跑的 walkthrough）│%s\n' "$B" "$Z"
printf '%s╰───────────────────────────────────────────────────────────────────╯%s\n' "$B" "$Z"
say "沙箱 home：$HOME_DIR"
say "讨论节点：${NODE_ID}（blocked_on:user，挂 decision_package）"

# =====================================================================================
step "1 — decision_package 契约完整（webview 才能渲染富决策卡）"
# =====================================================================================
say "master 在 idle 时为 D1 准备好 decision_package、挂节点上。先证这块 board 的决策包契约真完整。"
# 注：board 窄腰合法性的校验已归带外 `ccm board lint`（skill 版 board-lint.js 已退役）——
#     本 smoke 不在此跑 lint（fixture 是 legacy cc-master/v1、待独立迁移到 v2），只逐字段断言决策包契约。

# D1 是 blocked_on:user
GATE="$(node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync(process.argv[1]));const t=b.tasks.find(x=>x.id===process.argv[2]);process.stdout.write((t&&t.status==="blocked"&&t.blocked_on==="user")?"yes":"no")' "$BOARD" "$NODE_ID")"
assert "D1 是 awaiting-user 节点（status:blocked, blocked_on:user）" "$GATE"

# decision_package 逐字段（board.md canonical 契约：字段名 / 枚举钉死）
for f in prepared_at inputs_hash freshness ask_type context_md question what_i_need why_it_matters enter_cmd; do
  V="$(pkg_field "$BOARD" "$NODE_ID" "$f" 2>/dev/null)"; RC=$?
  assert "decision_package.$f 存在且非空" "$( [ "$RC" -eq 0 ] && [ -n "$V" ] && echo yes || echo no )"
done

ASK="$(pkg_field "$BOARD" "$NODE_ID" ask_type)"
case "$ASK" in decision|advice|solution) ASK_OK=yes;; *) ASK_OK=no;; esac
assert "ask_type ∈ {decision,advice,solution}（实为 ${ASK}）" "$ASK_OK"

FRESH="$(pkg_field "$BOARD" "$NODE_ID" freshness)"
case "$FRESH" in fresh|stale) FRESH_OK=yes;; *) FRESH_OK=no;; esac
assert "freshness ∈ {fresh,stale}（实为 ${FRESH}）" "$FRESH_OK"

# decision 型 → options 必填非空、每项含 id/label
OPTS_OK="$(node -e '
  const fs=require("fs");
  const b=JSON.parse(fs.readFileSync(process.argv[1]));
  const t=b.tasks.find(x=>x.id===process.argv[2]);
  const pkg=t.decision_package, opts=pkg.options;
  if(pkg.ask_type==="decision"){
    if(!Array.isArray(opts)||opts.length<2){process.stdout.write("no");process.exit(0);}
    for(const o of opts){ if(!o||typeof o!=="object"||!o.id||!o.label){process.stdout.write("no");process.exit(0);} }
  }
  process.stdout.write("yes");
' "$BOARD" "$NODE_ID")"
assert "ask_type:decision → options 非空(≥2)且每项含 id+label" "$OPTS_OK"

ENTER="$(pkg_field "$BOARD" "$NODE_ID" enter_cmd)"
assert "enter_cmd 就是用户在富卡上点「复制命令」拿到的那条" "$(contains "$ENTER" "/cc-master:discuss $NODE_ID")"
# enter_cmd **默认带 --board <board-stem>**（board.md §decision_package 生成规则）——让用户新开 session
# 跑复制命令时即便同 home 下还开着别的 orchestration board 也绝不窜板（不靠 node-id 自动消歧）
assert "默认带 --board：enter_cmd 含 --board ${BOARD_STEM}（防共享 home 多板窜上下文）" \
  "$(contains "$ENTER" "--board $BOARD_STEM")"
# 本 fixture 用默认 home → enter_cmd 不带 --home（board.md §decision_package 生成规则）
assert "默认 home：enter_cmd 不含 --home（仅 /cc-master:discuss <node-id> --board <stem>）" "$( [ "$(contains "$ENTER" "--home")" = no ] && echo yes || echo no )"
# 解析侧（discuss.md §1）：<node-id> [--home <path>] 里 --home 优先级最高，覆盖 env 默认
#   --home 解析必须 quote-aware（自定义 home 路径可能含空格）——跟引号则取到配对引号、剥外层引号；
#   否则取下一个空白分隔 token。这里走纯 node 复刻 discuss.md §1 那条 quote-aware 规则（禁 jq/python），
#   证明非默认 home（含空格）时复制按钮自带的选择器能在新终端落回正确 home。
parse_home() {  # parse_home "<args 整串>" "<env CC_MASTER_HOME>" → 打印生效 home
  node -e '
    const args=process.argv[1], envHome=process.argv[2];
    // quote-aware 分词：单/双引号包裹的整串（含空格）算一个 token、剥外层引号
    const toks=[]; let i=0;
    while(i<args.length){
      while(i<args.length && /\s/.test(args[i])) i++;
      if(i>=args.length) break;
      const q=args[i];
      if(q==="\x27"||q==="\x22"){ // 跟引号 → 取到配对同种引号
        const j=args.indexOf(q,i+1);
        const end=j<0?args.length:j;
        toks.push(args.slice(i+1,end)); i=(j<0?args.length:j+1);
      }else{ // 普通 token：到下一个空白
        let j=i; while(j<args.length && !/\s/.test(args[j])) j++;
        toks.push(args.slice(i,j)); i=j;
      }
    }
    let home="";
    for(let k=0;k<toks.length;k++){ if(toks[k]==="--home" && k+1<toks.length){ home=toks[k+1]; break; } }
    process.stdout.write(home || envHome || "DEFAULT");
  ' "$1" "$2"
}
assert "解析 '$NODE_ID --home /custom/home'：--home 胜出（即便 env 指别处）" \
  "$( [ "$(parse_home "$NODE_ID --home /custom/home" "/env/elsewhere")" = "/custom/home" ] && echo yes || echo no )"
assert "解析 '$NODE_ID'（无 --home）：回落 env CC_MASTER_HOME" \
  "$( [ "$(parse_home "$NODE_ID" "/env/home")" = "/env/home" ] && echo yes || echo no )"
# quote-aware 关键例：含空格的 home 必须被解析成完整路径（裸取空格前 token 会截成 /tmp/with）
SPACE_HOME="/tmp/with space/home"
assert "quote-aware 解析 \"--home '/tmp/with space/home'\"：剥引号得含空格完整路径" \
  "$( [ "$(parse_home "$NODE_ID --home '/tmp/with space/home'" "/env/elsewhere")" = "$SPACE_HOME" ] && echo yes || echo no )"
# 生成端 ⟺ 解析端对齐：board.md §decision_package 生成的引号形式（home 非默认时单引号包路径）回灌解析必还原
GEN_ENTER_CMD="/cc-master:discuss $NODE_ID --board $BOARD_STEM --home '$SPACE_HOME'"
assert "enter_cmd 生成端（含 --board + 引号 --home）回灌解析：home == '$SPACE_HOME'" \
  "$( [ "$(parse_home "${GEN_ENTER_CMD#/cc-master:discuss }" "")" = "$SPACE_HOME" ] && echo yes || echo no )"
# --board 选择器解析（discuss.md §1）：board-stem path-safe 无空格，取下一 token 即可
parse_board() {  # parse_board "<args 整串>" → 打印 --board 选出的 board-stem（无则空）
  node -e '
    const toks=process.argv[1].split(/\s+/).filter(Boolean);
    let stem="";
    for(let k=0;k<toks.length;k++){ if(toks[k]==="--board" && k+1<toks.length){ stem=toks[k+1]; break; } }
    process.stdout.write(stem);
  ' "$1"
}
assert "解析 enter_cmd 的 --board：选出 board-stem == ${BOARD_STEM}（钉死用哪块板、跳过自动消歧）" \
  "$( [ "$(parse_board "${GEN_ENTER_CMD#/cc-master:discuss }")" = "$BOARD_STEM" ] && echo yes || echo no )"
# 钉死的 board 文件确实在 home 里、且就是本 fixture 那块（--board 显式选择器 → 直接定位 <stem>.board.json）
assert "--board 钉死的 $BOARD_STEM.board.json 存在于 home（discuss §1 step 2 直接定位、不扫 active）" \
  "$( [ -f "$HOME_DIR/$BOARD_STEM.board.json" ] && echo yes || echo no )"
say "  → 网页侧：view-server.js 指向本 board，view.html DecisionCard 渲染上面这些字段 + 复制按钮（见 walkthrough §A）。"

# =====================================================================================
step "2 — freshness-check 正例：输入未变 → fresh（discuss 入口必 reconcile）"
# =====================================================================================
say "discuss session 进来第一件事：按 inputs_hash 定义重算、与决策包里的比对。输入没变就该判 fresh。"
BAKED="$(pkg_field "$BOARD" "$NODE_ID" inputs_hash)"
RECOMPUTED="$(recompute_hash "$BOARD" "$NODE_ID")"
what "决策包内 inputs_hash = $BAKED"
what "discuss 入口重算    = $RECOMPUTED"
assert "fresh 正例：重算 hash == 决策包内 hash（采访仍新鲜，直接用缓存）" "$( [ "$BAKED" = "$RECOMPUTED" ] && echo yes || echo no )"

# =====================================================================================
step "3 — freshness-check 反例：上游 artifact 改变 → stale（用户不会答一个被架空的问题）"
# =====================================================================================
say "造一例：上游 dep 节点 P1 的 artifact 在采访准备之后被改了（subagent 又跑了 n 步）。"
STALE_BOARD="$HOME_DIR/stale.board.json"
node -e '
  const fs=require("fs");
  const b=JSON.parse(fs.readFileSync(process.argv[1]));
  const p1=b.tasks.find(x=>x.id==="P1");
  p1.artifact="design_docs/plans/perf-baseline.md —— [已更新] 复测：缓存命中后重布局降到 120ms p95（上游变了）。";
  fs.writeFileSync(process.argv[2], JSON.stringify(b,null,2));
' "$BOARD" "$STALE_BOARD"
STALE_RECOMPUTED="$(recompute_hash "$STALE_BOARD" "$NODE_ID")"
what "上游改后重算 hash = $STALE_RECOMPUTED"
assert "stale 反例：上游 artifact 变 → 重算 hash != 决策包内 hash（discuss 会先 re-ground）" "$( [ "$BAKED" != "$STALE_RECOMPUTED" ] && echo yes || echo no )"
say "  → discuss session 此时会翻当前 board/代码刷新 context_md/question/options，并告知用户「采访已过期、已刷新」。"

# =====================================================================================
step "4 — 模拟讨论结束（聊了 2 次）：discuss 版本化 append-only 写 sidecar（绝不写 board）"
# =====================================================================================
say "用户在新终端跑 /cc-master:discuss D1，谈透后 discuss session 把结论落成 sidecar（board home 同目录）。"
say "契约已改版本化（discuss.md §5）：<board-stem>--D1--<STAMP>.decision.md，STAMP=YYYYMMDDTHHMMSSZ；每次写新文件、永不覆盖。"
say "这里模拟「聊了 2 次」——写**两份**不同 STAMP 的 sidecar（round 1 早 / round 2 晚、TL;DR 不同），证 append-only 两份都在。"
CHOSEN="opt-sidecar-index"

# write_sidecar <path> <round> <resolved_at> <tldr-firstline> <chosen-opt>
#   生成一份**结构合法**的 sidecar（frontmatter 5 字段含可选 round + 四个 ## 段）。纯 heredoc、零依赖。
write_sidecar() {
  local path="$1" round="$2" resolved="$3" tldr="$4" chosen="$5"
  cat > "$path" <<EOF
---
node_id: $NODE_ID
resolved_at: $resolved
inputs_hash_at_decision: $BAKED
ask_type: $ASK
round: $round
---

## TL;DR

$tldr

## 决策结论

选定 option id：\`$chosen\` —— 「单文件 JSON + 旁挂只读 sidecar 索引」。
board 主文件保持 narrow waist 不动，另写 \`<board>.index.json\` 缓存布局/折叠层级；viewer 优先读 index、主文件变更时增量重算；hook 完全无视 index（带外 sidecar）。
不选 opt-split-shards（动硬 waist、红线 2 重改动）；opt-viewer-only 作为本方向内的第一步并入，不单独成路。

## 完整决策文档

- **依据**：P1 基线坐实瓶颈在 viewer 侧（解析 38ms / 重布局 410ms p95），非磁盘 IO；故持久层不必大改，sidecar 索引即可把「布局重算」从每回合全量降为增量。
- **narrow-waist 取舍**：index 是带外 sidecar，hook 一概不读 → 红线 2 完全不破；可回退性强（删 index 退化到现状）。
- **新引入的 staleness 面**：index 与主文件可能不一致 → 用 content-hash 校验（复用既有 stale 心智），这条要写进 P2 的验收。
- **边界**：本方向不解决「主文件每回合全量重写」的写放大；>500 节点时再起独立节点处理，不在本决策范围。

## 对话记录指针

- 翻过 \`design_docs/plans/persistence-recon.md\`（P0 产物）+ \`perf-baseline.md\`（P1 产物）对齐瓶颈定位。
- 翻过 \`skills/orchestrating-to-completion/references/board.md\` §narrow-waist 确认 index 走柔性边 / 带外不破 waist。
- 关键来回：用户最初倾向 split-shards，复述其底层 job（「>200 节点不卡」而非「拆文件」）后收敛到代价最小的 sidecar-index。
EOF
}

# round 1：用户第一次谈，倾向坐实在 sidecar-index（但留了一个悬而未决的边界）
TLDR_R1="第 1 次谈：先**倾向** ${CHOSEN}（单文件 JSON + 旁挂只读 sidecar 索引），但 index 与主文件的一致性面还没敲死、留作下次确认。"
write_sidecar "$SIDECAR_R1" 1 "2026-06-19T11:42:00Z" "$TLDR_R1" "$CHOSEN"
what "round 1 sidecar 已写到：$(basename "$SIDECAR_R1")"

# round 2：复谈把边界敲死，**最终**定 sidecar-index（这才是 master 该消化的「最新一份」）
TLDR_R2="第 2 次谈（最终）：定 **${CHOSEN}**——index 与主文件用 content-hash 校验闭掉一致性面，narrow waist 零改动、可回退，先解 viewer 卡顿。"
write_sidecar "$SIDECAR_R2" 2 "2026-06-19T16:15:30Z" "$TLDR_R2" "$CHOSEN"
what "round 2 sidecar 已写到：$(basename "$SIDECAR_R2")"

assert "discuss 只写 sidecar、**没有**改 board 文件（单写者纪律：board 与 fixture 逐字节相同）" \
  "$( cmp -s "$BOARD" "$FIXTURE" && echo yes || echo no )"
assert "round 1 sidecar 存在于 board home" "$( [ -f "$SIDECAR_R1" ] && echo yes || echo no )"
assert "round 2 sidecar 存在于 board home" "$( [ -f "$SIDECAR_R2" ] && echo yes || echo no )"
# append-only 硬证：写第二份**没有**覆盖第一份——两份并存、文件名不同（STAMP 不同）
assert "append-only：写 round 2 后 round 1 仍在（未被覆盖，两份都留得住）" \
  "$( [ -f "$SIDECAR_R1" ] && [ -f "$SIDECAR_R2" ] && [ "$SIDECAR_R1" != "$SIDECAR_R2" ] && echo yes || echo no )"
# 「聊过 N 次」= 该 node 的 <board-stem>--D1--*.decision.md 个数
N_SIDECARS="$(ls "$HOME_DIR/$BOARD_STEM--$NODE_ID--"*.decision.md 2>/dev/null | wc -l | tr -d ' ')"
what "board home 里 D1 名下的 sidecar 数（= webview「已讨论 N 次」）：$N_SIDECARS"
assert "D1 名下 sidecar 计数 == 2（webview 据此显示「💬 已讨论 2 次」）" "$( [ "$N_SIDECARS" = "2" ] && echo yes || echo no )"

# =====================================================================================
step "4b — webview 历史区：起真 view-server、GET /decisions.json，断言 D1 的 2 条讨论历史可见"
# =====================================================================================
say "view.html 卡片新增「💬 已讨论 N 次」区，纯客户端 fetch 只读 GET /decisions.json（同 /board.json 轮询同款，零 POST 零联网）。"
say "这里起真 view-server.js（CC_MASTER_BOARD 指向沙箱 fixture）、node http GET /decisions.json，断言它把刚写的两份 sidecar 扫成历史。"

# 起 view-server：它打印恰一行 `cc-master board view: http://127.0.0.1:<port>`。后台起、抓 URL、用完即杀。
SRV_LOG="$HOME_DIR/view-server.log"
CC_MASTER_BOARD="$BOARD" node "$VIEW_SERVER" >"$SRV_LOG" 2>&1 &
SRV_PID=$!
# 把杀 server 叠进 trap（保留原 cleanup 删沙箱）
cleanup() { [ -n "${SRV_PID:-}" ] && kill "$SRV_PID" 2>/dev/null; rm -rf "$HOME_DIR"; }
# 等 server 打印 URL（最多 ~5s，纯轮询日志、不用 sleep 阻塞过久）
URL=""
for _ in $(seq 1 50); do
  URL="$(sed -n 's#.*\(http://127\.0\.0\.1:[0-9]\{1,\}\).*#\1#p' "$SRV_LOG" 2>/dev/null | head -1)"
  [ -n "$URL" ] && break
  node -e 'setTimeout(()=>{},100)'  # 100ms 轻轮询（纯 node，禁 sleep 长阻塞约定）
done
what "view-server 起在：${URL:-<未拿到 URL>}"
assert "view-server 起来并打印了本地 URL（127.0.0.1，零联网）" "$( [ -n "$URL" ] && echo yes || echo no )"

# 纯 node http GET /decisions.json（红线1：禁 jq/python；红线5：本地 127.0.0.1、零联网）
DEC_JSON="$(node -e '
  const http=require("http");
  const u=new URL(process.argv[1]+"/decisions.json");
  http.get({hostname:u.hostname,port:u.port,path:u.pathname}, res=>{
    let b=""; res.on("data",d=>b+=d); res.on("end",()=>{ process.stdout.write(b); });
  }).on("error",e=>{ process.stderr.write("GET-ERR:"+e.message); process.exit(3); });
' "$URL")"
what "GET /decisions.json 原文：$DEC_JSON"

# 解析返回数组，挑出 D1 的行，断言 round 顺序 / tldr 抽取 / node_id
DEC_PROBE="$(node -e '
  const arr=JSON.parse(process.argv[1]);
  const d1=arr.filter(r=>r.node_id==="D1").sort((a,b)=>a.round-b.round);
  const out={
    isArray:Array.isArray(arr),
    d1count:d1.length,
    r1:d1[0]||{}, r2:d1[1]||{},
    // tldr 抽取：应是各 sidecar ## TL;DR 下首行非空（含我们埋的 round 标记串）
    r1HasRoundMark: d1[0]?/第 1 次谈/.test(d1[0].tldr):false,
    r2HasRoundMark: d1[1]?/第 2 次谈/.test(d1[1].tldr):false,
    r1Round: d1[0]?d1[0].round:null,
    r2Round: d1[1]?d1[1].round:null,
    r1Node: d1[0]?d1[0].node_id:"",
    r2Node: d1[1]?d1[1].node_id:"",
    r1Ask: d1[0]?d1[0].ask_type:"",
  };
  process.stdout.write(JSON.stringify(out));
' "$DEC_JSON")"

probe() { node -e 'const o=JSON.parse(process.argv[1]);const v=o[process.argv[2]];process.stdout.write(typeof v==="string"?v:JSON.stringify(v))' "$DEC_PROBE" "$1"; }

assert "/decisions.json 返回 JSON 数组" "$( [ "$(probe isArray)" = "true" ] && echo yes || echo no )"
assert "数组含 D1 的恰 2 条（聊了 2 次都被扫到）" "$( [ "$(probe d1count)" = "2" ] && echo yes || echo no )"
assert "第 1 条 round == 1（按 STAMP 字典序=时间序排序，早的为 round 1）" "$( [ "$(probe r1Round)" = "1" ] && echo yes || echo no )"
assert "第 2 条 round == 2（晚的为 round 2）" "$( [ "$(probe r2Round)" = "2" ] && echo yes || echo no )"
assert "两条 node_id 都是 D1（webview 据此按节点分组卡片历史区）" \
  "$( [ "$(probe r1Node)" = "D1" ] && [ "$(probe r2Node)" = "D1" ] && echo yes || echo no )"
assert "round 1 的 tldr 抽取正确（含「第 1 次谈」标记，server 抽 ## TL;DR 首行）" "$( [ "$(probe r1HasRoundMark)" = "true" ] && echo yes || echo no )"
assert "round 2 的 tldr 抽取正确（含「第 2 次谈」标记）" "$( [ "$(probe r2HasRoundMark)" = "true" ] && echo yes || echo no )"
assert "每条带 ask_type（实为 $(probe r1Ask)，卡片可标决策/建议/方案）" "$( [ -n "$(probe r1Ask)" ] && echo yes || echo no )"

# ── 跨 board 串味防护：放一份**别的 board-stem** 的 D1 sidecar，断言 /decisions.json **不**收它 ──
# 共享 home 下可有多块 active board，且两板可复用同一 node id（都有 D1）。view-server 只该
# 收**当前 board**（CC_MASTER_BOARD 指向的那块，其 stem = BOARD_STEM）名下的 sidecar——以
# `${BOARD_STEM}--` 开头。别的 board 的 <other-stem>--D1--<stamp>.decision.md 必须被过滤掉，
# 否则会把别人的「已讨论」串到当前卡片、歪曲计数与最近 TL;DR（codex follow-up Bug A）。
OTHER_STEM="20260620T080000-9999"
OTHER_SIDECAR="$HOME_DIR/$OTHER_STEM--$NODE_ID--20260620T080500Z.decision.md"
write_sidecar "$OTHER_SIDECAR" 1 "2026-06-20T08:05:00Z" "别的 board 的 D1 讨论——绝不该串进当前 board 的卡片。" "opt-sidecar-index"
what "已放一份别 board 的 sidecar：$(basename "$OTHER_SIDECAR")（stem=${OTHER_STEM}，非当前 ${BOARD_STEM}）"
DEC_JSON2="$(node -e '
  const http=require("http");
  const u=new URL(process.argv[1]+"/decisions.json");
  http.get({hostname:u.hostname,port:u.port,path:u.pathname}, res=>{
    let b=""; res.on("data",d=>b+=d); res.on("end",()=>{ process.stdout.write(b); });
  }).on("error",e=>{ process.stderr.write("GET-ERR:"+e.message); process.exit(3); });
' "$URL")"
what "再次 GET /decisions.json（home 里现有当前板 2 份 + 别板 1 份 D1）：$DEC_JSON2"
# 当前板的 D1 仍恰 2 条（别板那份没被收）；且返回里没有别板 stem 的文件名
CROSS_PROBE="$(node -e '
  const arr=JSON.parse(process.argv[1]);
  const otherStem=process.argv[2];
  const d1=arr.filter(r=>r.node_id==="D1");
  const leaked=arr.some(r=>typeof r.file==="string" && r.file.startsWith(otherStem+"--"));
  process.stdout.write(JSON.stringify({d1count:d1.length, leaked}));
' "$DEC_JSON2" "$OTHER_STEM")"
assert "跨 board 过滤：当前板 D1 仍恰 2 条（别 board 的 D1 没被串进来）" \
  "$( [ "$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).d1count))' "$CROSS_PROBE")" = "2" ] && echo yes || echo no )"
assert "跨 board 过滤：/decisions.json 不含任何别 board-stem（${OTHER_STEM}--）的 sidecar" \
  "$( [ "$(node -e 'process.stdout.write(String(JSON.parse(process.argv[1]).leaked))' "$CROSS_PROBE")" = "false" ] && echo yes || echo no )"
# 清掉别板 sidecar，免得后面步骤（master 消化「最新」）误把它当当前板的一员
rm -f "$OTHER_SIDECAR"

# 用完即杀 view-server（trap 也会兜底）
kill "$SRV_PID" 2>/dev/null; wait "$SRV_PID" 2>/dev/null; SRV_PID=""
say "  → 网页侧：view.html 卡片把这 2 条按 node_id 分组成「💬 已讨论 2 次 · 最近结论 TL;DR …」+ 可展开逐次（见 walkthrough §A）。"

# =====================================================================================
step "5 — 断言 master 消化路径：recon 拾取**最新**那份 sidecar → 解析 → 选定 option 可用"
# =====================================================================================
say "master 在下次 recon（决策程序 step 1）扫 awaiting-user 节点，发现同目录有该 node 的多份 <board-stem>--D1--<STAMP>.decision.md。"
say "按 async-hitl 消化纪律：读该 node **全部** sidecar、取**最新**一份（最大 STAMP = round 2）为准消化。纯 node 解析（禁 jq/python）。"
SIDECAR="$SIDECAR_LATEST"
what "master 取最新一份消化：$(basename "$SIDECAR")"

# 解析 sidecar：frontmatter 4 字段 + 四个 ## 段 + 抽出 TL;DR 与选定 option id
DIGEST="$(node -e '
  const fs=require("fs");
  const raw=fs.readFileSync(process.argv[1],"utf8");
  const nodeId=process.argv[2];
  const out={};
  // --- frontmatter ---
  const m=raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if(!m){console.log(JSON.stringify({err:"no-frontmatter"}));process.exit(0);}
  const fm={}; for(const line of m[1].split("\n")){const i=line.indexOf(":"); if(i>0) fm[line.slice(0,i).trim()]=line.slice(i+1).trim();}
  out.fm=fm;
  const body=m[2];
  // --- sections present? ---
  out.hasTLDR = /(^|\n)##\s*TL;DR/.test(body);
  out.hasConclusion = /(^|\n)##\s*决策结论/.test(body);
  out.hasFullDoc = /(^|\n)##\s*完整决策文档/.test(body);
  out.hasPointer = /(^|\n)##\s*对话记录指针/.test(body);
  // --- extract TL;DR text (first non-empty line under the heading) ---
  const t=body.split(/##\s*TL;DR/)[1]||"";
  out.tldr=(t.split(/\n##\s/)[0]||"").split("\n").map(s=>s.trim()).filter(Boolean)[0]||"";
  // --- extract chosen option id: first `opt-...` backtick token in 决策结论 ---
  const c=(body.split(/##\s*决策结论/)[1]||"").split(/\n##\s/)[0]||"";
  const om=c.match(/opt-[A-Za-z0-9-]+/);
  out.chosen=om?om[0]:"";
  console.log(JSON.stringify(out));
' "$SIDECAR" "$NODE_ID")"

# frontmatter node_id 对得上
FM_NODE="$(node -e 'const o=JSON.parse(process.argv[1]);process.stdout.write(o.fm&&o.fm.node_id||"")' "$DIGEST")"
assert "sidecar frontmatter.node_id == ${NODE_ID}（认得回这是哪个节点的结论）" "$( [ "$FM_NODE" = "$NODE_ID" ] && echo yes || echo no )"

for k in resolved_at inputs_hash_at_decision ask_type; do
  HAS="$(node -e 'const o=JSON.parse(process.argv[1]);process.stdout.write(o.fm&&o.fm[process.argv[2]]?"yes":"no")' "$DIGEST" "$k")"
  assert "sidecar frontmatter.$k 存在" "$HAS"
done

# inputs_hash_at_decision 复用 discuss 命令规定的 hash 定义（与决策包内一致）
FM_HASH="$(node -e 'const o=JSON.parse(process.argv[1]);process.stdout.write(o.fm.inputs_hash_at_decision||"")' "$DIGEST")"
assert "sidecar inputs_hash_at_decision == 决策包内 inputs_hash（复用同一 hash 定义）" "$( [ "$FM_HASH" = "$BAKED" ] && echo yes || echo no )"

# master 取的是**最新**那份（round 2）——不是 round 1 那个还悬而未决的版本
FM_ROUND="$(node -e 'const o=JSON.parse(process.argv[1]);process.stdout.write(o.fm&&o.fm.round||"")' "$DIGEST")"
what "master 消化的这份 frontmatter.round = ${FM_ROUND}（应为最新 round 2，非 round 1）"
assert "master 取最新 round 消化（round == 2，非 round 1 的暂定版）" "$( [ "$FM_ROUND" = "2" ] && echo yes || echo no )"

for sec in hasTLDR hasConclusion hasFullDoc hasPointer; do
  HAS="$(node -e 'const o=JSON.parse(process.argv[1]);process.stdout.write(o[process.argv[2]]?"yes":"no")' "$DIGEST" "$sec")"
  assert "sidecar 含 $sec 段（master 消化所需结构）" "$HAS"
done

# master 先读 TL;DR
TLDR="$(node -e 'const o=JSON.parse(process.argv[1]);process.stdout.write(o.tldr||"")' "$DIGEST")"
what "master 先扫 TL;DR：$TLDR"
assert "能解析出非空 TL;DR（master 先读这段拿快速摘要）" "$( [ -n "$TLDR" ] && echo yes || echo no )"

# 选定 option id 必须属于 board 节点 decision_package.options 之一 —— 这是「master 用得上」的硬证
CHOSEN_PARSED="$(node -e 'const o=JSON.parse(process.argv[1]);process.stdout.write(o.chosen||"")' "$DIGEST")"
what "master 从决策结论解析出选定 option：$CHOSEN_PARSED"
IN_OPTS="$(node -e '
  const fs=require("fs");
  const b=JSON.parse(fs.readFileSync(process.argv[1]));
  const t=b.tasks.find(x=>x.id===process.argv[2]);
  const ids=(t.decision_package.options||[]).map(o=>o.id);
  process.stdout.write(ids.includes(process.argv[3])?"yes":"no");
' "$BOARD" "$NODE_ID" "$CHOSEN_PARSED")"
assert "选定 option id ∈ board 节点 decision_package.options（证明 master 真能用上这份数据）" "$IN_OPTS"

say ""
say "  → master 据此 replan：解锁 D1 的下游 P2/P3/P4（deps 在 D1 上），把短摘要折进 D1.notes、清 blocked_on:user。"
say "    （回流写 board 是 master 的活，本 smoke 只证「拾取→解析→可用」这条可机验链；replan 见 walkthrough §D。）"

# =====================================================================================
printf '\n%s━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━%s\n' "$B" "$Z"
if [ "$FAIL" -eq 0 ]; then
  printf '%sDEMO E2E PASSED%s  — %d 项断言全绿，0 失败。\n' "$G" "$Z" "$PASS"
  printf '   网页触发（决策包契约+复制命令）→ freshness 正/反例 → 模拟讨论结束（版本化 append-only 聊 2 次、不碰 board）→ webview 历史（/decisions.json 见 2 条、round 顺序对）→ master 消化最新 round（拾取/解析/选定 option 可用）：闭环可机验部分全过。\n'
  exit 0
else
  printf '%sDEMO E2E FAILED%s  — %d 过，%d 失败。\n' "$R" "$Z" "$PASS" "$FAIL"
  exit 1
fi
