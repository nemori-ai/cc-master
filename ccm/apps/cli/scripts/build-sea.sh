#!/usr/bin/env bash
# build-sea.sh — 把 apps/cli 打成本平台的 Node SEA（Single Executable Application）单可执行 `ccm` 二进制（T3·ADR-014）。
#
# 整条构建链（Node 官方 SEA 流程 + macOS 重签名）：
#   ① tsdown --config tsdown.sea.config.mts → dist/ccm-sea.cjs（自包含可执行 bundle，引擎全内联、顶层执行 CLI）
#   ② node --experimental-sea-config sea-config.json → dist/ccm-sea.blob（useCodeCache:true 的 SEA blob）
#   ③ 拷贝当前 node 可执行 → 目标二进制（dist/ccm[-<os>-<arch>]）
#   ④ macOS：codesign --remove-signature（postject 注入会使原签名失效，须先去签）
#   ⑤ postject 把 blob 注入二进制（SEA fuse NODE_SEA_BLOB；macOS 额外 --macho-segment-name NODE_SEA）
#   ⑥ macOS：codesign --sign - <binary>（ad-hoc 重签，否则 Gatekeeper/内核拒跑）
#
# 产物落 dist/（已 gitignore·ccm/**/dist）——二进制是 per-OS build artifact，绝不提交（只提交本脚本 + 入口 + config）。
#
# 用法：
#   bash scripts/build-sea.sh                      # 本平台，产 dist/ccm
#   CCM_SEA_OUT=dist/ccm-darwin-arm64 bash ...     # 自定义产物名（T5 多平台用）
#   CCM_SEA_SKIP_BUNDLE=1 bash ...                 # 跳过 ① tsdown（bundle 已就绪时）
#   CCM_SEA_NODE=/path/to/node bash ...            # 用指定 node（交叉/多版本；默认 `command -v node`）
#
# ⚠️ 自包含前提（平台坑，T5/CI 必读）：SEA 把 blob 注入「拷贝来的那个 node 二进制」——产物的自包含度 =
#   被拷贝 node 的自包含度。**homebrew 的 node 是动态链接** @rpath/libnode.*.dylib + 一堆 /opt/homebrew/*
#   dylib（otool -L 可见 ~21 个非系统依赖），用它打的 SEA 仍需那些 dylib 在盘上 → 不自包含。
#   **必须用 nodejs.org 官方静态二进制**（otool -L 只剩 /usr/lib + /System）。CI 装官方 node（actions/setup-node
#   或直接下 tarball）后本脚本即产真自包含二进制；本地 homebrew node 请 CCM_SEA_NODE=<官方node路径> 覆盖。
#
# 红线：纯 shell·依赖 node + tsdown(npx/pnpm 调) + postject(本地 devDep) + (macOS) codesign。
#   这是 dev/CI 构建脚本（非运行时·非 hook）——不破 ship-anywhere（产物才是 ship 的东西）。

set -euo pipefail

# ── 定位脚本所在的 apps/cli 目录（脚本可从任意 cwd 调）──────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${CLI_DIR}"

# ── 参数化（T5 多平台）──────────────────────────────────────────────────────────────────────────────
NODE_BIN="${CCM_SEA_NODE:-$(command -v node)}"
SEA_CONFIG="${CCM_SEA_CONFIG:-sea-config.json}"
BUNDLE="dist/ccm-sea.cjs"
BLOB="dist/ccm-sea.blob"
OUT="${CCM_SEA_OUT:-dist/ccm}"
OS="$(uname -s)"

log() { printf '\033[1;34m[build-sea]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[build-sea] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[ -x "${NODE_BIN}" ] || die "node 不可执行：${NODE_BIN}"
log "node: ${NODE_BIN} ($(${NODE_BIN} --version))"
log "platform: ${OS} ($(uname -m)) → 产物 ${OUT}"

# ── ① tsdown：产自包含可执行 bundle dist/ccm-sea.cjs ───────────────────────────────────────────────
if [ "${CCM_SEA_SKIP_BUNDLE:-0}" != "1" ]; then
  log "① gen web-viewer assets + tsdown → ${BUNDLE}"
  node scripts/gen-web-viewer-assets.mjs
  npx tsdown --config tsdown.sea.config.mts
else
  log "① 跳过 tsdown（CCM_SEA_SKIP_BUNDLE=1）"
fi
[ -f "${BUNDLE}" ] || die "bundle 不存在：${BUNDLE}（先跑 ① 或别设 SKIP_BUNDLE）"

# ── ② SEA blob ─────────────────────────────────────────────────────────────────────────────────────
log "② node --experimental-sea-config ${SEA_CONFIG} → ${BLOB}"
"${NODE_BIN}" --experimental-sea-config "${SEA_CONFIG}"
[ -f "${BLOB}" ] || die "blob 未生成：${BLOB}"

# ── ③ 拷贝 node 可执行 → 目标二进制 ──────────────────────────────────────────────────────────────────
#   注：解析 symlink 取真二进制（homebrew `node` 是 symlink·见平台坑）；rm 旧产物 + chmod +w
#   （源 node 常是 r-xr-xr-x 只读，cp 后 postject 需写权限，否则报「Can't read and write to target executable」）。
NODE_REAL="$("${NODE_BIN}" -e 'process.stdout.write(require("fs").realpathSync(process.execPath))')"
log "③ cp node（real: ${NODE_REAL}）→ ${OUT}"
mkdir -p "$(dirname "${OUT}")"
rm -f "${OUT}"
cp "${NODE_REAL}" "${OUT}"
chmod u+wx "${OUT}"

# ── ④ macOS：去签（postject 注入会破签）───────────────────────────────────────────────────────────────
if [ "${OS}" = "Darwin" ]; then
  log "④ codesign --remove-signature ${OUT}"
  codesign --remove-signature "${OUT}" || die "去签失败"
fi

# ── ⑤ postject 注入 blob ─────────────────────────────────────────────────────────────────────────────
log "⑤ postject 注入 NODE_SEA_BLOB"
POSTJECT_ARGS=(
  "${OUT}" NODE_SEA_BLOB "${BLOB}"
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
)
if [ "${OS}" = "Darwin" ]; then
  POSTJECT_ARGS+=(--macho-segment-name NODE_SEA)
fi
# 优先本地 devDep 的 postject；缺则 npx 拉。
if [ -x "node_modules/.bin/postject" ]; then
  node_modules/.bin/postject "${POSTJECT_ARGS[@]}"
else
  npx --yes postject "${POSTJECT_ARGS[@]}"
fi

# ── ⑥ macOS：ad-hoc 重签（否则 Gatekeeper/内核拒跑）──────────────────────────────────────────────────
if [ "${OS}" = "Darwin" ]; then
  log "⑥ codesign --sign - ${OUT}（ad-hoc）"
  codesign --sign - "${OUT}" || die "重签失败"
fi

SIZE="$(du -h "${OUT}" | cut -f1)"
log "✔ 完成：${OUT}（${SIZE}）"
log "  冒烟：${OUT} --version"
