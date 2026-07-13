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
#   bash install.sh [--ccm-version ccm-vX.Y.Z] [--plugin-version vX.Y.Z] [--harness claude-code|codex|cursor|auto] [--all-harnesses]
#
# 版本 flag（均可选）：
#   --ccm-version <ccm-vX.Y.Z>    钉 ccm 二进制的版本（缺省 → 解析 ccm-v* 线最新）
#   --plugin-version <vX.Y.Z>     钉 plugin zip 的版本（缺省 → 解析裸 v* 线最新）
#   --harness <id>                指定要安装 plugin 的 agent harness（默认 auto；也可用 CC_MASTER_HARNESS）
#   --all-harnesses               枚举本机已安装的 ccm-supported harness，对支持 plugin 分发者逐个安装
#   （旧的单一 --version 已移除——解耦后它无法同时钉两产物；传它会报错指向上面两 flag。）
#
# 运行依赖：
#   Node.js 22+（联网、pin 和本地离线模式都必需）、unzip、chmod，以及一个 SHA256 工具
#   （sha256sum / shasum / openssl）；联网模式另需 curl 或 wget。
#
# 环境变量（覆写默认）：
#   PREFIX=<dir>                  ccm 二进制装到 <dir>/ccm（默认 $HOME/.local/bin）
#   CC_MASTER_PLUGIN_DIR=<dir>    plugin 解压目标根（默认 $HOME/.local/share/cc-master）
#   CC_MASTER_INSTALL_LOCAL=<dir> ★本地源模式★：从 <dir> 里的 ccm-<os>-<arch> + cc-master-plugin-<harness>-*.zip
#                                 装，而非联网下载（沙盒 E2E / 离线 / draft-release 用）
#                                 若 <dir>/SHA256SUMS 存在则校验；不存在则只信任本地目录、不联网取清单。
#
# 装什么：
#   ① ccm 二进制（per-OS Node SEA·ADR-014）→ $PREFIX/ccm（chmod +x·验 `ccm --version`）
#   ② cc-master 插件 → 在 $CC_MASTER_PLUGIN_DIR target-adjacent stage 后原子发布，再按本机
#      supported harness inventory 分发：
#      - Claude Code：用 claude CLI 持久安装（marketplace add/update + plugin install/update）
#      - Codex：注册本地 Codex plugin marketplace。
#      - Cursor：复制到 ~/.cursor/plugins/local/cc-master（local plugin 面，对齐 probe D9）。
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
CHECKSUM_MANIFEST="SHA256SUMS"

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
  sed -n '2,49p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//' >&2
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
    --harness) HARNESS_TARGET="${2:-}"; [ -n "$HARNESS_TARGET" ] || die "--harness 需要一个值（auto / claude-code / codex / cursor）"; shift 2 ;;
    --harness=*) HARNESS_TARGET="${1#*=}"; [ -n "$HARNESS_TARGET" ] || die "--harness 需要一个值（auto / claude-code / codex / cursor）"; shift ;;
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
need node
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' \
  || die "需要 Node.js 22 或更高版本（联网、pin 和本地离线模式都必需）。"

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

sha256_file() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$file" | awk '{print $NF}'
  else
    die "缺少 SHA256 工具：需要 sha256sum、shasum 或 openssl 之一来校验 release asset。"
  fi
}

expected_sha256_from_manifest() {
  local manifest="$1" asset="$2" base
  base="${asset##*/}"
  [ -f "$manifest" ] || die "缺 checksum 清单：$manifest"
  awk -v target="$base" '
    /^[[:space:]]*($|#)/ { next }
    {
      hash=$1
      name=$2
      sub(/^\*/, "", name)
      sub(/^\.\//, "", name)
      if (name == target) { print hash; found=1; exit }
    }
    END { if (!found) exit 1 }
  ' "$manifest" || return 1
}

verify_sha256_manifest() {
  local asset="$1" manifest="$2" manifest_asset="${3:-}" expected actual base
  base="${manifest_asset:-$asset}"
  base="${base##*/}"
  expected="$(expected_sha256_from_manifest "$manifest" "$base")" \
    || die "checksum 清单 $manifest 里找不到 ${base}。为避免安装未发布/未登记的 asset，已停止。"
  printf '%s' "$expected" | grep -Eq '^[0-9a-fA-F]{64}$' \
    || die "checksum 清单 $manifest 中 ${base} 的 SHA256 值格式不合法：$expected"
  actual="$(sha256_file "$asset")"
  if [ "$(printf '%s' "$actual" | tr '[:upper:]' '[:lower:]')" != "$(printf '%s' "$expected" | tr '[:upper:]' '[:lower:]')" ]; then
    die "checksum 校验失败：${base}
  expected: ${expected}
  actual:   ${actual}
请删除本地缓存/临时文件后重试；若仍失败，请不要继续安装，并到 https://github.com/${REPO}/releases 检查 release asset 或提交 issue。"
  fi
  log "checksum OK：${base}"
}

fetch_release_manifest() {
  local tag="$1" dest="$2"
  fetch "$CHECKSUM_MANIFEST" "$dest" "$GITHUB/$REPO/releases/download/$tag/$CHECKSUM_MANIFEST"
}

verify_downloaded_release_asset() {
  local tag="$1" asset="$2" file="$3" manifest="$4"
  if [ -n "$LOCAL_SRC" ]; then
    if [ -f "$LOCAL_SRC/$CHECKSUM_MANIFEST" ]; then
      verify_sha256_manifest "$file" "$LOCAL_SRC/$CHECKSUM_MANIFEST" "$asset"
    else
      warn "CC_MASTER_INSTALL_LOCAL 本地源未提供 ${CHECKSUM_MANIFEST}；离线安装将信任本地目录中的 ${asset}。联网 GitHub release 安装不会跳过 checksum。"
    fi
    return
  fi
  fetch_release_manifest "$tag" "$manifest" \
    || die "无法下载 checksum 清单：${GITHUB}/${REPO}/releases/download/${tag}/${CHECKSUM_MANIFEST}。为避免未校验安装，已停止。"
  verify_sha256_manifest "$file" "$manifest" "$asset"
}

# ── Target-adjacent transactional publisher ──────────────────────────────────────────────────────
# Usage: transactional_publish <binary|plugin:claude-code|plugin:codex|plugin:cursor> <source> <target>
#
# Source acquisition may cross filesystems. Publication never does: the candidate is copied into a
# target-adjacent stage, re-checksummed/validated there, fsync'd, then activated by rename. Binary
# replacement keeps a same-filesystem backup inode until the installed path executes. Plugin trees
# are immutable versions selected by a relative symlink pointer; after the one-time migration of a
# legacy real directory, every activation is one atomic pointer rename. Failures emit one JSON object
# on stderr and return nonzero; success emits one JSON object on stdout. The private fault hook is
# accepted only by tests. Comma-separated faults can exercise primary, rollback and cleanup failures
# in one transaction (`copy|checksum|exec|rename|exdev|activation|backup-barrier|rollback|
# rollback-barrier|cleanup`).
transactional_publish() {
  local kind="$1" source="$2" target="$3"
  command -v node >/dev/null 2>&1 || die "事务发布需要 PATH 上可用的 Node.js 22+。"
  node - "$kind" "$source" "$target" <<'CC_MASTER_TRANSACTIONAL_PUBLISH_NODE'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const [kind, sourceInput, targetInput] = process.argv.slice(2);
const faultNames = String(process.env.CC_MASTER_PUBLISH_FAULT || '').split(',').filter(Boolean);
const faults = new Set(faultNames);
const allowedFaults = new Set([
  'copy',
  'checksum',
  'exec',
  'rename',
  'exdev',
  'activation',
  'backup-barrier',
  'rollback',
  'rollback-barrier',
  'cleanup',
]);
let phase = 'input';
let stageDir = '';
let publishedVersion = '';
let legacyBackup = '';
let binaryBackup = '';
let failedCandidate = '';
let rollbackLink = '';
let oldLink = null;
let targetExisted = false;
let activated = false;
let committed = false;
let targetRealPath = '';
let previousEndpoint = '';
let previousDigest = '';
let cleanupAttempted = false;
let cleanupOk = null;
let cleanupError = null;
let cleanupErrorCode = null;

function fail(message, code, cause) {
  const error = cause instanceof Error ? cause : new Error(message);
  error.message = message;
  error.publishCode = code;
  throw error;
}

function inject(name) {
  if (!faults.has(name)) return;
  const durabilityFault = name.endsWith('-barrier');
  const code = name === 'exdev'
    ? 'EXDEV'
    : ['rollback', 'cleanup'].includes(name) || durabilityFault
      ? 'EIO'
      : `FAULT_${name.toUpperCase()}`;
  const error = new Error(`injected ${name} failure`);
  error.code = code;
  error.publishCode = name === 'exdev' ? code : `FAULT_${name.toUpperCase().replaceAll('-', '_')}`;
  throw error;
}

function lstatIfPresent(entry) {
  try {
    return fs.lstatSync(entry);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function within(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

function walk(root, visit, rel = '') {
  const here = rel ? path.join(root, rel) : root;
  const stat = fs.lstatSync(here);
  visit(here, rel, stat);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return;
  for (const name of fs.readdirSync(here).sort()) walk(root, visit, path.join(rel, name));
}

function treeDigest(root) {
  const hash = crypto.createHash('sha256');
  walk(root, (entry, rel, stat) => {
    const logical = rel.split(path.sep).join('/');
    const type = stat.isDirectory() ? 'd' : stat.isSymbolicLink() ? 'l' : stat.isFile() ? 'f' : 'o';
    hash.update(`${type}\0${logical}\0${(stat.mode & 0o7777).toString(8)}\0`);
    if (stat.isSymbolicLink()) hash.update(`${fs.readlinkSync(entry)}\0`);
    else if (stat.isFile()) hash.update(fs.readFileSync(entry));
  });
  return hash.digest('hex');
}

function fileDigest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fsyncEntry(entry, stat) {
  if (!stat.isFile() && !stat.isDirectory()) return;
  let fd;
  try {
    fd = fs.openSync(entry, 'r');
    fs.fsyncSync(fd);
  } catch (error) {
    // Linux/macOS differ on directory fsync. These codes mean the filesystem does not expose it;
    // every regular file is still fsync'd and activation remains fail-closed for all other errors.
    if (!stat.isDirectory() || !['EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'EBADF', 'EPERM'].includes(error.code)) {
      throw error;
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function fsyncTree(root) {
  const directories = [];
  walk(root, (entry, _rel, stat) => {
    if (stat.isDirectory()) directories.push([entry, stat]);
    else fsyncEntry(entry, stat);
  });
  for (const [entry, stat] of directories.reverse()) fsyncEntry(entry, stat);
}

function durabilityBarrier(directory, faultName) {
  try {
    inject(faultName);
    fsyncEntry(directory, fs.statSync(directory));
  } catch (error) {
    error.durabilityBarrier = faultName;
    throw error;
  }
}

function validateSafeSymlinks(root) {
  walk(root, (entry, _rel, stat) => {
    if (!stat.isSymbolicLink()) return;
    const link = fs.readlinkSync(entry);
    if (path.isAbsolute(link)) fail(`plugin contains absolute symlink: ${entry}`, 'PLUGIN_SYMLINK');
    const resolved = path.resolve(path.dirname(entry), link);
    if (!within(root, resolved)) fail(`plugin symlink escapes tree: ${entry}`, 'PLUGIN_SYMLINK');
  });
}

function validatePlugin(root, host) {
  const manifests = {
    'claude-code': '.claude-plugin/marketplace.json',
    codex: '.codex-plugin/plugin.json',
    cursor: '.cursor-plugin/plugin.json',
  };
  const relative = manifests[host];
  if (!relative) fail(`unsupported plugin host: ${host}`, 'KIND');
  const manifest = path.join(root, relative);
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('plugin candidate root must be a real directory', 'PLUGIN_TYPE');
  if (!fs.existsSync(manifest) || !fs.statSync(manifest).isFile()) {
    fail(`plugin manifest missing: ${relative}`, 'PLUGIN_MANIFEST');
  }
  try {
    JSON.parse(fs.readFileSync(manifest, 'utf8'));
  } catch (error) {
    fail(`plugin manifest is not valid JSON: ${relative}`, 'PLUGIN_MANIFEST', error);
  }
  validateSafeSymlinks(root);
}

function runBinary(file) {
  const result = spawnSync(file, ['--version'], { encoding: 'utf8', timeout: 15000 });
  if (result.error || result.status !== 0 || !String(result.stdout || '').trim()) {
    fail(
      `binary validation failed: ${result.error?.message || `exit ${result.status}; stdout=${JSON.stringify(result.stdout || '')}`}`,
      'BINARY_EXEC',
      result.error,
    );
  }
  return String(result.stdout).trim();
}

function removeIfPresent(entry) {
  if (entry && lstatIfPresent(entry)) fs.rmSync(entry, { recursive: true, force: true });
}

function restoreAfterFailure(target) {
  const targetPresent = lstatIfPresent(target) !== null;
  const needsRestore = activated || Boolean(legacyBackup && !targetPresent && lstatIfPresent(legacyBackup));
  if (!needsRestore) return false;
  if (!activated) {
    if (legacyBackup && !targetPresent && lstatIfPresent(legacyBackup)) {
      inject('rollback');
      fs.renameSync(legacyBackup, target);
      previousEndpoint = target;
      durabilityBarrier(path.dirname(target), 'rollback-barrier');
    }
    return true;
  }
  if (kind === 'binary') {
    if (targetPresent) {
      failedCandidate = path.join(stageDir, 'failed-candidate');
      try {
        fs.linkSync(target, failedCandidate);
      } catch (error) {
        if (error && error.code === 'EXDEV') fail('failed-candidate link crossed filesystems', 'EXDEV', error);
        fs.copyFileSync(target, failedCandidate, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(failedCandidate, fs.lstatSync(target).mode & 0o7777);
      }
      fsyncEntry(failedCandidate, fs.statSync(failedCandidate));
      fsyncEntry(stageDir, fs.statSync(stageDir));
    }
    inject('rollback');
    if (binaryBackup && lstatIfPresent(binaryBackup)) fs.renameSync(binaryBackup, target);
    else removeIfPresent(target);
    activated = false;
    durabilityBarrier(path.dirname(target), 'rollback-barrier');
    return true;
  }
  rollbackLink = path.join(path.dirname(target), `.${path.basename(target)}.rollback-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  if (oldLink !== null) {
    fs.symlinkSync(oldLink, rollbackLink, 'dir');
    inject('rollback');
    fs.renameSync(rollbackLink, target);
    rollbackLink = '';
    durabilityBarrier(path.dirname(target), 'rollback-barrier');
  } else if (legacyBackup && fs.existsSync(legacyBackup)) {
    inject('rollback');
    removeIfPresent(target);
    fs.renameSync(legacyBackup, target);
    previousEndpoint = target;
    durabilityBarrier(path.dirname(target), 'rollback-barrier');
  } else {
    inject('rollback');
    removeIfPresent(target);
    durabilityBarrier(path.dirname(target), 'rollback-barrier');
  }
  activated = false;
  return true;
}

function verifyActiveEndpoint(target) {
  try {
    const stat = lstatIfPresent(target);
    if (!stat) return { ok: false, error: 'active endpoint is absent' };
    if (kind === 'binary') {
      if (!stat.isFile() || stat.isSymbolicLink()) {
        return { ok: false, error: 'binary endpoint is not a real regular file' };
      }
      const version = runBinary(target);
      return { ok: true, resolved: target, digest: fileDigest(target), version };
    }
    if (!stat.isDirectory() && !stat.isSymbolicLink()) {
      return { ok: false, error: 'plugin endpoint is neither a directory nor a symlink pointer' };
    }
    const resolved = fs.realpathSync(target);
    validatePlugin(resolved, kind.slice('plugin:'.length));
    return { ok: true, resolved, digest: treeDigest(resolved) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function recoveryPaths() {
  const paths = {};
  if (binaryBackup && lstatIfPresent(binaryBackup)) paths.binary_backup = binaryBackup;
  if (failedCandidate && lstatIfPresent(failedCandidate)) paths.failed_candidate = failedCandidate;
  if (kind !== 'binary' && previousEndpoint && lstatIfPresent(previousEndpoint)) {
    paths.previous_endpoint = previousEndpoint;
  }
  if (publishedVersion && lstatIfPresent(publishedVersion)) paths.published_version = publishedVersion;
  if (legacyBackup && lstatIfPresent(legacyBackup)) paths.legacy_backup = legacyBackup;
  if (rollbackLink && lstatIfPresent(rollbackLink)) paths.rollback_pointer = rollbackLink;
  if (stageDir && lstatIfPresent(stageDir)) paths.stage_dir = stageDir;
  return paths;
}

function cleanupFailedPublication() {
  cleanupAttempted = true;
  inject('cleanup');
  removeIfPresent(publishedVersion);
  removeIfPresent(binaryBackup);
  removeIfPresent(rollbackLink);
  removeIfPresent(stageDir);
  stageDir = '';
  cleanupOk = true;
}

try {
  if (!kind || !sourceInput || !targetInput) fail('kind, source and target are required', 'USAGE');
  const unknownFault = faultNames.find((name) => !allowedFaults.has(name));
  if (unknownFault) fail(`unknown CC_MASTER_PUBLISH_FAULT: ${unknownFault}`, 'FAULT_NAME');
  if (kind !== 'binary' && !kind.startsWith('plugin:')) fail(`unsupported publish kind: ${kind}`, 'KIND');

  const source = fs.realpathSync(path.resolve(sourceInput));
  const target = path.resolve(targetInput);
  const lexicalParent = path.dirname(target);
  fs.mkdirSync(lexicalParent, { recursive: true });
  const targetParent = fs.realpathSync(lexicalParent);
  targetRealPath = path.join(targetParent, path.basename(target));
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const gid = typeof process.getgid === 'function' ? process.getgid() : null;

  const existingTarget = lstatIfPresent(targetRealPath);
  targetExisted = existingTarget !== null;
  if (existingTarget && kind === 'binary') {
    if (!existingTarget.isFile() || existingTarget.isSymbolicLink()) {
      fail('binary target must be a real regular file or absent', 'TARGET_TYPE');
    }
    previousEndpoint = targetRealPath;
    runBinary(previousEndpoint);
    previousDigest = fileDigest(previousEndpoint);
  } else if (existingTarget) {
    if (existingTarget.isSymbolicLink()) {
      oldLink = fs.readlinkSync(targetRealPath);
      try {
        previousEndpoint = fs.realpathSync(targetRealPath);
      } catch (error) {
        fail('plugin target symlink must resolve to a valid plugin tree', 'TARGET_TYPE', error);
      }
    } else if (existingTarget.isDirectory()) {
      previousEndpoint = targetRealPath;
    } else {
      fail('plugin target must be a directory, symlink pointer, or absent', 'TARGET_TYPE');
    }
    validatePlugin(previousEndpoint, kind.slice('plugin:'.length));
    previousDigest = treeDigest(previousEndpoint);
  }

  stageDir = fs.mkdtempSync(path.join(targetParent, `.${path.basename(target)}.publish-`));
  const candidate = path.join(stageDir, 'candidate');

  phase = 'copy';
  inject('copy');
  let sourceDigest;
  if (kind === 'binary') {
    const stat = fs.statSync(source);
    if (!stat.isFile()) fail('binary source must be a regular file', 'BINARY_TYPE');
    sourceDigest = fileDigest(source);
    fs.copyFileSync(source, candidate, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(candidate, 0o755);
  } else {
    if (!fs.statSync(source).isDirectory()) fail('plugin source must be a directory', 'PLUGIN_TYPE');
    sourceDigest = treeDigest(source);
    fs.cpSync(source, candidate, {
      recursive: true,
      errorOnExist: true,
      force: false,
      dereference: false,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    });
  }

  phase = 'checksum';
  inject('checksum');
  const stagedDigest = kind === 'binary' ? fileDigest(candidate) : treeDigest(candidate);
  if (sourceDigest !== stagedDigest) fail('target-adjacent copy checksum mismatch', 'CHECKSUM');

  phase = 'validate';
  let version = null;
  if (kind === 'binary') {
    inject('exec');
    version = runBinary(candidate);
  } else {
    validatePlugin(candidate, kind.slice('plugin:'.length));
  }
  const candidateStat = fs.lstatSync(candidate);
  if (uid !== null && candidateStat.uid !== uid) fail('staged artifact owner differs from publisher', 'OWNER');
  fsyncTree(candidate);
  fsyncEntry(stageDir, fs.statSync(stageDir));

  phase = 'activate';
  inject('exdev');
  inject('rename');
  if (kind === 'binary') {
    if (targetExisted) {
      const old = fs.lstatSync(targetRealPath);
      binaryBackup = path.join(stageDir, 'previous');
      try {
        fs.linkSync(targetRealPath, binaryBackup);
      } catch (error) {
        if (error.code === 'EXDEV') fail('backup link crossed filesystems', 'EXDEV', error);
        fs.copyFileSync(targetRealPath, binaryBackup, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(binaryBackup, old.mode & 0o7777);
        fsyncEntry(binaryBackup, fs.statSync(binaryBackup));
      }
      durabilityBarrier(stageDir, 'backup-barrier');
    }
    fs.renameSync(candidate, targetRealPath);
    activated = true;
    inject('activation');
    version = runBinary(targetRealPath);
    fsyncEntry(targetParent, fs.statSync(targetParent));
  } else {
    const versionsRoot = path.join(targetParent, `.${path.basename(target)}.versions`);
    fs.mkdirSync(versionsRoot, { recursive: true, mode: 0o700 });
    const tx = `${Date.now()}-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
    publishedVersion = path.join(versionsRoot, tx);
    fs.renameSync(candidate, publishedVersion);
    fsyncEntry(versionsRoot, fs.statSync(versionsRoot));

    if (targetExisted) {
      const old = fs.lstatSync(targetRealPath);
      if (old.isDirectory() && !old.isSymbolicLink()) {
        legacyBackup = path.join(versionsRoot, `legacy-${tx}`);
        fs.renameSync(targetRealPath, legacyBackup);
        previousEndpoint = legacyBackup;
        durabilityBarrier(versionsRoot, 'backup-barrier');
      }
    }

    const linkTmp = path.join(targetParent, `.${path.basename(target)}.next-${tx}`);
    const relativeVersion = path.relative(targetParent, publishedVersion);
    fs.symlinkSync(relativeVersion, linkTmp, 'dir');
    fs.renameSync(linkTmp, targetRealPath);
    activated = true;
    inject('activation');
    fsyncEntry(targetParent, fs.statSync(targetParent));
  }

  const committedEndpoint = verifyActiveEndpoint(targetRealPath);
  if (!committedEndpoint.ok) {
    fail(`active endpoint verification failed: ${committedEndpoint.error}`, 'ENDPOINT_VERIFY');
  }
  committed = true;
  phase = 'cleanup';
  cleanupAttempted = true;
  inject('cleanup');
  removeIfPresent(binaryBackup);
  removeIfPresent(stageDir);
  stageDir = '';
  cleanupOk = true;
  process.stdout.write(`${JSON.stringify({
    ok: true,
    action: 'published',
    kind,
    target,
    source_digest: sourceDigest,
    version,
    owner: uid === null ? null : { uid, gid },
    activation: kind === 'binary' ? 'atomic-rename' : 'atomic-version-pointer',
    endpoint: committedEndpoint,
  })}\n`);
} catch (error) {
  const target = targetRealPath || (targetInput ? path.resolve(targetInput) : '');
  let rollbackAttempted = false;
  let rollbackOk = null;
  let rollbackError = null;
  let rollbackErrorCode = null;
  let rollbackDurabilityBarrier = null;
  if (!committed && target) {
    const targetPresent = lstatIfPresent(target) !== null;
    const shouldRollback = activated || Boolean(legacyBackup && !targetPresent && lstatIfPresent(legacyBackup));
    if (shouldRollback) {
      rollbackAttempted = true;
      try {
        restoreAfterFailure(target);
        rollbackOk = true;
      } catch (rollback) {
        rollbackOk = false;
        rollbackError = rollback instanceof Error ? rollback.message : String(rollback);
        rollbackErrorCode = rollback && typeof rollback.code === 'string' ? rollback.code : 'ROLLBACK_FAILED';
        rollbackDurabilityBarrier = rollback && typeof rollback.durabilityBarrier === 'string'
          ? rollback.durabilityBarrier
          : null;
      }
    }
  }

  const endpoint = target ? verifyActiveEndpoint(target) : { ok: false, error: 'target unavailable' };
  const previousPreserved = Boolean(previousDigest && endpoint.ok && endpoint.digest === previousDigest);
  const noPriorEndpointPreserved = !targetExisted && (!target || lstatIfPresent(target) === null);

  if (cleanupAttempted && cleanupOk !== true) {
    cleanupOk = false;
    cleanupError = error instanceof Error ? error.message : String(error);
    cleanupErrorCode = error && typeof error.code === 'string' ? error.code : 'CLEANUP_FAILED';
  }
  const failedDurabilityBarrier = error && typeof error.durabilityBarrier === 'string'
    ? error.durabilityBarrier
    : rollbackDurabilityBarrier;
  const safeToCleanup = !committed
    && !failedDurabilityBarrier
    && rollbackOk !== false
    && (previousPreserved || noPriorEndpointPreserved);
  if (safeToCleanup && !cleanupAttempted) {
    try {
      cleanupFailedPublication();
    } catch (cleanup) {
      cleanupOk = false;
      cleanupError = cleanup instanceof Error ? cleanup.message : String(cleanup);
      cleanupErrorCode = cleanup && typeof cleanup.code === 'string' ? cleanup.code : 'CLEANUP_FAILED';
    }
  }

  let action;
  if (failedDurabilityBarrier) {
    action = endpoint.ok ? 'recovery-required' : 'endpoint-unusable-recovery-required';
  } else if (committed) {
    action = endpoint.ok ? 'published-recovery-required' : 'endpoint-unusable-recovery-required';
  } else if (previousPreserved && rollbackOk !== false) {
    action = 'preserved-last-known-good';
  } else if (noPriorEndpointPreserved) {
    action = 'not-published';
  } else {
    action = endpoint.ok ? 'recovery-required' : 'endpoint-unusable-recovery-required';
  }
  const rawCode = error && (error.publishCode || error.code);
  const code = typeof rawCode === 'string' ? rawCode : 'PUBLISH_FAILED';
  process.stderr.write(`${JSON.stringify({
    ok: false,
    action,
    kind: kind || null,
    target: target || null,
    phase,
    code,
    message: error instanceof Error ? error.message : String(error),
    faults: faultNames,
    committed,
    endpoint_ok: endpoint.ok,
    endpoint,
    rollback_attempted: rollbackAttempted,
    rollback_ok: rollbackOk,
    rollback_error: rollbackError,
    rollback_error_code: rollbackErrorCode,
    cleanup_attempted: cleanupAttempted,
    cleanup_ok: cleanupOk,
    cleanup_error: cleanupError,
    cleanup_error_code: cleanupErrorCode,
    durability_barrier: failedDurabilityBarrier,
    recovery_paths: recoveryPaths(),
  })}\n`);
  process.exitCode = 1;
}
CC_MASTER_TRANSACTIONAL_PUBLISH_NODE
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
#   - Cursor：可识别（~/.cursor 或 cursor CLI）、支持 local plugin 复制到 ~/.cursor/plugins/local/。
normalize_harness() {
  local raw="${1:-auto}" h
  h="$(printf '%s' "$raw" | tr '[:upper:]_' '[:lower:]-')"
  case "$h" in
    ""|auto) printf '%s\n' "auto" ;;
    claude|claude-code|claudecode) printf '%s\n' "claude-code" ;;
    codex|openai-codex) printf '%s\n' "codex" ;;
    cursor|cursor-ide) printf '%s\n' "cursor" ;;
    *) return 1 ;;
  esac
}

claude_bin() { printf '%s\n' "${CCM_CLAUDE_BIN:-${CLAUDE_BIN:-claude}}"; }
codex_bin() { printf '%s\n' "${CCM_CODEX_BIN:-${CODEX_BIN:-codex}}"; }
cursor_bin() { printf '%s\n' "${CCM_CURSOR_BIN:-${CURSOR_BIN:-cursor}}"; }

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

# Honest heuristic (probe D9 / ccm cursorAdapter): ~/.cursor exists OR cursor CLI on PATH.
cursor_config_dir() {
  if [ -n "${HOME:-}" ] && [ -d "$HOME/.cursor" ]; then
    printf '%s\n' "$HOME/.cursor"
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
    cursor)
      bin="$(cursor_bin)"
      command -v "$bin" >/dev/null 2>&1 && return 0
      dir="$(cursor_config_dir)"
      [ -n "$dir" ] && [ -d "$dir" ]
      ;;
    *) return 1 ;;
  esac
}

harness_supports_plugin_distribution() {
  [ "$1" = "claude-code" ] || [ "$1" = "codex" ] || [ "$1" = "cursor" ]
}

detect_installed_harnesses() {
  is_harness_installed "claude-code" && printf '%s\n' "claude-code"
  is_harness_installed "codex" && printf '%s\n' "codex"
  is_harness_installed "cursor" && printf '%s\n' "cursor"
}

selected_harnesses() {
  local requested="${HARNESS_TARGET:-${CC_MASTER_HARNESS:-${CC_MASTER_HOST:-${CCM_HOST:-${CC_MASTER_HARNESS_HOST:-auto}}}}}" normalized
  if [ "$ALL_HARNESSES" = "1" ]; then
    detect_installed_harnesses
    return
  fi

  normalized="$(normalize_harness "$requested")" || die "未知 harness：$requested（支持：auto / claude-code / codex / cursor）。"
  if [ "$normalized" = "auto" ]; then
    detect_installed_harnesses
  else
    printf '%s\n' "$normalized"
  fi
}

log_harness_inventory() {
  local cc_state codex_state cursor_state
  if is_harness_installed "claude-code"; then cc_state="installed"; else cc_state="missing"; fi
  if is_harness_installed "codex"; then codex_state="installed"; else codex_state="missing"; fi
  if is_harness_installed "cursor"; then cursor_state="installed"; else cursor_state="missing"; fi
  log "harness inventory：claude-code=${cc_state}, plugin=yes; codex=${codex_state}, plugin=yes; cursor=${cursor_state}, plugin=yes"
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

# Cursor local plugin install (probe D9): copy unpacked adapter → ~/.cursor/plugins/local/cc-master.
install_plugin_cursor() {
  local plugin_root="$1" dest parent publish_state
  [ -f "$plugin_root/.cursor-plugin/plugin.json" ] \
    || die "Cursor adapter 缺失：$plugin_root/.cursor-plugin/plugin.json。请确认是合法的 cc-master Cursor 包。"
  [ -n "${HOME:-}" ] || die "无法解析 Cursor local plugin 路径（需要 HOME）。"

  dest="${CC_MASTER_CURSOR_PLUGIN_ROOT:-$HOME/.cursor/plugins/local/cc-master}"
  parent="$(dirname "$dest")"
  mkdir -p "$parent"
  publish_state="$(transactional_publish "plugin:cursor" "$plugin_root" "$dest")" \
    || die "Cursor plugin 事务发布失败（旧版本已保留）。"
  log "Cursor plugin publish：$publish_state"

  [ -f "$dest/.cursor-plugin/plugin.json" ] \
    || die "Cursor 安装后校验失败：缺 $dest/.cursor-plugin/plugin.json。"
  ok "Cursor 插件已安装：$dest。重开 Cursor Agent session 后 hooks/rules/skills 生效。"
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
  if [ -n "$CCM_VERSION" ]; then
    case "$CCM_VERSION" in
      ccm-v*) printf '%s\n' "$CCM_VERSION" ;;
      v*) printf 'ccm-%s\n' "$CCM_VERSION" ;;
      *) printf 'ccm-v%s\n' "$CCM_VERSION" ;;
    esac
    return
  fi
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
  if [ -n "$PLUGIN_VERSION" ]; then
    case "$PLUGIN_VERSION" in
      v*) printf '%s\n' "$PLUGIN_VERSION" ;;
      *) printf 'v%s\n' "$PLUGIN_VERSION" ;;
    esac
    return
  fi
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
if [ "${CC_MASTER_INSTALL_SH_TEST_SOURCE:-}" = "1" ]; then
  return 0 2>/dev/null || exit 0
fi

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
verify_downloaded_release_asset "$CCM_TAG" "$BIN_ASSET" "$TMP/ccm" "$TMP/${CCM_TAG}-${CHECKSUM_MANIFEST}"
chmod +x "$TMP/ccm"
mkdir -p "$PREFIX"
CCM_BIN="$PREFIX/ccm"
CCM_PUBLISH_STATE="$(transactional_publish binary "$TMP/ccm" "$CCM_BIN")" \
  || die "ccm 事务发布失败（旧二进制已保留）。"
log "ccm publish：$CCM_PUBLISH_STATE"

# 验证二进制能跑（用绝对路径，绕开 PATH 未配的情况）。
if CCM_VER="$("$CCM_BIN" --version 2>&1)"; then
  ok "ccm 已安装：${CCM_BIN}（${CCM_VER}）"
else
  die "ccm 装好了但无法执行（$CCM_BIN --version 失败）。可能是平台二进制不匹配。输出：${CCM_VER:-<空>}"
fi

# ccm binary lifecycle hook (ADR-033): after replacing/verifying the ccm binary,
# restart only services that were already wanted/running. This is best-effort:
# plugin install failures and service reconciliation failures must stay separate.
if "$CCM_BIN" services reconcile --after-binary-replace >/dev/null 2>&1; then
  log "services reconcile OK（monitor / web-viewer wanted 服务已按需收口）"
else
  warn "ccm 已安装，但 services reconcile 未成功；如你有 monitor/web-viewer 常驻服务，可稍后手动运行：$CCM_BIN services reconcile --after-binary-replace"
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
REQUESTED_HARNESS_NORMALIZED="$(normalize_harness "$REQUESTED_HARNESS_RAW")" || die "未知 harness：$REQUESTED_HARNESS_RAW（支持：auto / claude-code / codex / cursor）。"
EXPLICIT_SINGLE_HARNESS=0
[ "$ALL_HARNESSES" = "0" ] && [ "$REQUESTED_HARNESS_NORMALIZED" != "auto" ] && EXPLICIT_SINGLE_HARNESS=1

TARGET_HARNESSES="$(selected_harnesses | awk 'NF && !seen[$0]++')"
[ -n "$TARGET_HARNESSES" ] || die "未发现已安装的 supported harness。请先安装 Claude Code、Codex 或 Cursor。"

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

[ -n "$SUPPORTED_TARGETS" ] || die "本机未发现任何支持 cc-master plugin 分发的 harness。当前可安装目标：claude-code / codex / cursor。"

PLUGIN_TAG="$(resolve_plugin_tag)"         # 如 v0.10.1
log "plugin：${PLUGIN_TAG}"

unpack_plugin_for_harness() {
  local harness="$1" asset zip dest root unpack_root candidate publish_state
  asset="cc-master-plugin-${harness}-${PLUGIN_TAG}.zip"
  zip="$TMP/plugin-${harness}.zip"
  fetch "$asset" "$zip" "$GITHUB/$REPO/releases/download/$PLUGIN_TAG/$asset"
  verify_downloaded_release_asset "$PLUGIN_TAG" "$asset" "$zip" "$TMP/${PLUGIN_TAG}-${CHECKSUM_MANIFEST}"
  dest="$PLUGIN_DIR/$harness"
  mkdir -p "$dest"
  unpack_root="$TMP/unpack-$harness"
  rm -rf "$unpack_root"
  mkdir -p "$unpack_root"
  unzip -q "$zip" -d "$unpack_root" || die "解压失败：$asset"
  candidate="$unpack_root/cc-master"
  root="$dest/cc-master"
  publish_state="$(transactional_publish "plugin:$harness" "$candidate" "$root")" \
    || die "$harness plugin 事务发布失败（旧版本已保留）。"
  log "$harness plugin publish：$publish_state"
  case "$harness" in
    claude-code)
      [ -f "$root/.claude-plugin/marketplace.json" ] \
        || die "解压结果不是合法 Claude Code plugin（缺 $root/.claude-plugin/marketplace.json）。"
      ;;
    codex)
      [ -d "$root/.codex-plugin" ] || die "解压结果不是合法 Codex adapter（缺 $root/.codex-plugin）。"
      ;;
    cursor)
      [ -f "$root/.cursor-plugin/plugin.json" ] \
        || die "解压结果不是合法 Cursor adapter（缺 $root/.cursor-plugin/plugin.json）。"
      ;;
  esac
  abspath_dir "$root"
}

INSTALLED_HARNESSES=""
while IFS= read -r harness; do
  [ -n "$harness" ] || continue
  PLUGIN_ROOT="$(unpack_plugin_for_harness "$harness")"
  log "插件已事务发布（${harness}）：$PLUGIN_ROOT"
  case "$harness" in
    claude-code)
      install_plugin_claude_code "$PLUGIN_ROOT"
      INSTALLED_HARNESSES="${INSTALLED_HARNESSES}${INSTALLED_HARNESSES:+, }${harness}"
      ;;
    codex)
      install_plugin_codex "$PLUGIN_ROOT"
      INSTALLED_HARNESSES="${INSTALLED_HARNESSES}${INSTALLED_HARNESSES:+, }${harness}"
      ;;
    cursor)
      install_plugin_cursor "$PLUGIN_ROOT"
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
log "下一步：Claude Code 跑 /cc-master:as-master-orchestrator <目标>；Codex 跑 \$cc-master-as-master-orchestrator <目标>；Cursor 装好后重开 Agent session（local plugin：~/.cursor/plugins/local/cc-master）。"
