#!/usr/bin/env bash
# test-release-local.sh — 本地预演两条 release workflow（版本线解耦·ADR-022 后二者独立）：
#   .github/workflows/ccm-release.yml（build-sea·ccm 二进制线）+ plugin-release.yml（package-plugin·plugin zip 线）
#   能正确**编译 + 打包出制品**的 dev-only harness。让 release 的破绽在打 tag 发版**之前**
#   就暴露，而不是真打 tag 推上去、CI 在真 runner 上才第一次跑。
#
# 落点（红线5）：这是 **dev-only** 脚本——只从 **repo 根**调用、**不随 plugin 分发**，
#   故用裸相对路径（从 repo 根解析正确·与 package-plugin.sh / eval-*.sh 同侧）。
#
# ─────────────────────────────────────────────────────────────────────────────
# 验证分层（哪些本地可验、哪些只能真 runner）——诚实记账，见文末 design_docs 文档：
#
#   ✅ 本地可验（本 harness 覆盖）：
#      1. SEA 编译 + 执行 + 自包含（STAGE 1）——用官方 **node 22** 跑 build-sea.sh 产真单文件
#         二进制（macOS arm64 口径），执行它跑 board init/show（隔离 scratch home·绝不碰真
#         ~/.claude），macOS 上 otool -L 核自包含。这是 ccm-release.yml `build-sea` job 的**本机**
#         那一档（macos-14 leg 的等价物）。
#      2. plugin 打包 + 校验（STAGE 2）——跑 package-plugin.sh 产 zip + SHA256SUMS，checksum
#         自检、解压后 `claude plugin validate` 过。这是 plugin-release.yml `package-plugin` job 的核心。
#      3. Linux job wiring via act（STAGE 3·可选）——若装了 act + docker 在，用 act 在本地
#         Docker 跑 Linux job（`package-plugin` 默认·来自 plugin-release.yml；`--with-sea-linux`
#         追加 linux-x64 的 build-sea·来自 ccm-release.yml），模拟 push 事件，确认 workflow steps
#         真执行 + 产 artifact。
#
#   ⚠️ 只能真 runner（本 harness **验不了**·诚实标注）：
#      - macOS job（macos-14 / macos-13）——act 无 macOS 容器（GitHub-hosted macOS runner only）。
#        本地 STAGE 1 验的是「SEA 编译链 + 二进制能跑 + 自包含」这件事（本机即 darwin-arm64·
#        与 macos-14 leg 同口径），但 workflow 的 macOS job 步骤编排只能靠真 runner / 逐行 YAML 审。
#      - 真 `gh release` attach（softprops/action-gh-release）——attach step 是 tag-gated
#        （`if: startsWith(github.ref, 'refs/tags/')`）。**血泪 footgun（本 harness 立此防线）**：
#        act 会**自动复用本机 `gh` keyring 的真 token**，若拿一个 **tag 事件**喂 act，attach step
#        会真的去 attach 到**真 GitHub repo 的真 release**（实测把一个 draft release 直接 publish 了）。
#        故 STAGE 3 **故意用「非-tag」push 事件**（ref=refs/heads/…）让 attach step 按其 `if` 守卫
#        **被跳过**——只验 checkout→setup→build→package→upload-artifact 这段 wiring（这本就是
#        local 能验的全部；attach 需真 release，本就只能真 runner 验）；外加 `GITHUB_TOKEN=dummy`
#        防御纵深。**绝不拿 tag 事件喂 act**（除非你 100% 确认 attach 被 `-n`/dummy-token 彻底掐死）。
#      - Linux arm64 leg（ubuntu-24.04-arm）——act 在 amd64 容器跑，arm64 runner 行为只能真 runner 验。
#
#   🟢 安全的真-runner 触发路径（不真发版）：ccm-release.yml 带 `workflow_dispatch`——push 到
#      GitHub 后可在 Actions 页手动触发，在真全平台 runner 上跑 build + upload-artifact（**不**
#      attach release·因非 tag 触发），即可验 macOS/arm64 leg 而不真发版。
# ─────────────────────────────────────────────────────────────────────────────
#
# 依赖：
#   STAGE 1：node（任意版本·跑 build 链；SEA 注入须 node 22·见下）+ pnpm + (macOS) codesign/otool。
#            SEA sentinel 注入只在 node 22 可靠（25/26 报 "Could not find the sentinel
#            NODE_SEA_FUSE"）——harness 自动取官方 node 22：CCM_SEA_NODE 覆写 > PATH 上的 node 22 >
#            下载 nodejs.org 官方静态 node 22 到缓存（CCM_NODE22_CACHE·默认系统 tmp·不入仓）。
#   STAGE 2：node（跑 plugin validate）+ claude CLI + zip/unzip。
#   STAGE 3：act + docker（任一缺则 STAGE 3 跳过·非失败）。
#
# 用法：
#   bash scripts/test-release-local.sh                  # STAGE 1 + 2（核心·必跑绿）
#   bash scripts/test-release-local.sh --with-act       # 追加 STAGE 3（act package-plugin job）
#   bash scripts/test-release-local.sh --with-act --with-sea-linux  # STAGE 3 再追加 linux-x64 build-sea job
#   bash scripts/test-release-local.sh --skip-sea       # 跳 STAGE 1（只验 plugin 打包）
#   CCM_SEA_NODE=/path/to/node22 bash ...               # 指定 node 22（免下载）
#
# 退出码：0 = 所有**已跑**的 stage 绿（跳过的 stage 不影响）；非 0 = 某 stage 失败。

set -euo pipefail

# ── 定位 repo 根（脚本在 scripts/ 下·从任意 cwd 调皆可）────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

# ── flag 解析 ────────────────────────────────────────────────────────────────────────────────────
WITH_ACT=0
WITH_SEA_LINUX=0
SKIP_SEA=0
for arg in "$@"; do
  case "${arg}" in
    --with-act) WITH_ACT=1 ;;
    --with-sea-linux) WITH_SEA_LINUX=1; WITH_ACT=1 ;;
    --skip-sea) SKIP_SEA=1 ;;
    -h|--help) sed -n '2,61p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "未知参数：${arg}（--help 看用法）" >&2; exit 2 ;;
  esac
done

OS="$(uname -s)"
ARCH="$(uname -m)"
C_BLUE='\033[1;34m'; C_GREEN='\033[1;32m'; C_RED='\033[1;31m'; C_YEL='\033[1;33m'; C_OFF='\033[0m'
hdr()  { printf "\n${C_BLUE}━━━ %s ━━━${C_OFF}\n" "$*"; }
ok()   { printf "${C_GREEN}✔${C_OFF} %s\n" "$*"; }
warn() { printf "${C_YEL}⚠${C_OFF} %s\n" "$*"; }
die()  { printf "${C_RED}✗ %s${C_OFF}\n" "$*" >&2; exit 1; }
mktemp_dir() {
  local prefix="${1:-ccm-release-test}"
  mktemp -d "${TMPDIR:-/tmp}/${prefix}.XXXXXX"
}

# 工作目录（产物 / scratch home / node22 缓存）——默认系统 tmp·**绝不入仓、绝不碰真 ~/.claude**。
WORK="${CCM_RELEASE_TEST_WORK:-$(mktemp_dir ccm-release-test)}"
mkdir -p "${WORK}"
NODE22_CACHE="${CCM_NODE22_CACHE:-${WORK}/node22}"

printf "${C_BLUE}cc-master release-local harness${C_OFF}  (os=%s arch=%s work=%s)\n" "${OS}" "${ARCH}" "${WORK}"

# ════════════════════════════════════════════════════════════════════════════════════════════════
#  STAGE 1 —— SEA 编译 + 执行 + 自包含（ccm-release.yml `build-sea` job 的本机档）
# ════════════════════════════════════════════════════════════════════════════════════════════════
resolve_node22() {
  # 1) 显式覆写
  if [ -n "${CCM_SEA_NODE:-}" ]; then
    [ -x "${CCM_SEA_NODE}" ] || die "CCM_SEA_NODE 不可执行：${CCM_SEA_NODE}"
    case "$("${CCM_SEA_NODE}" --version)" in v22.*) printf '%s' "${CCM_SEA_NODE}"; return 0 ;;
      *) die "CCM_SEA_NODE 不是 node 22（是 $("${CCM_SEA_NODE}" --version)）——SEA 注入须 node 22" ;; esac
  fi
  # 2) PATH 上的 node 恰为 22
  if command -v node >/dev/null 2>&1; then
    case "$(node --version)" in v22.*) command -v node; return 0 ;; esac
  fi
  # 3) 下载官方静态 node 22（缓存·不入仓）
  local plat arch_tag ver tarball dir nbin
  case "${OS}" in Darwin) plat=darwin ;; Linux) plat=linux ;; *) die "不支持的 OS：${OS}" ;; esac
  case "${ARCH}" in arm64|aarch64) arch_tag=arm64 ;; x86_64) arch_tag=x64 ;; *) die "不支持的 ARCH：${ARCH}" ;; esac
  mkdir -p "${NODE22_CACHE}"
  # 已缓存？
  nbin="$(find "${NODE22_CACHE}" -type f -name node -path '*/bin/node' 2>/dev/null | head -1 || true)"
  if [ -n "${nbin}" ] && [ -x "${nbin}" ]; then printf '%s' "${nbin}"; return 0; fi
  command -v curl >/dev/null 2>&1 || die "需要 curl 下载官方 node 22（或设 CCM_SEA_NODE）"
  ver="$(curl -fsSL https://nodejs.org/dist/index.json | node -e '
    const d=JSON.parse(require("fs").readFileSync(0));
    const v=d.filter(r=>r.version.startsWith("v22.")).sort((a,b)=>{
      const pa=a.version.slice(1).split(".").map(Number),pb=b.version.slice(1).split(".").map(Number);
      return pb[0]-pa[0]||pb[1]-pa[1]||pb[2]-pa[2];})[0];
    process.stdout.write(v.version);')"
  [ -n "${ver}" ] || die "解析最新 node 22 版本失败"
  tarball="node-${ver}-${plat}-${arch_tag}.tar.gz"
  printf "${C_BLUE}[node22]${C_OFF} 下载官方静态 %s → %s\n" "${tarball}" "${NODE22_CACHE}" >&2
  curl -fsSL -o "${NODE22_CACHE}/${tarball}" "https://nodejs.org/dist/${ver}/${tarball}" \
    || die "下载 node 22 失败"
  tar -xzf "${NODE22_CACHE}/${tarball}" -C "${NODE22_CACHE}"
  dir="node-${ver}-${plat}-${arch_tag}"
  nbin="${NODE22_CACHE}/${dir}/bin/node"
  [ -x "${nbin}" ] || die "解压后 node 不可执行：${nbin}"
  printf '%s' "${nbin}"
}

sea_stage() {
  hdr "STAGE 1 — SEA 编译 + 执行 + 自包含"

  command -v pnpm >/dev/null 2>&1 || die "需要 pnpm（pnpm install + build）"
  command -v node >/dev/null 2>&1 || die "需要 node（跑 build 链）"

  local node22; node22="$(resolve_node22)"
  ok "node 22: ${node22} ($("${node22}" --version))"

  # 镜像 CI：装依赖（frozen）+ build 引擎/CLI（turbo 处理依赖顺序）+ build SEA。
  printf "${C_BLUE}[build]${C_OFF} pnpm install --frozen-lockfile\n"
  ( cd ccm && pnpm install --frozen-lockfile >/dev/null 2>&1 ) || die "pnpm install 失败"
  printf "${C_BLUE}[build]${C_OFF} pnpm run build（engine + cli·turbo）\n"
  ( cd ccm && pnpm run build >/dev/null 2>&1 ) || die "pnpm build 失败"

  local out="dist/ccm-sea-test"
  local binpath="ccm/apps/cli/${out}"
  printf "${C_BLUE}[build]${C_OFF} build-sea.sh（CCM_SEA_NODE=node22·CCM_SEA_OUT=%s）\n" "${out}"
  CCM_SEA_NODE="${node22}" CCM_SEA_OUT="${out}" bash ccm/apps/cli/scripts/build-sea.sh >/dev/null 2>&1 \
    || die "build-sea.sh 失败（SEA 编译没过——若报 sentinel 错说明 node 非 22）"
  [ -f "${binpath}" ] || die "SEA 产物不存在：${binpath}"
  chmod +x "${binpath}"
  ok "SEA 产物：${binpath} ($(du -h "${binpath}" | cut -f1))"

  # 执行：--version
  local ver_out; ver_out="$("${REPO_ROOT}/${binpath}" --version)" || die "SEA --version 执行失败"
  ok "执行 --version → ${ver_out}"

  # 执行：board init / show（隔离 scratch home·绝不碰真 ~/.claude）
  local shome="${WORK}/sea-scratch-home"
  rm -rf "${shome}"; mkdir -p "${shome}"
  CC_MASTER_HOME="${shome}" "${REPO_ROOT}/${binpath}" board init --goal "release-harness smoke" >/dev/null \
    || die "SEA board init 失败"
  # Keep the transport smoke independent from development-task evidence gates: a development
  # node intentionally requires spec+plan refs, while this node only proves SEA board I/O.
  CC_MASTER_HOME="${shome}" "${REPO_ROOT}/${binpath}" task add t1 --type research --title "smoke slice" >/dev/null 2>&1 \
    || die "SEA task add 失败"
  local nxt; nxt="$(CC_MASTER_HOME="${shome}" "${REPO_ROOT}/${binpath}" board next 2>/dev/null | tr -d '[:space:]')"
  [ "${nxt}" = "t1" ] || die "SEA board next 期望 t1，实得 '${nxt}'"
  CC_MASTER_HOME="${shome}" "${REPO_ROOT}/${binpath}" board show >/dev/null || die "SEA board show 失败"
  ok "执行 board init/add/next/show（scratch home·真 ~/.claude 未碰）→ next=t1"

  # 自包含（macOS）
  if [ "${OS}" = "Darwin" ] && command -v otool >/dev/null 2>&1; then
    local nonsys; nonsys="$(otool -L "${binpath}" | tail -n +2 | grep -vE '^\s+(/usr/lib/|/System/)' || true)"
    if [ -n "${nonsys}" ]; then
      warn "otool 发现非系统依赖（官方 node 应自包含·请核 CCM_SEA_NODE 是否官方静态 node）："
      printf '%s\n' "${nonsys}"
      die "SEA 不自包含——不可分发"
    fi
    ok "otool -L 自包含（只剩 /usr/lib + /System·可分发）"
  else
    warn "非 macOS 或无 otool——跳过 otool 自包含核查（Linux 用 ldd·留给真 runner / act）"
  fi
  ok "STAGE 1 绿"
}

# ════════════════════════════════════════════════════════════════════════════════════════════════
#  STAGE 2 —— plugin 打包 + 校验（plugin-release.yml `package-plugin` job 核心）
# ════════════════════════════════════════════════════════════════════════════════════════════════
plugin_stage() {
  hdr "STAGE 2 — plugin 打包 + 解压 validate"
  command -v claude >/dev/null 2>&1 || die "需要 claude CLI（plugin validate）"
  command -v unzip >/dev/null 2>&1 || die "需要 unzip"

  local zip; zip="$(bash scripts/package-plugin.sh 2>/dev/null)" || die "package-plugin.sh 失败"
  [ -f "${zip}" ] || die "zip 产物不存在：${zip}"
  ok "打包：${zip} ($(du -h "${zip}" | cut -f1))"
  local manifest; manifest="$(dirname "${zip}")/SHA256SUMS"
  [ -f "${manifest}" ] || die "checksum 清单不存在：${manifest}"
  if command -v sha256sum >/dev/null 2>&1; then
    ( cd "$(dirname "${zip}")" && sha256sum --check SHA256SUMS >/dev/null ) \
      || die "SHA256SUMS 校验失败"
  elif command -v shasum >/dev/null 2>&1; then
    ( cd "$(dirname "${zip}")" && shasum -a 256 -c SHA256SUMS >/dev/null ) \
      || die "SHA256SUMS 校验失败"
  else
    die "缺 SHA256 工具：需要 sha256sum 或 shasum 来校验 SHA256SUMS"
  fi
  ok "checksum：${manifest}"

  local dest; dest="$(mktemp -d -p "${WORK}")"
  unzip -q "${zip}" -d "${dest}" || die "解压失败"
  [ -d "${dest}/cc-master/.claude-plugin" ] || die "解压制品缺 .claude-plugin/——不是合法 plugin"
  [ -f "${dest}/cc-master/LICENSE" ] || die "解压制品缺 LICENSE"
  [ -f "${dest}/cc-master/LICENSING.md" ] || die "解压制品缺 LICENSING.md"
  [ -f "${dest}/cc-master/TRADEMARKS.md" ] || die "解压制品缺 TRADEMARKS.md"
  claude plugin validate "${dest}/cc-master" >/dev/null 2>&1 || die "claude plugin validate 未过"
  ok "解压制品 claude plugin validate 过"
  ok "STAGE 2 绿"
}

# ════════════════════════════════════════════════════════════════════════════════════════════════
#  STAGE 3 —— Linux job wiring via act（可选·act + docker 缺则跳过）
# ════════════════════════════════════════════════════════════════════════════════════════════════
act_stage() {
  hdr "STAGE 3 — workflow wiring via act（Linux job·非-tag push·attach 跳过）"
  if ! command -v act >/dev/null 2>&1; then
    warn "act 未装（brew install act）——跳过 STAGE 3（非失败）"; return 0
  fi
  if ! docker info >/dev/null 2>&1; then
    warn "docker 未运行——跳过 STAGE 3（非失败）"; return 0
  fi

  # ⚠️ 安全机制：故意用「非-tag」push 事件（ref=refs/heads/…·见文件头注 footgun）——让 attach step
  #    的 tag 守卫 `if: startsWith(github.ref,'refs/tags/')` **声明式地被跳过**，act 就不会拿本机 gh
  #    token 去动真 release。这一条（非-tag 事件 + workflow 自带的 tag 守卫）已足够安全。
  #    **不**再额外塞 dummy GITHUB_TOKEN——实测它会让 act `git clone` 拉 action 定义（actions/setup-node
  #    等）时拿假 token 当 git 凭据被 GitHub 拒、整个 job 在 setup 阶段就挂（弄巧成拙）。
  local ev="${WORK}/nontag-push-event.json"
  cat > "${ev}" <<'JSON'
{ "ref": "refs/heads/ccm-release-local-harness", "ref_name": "ccm-release-local-harness", "ref_type": "branch" }
JSON
  local img="catthehacker/ubuntu:act-latest"
  local artdir="${WORK}/act-artifacts"; mkdir -p "${artdir}"
  local SAFE=( -e "${ev}" -P "ubuntu-latest=${img}" --container-architecture linux/amd64
               --artifact-server-path "${artdir}" )

  printf "${C_BLUE}[act]${C_OFF} package-plugin job（linux/amd64·非-tag 事件·attach step 跳过）\n"
  if act push -W .github/workflows/plugin-release.yml -j package-plugin "${SAFE[@]}"; then
    ok "act package-plugin job 绿（checkout→setup→package→upload-artifact 真执行·attach 跳过）"
  else
    die "act package-plugin job 失败（看上面 act 输出）"
  fi

  if [ "${WITH_SEA_LINUX}" = "1" ]; then
    printf "${C_BLUE}[act]${C_OFF} build-sea job·linux-x64 leg（matrix os=ubuntu-latest·attach 跳过）\n"
    if act push -W .github/workflows/ccm-release.yml -j build-sea \
         --matrix os:ubuntu-latest "${SAFE[@]}"; then
      ok "act build-sea linux-x64 job 绿"
    else
      die "act build-sea linux-x64 job 失败（看上面 act 输出）"
    fi
  fi
  ok "STAGE 3 绿（注：macOS leg / arm64 leg / tag-gated 真 release attach 只能真 runner——见文件头注）"
}

# ── 编排 ──────────────────────────────────────────────────────────────────────────────────────────
[ "${SKIP_SEA}" = "1" ] && warn "STAGE 1 跳过（--skip-sea）" || sea_stage
plugin_stage
[ "${WITH_ACT}" = "1" ] && act_stage || warn "STAGE 3 跳过（默认不跑·加 --with-act 启用）"

hdr "RELEASE-LOCAL HARNESS：所有已跑 stage 绿"
printf "工作目录（产物/缓存·可删）：%s\n" "${WORK}"
