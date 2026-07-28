#!/usr/bin/env bash
# package-plugin.sh — 把 cc-master plugin 的可分发子集按 harness 打成 zip。
#
# 正常入口从已验证的 plugin/dist/<host> 打包：
#   bash scripts/package-plugin.sh --host claude-code [tag]
#   bash scripts/package-plugin.sh --all-hosts [tag]
#
# 兼容入口消费既有 immutable release-input.json；它不改变正常入口：
#   bash scripts/package-plugin.sh --manifest /absolute/release-input.json [--out-dir dist]
#
# Stdout 只输出 release upload set 的绝对路径。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

log() { printf '\033[1;34m[package-plugin]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[package-plugin] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

sha256_file() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$file" | awk '{print $NF}'
  else
    die "缺 SHA256 工具：需要 sha256sum、shasum 或 openssl 之一。"
  fi
}

zip_dir() {
  local stage="$1" zip="$2"
  if command -v zip >/dev/null 2>&1; then
    ( cd "$stage" && zip -rqX "$zip" cc-master )
    return
  fi
  command -v python3 >/dev/null 2>&1 || die "缺 zip；也找不到 python3 fallback 来生成 zip。"
  STAGE="$stage" ZIP="$zip" python3 <<'PY'
import os
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
            info.external_attr = (os.stat(dirpath).st_mode & 0xFFFF) << 16
            zf.writestr(info, b"")
        for name in filenames:
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, stage)
            info = zipfile.ZipInfo(rel)
            info.external_attr = (os.stat(full).st_mode & 0xFFFF) << 16
            with open(full, "rb") as fh:
                zf.writestr(info, fh.read())
PY
}

has_manifest_arg=0
for arg in "$@"; do
  case "${arg}" in
    --manifest|--manifest=*) has_manifest_arg=1 ;;
  esac
done

if [ "${has_manifest_arg}" -eq 1 ]; then
  manifest=""
  out_dir="${CCM_PLUGIN_OUT_DIR:-${REPO_ROOT}/dist}"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --manifest)
        manifest="${2:-}"
        shift 2
        ;;
      --manifest=*)
        manifest="${1#*=}"
        shift
        ;;
      --out-dir)
        out_dir="${2:-}"
        shift 2
        ;;
      --out-dir=*)
        out_dir="${1#*=}"
        shift
        ;;
      *) die "manifest 入口不接受参数：$1" ;;
    esac
  done
  [ -n "${manifest}" ] || die "--manifest 需要一个非空路径"
  [ -f "${manifest}" ] || die "manifest 不存在：${manifest}"
  [ -n "${out_dir}" ] || die "--out-dir 不能为空"
  exec node "${SCRIPT_DIR}/trusted-release-bundle.mjs" build \
    --manifest "${manifest}" \
    --out-dir "${out_dir}"
fi

host="claude-code"
all_hosts=0
tag=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --host)
      host="${2:-}"
      [ -n "${host}" ] || die "--host 需要一个值（claude-code / codex / cursor / kimi-code）"
      shift 2
      ;;
    --host=*)
      host="${1#*=}"
      [ -n "${host}" ] || die "--host 需要一个值（claude-code / codex / cursor / kimi-code）"
      shift
      ;;
    --all-hosts)
      all_hosts=1
      shift
      ;;
    --out-dir)
      CCM_PLUGIN_OUT_DIR="${2:-}"
      [ -n "${CCM_PLUGIN_OUT_DIR}" ] || die "--out-dir 不能为空"
      shift 2
      ;;
    --out-dir=*)
      CCM_PLUGIN_OUT_DIR="${1#*=}"
      [ -n "${CCM_PLUGIN_OUT_DIR}" ] || die "--out-dir 不能为空"
      shift
      ;;
    -h|--help)
      sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      [ -z "${tag}" ] || die "只能传一个 tag；多余参数：$1"
      tag="$1"
      shift
      ;;
  esac
done
[ "${all_hosts}" = "1" ] && [ "${host}" != "claude-code" ] \
  && die "--host 与 --all-hosts 不能同时使用。"

if [ -z "${tag}" ]; then
  tag="$(git describe --tags --exact-match 2>/dev/null || true)"
fi
if [ -z "${tag}" ]; then
  version="$(node -e 'process.stdout.write(require("./plugin/src/.claude-plugin/plugin.json").version)')" \
    || die "读 plugin.json version 失败"
  tag="v${version}"
fi
log "tag: ${tag}"

package_seq=0
package_one() {
  local package_host="$1" stage package_root dist_root zip output_dir checksum hash
  case "${package_host}" in
    claude-code|codex|cursor|kimi-code) ;;
    *) die "未知 host：${package_host}（支持：claude-code / codex / cursor / kimi-code）" ;;
  esac

  bash scripts/sync-plugin-dist.sh --host "${package_host}" >/dev/null
  dist_root="plugin/dist/${package_host}"
  [ -d "${dist_root}" ] || die "缺 ${dist_root}"

  stage="$(mktemp -d)"
  package_root="${stage}/cc-master"
  mkdir -p "${package_root}"

  local include_dirs=( skills hooks docs agents bin )
  local root_manifest=""
  case "${package_host}" in
    claude-code) include_dirs=( .claude-plugin commands "${include_dirs[@]}" ) ;;
    codex) include_dirs=( .codex-plugin "${include_dirs[@]}" ) ;;
    cursor) include_dirs=( .cursor-plugin commands rules "${include_dirs[@]}" ) ;;
    kimi-code)
      include_dirs=( commands "${include_dirs[@]}" )
      root_manifest="kimi.plugin.json"
      ;;
  esac
  local include_files=( README.md README_zh.md CHANGELOG.md LICENSE LICENSING.md TRADEMARKS.md )

  log "host: ${package_host}"
  local directory file
  for directory in "${include_dirs[@]}"; do
    if [ -d "${dist_root}/${directory}" ]; then
      cp -R "${dist_root}/${directory}" "${package_root}/${directory}"
      log "+ dir  ${directory}/"
    fi
  done
  if [ -n "${root_manifest}" ]; then
    [ -f "${dist_root}/${root_manifest}" ] || die "缺 ${dist_root}/${root_manifest}"
    cp "${dist_root}/${root_manifest}" "${package_root}/${root_manifest}"
    log "+ file ${root_manifest}"
  fi
  for file in "${include_files[@]}"; do
    if [ -f "${file}" ]; then
      cp "${file}" "${package_root}/${file}"
      log "+ file ${file}"
    fi
  done

  [ -d "${package_root}/skills" ] || die "缺 skills/"
  case "${package_host}" in
    claude-code)
      [ -f "${package_root}/.claude-plugin/plugin.json" ] || die "缺 .claude-plugin/plugin.json"
      [ -d "${package_root}/commands" ] || die "缺 commands/"
      ;;
    codex)
      [ -f "${package_root}/.codex-plugin/plugin.json" ] || die "缺 .codex-plugin/plugin.json"
      ;;
    cursor)
      [ -f "${package_root}/.cursor-plugin/plugin.json" ] || die "缺 .cursor-plugin/plugin.json"
      [ -d "${package_root}/rules" ] || die "缺 rules/"
      ;;
    kimi-code)
      [ -f "${package_root}/kimi.plugin.json" ] || die "缺 kimi.plugin.json"
      [ -d "${package_root}/commands" ] || die "缺 commands/"
      [ -d "${package_root}/hooks" ] || die "缺 hooks/"
      ;;
  esac

  find "${package_root}" -name '.DS_Store' -delete 2>/dev/null || true
  find "${package_root}" -type d -name node_modules -prune -exec rm -rf {} + 2>/dev/null || true
  find "${package_root}/skills" -type d -name .design -prune -exec rm -rf {} + 2>/dev/null || true

  if find "${package_root}" -type d -name knowledge -print -quit | grep -q .; then
    rm -rf "${stage}"
    die "package staging 中禁止 knowledge/"
  fi
  if grep -RIlE 'knowledge/atlas\.md|knowledge/modules/|plugin/src/knowledge' \
    "${package_root}" --include='*.md' | grep -q .; then
    rm -rf "${stage}"
    die "package staging 中存在 repo-only knowledge 链接"
  fi

  output_dir="${CCM_PLUGIN_OUT_DIR:-dist}"
  case "${output_dir}" in
    /*) ;;
    *) output_dir="${REPO_ROOT}/${output_dir}" ;;
  esac
  mkdir -p "${output_dir}"
  zip="${output_dir}/cc-master-plugin-${package_host}-${tag}.zip"
  rm -f "${zip}"
  zip_dir "${stage}" "${zip}"
  rm -rf "${stage}"

  checksum="${output_dir}/SHA256SUMS"
  if [ "${package_seq}" -eq 0 ]; then
    rm -f "${checksum}"
  fi
  hash="$(sha256_file "${zip}")"
  printf '%s  %s\n' "${hash}" "${zip##*/}" >>"${checksum}"
  package_seq=$((package_seq + 1))
  log "✔ 打包完成：${zip}"
  printf '%s\n' "${zip}"
}

if [ "${all_hosts}" = "1" ]; then
  package_one claude-code
  package_one codex
  package_one cursor
  package_one kimi-code
else
  package_one "${host}"
fi
