#!/usr/bin/env bash
# package-plugin.sh — 把 cc-master plugin 的**可分发子集**打成 `cc-master-plugin-<tag>.zip`。
#
# 用途：发版时随 GitHub release 附一份「解压即装」的 plugin 制品，
#   解压后即得 plugin 根目录 `cc-master/`，可直接 `claude --plugin-dir <解压目录>/cc-master` 本地安装。
#
# 落点（红线5）：这是 **dev-only** 构建脚本——只从 **repo 根**调用、**不随 plugin 分发**，
#   故用裸相对路径（从 repo 根解析正确）。运行时脚本才进 `skills/<skill>/scripts/`。
#
# allowlist 模型：只 ship 约定的分发目录 + 顶层 doc，**显式列入**而非排除——
#   宁可漏装一个新目录（validate 会现形）也不误带 dev-only 物（ccm/ design_docs/ tests/ scripts/ adrs/ examples/）。
#
# 用法：
#   bash scripts/package-plugin.sh            # tag 从 git/plugin.json 推导
#   bash scripts/package-plugin.sh v0.10.0    # 显式指定 tag（CI 传 GITHUB_REF_NAME）
#   CCM_PLUGIN_OUT_DIR=dist bash ...          # 自定义产物目录（默认 dist/）
#
# 产物路径打到 stdout 最后一行（CI 可 capture）。

set -euo pipefail

# ── 定位 repo 根（脚本在 scripts/ 下·从任意 cwd 调皆可）────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

log() { printf '\033[1;34m[package-plugin]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[package-plugin] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# ── tag 推导：参数 > git exact tag > plugin.json version（前缀 v）──────────────────────────────────
TAG="${1:-}"
if [ -z "${TAG}" ]; then
  TAG="$(git describe --tags --exact-match 2>/dev/null || true)"
fi
if [ -z "${TAG}" ]; then
  VER="$(node -e 'process.stdout.write(require("./.claude-plugin/plugin.json").version)')" \
    || die "读 plugin.json version 失败"
  TAG="v${VER}"
fi
log "tag: ${TAG}"

# ── 可分发 allowlist ─────────────────────────────────────────────────────────────────────────────
#   约定分发目录（红线·§12）：.claude-plugin / commands / skills / hooks（+ 未来 agents / bin）。
#   docs/ 随附是为让 README 里的图片链接在解压后仍可解析（自包含制品）。
INCLUDE_DIRS=( .claude-plugin commands skills hooks docs agents bin )
INCLUDE_FILES=( README.md README_zh.md AGENTS.md CLAUDE.md CHANGELOG.md LICENSE )

# ── staging：制品顶层是 cc-master/（解压即得干净的 plugin 根目录）────────────────────────────────────
STAGE="$(mktemp -d)"
trap 'rm -rf "${STAGE}"' EXIT
PKG="${STAGE}/cc-master"
mkdir -p "${PKG}"

for d in "${INCLUDE_DIRS[@]}"; do
  if [ -d "${d}" ]; then
    cp -R "${d}" "${PKG}/${d}"
    log "+ dir  ${d}/"
  fi
done
[ -d "${PKG}/.claude-plugin" ] || die "缺 .claude-plugin/——制品不会是合法 plugin"
[ -d "${PKG}/skills" ] || die "缺 skills/"

for f in "${INCLUDE_FILES[@]}"; do
  if [ -f "${f}" ]; then
    cp "${f}" "${PKG}/${f}"
    log "+ file ${f}"
  fi
done

# ── 清理任何混入的非分发噪声（保险，allowlist 内目录可能藏 .DS_Store / node_modules）──────────────────
find "${PKG}" -name '.DS_Store' -delete 2>/dev/null || true
find "${PKG}" -type d -name node_modules -prune -exec rm -rf {} + 2>/dev/null || true
# skills/<name>/.design/ 是仓库维护者用的 co-located 设计/J 文档，不是用户 agent 运行时 prose。
find "${PKG}/skills" -type d -name .design -prune -exec rm -rf {} + 2>/dev/null || true

# ── 打 zip ────────────────────────────────────────────────────────────────────────────────────────
OUT_DIR="${CCM_PLUGIN_OUT_DIR:-dist}"
mkdir -p "${REPO_ROOT}/${OUT_DIR}"
ZIP="${REPO_ROOT}/${OUT_DIR}/cc-master-plugin-${TAG}.zip"
rm -f "${ZIP}"
# -X 去除多余的扩展属性/uid-gid，制品跨机一致。
( cd "${STAGE}" && zip -rqX "${ZIP}" cc-master )
log "✔ 打包完成：${ZIP} ($(du -h "${ZIP}" | cut -f1))"

# stdout 最后一行 = 产物绝对路径（CI capture 用）。
printf '%s\n' "${ZIP}"
