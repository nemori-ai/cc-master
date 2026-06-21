#!/usr/bin/env bash
# account-delete.sh — out-of-band「把一个备号从号池里删干净」wrapper（NOT a hook）。
#
# A2 account-management skill 的删号写侧：给一个 email，把它从号池**两处**删干净：
#   ① accounts.json registry entry（accounts-lib.js removeAccount，非密）；
#   ② vault 里的 token（keychain `security delete-generic-password` / file 删 <email>_TOKEN/_EXPIRES 行）。
# delete 删的是 token 的 vault 痕迹——一份留在 vault 的过期/废弃 OAuth token 是 bearer-secret 残留，必须删净。
#
# ───────────────────────────── 命门：token 永不经过 agent / 绝不回显（HARD）─────────────────────────────
# 本脚本**不读 token 值**（删 vault 是按 email 前缀删项/删行，token-blind）：
#   · keychain：`security delete-generic-password -a <email> -s <service>`（**绝不带 -w**，不取值）。
#   · file：用 accounts-lib.fileVaultLineMatch 给的 **awk index() 精确前缀**删 <email>_* 行（绝不 grep -E
#     的 `^email_`——email 含 `.`/`@` 是正则元字符，会误删 sibling·§A.4 必修 bug），删行只看前缀、不读值。
#   · registry：removeAccount 删非密 entry，无 token 可言。
# stdout 全程只有「✓ 已删 / ✗ 未找到 / 警告」非密信息，绝不回显任何 token。set +x / unset SHELLOPTS 加固。
#
# ───────────────────────── 落点纪律（红线 1/5）─────────────────────────
# out-of-band 脚本，**绝不进 hooks/**；调 `security` / `node`（带外，云后端 no-op）。

# ───────────────────────── 安全开头（HARD·虽不读 token，仍堵 xtrace 防 email/路径污染日志）─────────────────────────
set +x
unset SHELLOPTS 2>/dev/null || true

# ───────────────────────── 云后端自检（红线 5，no-op 退出）─────────────────────────
if [ -n "${CLAUDE_CODE_USE_BEDROCK:-}" ] || [ -n "${CLAUDE_CODE_USE_VERTEX:-}" ] || [ -n "${CLAUDE_CODE_USE_FOUNDRY:-}" ]; then
  printf '%s\n' "account-delete: 云后端（Bedrock/Vertex/Foundry）无订阅 OAuth token 可管 —— 删号不适用，no-op 退出。" >&2
  exit 0
fi

set -uo pipefail

# ───────────────────────── 路径自解析（self-contain，同 account-add.sh）─────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
LIB_JS="${CLAUDE_SKILL_DIR:-$SCRIPT_DIR/..}/scripts/accounts-lib.js"
[ -f "$LIB_JS" ] || LIB_JS="$SCRIPT_DIR/accounts-lib.js"

err()  { printf '%s\n' "$*" >&2; }
info() { printf '%s\n' "$*"; }

usage() {
  err "usage: account-delete.sh --email <email> [--vault-kind keychain|file]"
  err "       [--vault-file <path>] [--keychain-service <s>] [--dry-run]"
  err ""
  err "  从 accounts.json registry 删 entry + 从 vault 删 token（keychain delete / file 删行）。"
  err "  vault-kind 缺省自动从 registry entry 的 vault.kind 推断（推不出则默认 keychain）。token 不回显。"
}

# ───────────────────────── arg 解析 ─────────────────────────
EMAIL=""; DRY_RUN=0
VAULT_KIND=""           # 空 = 待会儿从 registry entry 的 vault.kind 推断
KEYCHAIN_SERVICE="cc-master-oauth"
KEYCHAIN_SERVICE_EXPLICIT=0   # 用户显式 --keychain-service → 不被 registry 推断覆盖（对齐 switch-account.sh）
VAULT_FILE="${CC_MASTER_HOME:-${HOME}/.claude/cc-master}/accounts.env"
VAULT_FILE_EXPLICIT=0         # 用户显式 --vault-file → 不被 registry 推断覆盖

# value 型 flag 缺值守卫（robustness·codex §7 P2-a·防死循环）：value 型 flag 缺第二个 arg 时 `shift 2` 失败、
#   arg list 不变 → `while [ $# -gt 0 ]` 死循环到被 kill（脚本无 set -e）。故每个 `shift 2` 前先确认存在第二个
#   arg（`[ $# -ge 2 ]`），缺值则 error+usage 退非 0。
need_val() { [ "$#" -ge 2 ] || { err "error: option '$1' requires a value."; usage; exit 2; }; }
while [ $# -gt 0 ]; do
  case "$1" in
    --email|--account)  need_val "$@"; EMAIL="$2"; shift 2;;
    --vault-kind)       need_val "$@"; VAULT_KIND="$2"; shift 2;;
    --vault-file)       need_val "$@"; VAULT_FILE="$2"; VAULT_FILE_EXPLICIT=1; shift 2;;
    --keychain-service) need_val "$@"; KEYCHAIN_SERVICE="$2"; KEYCHAIN_SERVICE_EXPLICIT=1; shift 2;;
    --dry-run)          DRY_RUN=1; shift;;
    -h|--help)          usage; exit 0;;
    *) err "unknown arg: $1"; usage; exit 2;;
  esac
done

if [ -z "$EMAIL" ]; then
  err "error: --email <email> is required."
  usage; exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  err "error: 'node' not found in PATH — 无法读/写 accounts.json registry。"
  exit 1
fi

# ───────────────────────── 从 registry 读 entry 的 vault 形态（推断 kind / 取实际 file path）─────────────────────────
# 读 registry entry 的 vault 引用——非密（只是「token 在哪」的指针）。用它推断 vault-kind + file path，
#   让 delete 删对地方（用户没显式 --vault-kind 时）。registry 不存在/无此 entry → 用默认/CLI 给的形态尽力删 vault。
# 输出三行：kind / service|"" / path|""（无 entry 则全空）。绝不读 token。
read_vault_ref() {
  node -e '
    "use strict";
    const lib = require(process.argv[1]);
    const email = process.argv[2];
    let reg; try { reg = lib.loadRegistry(lib.defaultRegistryPath()); } catch (e) { reg = { accounts: {} }; }
    const e = reg.accounts && reg.accounts[email];
    if (!e || !e.vault) { process.stdout.write("\n\n\n"); process.exit(0); }
    const v = e.vault;
    process.stdout.write((v.kind||"") + "\n" + (v.service||"") + "\n" + (v.path||"") + "\n");
  ' "$LIB_JS" "$EMAIL" 2>/dev/null || printf '\n\n\n'
}

REG_KIND=""; REG_SERVICE=""; REG_PATH=""
{ read -r REG_KIND; read -r REG_SERVICE; read -r REG_PATH; } < <(read_vault_ref)

# vault-kind：CLI 显式 > registry 推断 > 默认 keychain。
if [ -z "$VAULT_KIND" ]; then
  if [ -n "$REG_KIND" ]; then VAULT_KIND="$REG_KIND"; else VAULT_KIND="keychain"; fi
fi
case "$VAULT_KIND" in
  keychain|file) ;;
  *) err "error: --vault-kind must be one of keychain|file (got: $VAULT_KIND)"; exit 2;;
esac
# keychain service / file path：优先级 = **显式 CLI > registry 推断 > 默认**（对齐 switch-account.sh 的 *_EXPLICIT 范式）。
#   仅在用户**没显式**传 --keychain-service / --vault-file 时，才用 registry 记的实际落点覆盖默认。
#   **P2-12（codex round-4）**：旧码无条件 `[ -n "$REG_SERVICE" ] && KEYCHAIN_SERVICE=…` / `[ -n "$REG_PATH" ] && VAULT_FILE=…`，
#   即便用户显式传了（要从已修复 / 非默认的 vault 位置删）也被 registry 覆盖掉——显式 override 在最需要它的
#   stale-registry 场景失效（registry 指向旧/错落点 → 删错 vault 项 / 删不掉目标 token）。加 *_EXPLICIT guard 修复。
[ "$KEYCHAIN_SERVICE_EXPLICIT" -ne 1 ] && [ -n "$REG_SERVICE" ] && KEYCHAIN_SERVICE="$REG_SERVICE"
[ "$VAULT_FILE_EXPLICIT" -ne 1 ] && [ -n "$REG_PATH" ] && VAULT_FILE="$REG_PATH"

# ───────────────────────── vault 删除（token-blind·按 email 前缀）─────────────────────────
# delete_vault_keychain — security delete-generic-password（绝不带 -w，不取值）。
delete_vault_keychain() {
  if ! command -v security >/dev/null 2>&1; then
    err "vault: 'security' (macOS keychain) not found — 非 mac？该号若是 file 形态请 --vault-kind file。"
    return 1
  fi
  if security delete-generic-password -a "$EMAIL" -s "$KEYCHAIN_SERVICE" >/dev/null 2>&1; then
    return 0
  fi
  # 删不到（本就不存在）→ 非致命：registry entry 可能存在但 keychain 项已手删——按「vault 已无」处理。
  return 2
}

# delete_vault_file — 用 accounts-lib.fileVaultLineMatch 的 awk index() 精确前缀删 <email>_* 行。
#   **§A.4 必修 bug**：绝不 grep -E "^${EMAIL}_"（email 的 `.` 是元字符，alice@x.com 会误删 alicexxxcom_*）。
delete_vault_file() {
  if [ ! -f "$VAULT_FILE" ]; then
    err "vault: file not found: ${VAULT_FILE}（无 file vault 可删）。"
    return 2
  fi
  local prefix
  prefix="$(node -e 'const{fileVaultLineMatch}=require(process.argv[1]);process.stdout.write(fileVaultLineMatch(process.argv[2]).prefix)' "$LIB_JS" "$EMAIL" 2>/dev/null)" || prefix=""
  if [ -z "$prefix" ]; then
    err "vault: 无法从 accounts-lib 取 email 安全前缀（node 失败？）——拒绝用裸正则删行（§A.4 元字符 bug）。"
    return 1
  fi
  # 删前先数一下有没有该 email 的行（区分「删了」vs「本就没有」），用同样的精确前缀。
  local before
  before="$(awk -v p="$prefix" 'index($0, p) == 1' "$VAULT_FILE" 2>/dev/null | wc -l | tr -d ' ')"
  umask 077
  # awk index($0,p)!=1 保留「不以 <email>_ 起头」的行 = 删掉所有 <email>_* 行（token-blind、不读值）。
  if awk -v p="$prefix" 'index($0, p) != 1' "$VAULT_FILE" > "$VAULT_FILE.tmp" 2>/dev/null; then
    mv "$VAULT_FILE.tmp" "$VAULT_FILE"
  else
    rm -f "$VAULT_FILE.tmp"; err "vault: 删行失败（awk 非 0）——保留原文件。"; return 1
  fi
  [ "${before:-0}" -gt 0 ] && return 0 || return 2   # 0 = 真删了行；2 = 本就没有该 email 的行
}

delete_vault() {
  case "$VAULT_KIND" in
    keychain) delete_vault_keychain;;
    file)     delete_vault_file;;
  esac
}

# ───────────────────────── registry 删 entry（非密·removeAccount）─────────────────────────
# 调 node：load → removeAccount → save（原子写+校验）。entry 不存在 = removeAccount 是 no-op、不报错。
# 返回 0 = 删了/本就无；非 0 = 真错误（坏 JSON / IO）。绝不碰 token。
delete_registry_entry() {
  node -e '
    "use strict";
    const lib = require(process.argv[1]);
    const email = process.argv[2];
    const regPath = lib.defaultRegistryPath();
    let reg;
    try { reg = lib.loadRegistry(regPath); }
    catch (e) { process.stderr.write("registry: 读取失败（" + (e && e.message || e) + "）——可能坏 JSON。\n"); process.exit(1); }
    const had = !!(reg.accounts && reg.accounts[email]);
    lib.removeAccount(reg, email);
    // 只有原本存在该 entry（或文件已存在）才回写——避免对「从没有 registry」的情况凭空建一个空文件。
    const fs = require("fs");
    if (had || fs.existsSync(regPath)) {
      lib.saveRegistry(reg, regPath);
    }
    process.stderr.write(had ? "registry: 已删 entry " + email + "\n" : "registry: 无此 entry " + email + "（号池里本就没有）。\n");
    process.exit(0);
  ' "$LIB_JS" "$EMAIL" 2>&1
}

# ───────────────────────── 主流程 ─────────────────────────
if [ "$DRY_RUN" -eq 1 ]; then
  info "── account-delete.sh DRY-RUN（不真删 vault、不真删 registry）──"
  info "email          : $EMAIL"
  info "vault kind     : $VAULT_KIND$([ -n "$REG_KIND" ] && echo "（从 registry 推断）")"
  case "$VAULT_KIND" in
    keychain) info "would delete vault: security delete-generic-password -a $EMAIL -s ${KEYCHAIN_SERVICE}（不带 -w，不取值）";;
    file)     info "would delete vault: awk index() 删 ${EMAIL}_* 行 @ ${VAULT_FILE}（精确前缀，§A.4 安全）";;
  esac
  info "would delete registry: accounts-lib removeAccount（删非密 entry）"
  info "── end DRY-RUN（未删任何东西、未泄 token）──"
  exit 0
fi

# 先删 vault（token 痕迹），再删 registry entry（非密对账）。
info "→ 删 vault（${VAULT_KIND}，token-blind 按 email 前缀）……"
delete_vault; vault_rc=$?
case "$vault_rc" in
  0) info "✓ 已从 vault 删除 $EMAIL 的 token（vault=${VAULT_KIND}）。";;
  2) info "· vault 里没找到 $EMAIL 的 token（可能已删/从没录）——继续删 registry entry。";;
  *) err "✗ vault 删除失败（rc=${vault_rc}）——未继续删 registry（保持一致，避免 registry 指向已没的 vault 却还留 token）。"; exit 1;;
esac

info "→ 删 accounts.json registry entry……"
if delete_registry_entry; then
  info "✓ 删号完成：$EMAIL 已从号池（registry + vault）删干净。"
  exit 0
else
  err "✗ registry entry 删除失败（accounts.json 坏 JSON？）——vault token 已删，但 registry 仍残留一条 entry。"
  err "  请人工检查 accounts.json（或删除该文件降级回天然单账号），再用 account-list.sh 对账。"
  exit 1
fi
