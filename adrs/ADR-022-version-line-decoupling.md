# ADR-022 — ccm 与 cc-master plugin 的版本线解耦（非对称 tag 前缀：plugin 裸 `vX.Y.Z` / ccm `ccm-vX.Y.Z`）

> Status: **Accepted**（方案 A 经用户拍板·2026-06-30）
> Date: 2026-06-30
> Scope: 两条产品线的 **git tag 命名 + release workflow 触发 + 版本文件归属 + changelog/changeset 节奏**。约束：`.github/workflows/`（release workflow 拆分）、`.claude-plugin/*`（plugin 版本文件）、`ccm/**/package.json` + `ccm/.changeset/`（ccm 版本文件 + changesets 配置）、`install.sh`（双 resolver·T5）、`scripts/package-plugin.sh`、AGENTS.md §11、README×2 安装段。不动 board 契约 / hook / skill 行为。
> Source: `design_docs/plans/2026-06-30-version-decoupling-strawman.md`（设计探查 + 三方案 strawman·用户拍板方案 A + 两个次级默认）；ADR-014 的自然 follow-up。
> Co-signed: 用户（拍板方案 A·非对称前缀 + engine/cli `fixed` 锁步 + ccm 线从 `ccm-v0.11.0` 作首个真实 release 起步·无 `ccm-v0.10.0` 锚点·见 §2.5）

---

## 1. Context

ADR-014 把 `ccm` 解耦为**独立安装的产品/引擎**（`@ccm/engine` SSOT + per-OS Node SEA 二进制），plugin 降为消费方之一。但 ADR-014 只解耦了**代码 / 分发架构，没触及版本号与 tag 命名**——两条线的版本仍被**单一 git tag `v*`** 焊死耦合：

- 一个 `v*` tag 同时触发 `ccm-release.yml` 的两个 job——`build-sea`（出 ccm 二进制 ×4）+ `package-plugin`（出插件 zip），二者落进**同一个** GitHub release。
- `install.sh` 用单一 `--version` 同时拼两个产物的下载 URL；五处版本号锁步 0.10.0。

讽刺的是，`ccm/.changeset/README.md` 早已白纸黑字声明「二者不共享版本号、两套发版流并存」——但这套**意图从未在机制层兑现**：changesets 配了却没接进任何 release 流，tag 仍是唯一真相。两条线被迫同生命周期 bump，违背 ADR-014「ccm 是独立产品」的根定位（独立产品理应独立版本、独立发版节奏，将来桌面端 / web 平行消费方也各有自己的版本线）。

现在解耦版本线 = 让机制追上 ADR-014 的产品定位 + `.changeset/README.md` 已声明的意图。

## 2. Decision

**`ccm` 与 cc-master plugin 拆成两条独立版本线，用非对称 git tag 前缀区分（方案 A）：plugin 保留裸 `vX.Y.Z`，ccm 改用 `ccm-vX.Y.Z`；各自独立的 tag 触发各自独立的 release workflow、各自独立的版本文件与 changelog 节奏。**

### 2.1 tag 命名 —— 非对称前缀

- **plugin 线 = 裸 `vX.Y.Z`**（不变·延续历史）。裸 `v*` 的全部历史（`v0.1.0…v0.10.0`）本就是 plugin 产品线，延续零认知摩擦。
- **ccm 线 = `ccm-vX.Y.Z`**（新增显式命名空间）。
- **glob 天然互斥**：`ccm-v…` 以 `c` 开头，不匹配 `v*`；`vX.Y.Z` 不以 `ccm-` 开头，不匹配 `ccm-v*`。两条 tag-filter 零交叉触发，无需任何排除规则。

### 2.2 workflow 拆分 —— 两个互斥 tag-filter 的 workflow

- `ccm-release.yml`：`on: push: tags: ['ccm-v*']` → **只保留 `build-sea` job**（四个 per-OS SEA 二进制）。删去 `package-plugin` job。
- 新增 `plugin-release.yml`：`on: push: tags: ['v*']` → **只跑 `package-plugin` job**（从旧文件原样搬出）。asset 命名不变（`ccm-<os>-<arch>` / `cc-master-plugin-<tag>.zip`）。
- 保留 `build-sea` 那条血泪注释：CI 必须 `pnpm -C ccm build`（turbo 全量先建 engine）——否则 SEA 解析不到 `@ccm/engine` → 运行时 `ERR_UNKNOWN_BUILTIN_MODULE`（v0.10.0 首发踩坑）。

### 2.3 版本文件归属

- **plugin 线（手动门）**：`.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json`（plugins[0].version）+ `CHANGELOG.md`。tag = 裸 `v*`。
- **ccm 线（changesets 驱动）**：`ccm/apps/cli/package.json`（`ccm`·= `ccm --version` 输出·= `ccm-v*` tag 数字）+ `ccm/packages/engine/package.json`（`@ccm/engine`）+ `ccm/package.json`（`ccm-monorepo`·private·cosmetic）。
- **engine + cli `fixed` 锁步**（次级默认①）：`ccm/.changeset/config.json` 的 `fixed: [["ccm", "@ccm/engine"]]`——「ccm 版本」是**一个数字**（cli = engine = `ccm-v*` tag），install / 用户心智 / tag 三者一致。代价：engine 内部小改也 bump cli 版本号（可接受——二者一起打进同一 SEA 二进制、同生命周期）。

### 2.4 changelog / changeset 模型 —— 各管各

- **ccm 线**：启用 changesets 真流程（兑现已休眠的配置）——每个改 `ccm/**` 行为的 PR 附 changeset，发版时 `changeset version` 消费 → bump cli+engine（fixed）+ 生成各包 changelog → 打 `ccm-v<新版本>` tag。
- **plugin 线**：维持现状手动门——改 `plugin.json` + `marketplace.json` + `CHANGELOG.md` 定版 + 打裸 `v*` tag。
- 两套 changelog 物理分离（plugin 根 `CHANGELOG.md` ∥ ccm 各包 changesets changelog），正是 `.changeset/README.md` 已声明的模型——本决策让它从「声明」变「事实」。

### 2.5 首个真实分叉（两线各自的起点 tag）

随本次解耦同发的两条线首个真实版本：

| 线 | 首个真实 tag | 版本文件 | 发版触发 |
|---|---|---|---|
| **plugin** | `v0.10.1`（裸 v·延续历史） | `plugin.json` + `marketplace.json` + `CHANGELOG.md` | `plugin-release.yml`（`v*`·打插件 zip） |
| **ccm** | `ccm-v0.11.0`（命名空间前缀·minor·因本轮 ccm 新增 `upgrade` 命令 + `GRAPH-CONNECTED` lint 规则） | `ccm/{package.json, packages/engine, apps/cli}`（`fixed` 锁步成单一 ccm 版本号） | `ccm-release.yml`（`ccm-v*`·产 SEA 二进制） |

- **不存在 `ccm-v0.10.0` 锚点**——旧的合并式 `v0.10.0` release（同一 tag 同时产 ccm 二进制 + 插件 zip）早于本解耦，是 plugin 线历史的一部分，**不**回填成 ccm 前缀 tag。ccm 独立线就从 **`ccm-v0.11.0`** 这第一个 `ccm-v*` tag 起步。
- 因此 install.sh 的 ccm resolver **无需「裸-v fallback」过渡分支**：ccm 线一经发版（`ccm-v0.11.0`）即有真 release，按 `ccm-v*` 前缀过滤 `/releases` 列表就能解析到本线最新；首发前若无任何 `ccm-v*` release，resolver 明确报「ccm 线尚无 release，请 `--ccm-version` 指定或等首发」（install.sh 已落地此分支），不静默退回裸 v。
- 旧 `v0.10.0` release（含两类产物）冻结保留为 plugin 历史；迁移期 README 提示用户重新拉新 install.sh（旧 install.sh 的 `/releases/latest` 在两线分叉后会拿不到正确产物）。

> 本 ADR 的**机制决策**（哪些文件归哪条线 + tag/触发分线 + glob 互斥）与**首个真实分叉版本**（plugin `v0.10.1` / ccm `ccm-v0.11.0`）一并落地；此后两线各自独立 bump、互不绑架节奏。

## 3. Consequences

### 3.1 Positive

- **两条线各自独立演进**：ccm 频繁迭代不被 plugin 发版节奏绑架，反之亦然；顺 ADR-014「ccm 是独立产品」之势。
- **机制追上既有意图**：`.changeset/README.md` 声明的「不共享版本号」从纸面变事实；changesets 真正接进 ccm release 流。
- **glob 天然互斥、零误触发**：两 workflow 无需复杂排除规则，仅 install 解析侧对裸 v 做一次「非 ccm-」锚定。
- **最小 blast radius**：plugin 占最短的裸 `v*` 合情合理（用户心智里的「产品」）；裸 `v*` 历史 + 默认安装 + `--version` 示例全部延续。

### 3.2 Negative

- **两条线视觉非对称**：一条带前缀一条不带，新人需知道「裸 v = plugin」这条隐性约定（靠 AGENTS.md §11 + README + 本 ADR 写清弥补）。
- **install.sh 复杂度上升**：单 `--version` 拆成双 resolver（按前缀过滤 `/releases` 列表·`/releases/latest` 不分前缀的坑）+ 双 pin flag（T5 落地）。
- **迁移期老用户需主动重拉 install.sh**：旧 `/releases/latest` 在下一个 plugin-only `v*` 后会拿不到 ccm 二进制（README 迁移提示弥补）。

### 3.3 Neutral

- `scripts/package-plugin.sh` 几乎不用动——它只认「给我个 tag、打个 zip」，裸 `v*` tag 下推导链（参数 > `git describe` > `plugin.json` 前缀 v）仍正确。
- `ccm-ci.yml`（PR/push 路径隔离的 ccm 专属 CI）不受影响——它本就按 `paths: ['ccm/**']` 隔离，解耦后正好对称。
- install.sh 的双 resolver / 双 pin flag（`--ccm-version` / `--plugin-version`）+ `ccm upgrade` 子命令是后续阶段（T5/T6）落地项，本 ADR 只定 tag 命名 + workflow 分线决策。

## 4. Alternatives Considered

### 4.1 Alternative B：对称前缀 `plugin-vX.Y.Z` + `ccm-vX.Y.Z`，裸 `v*` 退役

拒绝。tag 自文档化、两线完全对称、解析逻辑最干净（无「裸 v 排除 ccm-」的正则歧义）——但 churn 最大：裸 `v*` 连续性断、所有历史 `v*` 视觉孤儿化、README/install 示例全改、老 `/releases/latest` 用户被甩下需主动迁移；且与「plugin 是用户心智里的产品、理应占最短 tag」的直觉相悖。对称美学不值其迁移代价。

### 4.2 Alternative C：路径式前缀 plugin `vX.Y.Z` + ccm `ccm/vX.Y.Z`

拒绝。`ccm/vX.Y.Z` 读作「ccm 命名空间下的版本」语义更像分层，plugin 仍占裸 v（同 A 的低 churn）——但 tag 里的 `/` 偶发 ergonomics 坑：部分 CI/工具/`git describe`/release 资产 URL 对带斜杠 ref 处理不一（`refs/tags/ccm/v…` 多一层），`GITHUB_REF_NAME` 含 `/`；收益相比 `ccm-v` 边际很小，tooling 风险不抵。

### 4.3 Alternative D：维持现状（单 `v*` tag 同时触发两 job）

拒绝。两条线被迫同生命周期 bump，违背 ADR-014「ccm 是独立产品」的根定位；`.changeset/README.md` 的声明永远兑现不了；未来桌面端 / web 平行消费方无从各有自己的版本线。

## 5. Related

- [`ADR-014-cli-decoupling-as-independent-product.md`](ADR-014-cli-decoupling-as-independent-product.md) —— 本 ADR 是它的**自然 follow-up**：ADR-014 解耦了代码/分发架构（`@ccm/engine` SSOT + per-OS SEA + 进程边界），但没解耦版本号/tag；本 ADR 补上版本线分叉，让「独立产品」在版本维度也成立。
- [`ADR-021-ccm-install-presence-hard-precheck.md`](ADR-021-ccm-install-presence-hard-precheck.md) —— ccm 主机硬前置（install presence）；解耦后 ccm 走自己的 `ccm-v*` release 线提供二进制。
- `ccm/.changeset/README.md` —— 早已声明「二者不共享版本号、两套发版流并存」的**意图真相源**；本 ADR 让机制追上声明。
- `AGENTS.md` §11（发版约定·两条独立版本线）+ §6（`ccm` ⟷ `using-ccm` 锁步）。
- `design_docs/plans/2026-06-30-version-decoupling-strawman.md` —— 设计探查 + 穷尽耦合点 + 三方案对比（gitignored 草稿）。

## 6. References

- GitHub `GET /repos/{owner}/{repo}/releases/latest` **不分 tag 前缀**（只返整仓最新非 draft/prerelease）——两条线共仓发版时，install.sh 须按前缀过滤 `/releases` 列表，不能用 `/releases/latest`（横切所有方案的核心技术坑，install.sh/T5 落地）。
- changesets `fixed` 配置——锁步一组包永远同版本 bump。
