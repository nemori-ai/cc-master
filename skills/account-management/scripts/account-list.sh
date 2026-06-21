#!/usr/bin/env bash
# account-list.sh — out-of-band「列号池对账」wrapper（NOT a hook）。
#
# A2 account-management skill 的只读对账侧：列号池里每个 email 的非密信息——
#   vault 形态（keychain/file）· token 到期日 · active（当前在用号）· 最近一次切出时间 · token 是否已过期。
# 纯只读：读 accounts.json registry 的非密字段 + （可选）keychain `find`（**绝不带 -w**，只确认项在不在、不取值）。
#
# ───────────────────────────── 命门：绝不取 / 绝不打印 token 值（HARD）─────────────────────────────
# 本脚本**永不读 token 值**：
#   · registry 本就零 token（只有 vault 引用 + 时间元信息），读它无害。
#   · keychain 探活用 `security find-generic-password -a <email> -s <service>` **不带 `-w`**——
#     带 -w 才打印密码值；不带 -w 只回项的元信息（确认在不在）。本脚本严格不带 -w。
#   · file vault 只 grep `<email>_EXPIRES`（到期日，非密）+ 用 awk index() 数 `<email>_TOKEN` 行**在不在**
#     （存在性，绝不读等号右侧 token 值）。绝不 `grep <email>_TOKEN=` 后打印整行（那会带出 token）。
# stdout 全程只有非密对账表，绝不含任何 token。set +x / unset SHELLOPTS 加固。
#
# ───────────────────────── 落点纪律（红线 1/5）─────────────────────────
# out-of-band 脚本，**绝不进 hooks/**；调 `node`（读 registry）/ 可选 `security`（探活，云后端 no-op）。

# ───────────────────────── 安全开头（HARD）─────────────────────────
set +x
unset SHELLOPTS 2>/dev/null || true

# ───────────────────────── 云后端自检（红线 5，no-op 退出）─────────────────────────
if [ -n "${CLAUDE_CODE_USE_BEDROCK:-}" ] || [ -n "${CLAUDE_CODE_USE_VERTEX:-}" ] || [ -n "${CLAUDE_CODE_USE_FOUNDRY:-}" ]; then
  printf '%s\n' "account-list: 云后端（Bedrock/Vertex/Foundry）无订阅 OAuth 号池 —— 列号不适用，no-op 退出。" >&2
  exit 0
fi

set -uo pipefail

# ───────────────────────── 路径自解析（self-contain）─────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
LIB_JS="${CLAUDE_SKILL_DIR:-$SCRIPT_DIR/..}/scripts/accounts-lib.js"
[ -f "$LIB_JS" ] || LIB_JS="$SCRIPT_DIR/accounts-lib.js"

err()  { printf '%s\n' "$*" >&2; }
info() { printf '%s\n' "$*"; }

usage() {
  err "usage: account-list.sh [--probe-keychain] [--registry <path>]"
  err ""
  err "  只读列号池：email · vault 形态 · 到期日 · active · 最近切出 · 是否过期。绝不取/打印 token 值。"
  err "  --probe-keychain：额外用 security find（不带 -w）确认 keychain 项是否真在（只验存在性，不取值）。"
}

# ───────────────────────── arg 解析 ─────────────────────────
PROBE_KEYCHAIN=0
REGISTRY_PATH=""
# value 型 flag 缺值守卫（robustness·codex §7 P2-a·防死循环）：value 型 flag 缺第二个 arg 时 `shift 2` 失败、
#   arg list 不变 → `while [ $# -gt 0 ]` 死循环到被 kill（脚本无 set -e）。故 `shift 2` 前确认存在第二个 arg。
need_val() { [ "$#" -ge 2 ] || { err "error: option '$1' requires a value."; usage; exit 2; }; }
while [ $# -gt 0 ]; do
  case "$1" in
    --probe-keychain) PROBE_KEYCHAIN=1; shift;;
    --registry)       need_val "$@"; REGISTRY_PATH="$2"; shift 2;;
    -h|--help)        usage; exit 0;;
    *) err "unknown arg: $1"; usage; exit 2;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  err "error: 'node' not found in PATH — 无法读 accounts.json registry。"
  exit 1
fi

# ───────────────────────── 主体：node 读 registry 非密字段 → 输出对账行（TSV，bash 再排版）─────────────────────────
# node 输出每号一行 TSV：email \t vault_kind \t expires \t active \t switchable \t token_state \t last_switch_out_at \t vault_locator
#   全字段非密（vault_locator = keychain service / file path，是「token 在哪」的指针不是值）。绝不输出 token。
#   switchable=no（显式 switchable:false·残缺号无 vault token）时 token_state=no-token，绝不呈现成健康 ok。
#   过期判定用 ISO 字典序（定宽 + Z → 字典序==时间序，纯字符串比较，与 lib ISO_UTC_RE 对齐）。
# 顶行另输出 meta：账号数 / registry 路径 / registry 是否存在。
rows="$(node -e '
  "use strict";
  const lib = require(process.argv[1]);
  const fs = require("fs");
  const regPath = process.argv[2] || lib.defaultRegistryPath();
  const exists = fs.existsSync(regPath);
  let reg;
  try { reg = lib.loadRegistry(regPath); }
  catch (e) { process.stdout.write("ERR\t" + (e && e.message || e) + "\n"); process.exit(0); }
  const accounts = reg.accounts || {};
  const emails = Object.keys(accounts);
  const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/,"Z");
  // meta 行：META \t count \t regPath \t exists
  process.stdout.write("META\t" + emails.length + "\t" + regPath + "\t" + (exists ? "1" : "0") + "\n");
  for (const email of emails) {
    const e = accounts[email] || {};
    const v = e.vault || {};
    const kind = v.kind || "?";
    const locator = kind === "keychain" ? (v.service || "") : (v.path || "");
    const expires = e.token_expires_at || "";
    const active = e.active === true ? "yes" : "no";
    // switchable：非密 boolean（缺省/null 视作可切；只有显式 false 才是不可切——fallback/手动录入残缺号·
    //   vault 尚无 token）。选号/pacing 排除 switchable:false；list 必须把它显式标成「不可切·无 token」，
    //   绝不按 token_expires_at 把一个无 token 的残缺号呈现成健康 ok（否则 --list 这个恢复 UI 会骗用户）。
    const switchable = e.switchable === false ? "no" : "yes";
    // TOKEN 列：先看 switchable——不可切（无 vault token）一律标 no-token，绝不显示 ok/EXPIRED（它没有 token
    //   可言、token_expires_at 是占位）。可切的号才按 token_expires_at 严格 ISO 字典序判过期（< now 即过期）。
    let expired = "?";
    if (switchable === "no") {
      expired = "no-token";
    } else if (expires && lib.ISO_UTC_RE.test(expires)) {
      expired = (expires < nowIso) ? "EXPIRED" : "ok";
    }
    const lso = (e.last_switch_out && e.last_switch_out.at) ? e.last_switch_out.at : "-";
    // 字段间绝无 token；TAB 分隔，email/locator 不含 TAB（email/路径不会有 TAB）。
    process.stdout.write([ "ROW", email, kind, expires||"-", active, switchable, expired, lso, locator ].join("\t") + "\n");
  }
' "$LIB_JS" "$REGISTRY_PATH" 2>&1)" || { err "error: 读 registry 失败。"; exit 1; }

# ── node 报硬错（坏 JSON 等）──
if printf '%s' "$rows" | head -1 | grep -q '^ERR	'; then
  reason="$(printf '%s' "$rows" | head -1 | sed 's/^ERR	//')"
  err "✗ accounts.json 读取失败：$reason"
  err "  （文件坏 JSON？删除该文件 = 降级回天然单账号空池。）"
  exit 1
fi

# ── meta 行 ──
meta_line="$(printf '%s' "$rows" | grep -m1 '^META	')"
count="$(printf '%s' "$meta_line" | cut -f2)"
reg_path="$(printf '%s' "$meta_line" | cut -f3)"
reg_exists="$(printf '%s' "$meta_line" | cut -f4)"

info "── cc-master 号池（accounts.json） ──"
info "registry : $reg_path$([ "$reg_exists" = "0" ] && echo "  (不存在 = 天然单账号空池)")"
if [ "${count:-0}" -eq 0 ]; then
  info "号池为空（0 个号）。用 account-add.sh --email <email> 录第一个备号。"
  exit 0
fi
info "共 $count 个号："
info ""
# 表头（定宽，便于人读；email 可能较长，留 28 列）。SWITCHABLE 列显式呈现号是否可无重启切入。
printf '  %-28s %-9s %-22s %-7s %-12s %-9s %-22s %s\n' "EMAIL" "VAULT" "EXPIRES" "ACTIVE" "SWITCHABLE" "TOKEN" "LAST-SWITCH-OUT" "VAULT-LOCATOR"

# ── 逐 ROW 排版 + 可选 keychain 探活 ──
while IFS=$'\t' read -r tag email kind expires active switchable expired lso locator; do
  [ "$tag" = "ROW" ] || continue
  probe=""
  if [ "$PROBE_KEYCHAIN" -eq 1 ] && [ "$kind" = "keychain" ] && command -v security >/dev/null 2>&1; then
    # 探活：不带 -w（只确认项在不在，绝不取 token 值）。
    if security find-generic-password -a "$email" -s "$locator" >/dev/null 2>&1; then
      probe=" [keychain✓]"
    else
      probe=" [keychain✗缺]"
    fi
  fi
  # SWITCHABLE 列：yes=可无重启切入 / no=不可切（残缺号·vault 尚无 token·需补录）。
  # TOKEN 列只显示存在性/过期状态（ok/EXPIRED/no-token/?），绝不显示 token 值。
  #   no-token = switchable:false 的残缺号（vault 无 token，token_expires_at 仅占位），绝不冒充健康 ok。
  sw_disp="$switchable"
  [ "$switchable" = "no" ] && sw_disp="no(补录)"
  printf '  %-28s %-9s %-22s %-7s %-12s %-9s %-22s %s%s\n' \
    "$email" "$kind" "$expires" "$active" "$sw_disp" "$expired" "$lso" "$locator" "$probe"
done < <(printf '%s\n' "$rows")

info ""
info "（SWITCHABLE：yes=可无重启切入 / no(补录)=残缺号 vault 尚无 token·需手动补录。）"
info "（TOKEN 列只示存在性/过期：ok=未过期 / EXPIRED=已过期 / no-token=无 vault token(不可切) / ?=无到期记录。绝不取 token 值。）"
exit 0
