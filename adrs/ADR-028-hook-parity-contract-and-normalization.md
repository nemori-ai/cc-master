# ADR-028 — hook parity contract layer + minimal normalization bridge

> Status: **Accepted**（用户拍板·2026-07-07·HOOKPAR-DEC）
> Date: 2026-07-07
> Scope: 新增 `plugin/src/hooks/<hook>/CONTRACT.md`（7 个双端 `implemented` 业务 hook 各一份）+
> `scripts/gen-hook-parity-matrix.sh`（生成 `design_docs/hook-parity-matrix.md`，接入 `run-tests.sh`）+
> `hook-common.js` 的最小归一化桥接（`normalizePayload`/`ctx.normalized`，附加只读字段）+
> `tests/hooks/test_parity-fixtures.sh`（行为级 parity fixture）+ `tests/content/hook-injection-contracts.test.mjs`
> 的 CONTRACT.md PARITY anchors 结构级检查 + `scripts/check-hook-parity-touch.sh`（PR-diff 存在性检查）+
> AGENTS.md §6 附近新增「hook 双端锁步」纪律段。同 PR 修复四处此前未声明的 host-convention-divergence
> （FUSE 熔断 / rollup 检查 / board-guard bash 兜底误报 / ADR-018 标签协议缺失，均限于 codex 侧）。
> Source: `design_docs/plans/2026-07-07-hook-parity-system.md`（六处分叉实证 §2）+
> `20260707T081546Z-4904--HOOKPAR-DEC--20260707T093724Z.decision.md`（用户四问全拍，选最大范围）。
> Co-signed: user (owner)

---

## 1. Context

cc-master 的 7 个业务 hook 里 6 个已双端（Claude Code / Codex）实现，但 Codex 侧没有跨 host 共享的
`hook-common` 等价物——7 个 Codex core 文件各自内联重写 `resolveHome`/`isArmed`/`listMatchingBoards`
等 helper。抽查 verify-board / board-guard / usage-pacing 三个双端 hook 发现 **6 处未声明的业务逻辑
分叉**（详见调研报告 §2），其中四处（FUSE 熔断缺失、rollup 检查缺失、board-guard 手改误报逻辑不一致、
ADR-018 标签协议缺失）判定为 `host-convention-divergence`——纯粹的实现漂移，非协议差异，理应修，也
理应有一层机制拦住它继续发生。

现有的 `injection-contracts.yaml` + `hook-injection-contracts.test.mjs` 只覆盖 1/7 个 hook
（identity-nudge），且只断言「字符串锚点两端都出现」，不断言判定逻辑本身等价——`bashWritesBoard` 那类
「两端字符串都对、逻辑不同」的分叉，字符串锚点测试**结构性拦不住**。这是本次决策要补的机制缺口。

## 2. Decision

### 2.1 CONTRACT.md — host-neutral 业务规则 SSOT

为 7 个双端 `implemented` 业务 hook（bootstrap-board / board-guard / board-lint / reinject /
identity-nudge / usage-pacing / verify-board）各建一份 `plugin/src/hooks/<hook>/CONTRACT.md`，固定结构：
触发意图 / 业务规则（每条一个 `rule-<id>`）/ 注入 taxonomy / 武装语义 / PARITY anchors（结构锚点声明）/
降级行为（三分类学 `event-unavailable` | `protocol-capability-gap` | `host-convention-divergence`，
后者必带 `tracked_by`）。`implementations/<host>/` 是这份 CONTRACT 的**投影**，不是独立 spec——改实现
前先改 CONTRACT.md。首批内容 = 调研报告 §2 六处分叉的如实登记（含本 PR 已修复的四处 + 保留的两处
declared protocol-capability-gap）。

为什么不止步于扩展现有 `injection-contracts.yaml`（选项 A1）：A1 的字符串锚点模型只能证明"两端都提到了
规则"，证不了"判定逻辑等价"——这正是本次要拦的漂移类型。CONTRACT.md 把"这个 hook 该做什么"和"host 怎么
做"物理分离，降级行为字段强制显式列出（不许沉默省略），比纯字符串锚点更抗漂移。

### 2.2 parity 矩阵 — 生成物，非手工维护

`scripts/gen-hook-parity-matrix.sh` 从全部 CONTRACT.md 的「降级行为」节汇总渲染只读的
`design_docs/hook-parity-matrix.md`（`--check` 模式接入 `run-tests.sh`）。复用本仓已验证过的
"source 分散在贴近改动的位置 + 生成聚合视图"范式（`plugin/src`→`plugin/dist`、
`.claude/skills`→`.agents/skills`）——细节离改动最近（改 hook 顺手改同目录 CONTRACT.md），矩阵只是派生
视图，改了 CONTRACT.md 忘重新生成会被 `run-tests.sh` 拦。`hooks.yaml` 的粗粒度 `host_coverage` 不变，继续
作为"hook 是否存在双端实现"的第一道闸；矩阵只补细粒度分叉这一层（对应调研报告 §3.2 选项 B2）。

### 2.3 测试卡点两层

- **层①结构级**：扩展 `tests/content/hook-injection-contracts.test.mjs`，新增对每份 CONTRACT.md
  「PARITY anchors」小节的检查——每条声明的 `rule-<id>` + `required_hosts`，须能在对应 host 实现文件里
  grep 到字面 `PARITY: rule-<id>` 注释锚点。这只证明"两端都声明了规则"，证不了逻辑等价（与 A1 同一局限），
  但成本低、能拦"CONTRACT.md 写了规则、某端忘打锚点"这类结构性遗漏。
- **层②行为级**：`tests/hooks/test_parity-fixtures.sh`，用同一份 host-neutral fixture stdin
  （Claude-Code-native 形状；Codex `_hosts/codex/launcher.js` 本就能归一化消费这个形状，见既有
  `test_codex-*.sh`）分别跑两端**真实现**，断言判定落在同一等价类。首批覆盖调研报告点名的三条高风险规则：
  FUSE 熔断、`segmentTouchesRealBoard`、握手 dedup（后者是**声明的**协议差异，fixture 锁定的是"两端各自
  声明的行为"而非"两端字节相同"）。这是唯一能拦住"两端字符串锚点都对、判定逻辑不同"这类分叉的机制
  （调研报告 §2.5 board-guard 案例的真实回归用例）。

### 2.4 最小归一化桥接 — 收敛在 `hook-common.js` 的 `runHook` 单点

用户在四问里选择"本轮顺带做最小归一化桥接"（比 master 原推荐更进取一档）。落地：`hook-common.js` 新增
`normalizePayload(ctx, eventName)`，产出与 Codex `launcher.js` 的 `normalize()` 同形状的 payload
（`{harness, event, session, tool?, raw}`），并在 `runHook` 里作为 `ctx.normalized` **附加**给每个 body——
**纯附加只读视图**：不替换 `ctx` 既有字段（`raw`/`obj`/`sid`/`toolName`/`filePath`），现有 hook body
一律继续读原字段，判定逻辑零改动。这就是"收敛在 runHook harness 单点"的实际含义：不是逐 hook 分别接归
一化层，而是在唯一的公共入口（`runHook`）加一处纯函数计算，供 parity fixture / 未来工具使用。

零业务行为变化的证据：`grep -rn 'ctx.normalized' plugin/src/hooks/*/implementations/claude-code/*.js`
——除 `hook-common.js` 自身定义处外零命中，即当前没有任何生产 hook body 读取这个字段；本 PR 的行为级测试
（层②）也验证了既有 7 个 hook 的所有既存测试全绿（详见 run-tests.sh 全绿记录）。

为什么不做"两端都强制走同一份 host-neutral core 文件"（更激进的重构）：Codex 侧本就没有共享
`hook-common`，把两端 body 收敛成同一份 core 需要发明一层新的跨 host 抽象、动全部 7 个 hook 的骨架，风险
和范围远超本轮四问拍板的意图（用户只批了"最小桥接"，不是"重写两端共享 core"）。

### 2.5 四处分叉修复（host-convention-divergence，本轮全修）

- **FUSE 熔断**（codex 补）：`verify-board-core.js` 新增会话级连续 block 计数 sidecar
  （`.codex-<sid>.stopfuse`），streak >= 5 强制放行 + strong advisory，语义对齐 claude-code 的 FUSE（触发
  键不同——claude 按未变完成态指纹、codex 按原始连续 block 计数，两者都保证 Stop 循环有限时长上界）。
- **rollup 检查**（codex 补）：`verify-board-core.js` 新增 `rollupOwnersViaCcm`（spawn `ccm board lint
  --json` 取 `GRAPH-ROLLUP` 违规 owner），逐板追加与 claude-code 同文案的软提醒；`ccm` 不可用 → 优雅降级
  跳过（其余 Stop gate 逻辑照走）。
- **board-guard bash 兜底误报**（对齐 claude-code 修法）：`board-guard-core.js` 的 `bashWritesBoard` 移除
  「整条命令」兜底分支（`sawBoardWrite ? false : WRITE_OP_RE.test(整条命令)`），新增
  `segmentTouchesRealBoard`（token 须 resolve 到 `boardsDir(home)` 下才算触碰真板），与 claude-code
  `board-guard.js` 判定表字节级对齐。修复了调研报告 §2.5 的具体反例
  （`echo hi > /tmp/scratch.txt; cat notes.board.json` 此前在 codex 侧误报 deny）。
- **ADR-018 标签协议**（codex 侧补齐）：`verify-board-core.js` / `board-guard-core.js` /
  `usage-pacing-core.js` / `identity-nudge-core.js` 新增本地 `directive`/`advisory` wrapper（无共享
  hook-common 可 require，故本地小型复刻，输出形状与 claude-code `hook-common.js` 的同名 wrapper 字节
  级一致），把此前裸 `{kind, message}` 输出升级为携带 ADR-018 标签的文本。`board-lint-core.js` 此前已
  自带本地 `advisory` wrapper，本轮未改动（已是双端一致状态）。

### 2.6 AGENTS.md 纪律 + PR 卡点

AGENTS.md §6 附近新增「hook 双端锁步」段（与 `ccm⟷using-ccm` 锁步同构）：任何 `plugin/src/hooks/<hook>/`
下的业务逻辑改动，若该 hook 声明双端 `implemented`，必须同 PR 同步另一端或在 CONTRACT.md「降级行为」显式
声明。硬卡点 `scripts/check-hook-parity-touch.sh`：对比 PR diff（或工作树 vs `origin/main`/`main`）里
`implementations/<host-A>/` 与 `implementations/<host-B>/` 的 touch 集合，单侧 touch 且 CONTRACT.md
未同 touch → fail（存在性检查，非语义检查——语义仍靠 PR reviewer）。此脚本**不**接入 `run-tests.sh`（需要
有意义的 base ref，纯本地跑无 PR 上下文时应静默跳过而非误报失败）。

### 2.7 顺手修复

`hooks.yaml` 的 `verify-board.host_coverage.codex` 从陈旧的 `implemented-advisory` 改为
`implemented-blocking`（延续 2026-07-06 审计已发现但未收尾的漂移——verify-board 早已是 blocking，manifest
标注没跟上）。

### 2.8 范围外发现，登记不修

草拟 CONTRACT.md 时额外发现（超出本轮四项命名分叉）：`bootstrap-board.sh`（claude-code）在 ADR-021 下
硬查 `ccm` 是否存在、缺则拒绝建板；`bootstrap-board-core.js`（codex）没有等价硬前置，只是各次
`spawnSync('ccm', ...)` 调用失败后各自 catch 记 note，仍会继续建板武装。本轮**不修**（不在用户拍板的
四项范围内），登记为 `bootstrap-board/CONTRACT.md` 的新增 `host-convention-divergence` 条目，`tracked_by`
标记为 backlog，留给后续 PR。

## 3. Consequences

### 3.1 Positive

- 未来任何 hook 业务逻辑改动都有明确的"改哪份 CONTRACT.md、要不要同步另一端"心智锚点，而非全靠 PR
  reviewer 记忆或碰运气。
- 行为级 fixture test 是本轮机制里唯一能拦"两端字符串都对、逻辑不同"这类分叉的卡点——已经在草拟本 ADR
  过程中真实抓住并修复了一处（board-guard bash 兜底）。
- 四处此前未声明的漂移全部修复，Codex 侧 verify-board / board-guard / usage-pacing / identity-nudge
  在安全网（FUSE）、软提醒完整度（rollup）、判定正确性（board-guard）、agent 可读信号
  （ADR-018 标签）四个维度上都不再系统性弱于 Claude Code 侧。

### 3.2 Negative

- 新增 7 份 CONTRACT.md + 1 份生成矩阵 + 2 类新测试 + 1 个 PR-touch lint 脚本——维护面变大；
  `ccm⟷using-ccm` 式的人工锁步纪律永远有"忘了同步"的风险，本轮只是把这个风险从"完全无机制"降到"有存在性
  检查兜底"，不是彻底消除。
- `check-hook-parity-touch.sh` 是存在性检查，不是语义检查——CONTRACT.md 被 touch 不代表声明诚实，仍需
  人工 review。
- 归一化桥接的 `ctx.normalized` 目前是"只算不用"的附加视图——如果长期没有生产代码消费它，可能沦为维护
  负担而非实际抽象；本 ADR 的立场是它至少服务了 parity fixture test 的构造，价值已经兑现一部分。

### 3.3 Neutral

- 窄腰、hook 武装闸、红线 1/2/5/6 全部不动——本轮改动全部落在业务判定逻辑本身 + 新增的 dev-only 文档/
  脚本/测试层，不触碰任何结构性不变式。
- `bootstrap-ccm-hard-precheck` 分叉的发现属于本轮调研的副产品，按 §2.8 处理（登记不修），不扩大本轮
  PR 范围。

## 4. Alternatives Considered

### 4.1 Alternative A1：只扩展 `injection-contracts.yaml` 覆盖面（不新增 CONTRACT.md）

调研报告已论证：A1 的字符串锚点模型证不了判定逻辑等价，是弱对齐。用户拍板选择了更完整的 A2（CONTRACT.md）
+ B2（生成矩阵）组合，本 ADR 记录该决策，不再重复论证过程，见调研报告 §3.1/§3.2。

### 4.2 Alternative：把 CONTRACT.md 的分叉声明塞进一个中心大 YAML（选项 B1）

否决：分叉数量增长后单文件会臃肿难读，且 `kind`/`risk` 这类语义字段混进机器可读中心文件容易被当装饰性
字段不维护。选择 B2（细节分散贴近改动、矩阵是生成视图），与本仓已验证的 source-dispersed / view-generated
范式一致。

### 4.3 Alternative：两端都强制走同一份共享 core（更激进的归一化）

见 §2.4 讨论——超出本轮"最小桥接"的拍板范围，且需要发明一层新抽象、动全部 7 个 hook 骨架，风险/范围
不成比例。留作未来若归一化价值持续验证后的可能演进方向。

## 5. Related

- [ADR-006](ADR-006-hooks-may-use-node-js.md) — hook 只用 bash+node/JS（本 ADR 的所有新代码/脚本遵守）。
- [ADR-007](ADR-007-hook-arming-gate.md) — dormant-until-armed（FUSE/rollup 修复仍在既有武装闸内）。
- [ADR-013](ADR-013-board-v2-data-model-and-cli.md) / [ADR-014](ADR-014-cli-decoupling-as-independent-product.md) — `ccm` 进程边界（rollup 检查复用同一 spawn 约定）。
- [ADR-018](ADR-018-hook-agent-message-protocol.md) — hook→agent 标签协议（本轮把它补齐到 Codex 侧四个 hook）。
- [ADR-021](ADR-021-ccm-install-presence-hard-precheck.md) — ccm 硬前置（§2.8 发现的 bootstrap 分叉与它相关，本轮不修）。
- [ADR-025](ADR-025-board-write-guard-single-path.md) — board-guard 本体设计（本 ADR 只修复其 codex 侧判定分叉，不改设计）。

## 6. References

- `design_docs/plans/2026-07-07-hook-parity-system.md` — 现状盘点 + 六处分叉实证 + 方案设计。
- `design_docs/hook-parity-matrix.md` — 本 ADR 落地的生成物（矩阵视图）。
