#!/usr/bin/env bash
# package-plugin.sh — 把 cc-master plugin 的**可分发子集**按 harness 打成 zip。
#
# 用途：发版时随 GitHub release 附「解压即装」的 per-harness plugin 制品，
#   解压后即得 plugin 根目录 `cc-master/`；所有 harness 共享同一 plugin tag/version，只拆 asset。
#
# 落点（红线5）：这是 **dev-only** 构建脚本——只从 **repo 根**调用、**不随 plugin 分发**，
#   故用裸相对路径（从 repo 根解析正确）。运行时脚本才进 `plugin/src/skills/<skill>/canonical/scripts/`。
#
# allowlist 模型：只 ship 约定的分发目录 + 顶层 doc，**显式列入**而非排除——
#   宁可漏装一个新目录（validate 会现形）也不误带 dev-only 物（ccm/ design_docs/ tests/ scripts/ adrs/ examples/）。
#
# 用法：
#   bash scripts/package-plugin.sh --host claude-code          # tag 从 git/plugin.json 推导
#   bash scripts/package-plugin.sh --host codex v0.10.0        # 显式指定 tag（CI 传 GITHUB_REF_NAME）
#   bash scripts/package-plugin.sh --all-hosts v0.10.0         # 输出所有 supported host 制品
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

zip_dir() {
  local stage="$1" zip="$2"
  if command -v zip >/dev/null 2>&1; then
    ( cd "$stage" && zip -rqX "$zip" cc-master )
    return
  fi
  command -v python3 >/dev/null 2>&1 || die "缺 zip；也找不到 python3 fallback 来生成 zip。"
  STAGE="$stage" ZIP="$zip" python3 <<'PY'
import os
import stat
import zipfile

stage = os.environ["STAGE"]
zip_path = os.environ["ZIP"]
root = os.path.join(stage, "cc-master")

with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        filenames.sort()
        rel_dir = os.path.relpath(dirpath, stage)
        if rel_dir != ".":
            info = zipfile.ZipInfo(rel_dir.rstrip("/") + "/")
            mode = os.stat(dirpath).st_mode
            info.external_attr = (mode & 0xFFFF) << 16
            zf.writestr(info, b"")
        for name in filenames:
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, stage)
            info = zipfile.ZipInfo(rel)
            mode = os.stat(full).st_mode
            info.external_attr = (mode & 0xFFFF) << 16
            with open(full, "rb") as fh:
                zf.writestr(info, fh.read())
PY
}

# ── tag 推导：参数 > git exact tag > plugin.json version（前缀 v）──────────────────────────────────
HOST="claude-code"
ALL_HOSTS=0
TAG=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --host)
      HOST="${2:-}"
      [ -n "${HOST}" ] || die "--host 需要一个值（claude-code / codex）"
      shift 2
      ;;
    --host=*)
      HOST="${1#*=}"
      [ -n "${HOST}" ] || die "--host 需要一个值（claude-code / codex）"
      shift
      ;;
    --all-hosts)
      ALL_HOSTS=1
      shift
      ;;
    -h|--help)
      sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      [ -z "${TAG}" ] || die "只能传一个 tag；多余参数：$1"
      TAG="$1"
      shift
      ;;
  esac
done
[ "${ALL_HOSTS}" = "1" ] && [ "${HOST}" != "claude-code" ] && die "--host 与 --all-hosts 不能同时使用。"
if [ -z "${TAG}" ]; then
  TAG="$(git describe --tags --exact-match 2>/dev/null || true)"
fi
if [ -z "${TAG}" ]; then
  VER="$(node -e 'process.stdout.write(require("./plugin/src/.claude-plugin/plugin.json").version)')" \
    || die "读 plugin.json version 失败"
  TAG="v${VER}"
fi
log "tag: ${TAG}"

# ── 可分发 allowlist ─────────────────────────────────────────────────────────────────────────────
package_one() {
  local host="$1" stage pkg plugin_root zip out_dir
  case "$host" in
    claude-code|codex) ;;
    *) die "未知 host：${host}（支持：claude-code / codex）" ;;
  esac

  bash scripts/sync-plugin-dist.sh --host "$host" >/dev/null
  plugin_root="plugin/dist/${host}"
  [ -d "$plugin_root" ] || die "缺 ${plugin_root}"

  stage="$(mktemp -d)"
  pkg="${stage}/cc-master"
  mkdir -p "$pkg"

  local include_dirs=( skills hooks docs agents bin )
  if [ "$host" = "claude-code" ]; then
    include_dirs=( .claude-plugin commands "${include_dirs[@]}" )
  else
    include_dirs=( .codex-plugin "${include_dirs[@]}" )
  fi
  local include_files=( README.md README_zh.md CHANGELOG.md LICENSE )

  log "host: ${host}"
  for d in "${include_dirs[@]}"; do
    if [ -d "${plugin_root}/${d}" ]; then
      cp -R "${plugin_root}/${d}" "${pkg}/${d}"
      log "+ dir  ${d}/"
    elif [ -d "${d}" ]; then
      cp -R "${d}" "${pkg}/${d}"
      log "+ dir  ${d}/"
    fi
  done
  [ -d "${pkg}/skills" ] || die "缺 skills/"
  if [ "$host" = "claude-code" ]; then
    [ -d "${pkg}/.claude-plugin" ] || die "缺 .claude-plugin/——Claude Code 制品不会是合法 plugin"
    [ -d "${pkg}/commands" ] || die "缺 commands/"
  else
    [ -d "${pkg}/.codex-plugin" ] || die "缺 .codex-plugin/"
  fi

  for f in "${include_files[@]}"; do
    if [ -f "${f}" ]; then
      cp "${f}" "${pkg}/${f}"
      log "+ file ${f}"
    fi
  done

  find "${pkg}" -name '.DS_Store' -delete 2>/dev/null || true
  find "${pkg}" -type d -name node_modules -prune -exec rm -rf {} + 2>/dev/null || true
  find "${pkg}/skills" -type d -name .design -prune -exec rm -rf {} + 2>/dev/null || true

  out_dir="${CCM_PLUGIN_OUT_DIR:-dist}"
  case "$out_dir" in
    /*) ;;
    *) out_dir="${REPO_ROOT}/${out_dir}" ;;
  esac
  mkdir -p "${out_dir}"
  zip="${out_dir}/cc-master-plugin-${host}-${TAG}.zip"
  rm -f "$zip"
  zip_dir "$stage" "$zip"
  rm -rf "$stage"
  log "✔ 打包完成：${zip} ($(du -h "${zip}" | cut -f1))"
  printf '%s\n' "$zip"
}

if [ "$ALL_HOSTS" = "1" ]; then
  package_one claude-code
  package_one codex
else
  package_one "$HOST"
fi
