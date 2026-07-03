#!/usr/bin/env bash
# install.sh — 一条命令把 `ccm` 引擎二进制 + cc-master 插件装到本机（两条版本线各自可指定）。
#
# 这是 **dev-only / 面向终端用户的安装器**——从 repo 根维护、随 GitHub 仓库托管，
# 用户用 curl 直接拉来跑（不随 plugin 分发、不是 hook，故用裸 shell + 可联网 + 可用 node，
# 不受红线1「hooks 只用 bash+node」约束）。
#
# 版本线解耦（ADR-022）：plugin 与 ccm 是**两条独立版本线**——
#   - plugin 走裸 `v*` tag（如 v0.10.1），asset = cc-master-plugin-<harness>-<tag>.zip
#   - ccm    走 `ccm-v*` tag（如 ccm-v0.11.0），asset = ccm-<os>-<arch>
# 两条线各自独立解析「本线最新」，互不串味（GitHub /releases/latest 只给整仓最新、不分前缀，
# 故本脚本改用 /releases 列表 + 按 tag 前缀过滤 + semver 取最高）。
#
# 用法：
#   # 装两条线各自的最新 release：
#   curl -fsSL https://raw.githubusercontent.com/nemori-ai/cc-master/main/install.sh | bash
#   # 各自 pin 指定版本（两 flag 均可选、各自缺省解析为本线最新）：
#   curl -fsSL …/install.sh | bash -s -- --ccm-version ccm-v0.11.0 --plugin-version v0.10.1
#   # 本地克隆后直接跑：
#   bash install.sh [--ccm-version ccm-vX.Y.Z] [--plugin-version vX.Y.Z] [--harness claude-code|codex|auto] [--all-harnesses]
#
# 版本 flag（均可选）：
#   --ccm-version <ccm-vX.Y.Z>    钉 ccm 二进制的版本（缺省 → 解析 ccm-v* 线最新）
#   --plugin-version <vX.Y.Z>     钉 plugin zip 的版本（缺省 → 解析裸 v* 线最新）
#   --harness <id>                指定要安装 plugin 的 agent harness（默认 auto；也可用 CC_MASTER_HARNESS）
#   --all-harnesses               枚举本机已安装的 ccm-supported harness，对支持 plugin 分发者逐个安装
#   （旧的单一 --version 已移除——解耦后它无法同时钉两产物；传它会报错指向上面两 flag。）
#
# 环境变量（覆写默认）：
#   PREFIX=<dir>                  ccm 二进制装到 <dir>/ccm（默认 $HOME/.local/bin）
#   CC_MASTER_PLUGIN_DIR=<dir>    plugin 解压目标根（默认 $HOME/.local/share/cc-master）
#   CC_MASTER_INSTALL_LOCAL=<dir> ★本地源模式★：从 <dir> 里的 ccm-<os>-<arch> + cc-master-plugin-<harness>-*.zip
#                                 装，而非联网下载（沙盒 E2E / 离线 / draft-release 用）
#
# 装什么：
#   ① ccm 二进制（per-OS Node SEA·ADR-014）→ $PREFIX/ccm（chmod +x·验 `ccm --version`）
#   ② cc-master 插件 → 解压到 $CC_MASTER_PLUGIN_DIR，再按本机 supported harness inventory 分发：
#      - Claude Code：用 claude CLI 持久安装（marketplace add/update + plugin install/update）
#      - Codex：注册本地 Codex plugin marketplace。
#
# 设计纪律：dual-OS（macOS/Linux·BSD/GNU 都跑）· set -euo pipefail · 错误 trap ·
#   幂等可重跑 · 失败有意义的中文报错。

set -euo pipefail

# ── 常量 ───────────────────────────────────────────────────────────────────────────────────────────
REPO="nemori-ai/cc-master"
GITHUB="https://github.com"
GITHUB_API="https://api.github.com"
MARKETPLACE_NAME="cc-master"   # .claude-plugin/marketplace.json 里的 marketplace 名
PLUGIN_NAME="cc-master"        # 插件名（install 用 <plugin>@<marketplace>）

# ── 颜色 + 日志 ─────────────────────────────────────────────────────────────────────────────────────
if [ -t 2 ]; then
  C_BLUE=$'\033[1;34m'; C_GREEN=$'\033[1;32m'; C_YELLOW=$'\033[1;33m'; C_RED=$'\033[1;31m'; C_RST=$'\033[0m'
else
  C_BLUE=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_RST=''
fi
log()  { printf '%s[install]%s %s\n' "$C_BLUE"   "$C_RST" "$*" >&2; }
ok()   { printf '%s[install]%s %s\n' "$C_GREEN"  "$C_RST" "$*" >&2; }
warn() { printf '%s[install] 注意:%s %s\n' "$C_YELLOW" "$C_RST" "$*" >&2; }
die()  { printf '%s[install] 错误:%s %s\n' "$C_RED" "$C_RST" "$*" >&2; exit 1; }

# ── 错误 trap：非 0 退出时报出错行 ──────────────────────────────────────────────────────────────────
on_err() { local rc=$?; printf '%s[install] 安装中断%s（退出码 %d，行 %s）。请回看上方报错。\n' \
           "$C_RED" "$C_RST" "$rc" "${BASH_LINENO[0]:-?}" >&2; exit "$rc"; }
trap on_err ERR

usage() {
  sed -n '2,41p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//' >&2
  exit 0
}

# ── 参数解析 ────────────────────────────────────────────────────────────────────────────────────────
# 版本线解耦后（ADR-022）：两条线各自一个可选 flag，各自缺省解析为本线最新。
CCM_VERSION=""      # ccm 二进制版本 tag（如 ccm-v0.11.0）
PLUGIN_VERSION=""   # plugin zip 版本 tag（如 v0.10.1）
HARNESS_TARGET=""    # explicit harness target; empty means env/default auto.
ALL_HARNESSES=0
LEGACY_VERSION_HINT="--version 已移除（ccm 与 plugin 版本线已解耦·ADR-022——单一 --version 无法同时钉两产物）。请改用 --ccm-version <ccm-vX.Y.Z> 和/或 --plugin-version <vX.Y.Z>，二者各自可选、缺省装各自线的最新。"
while [ $# -gt 0 ]; do
  case "$1" in
    --ccm-version) CCM_VERSION="${2:-}"; [ -n "$CCM_VERSION" ] || die "--ccm-version 需要一个值（如 ccm-v0.11.0）"; shift 2 ;;
    --ccm-version=*) CCM_VERSION="${1#*=}"; [ -n "$CCM_VERSION" ] || die "--ccm-version 需要一个值（如 ccm-v0.11.0）"; shift ;;
    --plugin-version) PLUGIN_VERSION="${2:-}"; [ -n "$PLUGIN_VERSION" ] || die "--plugin-version 需要一个值（如 v0.10.1）"; shift 2 ;;
    --plugin-version=*) PLUGIN_VERSION="${1#*=}"; [ -n "$PLUGIN_VERSION" ] || die "--plugin-version 需要一个值（如 v0.10.1）"; shift ;;
    --harness) HARNESS_TARGET="${2:-}"; [ -n "$HARNESS_TARGET" ] || die "--harness 需要一个值（auto / claude-code / codex）"; shift 2 ;;
    --harness=*) HARNESS_TARGET="${1#*=}"; [ -n "$HARNESS_TARGET" ] || die "--harness 需要一个值（auto / claude-code / codex）"; shift ;;
    --all-harnesses) ALL_HARNESSES=1; shift ;;
    --version|--version=*) die "$LEGACY_VERSION_HINT" ;;
    -h|--help) usage ;;
    *) die "未知参数：$1（用 --help 看用法）" ;;
  esac
done

[ "$ALL_HARNESSES" = "1" ] && [ -n "$HARNESS_TARGET" ] && die "--harness 与 --all-harnesses 不能同时使用。"

PREFIX="${PREFIX:-$HOME/.local/bin}"
PLUGIN_DIR="${CC_MASTER_PLUGIN_DIR:-$HOME/.local/share/cc-master}"
LOCAL_SRC="${CC_MASTER_INSTALL_LOCAL:-}"

# ── 依赖自检 ────────────────────────────────────────────────────────────────────────────────────────
need() { command -v "$1" >/dev/null 2>&1 || die "缺少必需命令：$1。请先安装它再重试。"; }
need uname
need unzip
need chmod

DL=""   # 下载器（仅联网模式需要）
if [ -z "$LOCAL_SRC" ]; then
  if command -v curl >/dev/null 2>&1; then DL="curl";
  elif command -v wget >/dev/null 2>&1; then DL="wget";
  else die "需要 curl 或 wget 来下载（或设 CC_MASTER_INSTALL_LOCAL=<本地源目录> 走离线安装）。"; fi
fi

# ── 平台探测：uname -s → darwin/linux，uname -m → arm64/x64 ──────────────────────────────────────────
detect_platform() {
  local os arch
  case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux)  os="linux" ;;
    *) die "暂不支持的操作系统：$(uname -s)（当前发布覆盖 darwin / linux）。" ;;
  esac
  case "$(uname -m)" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64)  arch="x64" ;;
    *) die "暂不支持的 CPU 架构：$(uname -m)（当前发布覆盖 arm64 / x64）。" ;;
  esac
  printf '%s-%s\n' "$os" "$arch"
}

# ── 下载一个文件到 dest（联网）或从本地源拷贝（CC_MASTER_INSTALL_LOCAL）─────────────────────────────
#    用法：fetch <远端文件名> <本地目标路径> <下载用的完整 URL>
fetch() {
  local fname="$1" dest="$2" url="$3"
  if [ -n "$LOCAL_SRC" ]; then
    local src="$LOCAL_SRC/$fname"
    [ -f "$src" ] || die "本地源缺文件：${src}（CC_MASTER_INSTALL_LOCAL 模式需要它）。"
    cp "$src" "$dest"
    log "本地源拷贝：$fname"
  else
    log "下载：$url"
    if [ "$DL" = "curl" ]; then
      curl -fSL --retry 3 -o "$dest" "$url" || die "下载失败：$url"
    else
      wget -q -O "$dest" "$url" || die "下载失败：$url"
    fi
  fi
}

# ── 取一行 HTTP 文本（GitHub API）──────────────────────────────────────────────────────────────────
http_get() {
  local url="$1"
  if [ "$DL" = "curl" ]; then curl -fsSL "$url"; else wget -qO- "$url"; fi
}

# ── 把（已存在的）目录转成绝对路径（不依赖 realpath，BSD/GNU 通用）────────────────────────────────────
abspath_dir() { ( cd "$1" && pwd ); }

# ── Harness inventory / adapter 安装策略 ────────────────────────────────────────────────────────────
# install.sh 不能假设只有 Claude Code。这里复刻 ccm CLI 的最小 host inventory：
#   - Claude Code：可识别、支持 pluginDistribution（claude plugin marketplace/install）。
#   - Codex：可识别、支持本地 Codex plugin 注册；命令入口由 plugin 分发的 skill（`$cc-master-*`）承载。
normalize_harness() {
  local raw="${1:-auto}" h
  h="$(printf '%s' "$raw" | tr '[:upper:]_' '[:lower:]-')"
  case "$h" in
    ""|auto) printf '%s\n' "auto" ;;
    claude|claude-code|claudecode) printf '%s\n' "claude-code" ;;
    codex|openai-codex) printf '%s\n' "codex" ;;
    *) return 1 ;;
  esac
}

claude_bin() { printf '%s\n' "${CCM_CLAUDE_BIN:-${CLAUDE_BIN:-claude}}"; }
codex_bin() { printf '%s\n' "${CCM_CODEX_BIN:-${CODEX_BIN:-codex}}"; }

claude_config_dir() {
  if [ -n "${CLAUDE_CONFIG_DIR:-}" ]; then
    printf '%s\n' "$CLAUDE_CONFIG_DIR"
  elif [ -n "${HOME:-}" ]; then
    printf '%s\n' "$HOME/.claude"
  else
    printf '\n'
  fi
}

codex_config_dir() {
  if [ -n "${CODEX_HOME:-}" ]; then
    printf '%s\n' "$CODEX_HOME"
  elif [ -n "${HOME:-}" ]; then
    printf '%s\n' "$HOME/.codex"
  else
    printf '\n'
  fi
}

is_harness_installed() {
  local id="$1" bin dir
  case "$id" in
    claude-code)
      bin="$(claude_bin)"
      command -v "$bin" >/dev/null 2>&1 && return 0
      dir="$(claude_config_dir)"
      [ -n "$dir" ] && [ -d "$dir" ]
      ;;
    codex)
      bin="$(codex_bin)"
      command -v "$bin" >/dev/null 2>&1 && return 0
      dir="$(codex_config_dir)"
      [ -n "$dir" ] && [ -d "$dir" ]
      ;;
    *) return 1 ;;
  esac
}

harness_supports_plugin_distribution() {
  [ "$1" = "claude-code" ] || [ "$1" = "codex" ]
}

detect_installed_harnesses() {
  is_harness_installed "claude-code" && printf '%s\n' "claude-code"
  is_harness_installed "codex" && printf '%s\n' "codex"
}

selected_harnesses() {
  local requested="${HARNESS_TARGET:-${CC_MASTER_HARNESS:-${CC_MASTER_HOST:-${CCM_HOST:-${CC_MASTER_HARNESS_HOST:-auto}}}}}" normalized
  if [ "$ALL_HARNESSES" = "1" ]; then
    detect_installed_harnesses
    return
  fi

  normalized="$(normalize_harness "$requested")" || die "未知 harness：$requested（支持：auto / claude-code / codex）。"
  if [ "$normalized" = "auto" ]; then
    detect_installed_harnesses
  else
    printf '%s\n' "$normalized"
  fi
}

log_harness_inventory() {
  local cc_state codex_state
  if is_harness_installed "claude-code"; then cc_state="installed"; else cc_state="missing"; fi
  if is_harness_installed "codex"; then codex_state="installed"; else codex_state="missing"; fi
  log "harness inventory：claude-code=${cc_state}, plugin=yes; codex=${codex_state}, plugin=yes"
}

install_plugin_claude_code() {
  local plugin_root="$1" bin marketplaces_json existing_path plugin_list reinstall
  bin="$(claude_bin)"
  command -v "$bin" >/dev/null 2>&1 || die "找不到 Claude Code CLI：$bin。Claude Code plugin 安装需要它（要求 ≥ v2.1.195）。"

  marketplaces_json="$("$bin" plugin marketplace list --json 2>/dev/null || printf '[]')"
  existing_path="$(printf '%s' "$marketplaces_json" | node -e '
    const name = process.argv[1];
    let raw = "";
    process.stdin.on("data", d => raw += d);
    process.stdin.on("end", () => {
      let arr = [];
      try { arr = JSON.parse(raw); } catch {}
      const hit = Array.isArray(arr) ? arr.find(x => x && x.name === name) : null;
      process.stdout.write(hit && typeof hit.path === "string" ? hit.path : "");
    });
  ' "$MARKETPLACE_NAME")"

  reinstall=0
  if [ -n "$existing_path" ]; then
    if [ "$existing_path" = "$plugin_root" ]; then
      log "Claude Code marketplace '${MARKETPLACE_NAME}' 已存在 → 更新"
      "$bin" plugin marketplace update "$MARKETPLACE_NAME" || warn "Claude Code marketplace update 未成功（继续尝试安装）。"
    else
      log "Claude Code marketplace '${MARKETPLACE_NAME}' 指向旧路径 ${existing_path} → 重建为 ${plugin_root}"
      "$bin" plugin marketplace remove "$MARKETPLACE_NAME" --scope user >/dev/null 2>&1 || "$bin" plugin marketplace remove "$MARKETPLACE_NAME" >/dev/null 2>&1 || true
      "$bin" plugin marketplace add "$plugin_root" || die "claude plugin marketplace add 失败。"
      reinstall=1
    fi
  else
    log "Claude Code 添加 marketplace：$plugin_root"
    "$bin" plugin marketplace add "$plugin_root" || die "claude plugin marketplace add 失败。"
    reinstall=1
  fi

  plugin_list="$("$bin" plugin list --json 2>/dev/null || printf '[]')"
  if printf '%s' "$plugin_list" | grep -q "\"${PLUGIN_NAME}@${MARKETPLACE_NAME}\""; then
    if [ "$reinstall" = "1" ]; then
      log "Claude Code 插件 '${PLUGIN_NAME}@${MARKETPLACE_NAME}' 已安装但 marketplace 已重建 → 重装"
      "$bin" plugin uninstall "${PLUGIN_NAME}@${MARKETPLACE_NAME}" --scope user --keep-data -y >/dev/null 2>&1 || true
      "$bin" plugin install "${PLUGIN_NAME}@${MARKETPLACE_NAME}" --scope user || die "claude plugin install 失败。"
    else
      log "Claude Code 插件 '${PLUGIN_NAME}@${MARKETPLACE_NAME}' 已安装 → 更新"
      "$bin" plugin update "${PLUGIN_NAME}@${MARKETPLACE_NAME}" || warn "claude plugin update 未成功（可能已是最新）。"
    fi
  else
    log "Claude Code 安装插件：${PLUGIN_NAME}@${MARKETPLACE_NAME}（--scope user）"
    "$bin" plugin install "${PLUGIN_NAME}@${MARKETPLACE_NAME}" --scope user || die "claude plugin install 失败。"
  fi

  # 自证：插件确实在已装列表里。
  if "$bin" plugin list --json 2>/dev/null | grep -q "\"${PLUGIN_NAME}@${MARKETPLACE_NAME}\""; then
    ok "Claude Code 插件已安装：${PLUGIN_NAME}@${MARKETPLACE_NAME}"
  else
    die "安装命令跑完，但 claude plugin list 里没看到 ${PLUGIN_NAME}@${MARKETPLACE_NAME}。请手动核查。"
  fi
}

install_plugin_codex() {
  local plugin_root="$1" codex_home marketplace_root marketplace_json
  codex_home="$(codex_config_dir)"
  [ -n "$codex_home" ] || die "无法解析 Codex home（请设置 CODEX_HOME 或 HOME）。"
  [ -f "$plugin_root/.codex-plugin/plugin.json" ] || die "Codex adapter 缺失：$plugin_root/.codex-plugin/plugin.json。请确认是合法的 cc-master Codex 包。"

  if ! command -v "$(codex_bin)" >/dev/null 2>&1; then
    warn "找不到 Codex CLI：$(codex_bin)。已完成 plugin 解压与校验，跳过注册。"
    return
  fi

  marketplace_root="$PLUGIN_DIR/codex-marketplace"
  marketplace_json="$marketplace_root/.agents/plugins/marketplace.json"
  rm -rf "$marketplace_root"
  mkdir -p "$marketplace_root/.agents/plugins" "$marketplace_root/plugins"
  ln -s "$plugin_root" "$marketplace_root/plugins/cc-master"
  cat >"$marketplace_json" <<EOF
{
  "name": "cc-master",
  "interface": { "displayName": "cc-master" },
  "plugins": [
    {
      "name": "cc-master",
      "source": { "source": "local", "path": "./plugins/cc-master" },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_USE" },
      "category": "Developer Tools"
    }
  ]
}
EOF

  log "Codex 注册 marketplace：$marketplace_root"
  "$(codex_bin)" plugin remove "${PLUGIN_NAME}@${MARKETPLACE_NAME}" >/dev/null 2>&1 || true
  "$(codex_bin)" plugin marketplace remove "$MARKETPLACE_NAME" >/dev/null 2>&1 || true
  "$(codex_bin)" plugin marketplace add "$marketplace_root" >/dev/null \
    || die "codex plugin marketplace add 失败。"
  "$(codex_bin)" plugin add "${PLUGIN_NAME}@${MARKETPLACE_NAME}" >/dev/null \
    || die "codex plugin add ${PLUGIN_NAME}@${MARKETPLACE_NAME} 失败。"

  if "$(codex_bin)" plugin list --json 2>/dev/null | grep -q "\"pluginId\"[[:space:]]*:[[:space:]]*\"${PLUGIN_NAME}@${MARKETPLACE_NAME}\""; then
    ok "Codex plugin 已安装：${PLUGIN_NAME}@${MARKETPLACE_NAME}。重启 Codex session 后 skills/hooks 生效。"
  else
    die "安装命令跑完，但 codex plugin list --json 里没看到 ${PLUGIN_NAME}@${MARKETPLACE_NAME}。请手动核查。"
  fi
}

# ── 双线版本 tag 解析 ──────────────────────────────────────────────────────────────────────────────
# GitHub /releases/latest 只返回**整仓**最新、不分 tag 前缀——两条线共仓后会串味。
# 故改用 /releases 列表 + 按 tag 前缀过滤 + semver 排序取最高。用 node 解析 JSON 数组
# （install.sh 非 hook·node 通常随 Claude Code 在，比 grep/sed 健壮）。
#
# resolve_latest_tag <line>   line ∈ {ccm, plugin}
#   stdout = 该线 semver 最高的 tag（无任何匹配 release → 空 stdout + RC 0）。
#   ccm   线：过滤前缀 `ccm-v`；plugin 线：过滤裸 `v` 且**排除** `ccm-`（按前缀字符串判定，不串味）。
#   RC: 1 = 网络/取列表失败；2 = JSON 解析失败。
resolve_latest_tag() {
  local line="$1" json
  command -v node >/dev/null 2>&1 \
    || die "需要 node 来解析 GitHub release 列表（install.sh 非 hook·node 通常随 Claude Code 在）。或用 --ccm-version/--plugin-version 显式指定版本以跳过解析。"
  json="$(http_get "$GITHUB_API/repos/$REPO/releases?per_page=100")" || return 1
  printf '%s' "$json" | node -e '
    const line = process.argv[1];
    let raw = "";
    process.stdin.on("data", d => raw += d);
    process.stdin.on("end", () => {
      let arr;
      try { arr = JSON.parse(raw); } catch (e) { process.exit(2); }
      if (!Array.isArray(arr)) process.exit(2);
      // 版本核（去掉前缀与 pre-release 后缀）做数值 semver 比较。
      const core = v => v.split("-")[0].split(".").map(n => parseInt(n, 10) || 0);
      const cmp = (a, b) => {
        const pa = core(a), pb = core(b);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
          const x = pa[i] || 0, y = pb[i] || 0;
          if (x !== y) return x - y;
        }
        return 0;
      };
      const tags = arr
        .filter(r => r && r.draft !== true && typeof r.tag_name === "string")
        .map(r => r.tag_name);
      let cands;
      if (line === "ccm") {
        cands = tags.filter(t => t.startsWith("ccm-v"))
                    .map(t => ({ tag: t, ver: t.slice("ccm-v".length) }));
      } else {
        // plugin 线：裸 v 前缀且**不是** ccm- 前缀（确保 ccm-v* 不被误纳）。
        cands = tags.filter(t => t.startsWith("v") && !t.startsWith("ccm-"))
                    .map(t => ({ tag: t, ver: t.slice(1) }));
      }
      cands = cands.filter(c => /^[0-9]+(\.[0-9]+)*/.test(c.ver));
      if (!cands.length) { process.stdout.write(""); return; }
      cands.sort((a, b) => cmp(b.ver, a.ver));
      process.stdout.write(cands[0].tag);
    });
  ' "$line"
}

# ── ccm 线版本 tag ──────────────────────────────────────────────────────────────────────────────────
resolve_ccm_tag() {
  if [ -n "$CCM_VERSION" ]; then printf '%s\n' "$CCM_VERSION"; return; fi
  # 本地源模式：ccm 二进制文件名是 ccm-<os>-<arch>（不含 tag），tag 仅作展示。
  if [ -n "$LOCAL_SRC" ]; then printf '%s\n' "local"; return; fi
  local tag
  tag="$(resolve_latest_tag ccm)" \
    || die "无法从 GitHub API 取 release 列表来解析 ccm 最新版（网络问题或 API 限流？可用 --ccm-version <ccm-vX.Y.Z> 显式指定，或用 CC_MASTER_INSTALL_LOCAL 本地源）。"
  [ -n "$tag" ] || die "ccm 发版线（ccm-v* tag）目前还没有任何 release。请用 --ccm-version <ccm-vX.Y.Z> 指定，或等 ccm 首发后再装（plugin 线已可独立发版）。"
  printf '%s\n' "$tag"
}

# ── plugin 线版本 tag ──────────────────────────────────────────────────────────────────────────────
resolve_plugin_tag() {
  if [ -n "$PLUGIN_VERSION" ]; then printf '%s\n' "$PLUGIN_VERSION"; return; fi
  if [ -n "$LOCAL_SRC" ]; then
    # 本地源模式：从 cc-master-plugin-<harness>-<tag>.zip 文件名推 tag（兼容旧 cc-master-plugin-<tag>.zip）。
    local zip
    zip="$(ls -1 "$LOCAL_SRC"/cc-master-plugin-claude-code-*.zip "$LOCAL_SRC"/cc-master-plugin-codex-*.zip "$LOCAL_SRC"/cc-master-plugin-*.zip 2>/dev/null | head -1 || true)"
    [ -n "$zip" ] || die "本地源 $LOCAL_SRC 里找不到 cc-master-plugin-<harness>-*.zip（无法推断 plugin 版本，请加 --plugin-version）。"
    local base="${zip##*/}"; base="${base#cc-master-plugin-}"; base="${base%.zip}"
    case "$base" in
      claude-code-*) base="${base#claude-code-}" ;;
      codex-*) base="${base#codex-}" ;;
    esac
    printf '%s\n' "$base"; return
  fi
  local tag
  tag="$(resolve_latest_tag plugin)" \
    || die "无法从 GitHub API 取 release 列表来解析 plugin 最新版（网络问题或 API 限流？可用 --plugin-version <vX.Y.Z> 显式指定，或用 CC_MASTER_INSTALL_LOCAL 本地源）。"
  [ -n "$tag" ] || die "plugin 发版线（裸 v* tag）目前还没有任何 release。请用 --plugin-version <vX.Y.Z> 指定。"
  printf '%s\n' "$tag"
}

# ════════════════════════════════════════════════════════════════════════════════════════════════════
# 主流程
# ════════════════════════════════════════════════════════════════════════════════════════════════════
PLATFORM="$(detect_platform)"             # 如 darwin-arm64
CCM_TAG="$(resolve_ccm_tag)"               # 如 ccm-v0.11.0（本地源模式为 "local"·仅展示）
BIN_ASSET="ccm-${PLATFORM}"                # 如 ccm-darwin-arm64（不含 tag）

log "目标平台：${PLATFORM}    ccm：${CCM_TAG}"
if [ -n "$LOCAL_SRC" ]; then log "源：本地目录 ${LOCAL_SRC}"; else log "源：GitHub release（${REPO}·两条独立版本线）"; fi

TMP="$(mktemp -d)"
trap 'rc=$?; rm -rf "$TMP"; exit $rc' EXIT   # 覆盖 ERR-trap 的兜底清理（保留 on_err 的报错由 set -e 触发前打印）

# ── ① 装 ccm 二进制 ─────────────────────────────────────────────────────────────────────────────────
log "① 安装 ccm 引擎二进制 …"
fetch "$BIN_ASSET" "$TMP/ccm" "$GITHUB/$REPO/releases/download/$CCM_TAG/$BIN_ASSET"
chmod +x "$TMP/ccm"
mkdir -p "$PREFIX"
mv -f "$TMP/ccm" "$PREFIX/ccm"
CCM_BIN="$PREFIX/ccm"

# 验证二进制能跑（用绝对路径，绕开 PATH 未配的情况）。
if CCM_VER="$("$CCM_BIN" --version 2>&1)"; then
  ok "ccm 已安装：${CCM_BIN}（${CCM_VER}）"
else
  die "ccm 装好了但无法执行（$CCM_BIN --version 失败）。可能是平台二进制不匹配。输出：${CCM_VER:-<空>}"
fi

# PATH 提示。
case ":$PATH:" in
  *":$PREFIX:"*) : ;;
  *) warn "$PREFIX 不在你的 PATH 里。把下面这行加进 ~/.zshrc 或 ~/.bashrc 再重开终端："
     printf '\n    export PATH="%s:$PATH"\n\n' "$PREFIX" >&2 ;;
esac

# ── ② 装 cc-master 插件 ────────────────────────────────────────────────────────────────────────────
log "② 安装 cc-master 插件 …"
log_harness_inventory

REQUESTED_HARNESS_RAW="${HARNESS_TARGET:-${CC_MASTER_HARNESS:-${CC_MASTER_HOST:-${CCM_HOST:-${CC_MASTER_HARNESS_HOST:-auto}}}}}"
REQUESTED_HARNESS_NORMALIZED="$(normalize_harness "$REQUESTED_HARNESS_RAW")" || die "未知 harness：$REQUESTED_HARNESS_RAW（支持：auto / claude-code / codex）。"
EXPLICIT_SINGLE_HARNESS=0
[ "$ALL_HARNESSES" = "0" ] && [ "$REQUESTED_HARNESS_NORMALIZED" != "auto" ] && EXPLICIT_SINGLE_HARNESS=1

TARGET_HARNESSES="$(selected_harnesses | awk 'NF && !seen[$0]++')"
[ -n "$TARGET_HARNESSES" ] || die "未发现已安装的 supported harness。请先安装 Claude Code 或 Codex。"

SUPPORTED_TARGETS=""
UNSUPPORTED_TARGETS=""
while IFS= read -r harness; do
  [ -n "$harness" ] || continue
  if harness_supports_plugin_distribution "$harness"; then
    SUPPORTED_TARGETS="${SUPPORTED_TARGETS}${SUPPORTED_TARGETS:+
}${harness}"
  else
    UNSUPPORTED_TARGETS="${UNSUPPORTED_TARGETS}${UNSUPPORTED_TARGETS:+
}${harness}"
  fi
done <<EOF
$TARGET_HARNESSES
EOF

if [ -n "$UNSUPPORTED_TARGETS" ]; then
  while IFS= read -r harness; do
    [ -n "$harness" ] || continue
    if [ "$EXPLICIT_SINGLE_HARNESS" = "1" ]; then
      die "$harness 已被识别，但当前 cc-master 尚未发布可安装的 plugin adapter。"
    fi
    warn "$harness 已被识别，但当前 cc-master 尚未发布可安装的 plugin adapter，跳过。"
  done <<EOF
$UNSUPPORTED_TARGETS
EOF
fi

[ -n "$SUPPORTED_TARGETS" ] || die "本机未发现任何支持 cc-master plugin 分发的 harness。当前可安装目标：claude-code / codex。"

PLUGIN_TAG="$(resolve_plugin_tag)"         # 如 v0.10.1
log "plugin：${PLUGIN_TAG}"

unpack_plugin_for_harness() {
  local harness="$1" asset zip dest root
  asset="cc-master-plugin-${harness}-${PLUGIN_TAG}.zip"
  zip="$TMP/plugin-${harness}.zip"
  fetch "$asset" "$zip" "$GITHUB/$REPO/releases/download/$PLUGIN_TAG/$asset"
  dest="$PLUGIN_DIR/$harness"
  mkdir -p "$dest"
  rm -rf "$dest/cc-master"
  unzip -q -o "$zip" -d "$dest" || die "解压失败：$asset"
  root="$dest/cc-master"
  case "$harness" in
    claude-code)
      [ -f "$root/.claude-plugin/marketplace.json" ] \
        || die "解压结果不是合法 Claude Code plugin（缺 $root/.claude-plugin/marketplace.json）。"
      ;;
    codex)
      [ -d "$root/.codex-plugin" ] || die "解压结果不是合法 Codex adapter（缺 $root/.codex-plugin）。"
      ;;
  esac
  abspath_dir "$root"
}

INSTALLED_HARNESSES=""
while IFS= read -r harness; do
  [ -n "$harness" ] || continue
  PLUGIN_ROOT="$(unpack_plugin_for_harness "$harness")"
  log "插件已解压（${harness}）：$PLUGIN_ROOT"
  case "$harness" in
    claude-code)
      install_plugin_claude_code "$PLUGIN_ROOT"
      INSTALLED_HARNESSES="${INSTALLED_HARNESSES}${INSTALLED_HARNESSES:+, }${harness}"
      ;;
    codex)
      install_plugin_codex "$PLUGIN_ROOT"
      INSTALLED_HARNESSES="${INSTALLED_HARNESSES}${INSTALLED_HARNESSES:+, }${harness}"
      ;;
    *)
      die "内部错误：$harness 被标记为支持 pluginDistribution，但 install.sh 没有对应 adapter。"
      ;;
  esac
done <<EOF
$SUPPORTED_TARGETS
EOF

# ── 收尾 ────────────────────────────────────────────────────────────────────────────────────────────
ok "完成 ✓  ccm（${CCM_TAG}）+ cc-master 插件（${PLUGIN_TAG}）已安装到：${INSTALLED_HARNESSES}。"
log "下一步：Claude Code 跑 /cc-master:as-master-orchestrator <目标>；Codex 跑 \$cc-master-as-master-orchestrator <目标>。"
