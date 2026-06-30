# ADR-014 — CLI 解耦为独立产品/引擎,plugin 降为消费方之一(ship-anywhere 落点:从「单件自包含 + 零依赖」改为「进程边界 + 主机预置 ccm 二进制」)

> Status: **Accepted**(修订 ADR-013 的 CLI 定位 + 零依赖前提;进一步修订 ADR-002 的 ship-anywhere 口径。决策已定 2026-06-24·用户三次 pivot 显式拍板;CLI port→TS 工业化 monorepo 地基 T1/T2 已实现并端点验收·SEA 二进制 T3 / hook 解耦 T4 / CI T5 / 文档收口 T6 为后续阶段)
> Date: 2026-06-24
> Scope: board 状态层的**归属** + plugin hooks/skills 访问 board 逻辑的**形态**(in-process require → 进程边界 shell-out)+ 红线5 ship-anywhere 的**含义** + cc-master 的**安装形态**。约束:全部 hook、`bootstrap`、分发 skill 对 board 的读写路径;`cli/` 旧实现的退役;未来 desktop / web 消费方。
> Source: 2026-06-23/24 board v2 CLI 设计三次 pivot(用户拍板)——见 `design_docs/plans/2026-06-23-board-cli-design.md` 顶部 ARCH PIVOT banner + `2026-06-24-industrial-stack-decision.md`(均 gitignored 草稿);需求根:ADR-013 把「统一 CLI」列为后续阶段,本 ADR 落地该阶段时形态发生根本变化。
> Co-signed: 用户(三次 pivot 显式拍板:① CLI self-contain / ② 完全解耦·plugin 只是消费方之一 / ③ 全盘工业化)

---

## 1. Context

ADR-013 把 board 演进为「完整 JS 数据模型 SSOT + 统一 CLI 访问层」,但当时(2026-06-23)CLI 的定位是 cc-master 的**内部访问层**:三消费者(agent invoke / web viewer / human shell)经同一 CLI,CLI **零 npm 依赖、纯 stdlib**以守红线1/5,hook 收编为 node 后 `require` 同一份 board-model(ADR-013 §2.2/§2.3/§2.4)。

随后(2026-06-24)三次设计 pivot 改变了 CLI 的根定位:

1. **CLI self-contain**:board 核心逻辑(model/lint/graph/lock)从 `hooks/scripts` 抽出、搬进 CLI 当 SSOT,hook/skill 经 CLI 封装能力,而非各自 `require`。
2. **完全解耦(关键)**:CLI 是**独立安装、全局可访问**的软件;plugin 安装时**假设 `ccm` 已在主机上**,经 **shell 调用**,**不访问 CLI 源码**。动机是用户明确的产品方向——「未来基于 CLI 长出桌面客户端,那它就必须和 plugin 解耦,plugin 只是 CLI 的一种消费方」。
3. **全盘工业化(地基优先)**:既然解耦,CLI 重调研工业技术栈——TypeScript + pnpm/Turborepo monorepo(`@ccm/engine` 库 + `ccm` CLI app + 未来 `desktop`)+ tsdown 多格式 + Node SEA per-OS 二进制 + changesets/Biome,现在做地基,避免插件集成做两遍。

这三点直接**与 ADR-013 §2.2「零 npm 依赖、纯 stdlib」、§2.3「CLI = cc-master 内部三消费者访问层」、§2.4「hook require 同一份 board-model」相矛盾**,也与红线5 ship-anywhere 的字面(「plugin 单件自包含、不依赖外部预置」)冲突——故需本 ADR 显式修订,留下「为什么改、何时可推翻」的快照。

## 2. Decision

**`ccm` CLI 解耦为独立产品/引擎;cc-master plugin 降为它的消费方之一;ship-anywhere 的落点从「单件自包含 + 零依赖」改为「进程边界 + 主机预置的 `ccm` 二进制」。** 四个相互绑定的面:

### 2.1 ccm 是独立产品/引擎,plugin 是消费方之一

board 状态层的 SSOT = `@ccm/engine`(TypeScript 库);`ccm` CLI 是其第一个消费方;未来 desktop / web 客户端是**平行**消费方。cc-master plugin **不再拥有** board 逻辑——它降为 `ccm` 的消费方之一(与 desktop 平级)。这取代 ADR-013 §2.3「CLI = cc-master 内部三消费者访问层」:消费者不再是「plugin 内部的 agent/viewer/human」,而是「plugin / desktop / web 等平行产品」。

### 2.2 plugin 经进程边界调用 ccm,绝不 import 引擎

plugin 的 hooks / skills 通过 **shell 调全局 `ccm` 二进制 + JSON 契约**访问 board,**绝不 import `@ccm/engine` 的源码或 dist**。这条**进程边界**是红线1(hooks 只 bash+node)在新架构的落点:TS / npm 依赖全锁在 `ccm` 内部,hook 侧只剩 bash exec + JSON parse。**这翻转 ADR-013 §2.4**——hook 不再 in-process `require` board-model,改为跨进程调 `ccm`(board 读写、lint、verify、dangling/wip-check 等经 `ccm` 子命令)。

### 2.3 ship-anywhere 重新定义(红线5 修订 + 进一步修订 ADR-002)

- **旧口径**(ADR-002 / 红线5 字面 + ADR-013 §2.2):plugin 单件自包含、CLI 零依赖纯 stdlib、无外部预置。
- **新口径**:plugin + **主机预置的 `ccm` 二进制**(per-OS Node SEA,随插件安装步骤装上)。ship-anywhere 的保证从「单件自包含」变为「**跨模型后端仍可跑**」——`ccm` 是自包含 SEA,在任何能跑 Claude Code 的 OS 主机上运行,与 Bedrock / Vertex / Foundry **无关**(它们是模型后端,非 CLI 宿主)。**这是 ADR-006「node 之于 hook」同构论证的延伸**:正如 `node` 在任何能触发 hook 的环境天然在,`ccm` SEA 在任何能装 Claude Code 的主机上可装可跑;模型后端的差异不触及主机这一层。
- ADR-002 的 **dispatch-机制 scope 不受影响**(后台机制仍只有 background shell / sub-agent / workflow,timer primitives 仍按 ADR-011);本 ADR 只修订 ADR-002「不依赖外部预置」这一条 ship-anywhere 口径。

### 2.4 不变的部分(红线精神守住)

红线1(hooks bash+node·经进程边界**反而更纯**)、红线2(narrow waist 仍是 hook↔ccm 唯一契约)、红线3(三 skill 不重叠)、红线4(指挥不演奏)、红线6(武装闸)**全部不变**。ADR-013 的 narrow-waist 三档建模(🔒/👁/✎)、JS 数据模型 SSOT、唯一写入关卡(现由 `ccm` 承担)、轻量 advisory 锁**均保留**——本 ADR 只改 SSOT 的**归属**(从 plugin 内 → 独立 `@ccm/engine`)与**访问形态**(in-process → 进程边界),不改 board 契约本身。

## 3. Consequences

### 3.1 Positive

- **桌面端 / web 可独立长出**:CLI 不再焊死在 plugin 内,产品边界清晰,多消费方共享一份引擎。
- **board 逻辑单一真相源且 typed**:`@ccm/engine`(TS)一份,消除「多消费者各自解析」漂移(ADR-013 的目标在更强形态下兑现)。
- **plugin 变薄**:hook 退化为薄 shell 调用,维护面下降。
- **CLI 可独立测试 / 分发 / 版本化**:工业化 monorepo(tsdown / SEA / changesets / Biome / CI)给独立产品该有的工程能力。
- **红线1 反而更纯**:TS/npm 依赖锁在进程边界后,hook 侧绝无 import 引擎之虞。

### 3.2 Negative

- **多一个安装前置**:cc-master 不再是「装个 plugin 就完」——`ccm` 必须在 PATH。这是为解耦付的**真实价**(诚实记账)。
- **plugin 与 ccm 需版本协同**:JSON 契约 / 版本兼容要管(changesets + 契约版本)。
- **ccm 缺失时 hook 须优雅降级**:不能因 `ccm` 不在就让 hook 炸(T4 落地课题:缺则静默/提示,不 block)。
- **CI 要 per-OS 出 SEA**:分发复杂度上升(optionalDependencies 平台子包)。

### 3.3 Neutral

- 旧 `cli/`(零依赖 CJS 实现)与 `hooks/scripts` 下的 `board-*.js` **退役**(T4);webview 改吃 `ccm` 的 IIFE 产物或经 `ccm` 取数;`run-tests.sh` 需 `ccm` on PATH。这些是 T4 的落地项,本 ADR 只定决策。
- **红线5 的 SSOT 文本(`AGENTS.md` §3)+ README 安装步骤 + skill A `board.md` 的更新随 T4/T6 落地**——evergreen 不变式描述与实现原子同步(在 hook 真改为 shell-out 之前,`AGENTS.md` §3 仍如实描述 in-process 现状)。

## 4. Alternatives Considered

### 4.1 Alternative A:board 逻辑留在 plugin hooks/skills 里(ADR-013 原形态)

拒绝。CLI 作为 plugin 内部访问层、零依赖纯 stdlib——无法在其上独立长出桌面客户端;若强行多消费方,则要么多份真相源、要么 plugin 与 desktop 强耦合。违背用户明确的产品方向。

### 4.2 Alternative B:CLI 源码 bundle 进 plugin、hooks 直接 import

拒绝。这会**破红线1**(hook 将 import TS / 带 npm 依赖的引擎);把 plugin 焊死在 CLI 内部实现上,挡住「CLI 独立成产品」;且仍无法让 desktop 平行消费。是「假解耦」。

### 4.3 Alternative C(选中):外部独立安装 + 进程边界 shell 调用

取。桌面端 / web 可平行长出;红线1 经进程边界守住(TS/npm 锁在 ccm 内);ship-anywhere 经 per-OS SEA 二进制 + 「宿主 vs 模型后端」之分重新落地。代价(安装前置 + 版本协同)显式接受。

## 5. Related

- [`ADR-013-board-v2-data-model-and-cli.md`](ADR-013-board-v2-data-model-and-cli.md) —— 本 ADR **修订**它:§2.2「零 npm 依赖纯 stdlib」→ 工业化 TS + npm 依赖(ship-anywhere 改由进程边界 + SEA 守);§2.3「CLI = plugin 内部三消费者访问层」→ CLI 独立产品 + plugin 降为平行消费方之一;§2.4「hook require 同一份 board-model」→ hook 经进程边界 shell 调 ccm。ADR-013 的 board 契约本身(narrow-waist 三档 / SSOT / 写入关卡 / 锁)**不变**。
- [`ADR-002-ship-anywhere-scope.md`](ADR-002-ship-anywhere-scope.md) —— 本 ADR **进一步修订**其 ship-anywhere 口径(「不依赖外部预置」→「主机预置 ccm 二进制 + 进程边界」);其 dispatch-机制 scope(background shell / sub-agent / workflow,timer primitives 按 ADR-011)**不受影响**。
- [`ADR-006-hooks-may-use-node-js.md`](ADR-006-hooks-may-use-node-js.md) —— 「宿主 vs 模型后端」同构论证的来源:node 之于 hook = ccm SEA 之于主机。
- [`ADR-003-board-narrow-waist.md`](ADR-003-board-narrow-waist.md) —— narrow waist 不变,仍是 hook↔ccm 的唯一契约(只是读经进程边界)。
- 落地阶段:T1/T2(CLI port→TS 工业化 monorepo·已建并端点验收)、T3(Node SEA per-OS 二进制)、T4(hook 解耦 shell-out + `bootstrap` 调 `ccm board init` + 旧 `cli/` 退役 + 红线5 SSOT 文本更新)、T5(changesets + optionalDeps 平台子包 + CI 多平台 SEA)、T6(README 安装步骤 + skill A `board.md` + AGENTS.md 收口)。

## 6. References

- Node SEA(Single Executable Applications)—— 官方 per-OS 自包含可执行,`node --build-sea` + `useCodeCache`。
- esbuild / Rollup 式 `optionalDependencies` 平台子包分发(零 postinstall 下载、攻击面最小)。
- `design_docs/plans/2026-06-23-board-cli-design.md`(ARCH PIVOT banner)+ `2026-06-24-cli-tech-stack-and-contract.md` + `2026-06-24-industrial-stack-decision.md`(均 gitignored 设计草稿,非分发)。
