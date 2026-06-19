#!/usr/bin/env bash
# =====================================================================================
# cc-master — decision-briefing + discuss-loop end-to-end smoke (the runnable proof)
# =====================================================================================
# 这是 walkthrough.md 背后**可无人值守跑**的证明。它把「网页触发 → 模拟讨论结束 → master 消化」
# 这条闭环里**可机验**的部分逐步跑出来、逐步断言，最后以 `DEMO E2E PASSED` / 非零退出收尾。
#
# 它跑的是真实产物，不是 mock：
#   - 用真 board-lint.js 校验 fixture board 合法（红线 2 narrow waist）；
#   - 按 board.md §decision_package 的 canonical 契约逐字段断言决策包完整；
#   - 用真 inputs_hash 定义（每个直接 dep 串 <dep-id>\n<artifact 字节长度>\n<artifact>\n + 末尾 goal 同形，
#     取 payload sha256；长度前缀 + dep-id 锁死依赖边界，commands/discuss.md §2）
#     重算并比对 → 证明 freshness-check 在「输入未变」时判 fresh、在「上游 artifact 改变」时判 stale；
#   - 模拟 discuss session 收尾：在沙箱 board home 写一份结构合法的 <board-stem>--<node-id>.decision.md sidecar；
#   - 模拟 master recon 拾取：断言 sidecar 存在 + 结构合法 + 能解析出 TL;DR 与选定 option，
#     且选定 option id 属于 board 节点 decision_package.options 之一（证明 master「用得上」这份数据）。
#
# Run:   bash examples/decision-briefing/smoke.sh
# Needs: bash + node（红线 1：禁 jq / python）。零联网（红线 5）。自带沙箱 home，不污染真实 .claude/cc-master/。
# =====================================================================================
set -uo pipefail

# ── 定位 plugin 根（本文件在 <root>/examples/decision-briefing/）+ 真实脚本 ────────────────
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LINT="$ROOT/skills/orchestrating-to-completion/scripts/board-lint.js"
FIXTURE="$ROOT/examples/decision-briefing/fixture.board.json"
NODE_ID="D1"

# ── 沙箱 home：把 fixture 拷进一个 throwaway $CC_MASTER_HOME，绝不碰真实 home ──────────────
HOME_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ccm-decbrief.XXXXXX")"
BOARD="$HOME_DIR/20260619T093000-0000.board.json"
# sidecar 命名带 board-stem（board 文件名去 .board.json）防共享 home 多板互撞 / 误消化
# 注：NODE_ID="D1" 本就 path-safe（^[A-Za-z0-9._-]+$、非 ./..）——discuss.md §5 落 sidecar 前会
#     guard 校验 node id path-safe（含 / 或 .. 即报错停手，绝不拼路径逃出 board home）。fixture 用 D1，guard 必过。
BOARD_STEM="20260619T093000-0000"
SIDECAR="$HOME_DIR/$BOARD_STEM--$NODE_ID.decision.md"
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
step "1 — fixture board 合法 + decision_package 契约完整（webview 才能渲染富决策卡）"
# =====================================================================================
say "master 在 idle 时为 D1 准备好 decision_package、挂节点上。先证这块 board 真合法、契约真完整。"
LINT_OUT="$(node "$LINT" "$BOARD" 2>&1)"; LINT_RC=$?
what "board-lint.js（真窄腰校验器）跑完 rc=${LINT_RC}：$LINT_OUT"
assert "fixture board 过 board-lint（窄腰合法、红线 2）" "$( [ "$LINT_RC" -eq 0 ] && echo yes || echo no )"

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
# 本 fixture 用默认 home → enter_cmd 不带 --home（board.md §decision_package 生成规则）
assert "默认 home：enter_cmd 不含 --home（裸 /cc-master:discuss <node-id>）" "$( [ "$(contains "$ENTER" "--home")" = no ] && echo yes || echo no )"
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
GEN_ENTER_CMD="/cc-master:discuss $NODE_ID --home '$SPACE_HOME'"
assert "enter_cmd 生成端引号形式回灌解析：'$GEN_ENTER_CMD' → home == '$SPACE_HOME'" \
  "$( [ "$(parse_home "${GEN_ENTER_CMD#/cc-master:discuss }" "")" = "$SPACE_HOME" ] && echo yes || echo no )"
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
step "4 — 模拟讨论结束：discuss session 写 <board-stem>--<node-id>.decision.md sidecar（绝不写 board）"
# =====================================================================================
say "用户在新终端跑 /cc-master:discuss D1，谈透后 discuss session 把结论落成 sidecar（board home 同目录）。"
say "这里用脚本生成一份**结构合法**的 sidecar，模拟那场讨论的产物。选定 opt-sidecar-index。"
CHOSEN="opt-sidecar-index"
RESOLVED_AT="2026-06-19T11:42:00Z"
cat > "$SIDECAR" <<EOF
---
node_id: $NODE_ID
resolved_at: $RESOLVED_AT
inputs_hash_at_decision: $BAKED
ask_type: $ASK
---

## TL;DR

选 **$CHOSEN**（单文件 JSON + 旁挂只读 sidecar 索引）：narrow waist 零改动、hook 零改动、可回退；先解 viewer 卡顿，写放大问题留作后续节点。

## 决策结论

选定 option id：\`$CHOSEN\` —— 「单文件 JSON + 旁挂只读 sidecar 索引」。
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
what "sidecar 已写到：$SIDECAR"
assert "discuss 只写 sidecar、**没有**改 board 文件（单写者纪律：board 与 fixture 逐字节相同）" \
  "$( cmp -s "$BOARD" "$FIXTURE" && echo yes || echo no )"
assert "sidecar 文件存在于 board home" "$( [ -f "$SIDECAR" ] && echo yes || echo no )"

# =====================================================================================
step "5 — 断言 master 消化路径：recon 拾取 sidecar → 解析 → 选定 option 可用"
# =====================================================================================
say "master 在下次 recon（决策程序 step 1）扫 awaiting-user 节点，发现同目录 <board-stem>--<node-id>.decision.md（带 board-stem 防多板撞名）。"
say "纯 node 解析 sidecar（禁 jq/python），断言它结构合法、master 真能从里面拿到可执行的结论。"

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
  printf '   网页触发（决策包契约+复制命令）→ freshness 正/反例 → 模拟讨论结束（写 sidecar、不碰 board）→ master 消化（拾取/解析/选定 option 可用）：闭环可机验部分全过。\n'
  exit 0
else
  printf '%sDEMO E2E FAILED%s  — %d 过，%d 失败。\n' "$R" "$Z" "$PASS" "$FAIL"
  exit 1
fi
