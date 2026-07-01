#!/usr/bin/env bash
# install.sh — 一条命令把 `ccm` 引擎二进制 + cc-master 插件装到本机（两条版本线各自可指定）。
#
# 这是 **dev-only / 面向终端用户的安装器**——从 repo 根维护、随 GitHub 仓库托管，
# 用户用 curl 直接拉来跑（不随 plugin 分发、不是 hook，故用裸 shell + 可联网 + 可用 node，
# 不受红线1「hooks 只用 bash+node」约束）。
#
# 版本线解耦（ADR-022）：plugin 与 ccm 是**两条独立版本线**——
#   - plugin 走裸 `v*` tag（如 v0.10.1），asset = cc-master-plugin-<tag>.zip
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
#   bash install.sh [--ccm-version ccm-vX.Y.Z] [--plugin-version vX.Y.Z]
#
# 版本 flag（均可选）：
#   --ccm-version <ccm-vX.Y.Z>    钉 ccm 二进制的版本（缺省 → 解析 ccm-v* 线最新）
#   --plugin-version <vX.Y.Z>     钉 plugin zip 的版本（缺省 → 解析裸 v* 线最新）
#   （旧的单一 --version 已移除——解耦后它无法同时钉两产物；传它会报错指向上面两 flag。）
#
# 环境变量（覆写默认）：
#   PREFIX=<dir>                  ccm 二进制装到 <dir>/ccm（默认 $HOME/.local/bin）
#   CC_MASTER_PLUGIN_DIR=<dir>    plugin 解压目标根（默认 $HOME/.local/share/cc-master）
#   CC_MASTER_INSTALL_LOCAL=<dir> ★本地源模式★：从 <dir> 里的 ccm-<os>-<arch> + cc-master-plugin-*.zip
#                                 装，而非联网下载（沙盒 E2E / 离线 / draft-release 用）
#
# 装什么：
#   ① ccm 二进制（per-OS Node SEA·ADR-014）→ $PREFIX/ccm（chmod +x·验 `ccm --version`）
#   ② cc-master 插件 → 解压到 $CC_MASTER_PLUGIN_DIR，再用 claude CLI 持久安装：
#        claude plugin marketplace add <abs plugin dir>
#        claude plugin install cc-master@cc-master --scope user
#      （幂等：已装则更新；需 claude CLI ≥ v2.1.195）
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
LEGACY_VERSION_HINT="--version 已移除（ccm 与 plugin 版本线已解耦·ADR-022——单一 --version 无法同时钉两产物）。请改用 --ccm-version <ccm-vX.Y.Z> 和/或 --plugin-version <vX.Y.Z>，二者各自可选、缺省装各自线的最新。"
while [ $# -gt 0 ]; do
  case "$1" in
    --ccm-version) CCM_VERSION="${2:-}"; [ -n "$CCM_VERSION" ] || die "--ccm-version 需要一个值（如 ccm-v0.11.0）"; shift 2 ;;
    --ccm-version=*) CCM_VERSION="${1#*=}"; [ -n "$CCM_VERSION" ] || die "--ccm-version 需要一个值（如 ccm-v0.11.0）"; shift ;;
    --plugin-version) PLUGIN_VERSION="${2:-}"; [ -n "$PLUGIN_VERSION" ] || die "--plugin-version 需要一个值（如 v0.10.1）"; shift 2 ;;
    --plugin-version=*) PLUGIN_VERSION="${1#*=}"; [ -n "$PLUGIN_VERSION" ] || die "--plugin-version 需要一个值（如 v0.10.1）"; shift ;;
    --version|--version=*) die "$LEGACY_VERSION_HINT" ;;
    -h|--help) usage ;;
    *) die "未知参数：$1（用 --help 看用法）" ;;
  esac
done

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
    # 本地源模式：从 cc-master-plugin-<tag>.zip 文件名推 tag。
    local zip
    zip="$(ls -1 "$LOCAL_SRC"/cc-master-plugin-*.zip 2>/dev/null | head -1 || true)"
    [ -n "$zip" ] || die "本地源 $LOCAL_SRC 里找不到 cc-master-plugin-*.zip（无法推断 plugin 版本，请加 --plugin-version）。"
    local base="${zip##*/}"; base="${base#cc-master-plugin-}"; base="${base%.zip}"
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
PLUGIN_TAG="$(resolve_plugin_tag)"         # 如 v0.10.1
BIN_ASSET="ccm-${PLATFORM}"                # 如 ccm-darwin-arm64（不含 tag）
ZIP_ASSET="cc-master-plugin-${PLUGIN_TAG}.zip"

log "目标平台：${PLATFORM}    ccm：${CCM_TAG}    plugin：${PLUGIN_TAG}"
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
command -v claude >/dev/null 2>&1 || die "找不到 claude CLI——插件持久安装需要它（要求 ≥ v2.1.195）。装好 Claude Code 后重跑本脚本（ccm 二进制已就位，会幂等跳过）。"

fetch "$ZIP_ASSET" "$TMP/plugin.zip" "$GITHUB/$REPO/releases/download/$PLUGIN_TAG/$ZIP_ASSET"

# 解压到 PLUGIN_DIR——zip 内顶层是 cc-master/（解压即得 plugin 根目录）。
mkdir -p "$PLUGIN_DIR"
rm -rf "$PLUGIN_DIR/cc-master"           # 幂等：清掉旧解压再覆盖
unzip -q -o "$TMP/plugin.zip" -d "$PLUGIN_DIR" || die "解压失败：$ZIP_ASSET"
PLUGIN_ROOT="$PLUGIN_DIR/cc-master"
[ -f "$PLUGIN_ROOT/.claude-plugin/marketplace.json" ] \
  || die "解压结果不是合法 plugin（缺 $PLUGIN_ROOT/.claude-plugin/marketplace.json）。"
PLUGIN_ROOT="$(abspath_dir "$PLUGIN_ROOT")"   # marketplace add 要绝对路径
log "插件已解压：$PLUGIN_ROOT"

# marketplace add（幂等：已存在则 update，否则 add）。
if claude plugin marketplace list --json 2>/dev/null | grep -Eq "\"name\"[[:space:]]*:[[:space:]]*\"${MARKETPLACE_NAME}\""; then
  log "marketplace '${MARKETPLACE_NAME}' 已存在 → 更新"
  claude plugin marketplace update "$MARKETPLACE_NAME" || warn "marketplace update 未成功（继续尝试安装）。"
else
  log "添加 marketplace：$PLUGIN_ROOT"
  claude plugin marketplace add "$PLUGIN_ROOT" || die "claude plugin marketplace add 失败。"
fi

# plugin install（幂等：已装则 update，否则 install --scope user）。
if claude plugin list --json 2>/dev/null | grep -q "\"${PLUGIN_NAME}@${MARKETPLACE_NAME}\""; then
  log "插件 '${PLUGIN_NAME}@${MARKETPLACE_NAME}' 已安装 → 更新"
  claude plugin update "${PLUGIN_NAME}@${MARKETPLACE_NAME}" || warn "claude plugin update 未成功（可能已是最新）。"
else
  log "安装插件：${PLUGIN_NAME}@${MARKETPLACE_NAME}（--scope user）"
  claude plugin install "${PLUGIN_NAME}@${MARKETPLACE_NAME}" --scope user || die "claude plugin install 失败。"
fi

# 自证：插件确实在已装列表里。
if claude plugin list --json 2>/dev/null | grep -q "\"${PLUGIN_NAME}@${MARKETPLACE_NAME}\""; then
  ok "插件已安装：${PLUGIN_NAME}@${MARKETPLACE_NAME}"
else
  die "安装命令跑完，但 claude plugin list 里没看到 ${PLUGIN_NAME}@${MARKETPLACE_NAME}。请手动核查。"
fi

# ── 收尾 ────────────────────────────────────────────────────────────────────────────────────────────
ok "完成 ✓  ccm（${CCM_TAG}）+ cc-master 插件（${PLUGIN_TAG}）都装好了。"
log "下一步：在任意项目里跑  /cc-master:as-master-orchestrator <你的目标>  开始编排。"
