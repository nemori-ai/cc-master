#!/usr/bin/env bash
# switch-account.sh — out-of-band 账号切换 wrapper（方案 A 落地·NOT a hook）。
#
# 当一份订阅配额（5h/7d）逼近耗尽、而你还握着未消费的备号时，这是最重的一根
# pacing lever：探测逼顶 → **选最优切入号**（select-account.js）→ **从 vault 取下一号的完整 claudeAiOauth
# blob（含 refresh token）**（非变更性 preflight，任一失败即退出、registry 原封不动）→ **主动 refresh**
# （node https·refresh token 放 POST body·不进 argv）→ **回写 vault 保 refresh token 新鲜** → **覆写官方
# 共享凭证三存储**（① credentials.json .claudeAiOauth ② ~/.claude.json oauthAccount ③ keychain
# "Claude Code-credentials"/$USER·先非权威后权威·原子写）→ 全过之后才动 registry：对**切出号**写配额快照
# （recordSwitchOut·best-effort 可降级）+ 切入号置 active（setActive·与快照**解耦**、独立可靠落盘）。
#
# ★无重启换号（设计审查已过）：**不再 exec claude / 不重启进程 / 不 resume 板**。换号 = 覆写官方 claude CLI
#   读取的**共享**凭证存储——运行中的 claude 在 access token 临近过期时**惰性 refresh、重读存储**，于是被覆写的
#   新号被它接管。主路径是**主动 refresh**（写新鲜 8h token，claude 接管后近期不需再 refresh·消竞态）；主动
#   refresh 失败才退化到 force-refresh 兜底（覆写原 blob + expiresAt 临近过期逼 claude 自己 refresh·有 vault-stale 风险）。
#   换号**决策**方法论（何时换、谁拍板）在 orchestrating-to-completion 的 cost-and-pacing.md §换号 lever；
#   换号**机制**（本脚本 + 选号 + vault 安全）在本 skill（account-management）的 SKILL.md + references/。
#
# A2 形态（本次重构·设计稿 §C-T4）：从「用户手指 --account <key>」升级为
#   「**自动选号切入 + 切时写切出快照 + 从 accounts.json registry 取 vault 引用取 token**」。
#   - 切前选号：默认 `email=$(node select-account.js)`——按切出快照 + reset 推算选最优切入号；
#     `--email/--account` 保留为可选覆写（用户显式指定时跳过自动选号）。
#   - select 返回非 0：exit 3（全员逼顶）→ surface 用户（blocked_on:"user"，不硬切）；
#     其它非 0（无候选 / registry 不可用）→ 报「无备号可切」、保持现状。
#   - 取 token：从选中 email 的 registry entry 的 vault 引用（keychain {service,account} /
#     file {path,key}）按 kind 取——file vault 行匹配用 accounts-lib.fileVaultLineMatch 取前缀 +
#     **awk index($0,p)==1**（行首锚定、对 email 的 `.`/`@` 元字符免疫·§A.4 必修 bug + P2-5，绝不
#     grep -m1 "^…" 也绝不 grep -F（子串匹配，重叠标识下取错行→畸形整行注入·P2-5））。
#   - 写快照 + setActive（**两段解耦·codex 二审 P2-1/P2-2 修复**）：**先过全部非变更性 preflight**（选号 +
#     读 token），**才**动 registry——绝不像旧码那样在 token 读之前就翻 active（token 取不到时退出会留下
#     「registry 标新号 active、session 仍旧 token」的损坏态·P2-1）。registry 两件事**解耦、各自独立 save**：
#     ① 快照（recordSwitchOut）= 选号优化层、best-effort——cc-usage 出 local fallback（缺 used_percentage）
#        时 saveRegistry 拒写该快照，但这**只少一条快照**、绝不连累 active（P2-2 病根：旧码两者同一事务，快照
#        校验失败 → setActive 一起丢）；② setActive(切入号) = 必须忠实反映现实的关键状态、独立可靠落盘。
#   token 全程只活在脚本子进程、绝不进 agent context / registry（registry 写的是非密用量快照 + active 翻转）。
#
# 落点纪律（红线 1/5）：这是 out-of-band 脚本（像 cc-usage.sh / codex-review.sh），
# 主线在 pacing 决策点 deliberately 跑它——它**绝不进 hooks/**、不是 hook runtime、
# 不新增后台派发机制。它调 `claude` / `security` / `node` 等带外依赖（node 是 Claude Code
# 宿主天然在的 runtime，ADR-006）。Bedrock/Vertex/Foundry 云后端无订阅 5h/7d 配额窗口 →
# 换号概念不适用 → 探测拿不到订阅 used% → 自然 no-op（不破 ship-anywhere）。
#
# ───────────────────────────── 安全纪律（HARD，逐条不可破）─────────────────────────────
# bearer 凭证 = possession-equals-access。本脚本从 vault 读完整 OAuth blob（含 refresh token）进一个 shell
# 变量后：
#   · 绝不 echo / 绝不 print / 绝不写任何日志文件 / 绝不进 board / 绝不进 registry / 绝不
#     commit / 绝不拼进任何会被打印的字符串（连 set -x 都不开——见下）。
#   · 凭证去向：① **refresh** 时把 refresh token 放 node https 的 **POST body**（不进 argv·绝不用 curl 把 token
#     放命令行）；② **覆写官方三存储**时 ①② 文件经 node **stdin** 喂（不进 argv），③ keychain 用 `security -w
#     "$wrapped"`（值作 **argv** 参数·必须 argv：stdin 喂的 -w 走 readpassphrase 有 128 字节硬上限会截断 blob）；
#     ③ **回写 vault** keychain 同样 `security -w "$blob"` argv 写、file 经 printf 写。keychain argv 写是用户拍板
#     抉择 A 接受的 sub-second 本机局部暴露（token 仍绝不 echo/log/进 registry）。
#   · 选号 / 写快照 / 取 vault 引用全经 accounts-lib（node），**只传 email / vault 形态 /
#     非密用量给 node，token 那一坨从不进 node**——registry 零凭证（§A.1 不变式1）。
#   · 本脚本注释里所有示例 token 一律 <redacted> 占位，绝不写真值。
#   · 绝不跨机器拷 vault（token 可能含机器指纹；possession=access）。
# vault 路径必须在 gitignored 区（~/.claude/cc-master/ 或 ${CC_MASTER_HOME}，绝不在 repo
# 树内）；keychain 优先、0600 文件为 ship-anywhere floor。token 一年期到期是静默失败
# 模式——registry 的 token_expires_at + vault 旁存 <email>_EXPIRES 便于人工/选号巡检。
#
# ───────────────────────────────── 用法 ─────────────────────────────────
# switch-account.sh [--email <email>] [options]
#   --board   <selector>  **deprecated no-op**（无重启换号不重启进程·不再 resume 板）。保留为可选兼容旧调用方。
#   --email   <email>     可选覆写：要切到的备号 email（vault 里的 keychain account / file key）。
#                         **缺省 = 自动选号**（select-account.js 选最优切入号·设计稿 §B）。
#   --account <email>     --email 的旧别名（兼容；同样跳过自动选号）。
#   --registry <path>     accounts.json 路径覆写（默认 ${CC_MASTER_HOME:-~/.claude/cc-master}/accounts.json）。
#   --vault-kind keychain|file|env   token 存储形态覆写。缺省 = 从选中 email 的 registry vault.kind 读。
#   --vault-file <path>   --vault-kind=file 时的 0600 vault 文件（默认
#                         ${CC_MASTER_HOME:-~/.claude/cc-master}/accounts.env；缺省从 registry vault.path 读）。
#   --keychain-service <s>  --vault-kind=keychain 时的 service（默认 cc-master-oauth；缺省从 registry vault.service 读）。
#   --no-snapshot         不对切出号写配额快照（跳过 cc-usage 探测 + recordSwitchOut；调试用）。
#   --now <ISO>           选号 / 快照的「现在」时刻覆写（确定性测试用）。
#   --dry-run             打印「将做什么」(token 永远 <redacted>)、**不真 exec、不真切、不真写 registry**。
#   --skip-token-check    （仅 --dry-run）允许在 vault 取不到 token 时仍走完逻辑打印计划。
#
# 退出码：0 成功（dry-run 走完 / 真 exec 不返回）；2 = 参数/前置校验失败；
#         3 = 全员逼顶（select-account exit 3）→ surface 用户、未切；非 0 其它 = vault/选号失败。
#
# 这个脚本**只**做「选号 + refresh + 覆写三存储 + 写快照」这一机械动作。探测（cc-usage.sh）、drain（handoff）
# 由主线编排器在调用本脚本前后驱动（见 cost-and-pacing.md §换号 lever）——指挥协调、脚本只演奏换号那一下
# （红线 4）。选号是机械选择、切不切仍由编排者/用户拍——尤其全员逼顶（exit 3）要 surface 用户（对齐 7d 总闸纪律）。

# 安全（HARD，token no-leak 第一要务）：本脚本会把 bearer blob 读进 shell 变量、再经 refresh POST body /
#   node stdin / security stdin 注入。**xtrace（set -x）会把变量赋值与命令实参回显到 stderr——直接打印明文凭证，
#   破 no-leak 契约**。两条来源都要堵：
#     ① 有人 `bash -x switch-account.sh` 显式调试；
#     ② env 继承的 xtrace（如 `export SHELLOPTS=xtrace` / `set -x` 后 source 本脚本）。
#   故在任何 vault 读之前**无条件关掉 xtrace**：`set +x` 关本 shell 的 xtrace 位，并 `unset
#   SHELLOPTS`（②的载体——bash 启动时据它恢复 set 选项；清掉它防 xtrace 被继承回来）。这必须是
#   脚本的**第一条可执行语句**，先于任何会碰 token 的代码。set -u 防未定义变量误用。
set +x                  # 关 xtrace（防凭证赋值 / 命令行被 trace 出来）；这是真正的关 trace 动作
# 防 env 继承的 xtrace（SHELLOPTS=xtrace）在子 shell 里复活 set -x。SHELLOPTS 在部分 bash 下是
# readonly（unset 会报错），故吞掉失败——真正关 trace 的是上一行 `set +x`，本行只是额外加固。
unset SHELLOPTS 2>/dev/null || true

# ───────────────────────── 云后端自检（红线 5，no-op 退出·先于任何 token 读）─────────────────────────
# Bedrock/Vertex/Foundry 是模型后端、非订阅口径：没有 5h/7d 订阅配额窗口、没有可换的订阅 OAuth token。
# 在这些后端上跑换号 = 顶替云 auth / 必然失败。故在**取任何 token 之前**（紧随 set +x、先于 set -u 与 arg
# 解析）自检三个云开关——任一为真 → 提示「云后端无订阅配额、换号不适用」+ **no-op 退出（exit 0）**，
# 绝不取 token、绝不选号、绝不 exec。镜像 accounts.md Step 1 的逻辑（命令体写侧 / 脚本切侧两端一致）。只读 env、不碰 token。
if [ -n "${CLAUDE_CODE_USE_BEDROCK:-}" ] || [ -n "${CLAUDE_CODE_USE_VERTEX:-}" ] || [ -n "${CLAUDE_CODE_USE_FOUNDRY:-}" ]; then
  printf '%s\n' "switch-account: 云后端（Bedrock/Vertex/Foundry）无订阅 5h/7d 配额窗口、无可换的订阅 OAuth token —— 换号不适用，no-op 退出。" >&2
  exit 0
fi

set -uo pipefail

# ───────────────────────── 路径自解析（self-contain·T7 搬入后的同目录 + 跨 skill 引用）─────────────────────────
# 本脚本（T7 后）住 ${CLAUDE_PLUGIN_ROOT}/skills/account-management/scripts/。它的依赖分两类：
#   ① 同 skill 同目录兄弟：accounts-lib.js / select-account.js —— 与本脚本同住 account-management/scripts/，
#      用 $SCRIPT_DIR 直接引用（同目录、不跨 skill，绝不裸相对路径·Finding #38/#50）。
#   ② 跨 skill：cc-usage.sh —— 它是 pacing 信号工具、属 orchestrating-to-completion，住
#      ${CLAUDE_PLUGIN_ROOT}/skills/orchestrating-to-completion/scripts/。跨 skill 引用必须
#      ${CLAUDE_PLUGIN_ROOT}/skills/<name>/… 绝对（绝不裸相对路径·Finding #38/#50）；缺 CLAUDE_PLUGIN_ROOT
#      时（dev / 直接 bash 跑）从本脚本所在目录上溯两级到 skills/ 再下到兄弟 skill（plugin 内相对稳定，两 skill 都 ship）。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

# ① 同目录兄弟（account-management skill 自身的 scripts/）。
LIB_JS="${SCRIPT_DIR}/accounts-lib.js"
SELECT_JS="${SCRIPT_DIR}/select-account.js"

# ② 跨 skill：cc-usage.sh 住 orchestrating-to-completion 的 scripts/。
#   解析顺序：① CLAUDE_PLUGIN_ROOT（装机后 harness 注入）；② dev 兜底——scripts → account-management →
#   skills → 再下到 orchestrating-to-completion/scripts（self-contain·Finding #38）。
if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -d "${CLAUDE_PLUGIN_ROOT}/skills/orchestrating-to-completion/scripts" ]; then
  ORCH_SCRIPTS="${CLAUDE_PLUGIN_ROOT}/skills/orchestrating-to-completion/scripts"
else
  # scripts → account-management → skills，再下到 orchestrating-to-completion/scripts。
  ORCH_SCRIPTS="$(cd "$SCRIPT_DIR/../.." 2>/dev/null && pwd)/orchestrating-to-completion/scripts"
fi
CC_USAGE_SH="${ORCH_SCRIPTS}/cc-usage.sh"

# ───────────────────────── helpers ─────────────────────────
# 所有诊断走 stderr；stdout 留给「计划」输出。绝不在任何路径打印 token 变量。
err()  { printf '%s\n' "$*" >&2; }
plan() { printf '%s\n' "$*"; }    # dry-run 计划行（绝不含 token）

usage() {
  err "usage: switch-account.sh [--email <email>] [--registry <path>]"
  err "       [--vault-kind keychain|file|env] [--vault-file <path>] [--keychain-service <s>]"
  err "       [--board <selector>] [--no-snapshot] [--now <ISO>] [--dry-run] [--skip-token-check]"
  err ""
  err "  无重启换号：覆写官方共享凭证三存储（\$USER 视角）→ 运行中 claude 惰性重读接管新号（不重启进程）。"
  err "  --email 缺省 = 自动选号（select-account.js 选最优切入号）。--board 已 deprecated（no-op·不再 resume 板）。"
}

# ───────────────────────── arg 解析（无真 token 也能安全 smoke）─────────────────────────
EMAIL=""; BOARD_SEL=""; DRY_RUN=0; SKIP_TOKEN_CHECK=0; NO_SNAPSHOT=0; NOW_OVERRIDE=""
EMAIL_EXPLICIT=0          # 用户显式 --email/--account → 跳过自动选号
VAULT_KIND=""             # 缺省从 registry vault.kind 读；--vault-kind 覆写
VAULT_KIND_EXPLICIT=0
KEYCHAIN_SERVICE=""       # 缺省从 registry vault.service 读；--keychain-service 覆写
KEYCHAIN_SERVICE_EXPLICIT=0
REGISTRY_PATH=""          # 缺省 = accounts-lib defaultRegistryPath()
# A2 §A.1 / G#1：file vault 默认统一到 accounts.json 同一用户级 home（~/.claude/cc-master）。
VAULT_FILE="${CC_MASTER_HOME:-${HOME}/.claude/cc-master}/accounts.env"
VAULT_FILE_EXPLICIT=0

# value 型 flag 缺值守卫（robustness·codex §7 P2-a·防死循环）：value 型 flag 缺第二个 arg 时 `shift 2` 失败、
#   arg list 不变 → `while [ $# -gt 0 ]` 死循环到被 kill（脚本上半身 set -uo pipefail 但无 set -e）。故每个 `shift 2`
#   前先确认存在第二个 arg（`[ $# -ge 2 ]`），缺值则 error+usage 退非 0（绝不死循环）。
need_val() { [ "$#" -ge 2 ] || { err "error: option '$1' requires a value."; usage; exit 2; }; }
while [ $# -gt 0 ]; do
  case "$1" in
    --email|--account)  need_val "$@"; EMAIL="$2"; EMAIL_EXPLICIT=1; shift 2;;
    --board)            need_val "$@"; BOARD_SEL="$2"; shift 2;;
    --registry)         need_val "$@"; REGISTRY_PATH="$2"; shift 2;;
    --vault-kind)       need_val "$@"; VAULT_KIND="$2"; VAULT_KIND_EXPLICIT=1; shift 2;;
    --vault-file)       need_val "$@"; VAULT_FILE="$2"; VAULT_FILE_EXPLICIT=1; shift 2;;
    --keychain-service) need_val "$@"; KEYCHAIN_SERVICE="$2"; KEYCHAIN_SERVICE_EXPLICIT=1; shift 2;;
    --no-snapshot)      NO_SNAPSHOT=1; shift;;
    --now)              need_val "$@"; NOW_OVERRIDE="$2"; shift 2;;
    --dry-run)          DRY_RUN=1; shift;;
    --skip-token-check) SKIP_TOKEN_CHECK=1; shift;;
    -h|--help)          usage; exit 0;;
    *) err "unknown arg: $1"; usage; exit 2;;
  esac
done

# --board：**deprecated no-op**（无重启换号不重启进程、不再 resume 板·设计审查已过）。保留为可选兼容旧调用方。
#   旧形态（exec claude --resume <板>）已删——换号现在覆写官方共享凭证三存储、claude 进程惰性重读接管新号，
#   不换 session、不需 board-resume。传了也无害（仅在 dry-run 计划里标 deprecated）；不传是正常路径。

if ! command -v node >/dev/null 2>&1; then
  err "error: 'node' not found in PATH — 选号 / 读 registry / 写快照都需 node（accounts-lib.js·ADR-006）。"
  err "       （node 是 Claude Code 宿主天然在的 runtime；若缺则环境异常。）"
  exit 1
fi
if [ ! -f "$LIB_JS" ]; then
  err "error: 找不到 accounts-lib.js（${LIB_JS}）——无法读 registry / 选号 / 写快照。"
  err "       检查 CLAUDE_PLUGIN_ROOT 或脚本所在 plugin 布局（account-management skill 应随 plugin 分发）。"
  exit 1
fi

# REGISTRY_PATH 缺省 = accounts-lib 的 defaultRegistryPath（与 add/list/delete 一致）。
if [ -z "$REGISTRY_PATH" ]; then
  REGISTRY_PATH="$(node -e 'process.stdout.write(require(process.argv[1]).defaultRegistryPath())' "$LIB_JS" 2>/dev/null || true)"
fi

# ───────────────────────── 切前选号（select-account.js·设计稿 §B）─────────────────────────
# 用户没显式 --email → 自动选号：node select-account.js 打印选中 email 到 stdout、退出码区分结果：
#   0 = 选中（email 在 stdout）；3 = 全员逼顶（NONE_ALL_EXHAUSTED·surface 用户、不硬切）；
#   1 = 无候选 / registry 不可用（无备号 / 单账号）。stderr 走 reason+warnings（不污染 stdout 纯 email）。
# token-blind：select-account.js 完全不碰 token，只读 accounts.json 非密元信息。
if [ "$EMAIL_EXPLICIT" -ne 1 ]; then
  if [ ! -f "$SELECT_JS" ]; then
    err "error: 找不到 select-account.js（${SELECT_JS}）——无法自动选号。显式传 --email <email> 覆写，或检查 plugin 布局。"
    exit 1
  fi
  # select 的 stderr（reason / warnings / 临近到期 / local-derived-approx 口径不可靠）**捕获后透传**给用户；
  # stdout 仍是纯 email（下游靠它）。P2-14：旧码 `2>/dev/null` 把选号器**自己生成的可操作警告**（选中号
  # token 临近到期 / 快照口径不可靠 / reason）一并吞进黑洞——换号照常进行却隐藏了正是该次选号的告警。改为：
  # 把 stderr 引到一个临时文件（非 token——select-account.js token-blind、stderr 无凭证，但仍按非密处理），
  # stdout 取纯 email；选号成功后把捕获的 stderr 警告透传给用户（exit 3 / exit 1 分支已有各自的 err 提示）。
  sel_args=(--registry "$REGISTRY_PATH")
  [ -n "$NOW_OVERRIDE" ] && sel_args+=(--now "$NOW_OVERRIDE")
  tmp_sel_err="$(mktemp "${TMPDIR:-/tmp}/.ccm-sel-err.XXXXXX")"
  EMAIL="$(node "$SELECT_JS" "${sel_args[@]}" 2>"$tmp_sel_err")"; sel_rc=$?
  # rc 决定分支 + 给用户可操作信息；捕获的 stderr 在成功分支透传，所有出口前清理临时文件。
  if [ "$sel_rc" -eq 3 ]; then
    [ -s "$tmp_sel_err" ] && err "$(cat "$tmp_sel_err")"
    rm -f "$tmp_sel_err"
    err "switch-account: 所有可切换备号都已逼顶 / 不可用（select-account NONE_ALL_EXHAUSTED）。"
    err "  这是 blocked_on:\"user\" 决策——是等 5h/7d reset 还是别的，请用户拍板。**未切换**。"
    err "  细看排名：node \"$SELECT_JS\" --registry \"$REGISTRY_PATH\" --json"
    exit 3
  fi
  if [ "$sel_rc" -ne 0 ] || [ -z "$EMAIL" ]; then
    [ -s "$tmp_sel_err" ] && err "$(cat "$tmp_sel_err")"
    rm -f "$tmp_sel_err"
    err "switch-account: 选号未选出可切入号（无备号 / registry 不可用 / 单账号场景）——保持现状、未切换。"
    err "  先用 /cc-master:accounts --add <email> 录备号，或显式 --email <email>。"
    err "  细看：node \"$SELECT_JS\" --registry \"$REGISTRY_PATH\" --json"
    exit 1
  fi
  # 选号成功：透传选号器在 stderr 出的**可操作警告**（选中号 token 临近到期 / 快照 local-derived-approx
  # 口径不可靠 / reason）——这正是 P2-14 旧码 2>/dev/null 吞掉的那条信息。换号照常进行，但不再隐藏告警。
  [ -s "$tmp_sel_err" ] && err "$(cat "$tmp_sel_err")"
  rm -f "$tmp_sel_err"
  err "switch-account: 自动选号 → 切入号 = ${EMAIL}（按切出快照 + reset 推算的最优切入号·§B）。"
else
  if [ -z "$EMAIL" ]; then
    err "error: --email/--account 传了空值。"
    usage; exit 2
  fi
  err "switch-account: 用户显式指定切入号 = ${EMAIL}（跳过自动选号）。"
fi

# ───────────────────────── 从 registry 读选中 email 的 vault 引用 ─────────────────────────
# 读 selected email 的 vault {kind, service/path, account/key:email}——全非密。
#   --vault-kind / --keychain-service / --vault-file 显式给则覆写 registry 值（调试 / registry 缺该 entry 时）。
#   node 输出三行：kind、service-or-path、account-or-key（都非密）；registry 缺该 entry → 输出空 kind，bash 兜底。
REG_VAULT_KIND=""; REG_VAULT_SVC_OR_PATH=""; REG_VAULT_ACCT_OR_KEY=""
# REG_IDENTITY_JSON：切入号的 registry identity（= ~/.claude.json oauthAccount 原样·**全非密**·身份补全重构）。
#   覆写官方三存储 ②段用它完整替换 oauthAccount，让换号真切**身份**（accountUuid/emailAddress/org…），不只切 token。
#   identity 非密 → 可经 node stdout 回 bash 变量（与 token 不同·token 仍绝不回显）。缺/无 identity → 空 → ②段降级。
REG_IDENTITY_JSON=""
if [ -n "$REGISTRY_PATH" ] && [ -f "$REGISTRY_PATH" ]; then
  # 三行输出（kind / svc-or-path / acct-or-key）；任何异常 → 空（bash 用 flag/默认兜底）。绝不读 token。
  reg_vault="$(node -e '
    "use strict";
    try {
      const lib = require(process.argv[1]);
      const reg = lib.loadRegistry(process.argv[2]);
      const e = (reg.accounts && reg.accounts[process.argv[3]]) || {};
      const v = e.vault || {};
      const kind = (v.kind === "keychain" || v.kind === "file") ? v.kind : "";
      const svcOrPath = kind === "keychain" ? (v.service || "") : (kind === "file" ? (v.path || "") : "");
      const acctOrKey = kind === "keychain" ? (v.account || "") : (kind === "file" ? (v.key || "") : "");
      process.stdout.write([kind, svcOrPath, acctOrKey].join("\n"));
    } catch (_e) { /* 缺/坏 registry → 空输出，bash 兜底 */ }
  ' "$LIB_JS" "$REGISTRY_PATH" "$EMAIL" 2>/dev/null || true)"
  # 逐行拆（IFS=newline；用 read 取前三行，避免 token 之类干扰——这里只有非密 vault 引用）。
  REG_VAULT_KIND="$(printf '%s\n' "$reg_vault" | sed -n '1p')"
  REG_VAULT_SVC_OR_PATH="$(printf '%s\n' "$reg_vault" | sed -n '2p')"
  REG_VAULT_ACCT_OR_KEY="$(printf '%s\n' "$reg_vault" | sed -n '3p')"
  # identity 单独一次 node 读（**全非密**·单行 JSON·缺/无 → 空）。绝不读 token——只取 entry.identity（身份对象）。
  REG_IDENTITY_JSON="$(node -e '
    "use strict";
    try {
      const lib = require(process.argv[1]);
      const reg = lib.loadRegistry(process.argv[2]);
      const e = (reg.accounts && reg.accounts[process.argv[3]]) || {};
      const id = e.identity;
      if (id && typeof id === "object" && !Array.isArray(id) && Object.keys(id).length > 0) process.stdout.write(JSON.stringify(id));
    } catch (_e) { /* 缺/坏 → 空·②段降级 */ }
  ' "$LIB_JS" "$REGISTRY_PATH" "$EMAIL" 2>/dev/null || true)"
fi

# 决定最终 vault 形态：显式 flag > registry 值 > 默认。
if [ "$VAULT_KIND_EXPLICIT" -ne 1 ]; then
  if [ -n "$REG_VAULT_KIND" ]; then
    VAULT_KIND="$REG_VAULT_KIND"
  else
    VAULT_KIND="keychain"   # registry 无该 entry / 缺 vault → 默认 keychain（mac floor）。
  fi
fi
case "$VAULT_KIND" in
  keychain|file|env) ;;
  *) err "error: vault kind must be one of keychain|file|env (got: $VAULT_KIND)"; exit 2;;
esac
# keychain service：显式 > registry > 默认。
if [ "$KEYCHAIN_SERVICE_EXPLICIT" -ne 1 ]; then
  if [ "$VAULT_KIND" = "keychain" ] && [ -n "$REG_VAULT_SVC_OR_PATH" ]; then
    KEYCHAIN_SERVICE="$REG_VAULT_SVC_OR_PATH"
  else
    KEYCHAIN_SERVICE="cc-master-oauth"
  fi
fi
# file vault path：显式 > registry > 默认。
if [ "$VAULT_FILE_EXPLICIT" -ne 1 ] && [ "$VAULT_KIND" = "file" ] && [ -n "$REG_VAULT_SVC_OR_PATH" ]; then
  VAULT_FILE="$REG_VAULT_SVC_OR_PATH"
fi

# ───────────────────────── 切出号配额快照 + setActive（两段解耦·P2-1/P2-2 修复·设计稿 §B.7）─────────────────────────
# **时序与解耦纪律（P2-1 / P2-2 修复·codex 二审）**：换号必须先过**全部非变更性 preflight**（选号 +
#   读 token），**才允许动 registry**。registry 里两件要写的事——快照（snapshot）与 active 翻转
#   （setActive）——**严重度不同、必须解耦**：
#     · **snapshot（recordSwitchOut）= 选号优化层**：best-effort、可降级。cc-usage 出 local fallback（缺
#       used_percentage）时 used_pct=undefined、saveRegistry 会拒写该快照——这**只该少一条快照**，绝不该
#       连累 active 翻转（P2-2 病根：旧码把两者塞进同一 saveRegistry 事务，快照校验失败 → setActive 一起丢）。
#     · **setActive = 必须忠实反映现实的关键状态**：一旦 token 读成功、即将 exec 换号，registry 的 active
#       必须翻到切入号。它**独立、可靠地落盘**（与 snapshot 分两次 save），即便 snapshot 那次失败，setActive
#       仍须成功。
#   故拆成两个函数：record_switch_out()（只写快照，失败容忍）+ set_active_in()（只翻 active，可靠）。
#   **调用顺序在 token 读成功之后**（见下方 vault 读取段后）：record_switch_out → set_active_in → exec。
#   token-blind：cc-usage.sh 只读本地 JSONL / sidecar 算用量，recordSwitchOut/setActive 只写非密字段，绝不碰 token。
SNAPSHOT_PLAN="(skipped: --no-snapshot)"
ACTIVE_PLAN="(not yet set)"
CURRENT_ACTIVE=""

# 读当前 active 号（registry 维护的「cc-master 换号视角的 active」）。供快照与 dry-run 计划共用。
# 无 active → 无切出号（首次换号 / 单账号建池）。绝不读 token。
detect_current_active() {
  CURRENT_ACTIVE="$(node -e '
    "use strict";
    try {
      const lib = require(process.argv[1]);
      const reg = lib.loadRegistry(process.argv[2]);
      const accts = reg.accounts || {};
      for (const [email, e] of Object.entries(accts)) {
        if (e && e.active === true) { process.stdout.write(email); break; }
      }
    } catch (_e) { /* 缺/坏 registry → 无 active，空输出 */ }
  ' "$LIB_JS" "$REGISTRY_PATH" 2>/dev/null || true)"
}

# ── (A) snapshot（best-effort·可降级）：只对切出号 recordSwitchOut + saveRegistry，绝不碰 active。──
#   失败（快照校验拒写 / registry 写出错 / cc-usage 降级）= 仅少一条快照，**绝不**阻断换号、绝不连累 setActive。
record_switch_out() {
  detect_current_active
  if [ -z "$CURRENT_ACTIVE" ]; then
    SNAPSHOT_PLAN="(no current active account in registry — 首次换号 / 单账号建池，无切出快照可写)"
    return 0
  fi
  if [ "$CURRENT_ACTIVE" = "$EMAIL" ]; then
    SNAPSHOT_PLAN="(current active == switch-in target $EMAIL — 已是该号，无需切出快照)"
    return 0
  fi

  # cc-usage.sh 拿账户权威 {source, five_hour:{used_percentage,resets_at}, seven_day:{...}}。缺/降级则 source=local-derived-approx。
  # ── best-effort 时限（codex round#2 Finding 3·照搬 account-add.sh write_observed_quota 的 timeout 写法）─────────
  #   病根：这个切出快照里的 cc-usage 无 timeout，跑在覆写官方存储**之后**、setActive **之前**——真 cc-usage 读当前
  #   session 巨 JSONL 算用量、超长 session 下极慢；slow/hung 会让机器已切到新号、但 accounts.json 还标旧号 active。
  #   修：用「后台跑进临时文件 + watchdog 轮询 + 超时 kill」可移植模式（无 timeout/gtimeout 依赖·macOS 上它们不保证在）
  #   给它兜上限（CC_USAGE_TIMEOUT_S 默认 8s·可 env 覆写）。超时/失败 → usage_json 空 → 优雅降级（配额字段留空·仍写
  #   last_switch_out 时间戳·继续到 setActive）。best-effort·绝不 wedge 换号。token 安全：cc-usage 本就 token-blind；
  #   临时文件只承非密用量 JSON、用完即删；kill 只针对 cc-usage 子进程、不碰任何 token。
  local usage_json=""
  if [ -f "$CC_USAGE_SH" ]; then
    local cu_args=()
    [ -n "$NOW_OVERRIDE" ] && cu_args+=(--now "$NOW_OVERRIDE")
    local timeout_s="${CC_USAGE_TIMEOUT_S:-8}"
    local usage_tmp
    usage_tmp="$(mktemp 2>/dev/null || printf '%s' "${TMPDIR:-/tmp}/cc-usage-so.$$.tmp")"
    # set -u + bash 3.2（macOS floor）：空数组 "${cu_args[@]}" 展开会 `unbound variable` 报错（cu_args
    #   只在 NOW_OVERRIDE 非空时才 += 元素，正常换号路径它是空数组）。用 ${arr[@]:-} 守卫——空时展开成单个
    #   空串参数（cc-usage.sh 无参运行本就合法，多一个空串 arg 无害；round-3 只扫了 `shift 2`、漏了数组展开）。
    ( bash "$CC_USAGE_SH" "${cu_args[@]:-}" >"$usage_tmp" 2>/dev/null ) &
    local ccu_pid=$!
    # 轮询最多 timeout_s 秒（0.2s 步进 → 5 次/秒）。子进程退出即提前 break。
    local waited=0 max_ticks=$(( timeout_s * 5 ))
    while [ "$waited" -lt "$max_ticks" ]; do
      kill -0 "$ccu_pid" 2>/dev/null || break
      sleep 0.2
      waited=$(( waited + 1 ))
    done
    if kill -0 "$ccu_pid" 2>/dev/null; then
      # 超时仍在跑 → kill（防巨 JSONL 下无限等·让机器卡在「已切新号、registry 仍旧号」半态）。TERM 后短等再 KILL 兜底。
      kill "$ccu_pid" 2>/dev/null || true
      sleep 0.2
      kill -9 "$ccu_pid" 2>/dev/null || true
      err "switch-account: cc-usage.sh 超过 ${timeout_s}s 未返回（多半当前 session JSONL 过大）——已中止，切出快照配额字段留空（仍写 last_switch_out 时间戳）。"
    fi
    wait "$ccu_pid" 2>/dev/null || true
    usage_json="$(cat "$usage_tmp" 2>/dev/null || true)"
    rm -f "$usage_tmp" 2>/dev/null || true
  fi

  # node：解析 cc-usage 输出 → 规整成 recordSwitchOut 的 {fiveHour,sevenDay}.{used_pct,resets_at,source}
  #   （cc-usage 给 used_percentage[account] 或反推；resets_at 是 epoch 秒 → 转严格 ISO；缺则留空）。
  #   **本块只读-改-写 last_switch_out**：loadRegistry → recordSwitchOut(切出号) → saveRegistry（原子+校验）。
  #   **绝不在此 setActive**（active 翻转拆到 set_active_in()·P2-2 解耦：快照校验失败不连累 active）。
  #   绝不传 token；usage_json 是非密用量。--now 透传给 ISO 转换（确定性）。
  local rec_out
  rec_out="$(node -e '
    "use strict";
    const lib = require(process.argv[1]);
    const [ , , regPath, switchOutEmail, usageRaw, nowOverride ] = process.argv;

    function epochToIso(ep) {
      if (typeof ep !== "number" || !isFinite(ep)) return undefined;
      // cc-usage 的 resets_at 是 epoch 秒。→ 严格 ISO-8601 UTC（秒精度、Z）。
      return new Date(ep * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
    }
    function intPct(v) {
      const n = Number(v);
      if (!isFinite(n)) return undefined;
      const r = Math.round(n);
      return Math.max(0, Math.min(100, r)); // 钳到 [0,100]（lib 校验 used_pct 是 0-100 整数）。
    }

    let usage = null;
    try { usage = usageRaw ? JSON.parse(usageRaw) : null; } catch (_e) { usage = null; }
    const src = (usage && typeof usage.source === "string") ? usage.source : "local-derived-approx";
    const fh = (usage && usage.five_hour) || {};
    const sd = (usage && usage.seven_day) || {};

    function win(w) {
      const o = { used_pct: intPct(w.used_percentage), source: src };
      const ra = epochToIso(w.resets_at);
      if (ra) o.resets_at = ra;
      return o;
    }

    const reg = lib.loadRegistry(regPath);
    if (!reg.accounts || !reg.accounts[switchOutEmail]) {
      process.stderr.write("snapshot: 切出号 " + switchOutEmail + " 不在 registry——跳过 recordSwitchOut。\n");
      // 切出号不在池中 = 无快照可写，但这不是错（active 翻转独立进行）。
      process.exit(0);
    }
    const fiveWin = win(fh);
    const sevenWin = win(sd);
    // ── 优雅降级闸（P2-2 病根的根治·bug 2）：快照是 pacing 的**可选观测**，丢了非致命。cc-usage 降级/超时
    //   （used_percentage 缺失）→ intPct 返回 undefined → used_pct 非 0-100 整数 → saveRegistry 会 throw + 吐
    //   node stack trace（换号核心其实已不受影响、active 仍翻转，但 trace 看着像崩）。**在构造/落盘快照之前先判
    //   used_pct 是否有效**：任一窗口 used_pct 非 0-100 整数 → **干净跳过这条快照**（不把 undefined 塞进 registry、
    //   绝不调用会 throw 的 saveRegistry），打一行清爽提示（非 stack-trace）后 exit 0。换号核心（三存储覆写 + active
    //   翻转）此前已完成、与本块完全独立，跳过快照绝不回滚换号。
    const pctOk = (v) => Number.isInteger(v) && v >= 0 && v <= 100;
    if (!pctOk(fiveWin.used_pct) || !pctOk(sevenWin.used_pct)) {
      process.stderr.write(
        "snapshot: cc-usage 降级未取到有效 used_pct（5h=" + JSON.stringify(fiveWin.used_pct) +
        " / 7d=" + JSON.stringify(sevenWin.used_pct) + "，source=" + src +
        "）→ 跳过本次切出配额快照·换号不受影响。\n");
      process.exit(0);
    }
    const snap = {
      at: nowOverride && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(nowOverride) ? nowOverride : undefined,
      fiveHour: fiveWin,
      sevenDay: sevenWin,
    };
    lib.recordSwitchOut(reg, switchOutEmail, snap);
    lib.saveRegistry(reg, regPath);
    process.stderr.write("snapshot: 已写 " + switchOutEmail + " 的 last_switch_out（source=" + src + "）。\n");
  ' "$LIB_JS" "$REGISTRY_PATH" "$CURRENT_ACTIVE" "$usage_json" "$NOW_OVERRIDE" 2>&1)" || {
    # 快照写失败（多半 used_pct 降级被 saveRegistry 拒写·P2-2）——**仅**少一条快照，绝不连累 setActive、绝不阻断换号。
    err "switch-account: 写切出快照失败（多半 cc-usage 降级、used_pct 缺失被拒写）——换号继续、active 仍会翻转，仅少这一条快照："
    err "$rec_out"
    SNAPSHOT_PLAN="(recordSwitchOut FAILED — see stderr; setActive 与换号不受影响、仍继续)"
    return 0
  }
  # rec_out 是 node 的诊断（非密），透传给用户。
  [ -n "$rec_out" ] && err "$rec_out"
  SNAPSHOT_PLAN="recorded switch-out snapshot for $CURRENT_ACTIVE"
}

# ── (B) setActive（可靠·独立落盘·与 snapshot 解耦）：切入号置 active=true、其余 false。──
#   这是 token 读成功、即将 exec 后**必须忠实反映现实**的关键状态——独立一次 saveRegistry，绝不被快照拖累。
#   切入号须在池中（不在则不强写——vault 取 token 那步已过、能到这里说明 token 拿到了；仍兜底告警）。
#   **调用前置条件（P2-1）**：必在 token 读成功之后调用——绝不在 token 失败路径上翻 active。
set_active_in() {
  local act_out
  act_out="$(node -e '
    "use strict";
    const lib = require(process.argv[1]);
    const [ , , regPath, switchInEmail ] = process.argv;
    const reg = lib.loadRegistry(regPath);
    if (reg.accounts && reg.accounts[switchInEmail]) {
      lib.setActive(reg, switchInEmail);          // active 唯一性：切入号 true、其余 false。
      lib.saveRegistry(reg, regPath);             // 独立落盘（与 snapshot 解耦·不受其校验失败影响）。
      process.stderr.write("active: 已置 " + switchInEmail + " 为 active（其余号 active=false）。\n");
    } else {
      // 切入号不在 registry——能到这里说明 token 已读成功（多半 --vault-kind/--keychain 显式覆写、号未入池）。
      // 不强写 active（setActive 会对不在池的号抛错），仅告警；换号仍继续（token 已在手）。
      process.stderr.write("active: 切入号 " + switchInEmail + " 不在 registry——未置 active（token 已读到、换号继续；建议 /cc-master:accounts --add 录号）。\n");
    }
  ' "$LIB_JS" "$REGISTRY_PATH" "$EMAIL" 2>&1)" || {
    # setActive 落盘失败是关键状态写失败——surface（但 token 已在手、不回滚 exec：现实已是切入号，宁可 registry
    #   滞后也不丢 token；下次 detect_current_active 会按 registry 旧 active，属可对账偏差、非 token 泄漏）。
    err "switch-account: setActive 落盘失败（registry 写出错）——换号仍继续（token 已读到），但 registry active 标记可能滞后："
    err "$act_out"
    ACTIVE_PLAN="(setActive FAILED — see stderr; 换号仍继续)"
    return 0
  }
  [ -n "$act_out" ] && err "$act_out"
  ACTIVE_PLAN="set active=$EMAIL"
}

# ───────────────────────── vault 读取（blob 进变量后绝不打印）─────────────────────────
# **无重启换号：vault 存的是完整 claudeAiOauth blob（单行 JSON·含 refresh token），不是裸 token。**
# 把 blob 读进 VAULT_BLOB 局部变量。失败时**不**把任何部分回显到日志。每条读取路径都能在「无真凭证」
# 环境下安全失败（返回非 0 / 空变量），不崩、不泄。ACCOUNT = 选中的 email。读取机制与旧码一致（值更长而已·单行）。
VAULT_BLOB=""

read_blob_keychain() {
  # macOS keychain：security 把 blob 打到 stdout——直接捕进变量，绝不再 echo。
  if ! command -v security >/dev/null 2>&1; then
    err "vault: 'security' (macOS keychain) not found — use --vault-kind file on non-mac."
    return 1
  fi
  # -w 只打印 password（blob）到 stdout；2>/dev/null 吞掉「not found」噪声。account = email。
  VAULT_BLOB="$(security find-generic-password -a "$EMAIL" -s "$KEYCHAIN_SERVICE" -w 2>/dev/null)" || return 1
  [ -n "$VAULT_BLOB" ]
}

read_blob_file() {
  # 0600 vault 文件，每行 <email>_TOKEN=<单行blob>。逐行取本号的那行、只切出值，
  # 绝不 `. "$VAULT"`（source 会把所有备号凭证灌进当前 env、扩大泄漏面 / 污染子进程）。
  if [ ! -f "$VAULT_FILE" ]; then
    err "vault: file not found: $VAULT_FILE"
    return 1
  fi
  # 安全检查：vault 文件不该 world/group 可读（提醒，不强制 fail——某些 fs 不支持）。
  local perm
  perm="$(stat -f '%Lp' "$VAULT_FILE" 2>/dev/null || stat -c '%a' "$VAULT_FILE" 2>/dev/null || echo '')"
  case "$perm" in
    600|400|"") ;;  # 期望 0600；空=取不到权限，不强判
    *) err "vault: WARNING $VAULT_FILE perms=$perm (expect 0600; bearer credential must not be group/world-readable).";;
  esac
  # ── §A.4 必修 bug：email 含 `.`/`@` 是正则元字符。**绝不** grep -m1 "^${email}_TOKEN="（BRE 下 `.`
  #   匹配任意字符，alice@x.com 会误匹配 alicexxxcom，静默取错行）。改用 accounts-lib.fileVaultLineMatch
  #   取本号的 _TOKEN= 行前缀（对 `.`/`@` 免疫）。绝不在 bash 手拼正则。
  local token_line_prefix
  token_line_prefix="$(node -e 'const{fileVaultLineMatch}=require(process.argv[1]);process.stdout.write(fileVaultLineMatch(process.argv[2]).tokenLine)' "$LIB_JS" "$EMAIL" 2>/dev/null)" || token_line_prefix=""
  if [ -z "$token_line_prefix" ]; then
    err "vault: 无法从 accounts-lib 取 email 安全前缀（node 失败？）——拒绝用裸正则取行（§A.4 元字符 bug）。"
    return 1
  fi
  # P2-5: awk index($0,p)==1 行首锚定取「以该前缀**起头**的首行」（对齐 account-delete/account-add 的范式）。
  #   绝不用 grep -F：它是**子串**匹配、非行首锚定——若两标识重叠（xalice@x.com_TOKEN= 排在 alice@x.com_TOKEN=
  #   之前），grep -F "alice@x.com_TOKEN=" 会先命中 xalice 那行，随后 ${line#prefix} 因前缀不在行首而不剥离
  #   → 整行（畸形）当 blob 注入。awk index($0,p)==1 才保证行首锚定，且对 `.`/`@` 元字符天然免疫（定字符串）。
  #   blob 单行（store_blob 已守 oneLine）→ 整行就是 <email>_TOKEN=<单行blob>，head -1 取首行即完整 blob 行。
  local line
  line="$(awk -v p="$token_line_prefix" 'index($0, p) == 1' "$VAULT_FILE" 2>/dev/null | head -1)" || true
  if [ -z "$line" ]; then
    err "vault: no entry '${token_line_prefix}' in $VAULT_FILE"
    return 1
  fi
  # 参数展开切掉前缀取值（awk index($0,p)==1 已保证 line 以 token_line_prefix 起头）。绝不 echo $line / ${VAULT_BLOB}。
  VAULT_BLOB="${line#"$token_line_prefix"}"
  [ -n "$VAULT_BLOB" ]
}

read_blob_env() {
  # 最弱形态（仅临时/调试）：从已 export 的 <email>_TOKEN 读。进程表/history 泄漏面大。
  # email 含 `.`/`@` 不是合法 shell 变量名——env 形态对 email 标识不通用，仅当用户显式 --vault-kind env
  # 且自己 export 了对应变量时用。间接展开（bash）；空/未设则失败。
  local var="${EMAIL}_TOKEN"
  VAULT_BLOB="${!var:-}"
  if [ -z "$VAULT_BLOB" ]; then
    err "vault(env): \$${var} not set/exported（注意 email 含 . / @ 不是合法变量名，env 形态对 email 标识不通用）。"
    return 1
  fi
}

fetch_blob() {
  case "$VAULT_KIND" in
    keychain) read_blob_keychain;;
    file)     read_blob_file;;
    env)      read_blob_env;;
  esac
}

TOKEN_OK=0
if fetch_blob; then
  TOKEN_OK=1
fi

# 取不到 blob：dry-run + --skip-token-check 时允许继续走计划打印；否则硬失败。
if [ "$TOKEN_OK" -ne 1 ]; then
  if [ "$DRY_RUN" -eq 1 ] && [ "$SKIP_TOKEN_CHECK" -eq 1 ]; then
    err "dry-run: blob unavailable from vault — proceeding to print plan only (--skip-token-check)."
  else
    err "error: could not read OAuth blob for account '$EMAIL' from vault ($VAULT_KIND)."
    err "  录号（一次性人工，在该号已登录环境）: /cc-master:accounts --add $EMAIL → 完整 blob 存进 vault（绝不 commit）。"
    exit 1
  fi
fi

# ───────────────────────── token 到期巡检（best-effort，不读 token 值）─────────────────────────
# 仅在 file vault 形态下、若旁存了 <email>_EXPIRES=YYYY-MM-DD，切前对比当日给软提醒。
# 它读的是 expires 日期（非敏感），绝不碰 token 值。用 awk index($0,p)==1 行首锚定（§A.4：email 元字符安全 +
#   P2-5 同款行首锚定——expires 虽非密，但与 token 取行同 bug 类，保持一致：grep -F 子串匹配可在重叠标识下取错行）。
if [ "$VAULT_KIND" = "file" ] && [ -f "$VAULT_FILE" ]; then
  exp_prefix="$(node -e 'const{fileVaultLineMatch}=require(process.argv[1]);process.stdout.write(fileVaultLineMatch(process.argv[2]).expiresLine)' "$LIB_JS" "$EMAIL" 2>/dev/null)" || exp_prefix=""
  if [ -n "$exp_prefix" ]; then
    exp_line="$(awk -v p="$exp_prefix" 'index($0, p) == 1' "$VAULT_FILE" 2>/dev/null | head -1 || true)"
    if [ -n "$exp_line" ]; then
      exp_date="${exp_line#"$exp_prefix"}"
      today="$(date -u +%Y-%m-%d)"
      # 字符串比较即可（ISO date 字典序 == 时间序）。exp_date 可能是 YYYY-MM-DD 或严格 ISO，取前 10 位比。
      exp_day="${exp_date:0:10}"
      if [ -n "$exp_day" ] && [ "$exp_day" \< "$today" ]; then
        err "WARNING: account '$EMAIL' OAuth token EXPIRED on $exp_day (今天 $today)."
        err "  切到该号可能认证失败——请重新登录该号（Orca / claude login）后跑 /cc-master:accounts --refresh ${EMAIL} 更新 vault。"
      fi
    fi
  fi
fi

# ═══════════════════════════ 无重启换号：覆写官方共享凭证三存储（核心动作·设计审查已过）═══════════════════════════
# **架构（先理解，所有下半身从此推导）**：无重启换号 = 覆写官方 claude CLI 读取的**共享**凭证存储，而非代理 /
#   不重启进程。运行中的 claude 在 access token 临近过期时**惰性 refresh、重读存储**——于是被覆写的新号被它接管。
#   故下半身不再 `exec claude`，而是：refresh 新号 → 回写 vault 保新鲜 → 覆写官方三存储（$USER 视角）→ 翻 registry。
#   全程 token-blind 给 node/registry（凭证只走 vault 读 / refresh POST body / 三存储写，绝不进 argv / registry / agent）。
#
# 三存储（官方 claude CLI 按 $USER 读的共享凭证·覆写顺序：先非权威后权威）：
#   ① ~/.claude/.credentials.json 的 .claudeAiOauth（凭证主存·原子写 tmp+rename·0600）。
#   ② ~/.claude.json 的 oauthAccount（账号身份字段·非 token·原子写·格外小心别整文件重写丢配置）。
#   ③ macOS keychain "Claude Code-credentials" / account=$USER（**注意官方条目名 + $USER**·非 cc-master-oauth+email·
#      经 `security -w "$wrapped"` argv 写入·避 stdin 128 截断）。Linux 无 keychain → 跳过（只写①②·同 `command -v security` 守卫）。

# ── refresh_blob：用 node https 主动 refresh，把 VAULT_BLOB 的 refresh token 换一份新鲜 8h access token ──
#   **绝不用 curl 把 token 放命令行（argv 泄漏）**——node https 把 refresh token 放 POST body、不进 argv。
#   入: $1 = vault blob（单行 JSON·含 refreshToken）。出: stdout = 全新单行 blob（accessToken 新 / expiresAt=now+expires_in*1000 /
#     refreshToken 用响应给的否则保留旧的 / scopes/subscriptionType 保留），rc 0；失败 rc 非 0 + stderr 原因（无 token）。
#   token-blind 给 node 的方式：blob 经 **stdin** 喂给 node（不进 argv）；node 解析 → POST refresh → 输出新 blob 到 stdout。
#   REFRESH_TOKEN_URL 可 env 覆写（测试注入 stub endpoint）。CLIENT_ID 是公开 OAuth client id（非密）。
REFRESH_TOKEN_URL="${REFRESH_TOKEN_URL:-https://platform.claude.com/v1/oauth/token}"
OAUTH_CLIENT_ID="${OAUTH_CLIENT_ID:-9d1c250a-e61b-44d9-88ed-5944d1962f5e}"
refresh_blob() {
  local in_blob="$1"
  printf '%s' "$in_blob" | node -e '
    "use strict";
    const https = require("https");
    const http = require("http");
    const { URL } = require("url");
    const url = process.argv[1];
    const clientId = process.argv[2];
    let s = "";
    process.stdin.on("data", (d) => { s += d; }).on("end", () => {
      let blob; try { blob = JSON.parse(s); } catch (_e) { process.stderr.write("refresh: vault blob 非法 JSON。\n"); process.exit(2); }
      const rt = blob && blob.refreshToken;
      if (typeof rt !== "string" || rt.indexOf("sk-ant-ort") !== 0) {
        process.stderr.write("refresh: vault blob 缺 refreshToken（前缀非 sk-ant-ort）——该号无 refresh token，无法主动续期（多半旧式残缺 blob）。\n");
        process.exit(3);
      }
      // x-www-form-urlencoded body：refresh token 放 body、绝不进 argv。
      const body = "grant_type=refresh_token&refresh_token=" + encodeURIComponent(rt) + "&client_id=" + encodeURIComponent(clientId);
      let u; try { u = new URL(url); } catch (_e) { process.stderr.write("refresh: REFRESH_TOKEN_URL 非法。\n"); process.exit(2); }
      const mod = u.protocol === "http:" ? http : https;
      const opts = {
        method: "POST",
        hostname: u.hostname,
        port: u.port || (u.protocol === "http:" ? 80 : 443),
        path: u.pathname + (u.search || ""),
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) },
      };
      const req = mod.request(opts, (res) => {
        let chunks = "";
        res.on("data", (c) => { chunks += c; });
        res.on("end", () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            // 绝不回显响应体（可能含 token / 错误细节）——只报状态码。
            process.stderr.write("refresh: oauth 端点返回 HTTP " + res.statusCode + "（refresh token 可能失效）。\n");
            process.exit(4);
          }
          let r; try { r = JSON.parse(chunks); } catch (_e) { process.stderr.write("refresh: oauth 响应非 JSON。\n"); process.exit(4); }
          const at = r.access_token;
          if (typeof at !== "string" || at.indexOf("sk-ant-oat") !== 0) { process.stderr.write("refresh: oauth 响应缺 access_token（前缀非 sk-ant-oat）。\n"); process.exit(4); }
          const expiresIn = Number(r.expires_in);
          const newBlob = {
            accessToken: at,
            // 响应给了新 refresh token 用新的，否则保留旧的（端点可能轮转 refresh token）。
            refreshToken: (typeof r.refresh_token === "string" && r.refresh_token.indexOf("sk-ant-ort") === 0) ? r.refresh_token : rt,
            expiresAt: Date.now() + (isFinite(expiresIn) ? expiresIn : 8 * 3600) * 1000,
          };
          // scopes：响应给了用响应的（空格分隔），否则保留旧 blob 的。
          if (typeof r.scope === "string" && r.scope) newBlob.scopes = r.scope.split(/\s+/);
          else if (Array.isArray(blob.scopes)) newBlob.scopes = blob.scopes;
          if (typeof blob.subscriptionType === "string" && blob.subscriptionType) newBlob.subscriptionType = blob.subscriptionType;
          if (typeof blob.rateLimitTier === "string" && blob.rateLimitTier) newBlob.rateLimitTier = blob.rateLimitTier;
          process.stdout.write(JSON.stringify(newBlob)); // 单行（无内嵌换行）。
        });
      });
      req.on("error", (e) => { process.stderr.write("refresh: 网络错误（" + (e && e.code || "ERR") + "）。\n"); process.exit(5); });
      req.write(body);
      req.end();
    });
  ' "$REFRESH_TOKEN_URL" "$OAUTH_CLIENT_ID"
}

# ── writeback_vault BLOB：把刷新后的新鲜 blob 回写 cc-master vault（覆写该 email 的 vault 项/行）──
#   关键：vault 里 refresh token 保持新鲜，下次换回仍有效。复用 store_blob 的写骨架（keychain `-w "$blob"` 值作
#   argv / file awk 删旧行 + printf）。**keychain 必须用 `-w "$blob"`（值作 argv）而非 stdin 喂**：stdin 喂的
#   `security -w`（末位不带值）走 readpassphrase 有硬上限 128 字节，~471 字节 blob 会被截成残片丢 refreshToken。
#   token-blind 细化（用户拍板抉择 A）：token 经 `security` argv 参数写入、接受 sub-second 本机局部暴露，绝不进
#   agent context / log / registry。
writeback_vault() {
  local blob="$1"
  case "$VAULT_KIND" in
    keychain)
      command -v security >/dev/null 2>&1 || { err "writeback: keychain 不可用（非 mac）——跳过 vault 回写。"; return 1; }
      security add-generic-password -U -s "$KEYCHAIN_SERVICE" -a "$EMAIL" -l "cc-master OAuth: $EMAIL" -w "$blob" >/dev/null 2>&1 || { err "writeback: keychain 写失败。"; return 1; }
      ;;
    file)
      umask 077; mkdir -p "$(dirname "$VAULT_FILE")" 2>/dev/null || true
      # **只删 `<email>_TOKEN=` 行·保留 `<email>_EXPIRES=`（codex P3·已坐实）**：旧码用 `.prefix`（`<email>_`）
      #   删**所有** `<email>_` 行（含非密 `<email>_EXPIRES=`），首次换号回写后 _EXPIRES sidecar 即消失 → 后续
      #   file-vault 到期巡检读不到 _EXPIRES 无法告警。改用 `.tokenLine`（`<email>_TOKEN=`）当 awk 匹配前缀，只删
      #   token 行、_EXPIRES 存活。token-blind 不变（awk 只按前缀删行·不读等号右侧 blob 值）。
      local token_line
      token_line="$(node -e 'const{fileVaultLineMatch}=require(process.argv[1]);process.stdout.write(fileVaultLineMatch(process.argv[2]).tokenLine)' "$LIB_JS" "$EMAIL" 2>/dev/null)" || token_line=""
      [ -n "$token_line" ] || { err "writeback: 无法取 email 安全前缀——跳过 vault 回写（拒裸正则）。"; return 1; }
      if [ -f "$VAULT_FILE" ]; then
        if awk -v p="$token_line" 'index($0, p) != 1' "$VAULT_FILE" > "$VAULT_FILE.tmp" 2>/dev/null; then
          mv "$VAULT_FILE.tmp" "$VAULT_FILE"
        else
          rm -f "$VAULT_FILE.tmp"; err "writeback: 删旧 vault 行失败——保留原文件。"; return 1
        fi
      fi
      printf '%s_TOKEN=%s\n' "$EMAIL" "$blob" >> "$VAULT_FILE" || { err "writeback: 写新 vault 行失败。"; return 1; }
      # 旁存 _EXPIRES（refresh token 长期有效期·非密·token-blind）——沿用 registry 的 token_expires_at 不在此动。
      #   注意：只删 _TOKEN 行（见上）→ 原有 _EXPIRES 行被保留，不被回写清掉。
      ;;
    env)
      # env 形态无持久存储可回写——跳过（仅调试用·告警）。
      err "writeback: env vault 形态无持久存储——跳过 vault 回写（refresh 后的新鲜 blob 不持久，下次换回需重 refresh）。"
      return 1
      ;;
  esac
  return 0
}

# ── 覆写三存储的 snapshot/rollback temp（codex P2-C·全或无·token-blind·照搬 account-add.sh 的 snapshot 纪律）──
#   病根：三存储覆写顺序 ① credentials.json → ② ~/.claude.json → ③ keychain。若 ③ 在 ①② **已写新号之后**失败，
#   旧码直接 return 1、caller 不翻 registry active（保守留旧号），结果 = split-brain：①② 已是新号、③+registry 仍旧号。
#   修：写 ①② **之前**先 snapshot ①②（文件 cp 到 0600 temp·token 随文件走·绝不读值进变量/argv/echo），③ 失败时
#   把 snapshot cp 回原位（原子：写 tmp + mv），让三存储**全回到旧号**（全或无）；任何退出路径都清理 snapshot temp。
SNAP_CRED_TMP=""   # 0600 temp 备份 credentials.json（含 token·文件 cp·token-blind）；空 = 未 snapshot 或文件不存在
SNAP_CJ_TMP=""     # 0600 temp 备份 ~/.claude.json（非密身份·统一文件 cp）；空 = 未 snapshot 或文件不存在
CRED_PREEXISTED=0  # 1 = credentials.json 换号前已存在（回滚→从 snapshot 恢复）；0 = 换号新建（回滚→rm -f 删回无此文件）
CJ_PREEXISTED=0    # 1 = ~/.claude.json 换号前已存在（回滚→从 snapshot 恢复）；0 = 换号新建（回滚→rm -f 删回无此文件）
cleanup_overwrite_snapshots() { rm -f "$SNAP_CRED_TMP" "$SNAP_CJ_TMP" 2>/dev/null || true; }
trap cleanup_overwrite_snapshots EXIT

# rollback_official_stores_12 CRED_PATH CLAUDE_JSON —— 把 ①② 回滚到换号前状态（原子·token 随文件走·绝不 echo）。
#   **全或无含新建文件（codex P2·已坐实）**：文件 **原本存在**（*_PREEXISTED=1）→ 从 snapshot cp 回原位（写 tmp + mv）；
#   文件 **原本不存在**（*_PREEXISTED=0·换号新建的）→ rm -f 删掉它，回到换号前「无此文件」状态（不是留着带新号 token 的新文件）。
#   回 0 = 全回滚成功（或本就无可回滚跳过）；回 1 = 至少一步失败（可能 split-brain）。token-blind：含 token 的 ① 全程文件 cp/rm。
rollback_official_stores_12() {
  local cred_path="$1" claude_json="$2"
  local ok=0
  # ① credentials.json：原本存在 → snapshot 恢复；原本不存在（新建的）→ 删回无此文件状态。
  if [ "$CRED_PREEXISTED" -eq 1 ] && [ -n "$SNAP_CRED_TMP" ] && [ -f "$SNAP_CRED_TMP" ]; then
    if ( umask 077; cp "$SNAP_CRED_TMP" "$cred_path.ccm-rb.$$" 2>/dev/null && mv "$cred_path.ccm-rb.$$" "$cred_path" 2>/dev/null ); then
      chmod 600 "$cred_path" 2>/dev/null || true
    else
      rm -f "$cred_path.ccm-rb.$$" 2>/dev/null || true; ok=1
    fi
  elif [ "$CRED_PREEXISTED" -eq 0 ]; then
    if rm -f "$cred_path" 2>/dev/null; then
      err "stores: 回滚删除换号新建的 ① credentials.json（换号前无此文件·回到无此文件状态·避免 split-brain）。"
    else
      ok=1
    fi
  else
    # **codex §7 P2-c**：原本存在（CRED_PREEXISTED=1）但 snapshot 缺失（SNAP_CRED_TMP 空/丢——换号前 cp 快照失败）。
    #   ② node 块已把 ① 覆写成新号、却无快照可恢复 → 静默跳过会让 ok 维持成功态、caller 谎报「已回滚」，而新号 token
    #   仍在原地 = 正是这段回滚要防的 split-brain。故**标记回滚失败**（ok=1）让 caller 如实报 split-brain 风险 / 需手动对账。
    err "stores: ① credentials.json 换号前已存在但无快照可恢复（换号前快照失败）——无法回滚到旧号·**可能 split-brain**（① 已是新号 token）·需手动对账！"
    ok=1
  fi
  # ② ~/.claude.json：原本存在 → snapshot 恢复；原本不存在（新建的）→ 删回无此文件状态。
  if [ "$CJ_PREEXISTED" -eq 1 ] && [ -n "$SNAP_CJ_TMP" ] && [ -f "$SNAP_CJ_TMP" ]; then
    if ( umask 077; cp "$SNAP_CJ_TMP" "$claude_json.ccm-rb.$$" 2>/dev/null && mv "$claude_json.ccm-rb.$$" "$claude_json" 2>/dev/null ); then
      :
    else
      rm -f "$claude_json.ccm-rb.$$" 2>/dev/null || true; ok=1
    fi
  elif [ "$CJ_PREEXISTED" -eq 0 ]; then
    if rm -f "$claude_json" 2>/dev/null; then
      err "stores: 回滚删除换号新建的 ② ~/.claude.json（换号前无此文件·回到无此文件状态·避免 split-brain）。"
    else
      ok=1
    fi
  else
    # **codex §7 P2-c（CJ 同类分支·一并审）**：② 原本存在但无快照可恢复——② 已被覆写成新号 oauthAccount、无快照恢复。
    #   ② 是身份显示层（非密·非凭证主存），但同样被写成了新号且回不去 → 仍是 split-brain 的一部分，须标回滚失败（不静默跳过）。
    err "stores: ② ~/.claude.json 换号前已存在但无快照可恢复（换号前快照失败）——无法回滚到旧号·**可能 split-brain**（② oauthAccount 已是新号）·需手动对账！"
    ok=1
  fi
  return $ok
}

# ── overwrite_official_stores BLOB IDENTITY：覆写官方共享凭证三存储（$USER 视角·原子写·token-blind 给 node 经 stdin）──
#   blob（含 token·bearer secret）经 **stdin** 喂给一个 node 程序（**绝不**进 argv），node 原子写①②，再由 bash 用 `security -w "$wrapped"` argv 写 keychain③（避 stdin 128 截断·抉择 A 接受的本机局部暴露）。
#   identity（= ~/.claude.json oauthAccount 原样·**全非密**身份字段·无 token-shaped 值）经 **argv** 传给 node（合规·非密）。
#   返回 0 = 全部成功（或 Linux 跳过③）；非 0 = 某步失败（stderr 标到哪步·绝不回显 blob）。
#   **全或无（codex P2-C）**：写 ①② 前先 snapshot ①②（文件 cp·token-blind），③ keychain 失败 → 回滚 ①② 到旧号，
#   三存储全留旧号（换号未发生·可重试），消除 split-brain。
overwrite_official_stores() {
  local blob="$1"
  local identity_json="$2"   # 切入号 registry identity（非密·经 argv）；缺/空 → ②段降级只同步 subscriptionType。
  # ①② 用 node 原子写（凭证经 stdin 不进 argv·identity 经 argv）。CRED_PATH / CLAUDE_JSON_PATH 可 env 覆写（测试注入）。
  local cred_path="${CRED_PATH:-${HOME}/.claude/.credentials.json}"
  local claude_json="${CLAUDE_JSON_PATH:-${HOME}/.claude.json}"

  # ── snapshot ①②（写之前·全或无回滚的前提·token-blind 文件 cp·仅文件存在时做）──────────────────────────
  #   ① credentials.json 含 token → 文件 cp 到 0600 temp（token 随文件走·绝不 cat/读值进变量/echo/argv）。
  #   ② ~/.claude.json 非密 → 也统一文件 cp 到 0600 temp（整文件备份·回滚时整文件写回·只此函数动它）。
  #   **新建文件全或无（codex P2·已坐实）**：node 块会 **创建** 不存在的 ①②（写新号 token）。若文件原本不存在、
  #   snapshot 为空，③ 失败时从空 snapshot 恢复 = 没东西可恢复 → 新建的（带新号 token 的）文件留下 = split-brain。
  #   故记录每个文件 **换号前是否存在**（CRED_PREEXISTED/CJ_PREEXISTED）；rollback 时：原本存在 → 从 snapshot 恢复；
  #   原本不存在（换号新建的）→ rm -f 删回「无此文件」状态，让 rollback 即便文件是新建的也真全或无。
  SNAP_CRED_TMP=""; SNAP_CJ_TMP=""
  CRED_PREEXISTED=0; CJ_PREEXISTED=0
  if [ -f "$cred_path" ]; then
    CRED_PREEXISTED=1
    SNAP_CRED_TMP="$(mktemp 2>/dev/null || printf '%s' "${TMPDIR:-/tmp}/.ccm-sw-credsnap.$$")"
    if ( umask 077; cp "$cred_path" "$SNAP_CRED_TMP" 2>/dev/null ); then
      chmod 600 "$SNAP_CRED_TMP" 2>/dev/null || true
    else
      rm -f "$SNAP_CRED_TMP" 2>/dev/null || true; SNAP_CRED_TMP=""
      err "stores: 快照 ① credentials.json 失败——继续换号，但若 ③ keychain 失败将无法回滚 ①（需手动对账）。"
    fi
  fi
  if [ -f "$claude_json" ]; then
    CJ_PREEXISTED=1
    SNAP_CJ_TMP="$(mktemp 2>/dev/null || printf '%s' "${TMPDIR:-/tmp}/.ccm-sw-cjsnap.$$")"
    if ( umask 077; cp "$claude_json" "$SNAP_CJ_TMP" 2>/dev/null ); then
      chmod 600 "$SNAP_CJ_TMP" 2>/dev/null || true
    else
      rm -f "$SNAP_CJ_TMP" 2>/dev/null || true; SNAP_CJ_TMP=""
      err "stores: 快照 ② ~/.claude.json 失败——继续换号，但若 ③ keychain 失败将无法回滚 ②（需手动对账）。"
    fi
  fi

  if ! printf '%s' "$blob" | node -e '
    "use strict";
    const fs = require("fs");
    const path = require("path");
    const credPath = process.argv[1];
    const claudeJson = process.argv[2];
    const identityRaw = process.argv[3] || "";   // 非密 identity JSON（argv·可空 → ②降级）。
    let s = "";
    process.stdin.on("data", (d) => { s += d; }).on("end", () => {
      let blob; try { blob = JSON.parse(s); } catch (_e) { process.stderr.write("stores: blob 非法 JSON。\n"); process.exit(1); }

      // 原子写 helper：写 tmp（0600）→ rename 覆盖（同分区原子）。绝不整文件重建——只改目标子对象、保留其它键。
      function atomicWrite(filePath, obj) {
        const dir = path.dirname(filePath);
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const tmp = path.join(dir, "." + path.basename(filePath) + ".tmp-" + process.pid + "-" + Date.now());
        fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", { mode: 0o600 });
        try { fs.chmodSync(tmp, 0o600); fs.renameSync(tmp, filePath); fs.chmodSync(filePath, 0o600); }
        catch (e) { try { fs.unlinkSync(tmp); } catch (_) {} throw e; }
      }

      // ① ~/.claude/.credentials.json：读现有→只把 .claudeAiOauth 换成新 blob→保留其它字段→原子写回。
      try {
        let cred = {};
        try { cred = JSON.parse(fs.readFileSync(credPath, "utf8")); } catch (_e) { cred = {}; }
        if (!cred || typeof cred !== "object" || Array.isArray(cred)) cred = {};
        // claudeAiOauth 全量换成新 blob（它本就是 OAuth 凭证子对象）。保留 cred 的其它顶层键（若有）。
        cred.claudeAiOauth = blob;
        atomicWrite(credPath, cred);
        process.stderr.write("stores: ① credentials.json .claudeAiOauth 已覆写（原子·0600）。\n");
      } catch (e) {
        process.stderr.write("stores: ① credentials.json 写失败：" + (e && e.code || e) + "\n");
        process.exit(1);
      }

      // ② ~/.claude.json 的 oauthAccount：读→改 oauthAccount 子对象→保留所有其它键→原子写回。
      //    格外小心别整文件重写丢配置：只在已存在的 ~/.claude.json 上改 oauthAccount，其它 75+ 键原样保留。
      //    **双路**：有 registry identity（非密身份对象·经 argv 传入）→ **完整替换**整个 oauthAccount，让换号真切
      //    身份（accountUuid/emailAddress/organizationUuid/subscriptionType 等全换成切入号）。无/空/解析失败 identity →
      //    **降级**回旧行为：保留旧 oauthAccount、仅当 blob.subscriptionType 存在且 oa 已有该字段时同步它（claude 主要
      //    按 credentials.json 的 token 认证；oauthAccount 是显示层身份）。降级时 surface 一条 stderr 提示补 identity。
      try {
        // 解析 identity（argv·非密）：非空对象 → 走完整替换；否则 → null（降级）。
        let identity = null;
        if (identityRaw) {
          try {
            const parsed = JSON.parse(identityRaw);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length > 0) identity = parsed;
          } catch (_e) { identity = null; }
        }
        if (fs.existsSync(claudeJson)) {
          let cj; try { cj = JSON.parse(fs.readFileSync(claudeJson, "utf8")); } catch (_e) { cj = null; }
          if (cj && typeof cj === "object" && !Array.isArray(cj)) {
            if (identity) {
              // 有 identity → 完整替换 oauthAccount（真切身份），保留 cj 所有其它顶层键。
              cj.oauthAccount = identity;
              atomicWrite(claudeJson, cj);
              process.stderr.write("stores: ② ~/.claude.json oauthAccount 已用 registry identity 完整替换（真切身份·其它键保留·原子）。\n");
            } else {
              // 无 identity → 降级：保留旧 oauthAccount，仅同步 subscriptionType（若 oa 已有该字段）。
              const oa = (cj.oauthAccount && typeof cj.oauthAccount === "object" && !Array.isArray(cj.oauthAccount)) ? cj.oauthAccount : {};
              if (typeof blob.subscriptionType === "string" && blob.subscriptionType && ("subscriptionType" in oa)) {
                oa.subscriptionType = blob.subscriptionType;
              }
              cj.oauthAccount = oa;     // 保留 oauthAccount 其它身份字段 + cj 所有其它顶层键。
              atomicWrite(claudeJson, cj);
              process.stderr.write("stores: ② ~/.claude.json 无 registry identity → 降级只同步 subscriptionType（登录显示可能仍是上一号·建议 --add 补 identity）。\n");
            }
          } else {
            process.stderr.write("stores: ② ~/.claude.json 非对象/损坏——跳过（不整文件重写·绝不丢配置）。\n");
          }
        } else {
          process.stderr.write("stores: ② ~/.claude.json 不存在——跳过（不新建·身份由 credentials.json token 主导）。\n");
        }
      } catch (e) {
        // ② 失败不致命（身份显示层）——surface 但不整体 fail（①是凭证主存、已成）。
        process.stderr.write("stores: ② ~/.claude.json 写失败（非致命·身份显示层）：" + (e && e.code || e) + "\n");
      }
    });
  ' "$cred_path" "$claude_json" "$identity_json"; then
    # ① 在 node 内 process.exit(1) 前于 ② 之前，故 ① 失败时 ② 未写、①是原子写本身未改——无需回滚，仅清 snapshot。
    cleanup_overwrite_snapshots; SNAP_CRED_TMP=""; SNAP_CJ_TMP=""
    err "overwrite-stores: ① credentials.json 覆写失败——未完成换号（凭证主存未更新）。"
    return 1
  fi

  # ③ macOS keychain "Claude Code-credentials" / account=$USER（官方条目名·非 cc-master-oauth+email）。
  #    Linux 无 keychain → 跳过（只写①②）。$wrapped 经 `security -w "$wrapped"`（值作 argv 参数）写入。
  #    **必须用 argv `-w "$wrapped"` 而非 stdin 喂**：stdin 喂的 `security -w`（末位不带值）走 readpassphrase 有
  #    硬上限 128 字节——`{"claudeAiOauth":...}` 包裹对象远超 128 字节，stdin 写会把官方登录凭证写成 128 残片
  #    （非法 JSON）→ brick 掉官方登录态。值作 argv 则存完整合法 JSON。
  #    **官方格式（codex P1·已坐实）**：真实「Claude Code-credentials」keychain 条目是 `{"claudeAiOauth":{...}}`
  #    包裹对象（与 credentials.json ① 写一致·account-add 的 keychain 读也读 `.claudeAiOauth`）——写扁平 $blob 会让
  #    claude 读不到 `.claudeAiOauth` → 当 corrupt/drift → 无重启换号不生效。故 ③ 写前先把 $blob 包成 claude 格式。
  #    **TOKEN-BLIND**（用户拍板抉择 A）：$wrapped 含 token，只作 `security` 的 argv 参数、绝不 echo/printf/log，
  #    接受写 keychain 时经 argv 的 sub-second 本机局部暴露（可读 argv 的同用户本就能直接读 keychain）。
  if command -v security >/dev/null 2>&1; then
    local wrapped="{\"claudeAiOauth\":${blob}}"   # $blob 是合法单行 JSON 对象 → 拼出 {"claudeAiOauth":{...}}（claude 官方格式）。
    if security add-generic-password -U -s "Claude Code-credentials" -a "$USER" -w "$wrapped" >/dev/null 2>&1; then
      err "stores: ③ keychain \"Claude Code-credentials\" account=$USER 已覆写（argv -w·完整 blob·避 128 截断）。"
    else
      # ③ keychain 失败、①② 已写新号 → split-brain（①②新号·③+registry 旧号）。**全或无**：把 ①② 回滚到旧号。
      if rollback_official_stores_12 "$cred_path" "$claude_json"; then
        err "stores: ③ keychain 失败 → 已回滚 ①②，三存储全留旧号，换号未发生，可重试。"
      else
        err "stores: ③ keychain 失败、且 ①② 回滚失败——可能 split-brain（部分官方凭证态已在新号上）·需手动对账！"
      fi
      cleanup_overwrite_snapshots; SNAP_CRED_TMP=""; SNAP_CJ_TMP=""
      return 1   # 换号确实没成（已回滚到旧号·不再 split-brain）；caller 不翻 registry active。
    fi
  else
    err "stores: ③ 无 security（非 mac）——跳过 keychain，只覆写了①② 两个文件（Linux 正常路径）。"
  fi
  cleanup_overwrite_snapshots; SNAP_CRED_TMP=""; SNAP_CJ_TMP=""
  return 0
}

# ───────────────────────── DRY-RUN（不真 refresh、不真覆写、不真写 registry）─────────────────────────
if [ "$DRY_RUN" -eq 1 ]; then
  plan "── switch-account.sh DRY-RUN (无重启换号·不真 refresh、不真覆写三存储、不真写 registry) ──"
  if [ "$EMAIL_EXPLICIT" -eq 1 ]; then
    plan "select         : (skipped — 用户显式 --email)"
  else
    plan "select         : 自动选号 select-account.js → $EMAIL"
  fi
  plan "switch-in email: $EMAIL"
  plan "registry       : $REGISTRY_PATH"
  plan "vault kind     : $VAULT_KIND$([ "$VAULT_KIND_EXPLICIT" -eq 1 ] && echo " (--vault-kind override)" || [ -n "$REG_VAULT_KIND" ] && echo " (from registry)")"
  case "$VAULT_KIND" in
    keychain) plan "vault source   : keychain service=$KEYCHAIN_SERVICE account=$EMAIL";;
    file)     plan "vault source   : file=$VAULT_FILE key=${EMAIL}_TOKEN (awk index==1 行首锚定·§A.4+P2-5 email 元字符/重叠标识安全)";;
    env)      plan "vault source   : env \$${EMAIL}_TOKEN";;
  esac
  if [ "$TOKEN_OK" -eq 1 ]; then
    plan "blob           : <redacted> (已从 vault 读入，长度=${#VAULT_BLOB}，绝不打印明文)"
  else
    plan "blob           : <UNAVAILABLE> (--skip-token-check：仅打印计划)"
  fi
  plan "would refresh  : node https POST ${REFRESH_TOKEN_URL}（refresh token 放 POST body·不进 argv·绝不 curl）→ 新鲜 8h access token"
  plan "would writeback: 回写 cc-master vault（${VAULT_KIND}·保 refresh token 新鲜，下次换回仍有效）"
  plan "would overwrite: 官方三存储（\$USER=$USER 视角·原子写）："
  plan "                 ① ~/.claude/.credentials.json .claudeAiOauth（凭证主存·tmp+rename·0600）"
  plan "                 ② ~/.claude.json oauthAccount（用 registry identity 完整替换·非密身份字段·保留其它 75+ 键·绝不整文件重写；无 identity 时降级只同步 subscriptionType）"
  plan "                 ③ keychain \"Claude Code-credentials\" account=\$USER（mac·security -w \"\$wrapped\" argv 写避 128 截断；Linux 跳过）"
  # snapshot + setActive（解耦·P2-2），时机：覆写三存储成功之后才翻 active。
  if [ "$NO_SNAPSHOT" -eq 1 ]; then
    plan "snapshot       : (skipped: --no-snapshot)"
  else
    dr_active="$(node -e '
      "use strict";
      try {
        const lib = require(process.argv[1]);
        const reg = lib.loadRegistry(process.argv[2]);
        const accts = reg.accounts || {};
        for (const [email, e] of Object.entries(accts)) { if (e && e.active === true) { process.stdout.write(email); break; } }
      } catch (_e) {}
    ' "$LIB_JS" "$REGISTRY_PATH" 2>/dev/null || true)"
    if [ -z "$dr_active" ]; then
      plan "snapshot       : (no current active in registry — 无切出快照可写)"
    elif [ "$dr_active" = "$EMAIL" ]; then
      plan "snapshot       : (current active == $EMAIL — 已是该号，无需切出快照)"
    else
      plan "snapshot       : WOULD recordSwitchOut for $dr_active (cc-usage 5h/7d used_pct+resets_at+source; best-effort·可降级)"
    fi
  fi
  plan "set-active     : WOULD setActive=$EMAIL (覆写三存储成功后才翻 active·与 snapshot 解耦)"
  if [ -n "$BOARD_SEL" ]; then
    plan "board (deprecated): $BOARD_SEL  (无重启换号不再 resume 板·--board 保留为 no-op)"
  fi
  plan "note           : 无重启换号——claude 进程不重启；access token 临近过期时官方 CLI 惰性 refresh 重读被覆写的存储 → 新号被接管。"
  plan "note           : refresh 失败 → 不覆写任何存储、registry 原封不动、surface 退非 0（非变更性 preflight）。"
  plan "note           : 凭证全程脚本子进程 / vault / refresh POST body / 三存储写，绝不进 agent / registry / argv。"
  plan "── end DRY-RUN（未 refresh、未覆写、未写 registry、未泄凭证）──"
  exit 0
fi

# ═══════════════════════════ 真切（无重启换号·不 exec·token-blind 全程）═══════════════════════════
# 到这里 TOKEN_OK 必为 1（非 dry-run 路径取不到 blob 已在上面 exit 1）。下半身（全 token-blind）：
#   1) 主动 refresh（非变更性 preflight）→ 失败则不覆写任何存储、registry 原封不动、surface 退非 0。
#   2) 回写 cc-master vault（保 refresh token 新鲜）。
#   3) 覆写官方三存储（先非权威后权威）。
#   4) snapshot + setActive（覆写成功后才翻 registry active·P2-2 解耦）。

# 1) 主动 refresh（非变更性 preflight·失败不动任何存储）。新鲜 blob 进 NEW_BLOB（绝不打印）。
#    refresh_blob 退出码（来自内嵌 node·语义化）：0=成功；2=blob 非法 JSON / URL 非法；3=blob 缺 refresh token；
#    4=oauth 端点返回非 2xx（**refresh token 失效**·设计稿 step 6：硬失败·不覆写）；5=网络错误（端点不通·设计稿
#    step 10：可退 force-refresh 兜底——refresh token 多半仍有效、只是端点momentarily 不通，让 claude 自己重试）。
NEW_BLOB="$(refresh_blob "$VAULT_BLOB" 2>/tmp/.ccm-refresh-err.$$)"; refresh_rc=$?
refresh_err="$(cat "/tmp/.ccm-refresh-err.$$" 2>/dev/null || true)"; rm -f "/tmp/.ccm-refresh-err.$$" 2>/dev/null || true
FORCE_REFRESH_FALLBACK=0
if [ "$refresh_rc" -ne 0 ] || [ -z "$NEW_BLOB" ]; then
  [ -n "$refresh_err" ] && err "$refresh_err"
  # ── 失败分流（设计稿 step 6 vs step 10）──
  #   · rc=3（缺 refresh token·残缺旧式 blob）→ **硬失败**：无 refresh 能力、force-refresh 也无意义 → exit 非 0。
  #   · rc=4（oauth 非 2xx·refresh token 失效）→ **硬失败**（设计稿 step 6）：refresh token 已失效，force-refresh
  #     用同一失效 token 也会失败、还会留下临近过期的坏存储 → **不覆写任何存储、registry 原封不动**、surface 退非 0。
  #   · rc=5（网络错误·端点不通）→ **force-refresh 兜底**（设计稿 step 10）：refresh token 多半仍有效，只是端点
  #     momentarily 不通；退回「覆写 vault 原 blob + expiresAt 临近过期，逼官方 CLI 自己 refresh」，有 vault-stale 风险但是安全网。
  #   · rc=2 / 其它 → 硬失败（输入/逻辑错·不该 force-refresh）。
  if [ "$refresh_rc" -eq 5 ]; then
    # 网络不通 → force-refresh 兜底。仅当 vault blob 本身有 refresh token（rc=5 已说明能解析出 refresh token）。
    err "switch-account: 主动 refresh 网络不通——退化到 force-refresh 兜底（覆写原 blob + expiresAt 临近过期，逼官方 CLI 自己 refresh）。"
    err "  ⚠ vault-stale 风险：claude 自己 refresh 后的新 token 不会回写 cc-master vault——下次换回该号可能需先 --refresh。"
    NEW_BLOB="$(printf '%s' "$VAULT_BLOB" | node -e '"use strict";let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let o;try{o=JSON.parse(s)}catch(_e){process.exit(1)}o.expiresAt=Date.now()+60*1000;process.stdout.write(JSON.stringify(o))})' 2>/dev/null)" || NEW_BLOB=""
    if [ -z "$NEW_BLOB" ]; then
      err "error: force-refresh 兜底也失败（blob 处理出错）——未覆写任何存储、registry 原封不动。"
      exit 1
    fi
    FORCE_REFRESH_FALLBACK=1
  elif [ "$refresh_rc" -eq 4 ]; then
    err "error: refresh token 可能已失效（oauth 端点拒绝）——**未覆写任何存储**、registry 原封不动（设计稿 step 6）。"
    err "  请用 /cc-master:accounts --refresh ${EMAIL} 重录该号完整 blob 后重试。"
    exit 1
  elif [ "$refresh_rc" -eq 3 ]; then
    err "error: 该号 vault blob 缺 refresh token（多半旧式残缺 blob）——无法 refresh、无法 force-refresh 兜底。"
    err "  请用 /cc-master:accounts --refresh ${EMAIL} 重录完整 blob 后重试。未覆写任何存储、registry 原封不动。"
    exit 1
  else
    err "error: refresh 失败（rc=${refresh_rc}·blob/URL 输入或逻辑错）——未覆写任何存储、registry 原封不动。"
    exit 1
  fi
fi

# 2) 回写 cc-master vault（保 refresh token 新鲜）。force-refresh 兜底下不回写（原 blob 没变·避免覆写成临近过期）。
if [ "${FORCE_REFRESH_FALLBACK:-0}" -ne 1 ]; then
  if writeback_vault "$NEW_BLOB"; then
    err "switch-account: 已回写 cc-master vault（${EMAIL}·refresh token 保新鲜）。"
  else
    # 回写失败非致命——三存储仍会覆写（换号现实仍发生），只是 vault 里的 token 没更新到最新。surface。
    err "switch-account: ⚠ vault 回写失败——三存储仍会覆写（换号继续），但 cc-master vault 里 $EMAIL 的 token 未更新到最新（下次换回可能需 --refresh）。"
  fi
fi

# 3) 覆写官方三存储（先非权威后权威）。① credentials.json 失败 = 致命（凭证主存未更新）→ 退非 0、不翻 registry。
if ! overwrite_official_stores "$NEW_BLOB" "$REG_IDENTITY_JSON"; then
  err "error: 覆写官方凭证存储失败（见上面 stores: 标到哪步）——换号未完成。registry 不翻 active（避免「registry 标新号、存储仍旧号」损坏态）。"
  # ③ keychain 失败时 overwrite_official_stores 已回滚 ①②到旧号（全或无·P2-C），三存储与 registry 全留旧号·不再 split-brain；
  #   surface 让用户对账（仅当回滚自身也失败才可能 split-brain·已在 stores: 强告警）；registry 不翻（active 仍指旧号·保守）。
  exit 1
fi
# 新号已被官方三存储接管；NEW_BLOB 用完即弃（绝不进 registry）。
unset NEW_BLOB VAULT_BLOB 2>/dev/null || true

# 4) snapshot + setActive（覆写三存储成功之后才翻 registry active·P2-2 解耦）。
#    先 (A) snapshot（best-effort、失败容忍），再 (B) setActive（可靠、独立落盘）。
if [ "$NO_SNAPSHOT" -ne 1 ]; then
  record_switch_out      # (A) 写切出快照——失败仅少一条快照，绝不阻断、绝不连累 (B)。
fi
set_active_in            # (B) 翻 active 到切入号——独立可靠落盘（与快照解耦·三存储已覆写才到这）。

err "✓ 无重启换号完成：官方共享凭证三存储已覆写为 ${EMAIL}（\$USER=${USER} 视角）。"
err "  运行中的 claude 在 access token 临近过期时会惰性 refresh、重读被覆写的存储 → 新号接管（无需重启进程）。"
if [ "${FORCE_REFRESH_FALLBACK:-0}" -eq 1 ]; then
  err "  （本次走 force-refresh 兜底：覆写原 blob + 临近过期逼 claude 自己 refresh·有 vault-stale 风险，见上。）"
fi
exit 0
