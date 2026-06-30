# Release workflow 本地验证机制（`ccm-release.yml` 预演）

> **这是什么**：一套 **dev-only** harness，让 `.github/workflows/ccm-release.yml`（tag `v*` 触发的多平台
> SEA 二进制 + plugin zip 制品）能在**打 tag 发版之前**就在本地验出「能不能正确编译 + 打包出制品」，
> 而不是真打 tag 推上去、CI 在真 runner 上第一次跑才暴露破绽。
>
> **入口**：[`scripts/test-release-local.sh`](../scripts/test-release-local.sh)（repo 根调用·裸路径·不随
> plugin 分发·红线5）。本文是它的**验证分层 + footgun 留痕**；脚本头注是用法 SSOT，本文不复述命令细节。

## 为什么要它

`ccm-release.yml` 此前只在「真打 tag」时才第一次执行——其中 **SEA 二进制构建**（`build-sea.sh` + postject）
是整条链里最易碎的一环：postject 的 SEA sentinel 注入**只在 node 22 可靠**（本机 node 25/26 实测报
`Could not find the sentinel NODE_SEA_FUSE` 而失败，故 CI matrix 全 pin node 22）。之前本地只验过
dev-bin shim（`apps/cli/dev-bin/ccm`，一个跑 tsx 的薄壳），**真 SEA 从没在本地端到端验过**。本 harness
补上这个盲区。

## 验证分层（诚实记账：哪些本地可验 / 哪些只能真 runner）

### ✅ 本地可验（harness 覆盖）

| 分层 | 对应 `ccm-release.yml` | harness STAGE | 验什么 |
|---|---|---|---|
| **SEA 编译 + 执行 + 自包含** | `build-sea` job（本机 = macos-14 leg 同口径 darwin-arm64） | STAGE 1 | 用官方 **node 22** 跑 `build-sea.sh` 产**真**单文件二进制 → 执行它（`--version` + 隔离 scratch home 里跑 `board init/add/next/show`，**绝不碰真 `~/.claude`**）→ macOS `otool -L` 核自包含（只剩 `/usr/lib` + `/System` 才可分发） |
| **plugin 打包 + 校验** | `package-plugin` job | STAGE 2 | `package-plugin.sh` 产 `cc-master-plugin-<tag>.zip` → 解压 → `claude plugin validate` 过 |
| **Linux job wiring via act** | `package-plugin` job（+ `--with-sea-linux` 追加 `build-sea` linux-x64 leg） | STAGE 3（可选·act+docker） | 本地 Docker 跑 workflow 的 Linux job，确认 checkout→setup-node→install→build→package→**upload-artifact** 这段 steps 真执行 + 产 artifact |

**实测基线（2026-06-30·darwin-arm64·node v22.23.1 官方静态）**：
- 真 SEA 产物 **107M** Mach-O arm64，`--version` → `ccm 0.10.0`，scratch home 里 `board init/add/next/show` 全跑通，`otool -L` 自包含 ✅。
- `package-plugin.sh` 产 **~6.1M** zip，解压 `claude plugin validate` → `Validation passed` ✅。
- act `package-plugin` job（catthehacker/ubuntu:act-latest·linux/amd64）端到端绿，artifact `cc-master-plugin.zip` 上传成功 ✅。

### ⚠️ 只能真 runner（harness **验不了**）

- **macOS job（macos-14 / macos-13）的 step 编排**——act 无 macOS 容器（GitHub-hosted macOS runner only）。
  STAGE 1 验的是「SEA 编译链 + 二进制能跑 + 自包含」这件**本机事实**（本机即 darwin-arm64·与 macos-14 leg 同口径），
  但 workflow 里 macOS job 的 step 串只能靠真 runner / 逐行 YAML 审。
- **Linux arm64 leg（`ubuntu-24.04-arm`）**——act 在 amd64 容器跑，arm64 runner 的原生行为只能真 runner 验。
- **真 `gh release` attach（`softprops/action-gh-release`）**——tag-gated step，需真 release + tag + token，本地无从安全复现（见下 footgun）。

### 🟢 安全的真-runner 触发路径（不真发版）

`ccm-release.yml` 带 `workflow_dispatch`——push 到 GitHub 后可在 **Actions 页手动触发**，在真全平台
runner 上跑 build + `upload-artifact`（因非 tag 触发，attach-release step 的 `if: startsWith(github.ref,
'refs/tags/')` 守卫 **为假被跳过**），即可在真 macOS/arm64 runner 上验全平台 SEA 构建**而不真发版**。
这是验 macOS/arm64 leg 的推荐路径。

## ⚠️⚠️ 血泪 footgun：act + tag 事件会动**真** GitHub release（2026-06-30 实测踩中）

**现象**：第一次用 act 拿一个 **tag 事件**（`refs/tags/v0.10.0`）跑 `package-plugin` job 跑通后，发现
workflow 的 `Attach to GitHub release` step **真的在真 GitHub repo 上执行了**——它把一个本是 **draft** 的
`v0.10.0` release **publish 了**并 attach 了 plugin zip 资产（release 的 `publishedAt` 时间戳与 act 运行
时刻精确吻合，资产 `createdAt` 同刻）。

**根因**：①act **会自动复用本机 `gh` CLI keyring 里的真 token**（无需显式 `GITHUB_TOKEN`，act 把它注进
`github.token` context）；②attach step 的守卫是 `if: startsWith(github.ref, 'refs/tags/')`——喂 tag 事件
就让它为真；③`softprops/action-gh-release` 于是拿真 token + tag 去真 repo 创建/发布 release。三者叠加 =
本地「预演」意外做了一次 outward-facing 真发布。

**防线（harness 已内建）**：STAGE 3 **故意用「非-tag」push 事件**（`refs/heads/…`）喂 act——让 attach step
按其 workflow 自带的 `if: startsWith(github.ref,'refs/tags/')` 守卫**声明式地被跳过**，只验
checkout→setup→build→package→upload-artifact 这段（本就是 local 能验的全部；attach 需真 release，本就
只能真 runner 验）。**纪律：绝不拿 tag 事件喂 act 跑 release workflow。**

**踩坑补记（dummy token 弄巧成拙）**：本想再塞 `-s GITHUB_TOKEN=dummy` 做防御纵深，实测**适得其反**——act
`git clone` 拉 action 定义（`actions/setup-node` 等公共 action）时会把这个假 token 当 git 凭据，被 GitHub
以 `authentication required: Invalid username or token` 拒，整个 job 在 **setup 阶段**就挂（连 build 都到不了）。
故 harness **不**塞 dummy token——「非-tag 事件 + workflow 自带 tag 守卫」这一条已足够安全（守卫是声明式的，
不依赖 token）。

**遗留**：那次实测把真 repo 的 `v0.10.0` draft release publish 了 + attach 了资产。remediation（撤资产 + 转回
draft）属 outward-facing 写、需用户显式授权，**待用户决定**（见交接报告）。0.10.0 是未合并的在制版本（只在
feature 分支上、未进 main），按发版纪律此 release 本不该公开。
