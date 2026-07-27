# K3 remaining scope audit

Status: human review required

Evidence boundary: board `20260723T141001Z-45674` read-only snapshot, audited 2026-07-27

## Decision rule

本报告使用本次对话中的用户原始请求、用户批准后要求正式实现的 specification，以及后续明确
收窄。后续明确收窄优先。请求锚点是：

1. “图 first / skill 产物”
2. “知识模块是一个全通图；从任意点到具体知识点 hop<=3”
3. “重要知识模块从入口触达的 hop 更少”
4. “一个 SSOT module/point 可被多个地方高效引用，路径不决定 membership”
5. “Markdown 文件/行区间与可计算、可维护的知识节点绑定”
6. “8 runtime skills”
7. “四 host K3”
8. “knowledge 不进 dist/package；运行时只拿 skill artifact”
9. “完整 meta toolkit + CI 防漂移”
10. “Draft PR，不 merge”

用户要求“完整解决方案正式化”后批准进入实现的
[`specification.md`](specification.md) 是这些锚点的可执行合同；但它不能推翻后来对 K3-01P 的明确
收窄：knowledge 边界只需在 publish 前删除并机械扫描，不因这条边界另造 independent oracle /
sealed release protocol。

`keep` 表示原句直接支持；`narrow` 表示 acceptance 混有受支持目标与派生门槛，只保留前者；
`defer` 表示可能有价值但没有本轮用户授权，只能做 follow-up；`drop` 表示重复、与 non-goal
冲突，或只服务被 defer 的设计，不能阻塞当前 slice。已完成的实现无需在本审计中回滚；本报告只裁定
**剩余工作能否阻塞 Draft PR**。

## Root tasks

| Task | Acceptance fragment | Decision | 用户原始请求支持 / 收窄结果 |
|---|---|---|---|
| K3-01 | accepted compositions 物化的四 host 分别满足 SCC、`diameter<=3`、`entry<=3`、critical SLO 与全部 budgets | **narrow** | “全通图 / hop<=3” + “重要模块更近” + “8 runtime skills” + “四 host K3”及已批准 specification 直接支持 H1–H4。保留 repo authored graph 与四 host **skill-local runtime navigation surface** 的 SCC、diameter、entry 与 access-class SLO；只保留 specification 已声明并已有实现的 pin/router/read/token/coverage budgets，不新造预算类别或 public knowledge 产品面。 |
| K3-01 | 路径移动不改变 semantic membership | **keep** | 用户明确要求文件/行区间只是 binding，知识点先于 skill 与路径；membership 必须来自图事实 / accepted composition，而不是目录 owner。用现有 fixture/validator 证明即可，不扩成通用文件系统协议。 |
| K3-01 | sync/build/package/release/change-chain/drift 全部成为 CI hard gates | **narrow** | “CI 防漂移” + “knowledge 不进 dist/package” + “四 host K3”。保留能机械抓 graph compile、四 host projection/runtime navigation、dist/package knowledge 泄漏与 committed dist drift 的 required CI；release transaction / sealed manifest / 独立 change-chain 新协议 defer。 |
| K3-01 | `plugin/src/knowledge/**` repo-only；dist、安装包、release archive 零 knowledge / governance metadata / runtime 反向依赖 | **narrow** | “knowledge 不进 dist/package”直接支持 dist 与 package archive 零 knowledge path；清除 runtime→repo-only knowledge 链接是满足 package 可用性的必要机械检查。额外“零全部治理元数据”若超出 knowledge path，无单独授权。 |
| K3-01 | 必要导航只进既有 skill-local Markdown，runtime links 在安装包可解析 | **keep** | “skill 产物” + “knowledge 不进 dist/package” + “8 runtime skills”。runtime 只消费 skill artifact，不能消费 repo-only graph。 |
| K3-01 | 诊断输出最小反例 witness | **keep** | 已批准 specification 把最小 witness 定为图治理工具的可维护性合同。只验现有 checker 的结构化 witness，不为此新增 oracle、协议或诊断产品面。 |
| K3-03 | ADR/spec/CLI/AGENTS/CONTRIBUTING/research evolution/meta-skill/命令事实全部一致 | **narrow** | “图 first / skill 产物” + “完整 meta toolkit” + “knowledge 不进 dist/package”。只修会对这些用户目标作冲突声明的 truth-bearing 文档；不以“遍历所有研究叙事”作 blocker。 |
| K3-03 | 零处声称 module 天然恰属一个 skill 或从目录推导 membership | **keep** | “图 first / skill 产物”直接支持：图事实先于 skill artifact。 |
| K3-03 | knowledge repo-only，dist/package/release 不含 knowledge，导航只进 skill-local Markdown | **narrow** | “knowledge 不进 dist/package” + “skill 产物”。保留 dist/package 与 skill-local artifact；release 只按 package archive 检查，不扩成 release protocol。 |
| K3-03 | dev journey 覆盖 discovery→graph→analysis→admission→skillsmith→grounding→four-host materialization | **narrow** | “完整 meta toolkit” + “四 host K3”。要求维护者能走通完整 toolkit 到四 host 产物；不把这组派生阶段名逐个升级为新的 acceptance。 |
| K3-03 | 无双 SSOT，dev/meta skill 数量和路由正确 | **narrow** | “图 first / skill 产物” + “完整 meta toolkit”。保留 graph source / skill artifact 边界与 toolkit 可发现、可路由；不以某个派生数量或新 meta-skill 作为门。 |
| K3-04 | Cursor reviewer 从 clean checkout 独立运行全量 tests/sync/package/knowledge checks | **keep** | 用户限定本 board 开发 worker 只用 Codex/Cursor，且批准了四 host K3 终验。保留 Cursor clean-checkout endpoint review，但必须按本报告 scope contract 裁决。 |
| K3-04 | 审计全部 point/module、compositions、候选准入与行为证据 | **keep** | “图 first / skill 产物” + “8 runtime skills” + “完整 meta toolkit”及 approved specification 支持全量数据和生命周期证据；不得借审计新增产品面。 |
| K3-04 | 证明 path 非 membership、共享 SSOT、未 admit 不物化、四 host H1–H4 真实 | **keep** | 这些是用户明确讨论并批准正式化的图模型核心。四 host H1–H4 验的是从 repo graph **物化进既有 skill-local Markdown 的 runtime navigation surface**，不是把 `plugin/src/knowledge/**` 或一套 public graph 产品面塞进 dist。 |
| K3-04 | 给出非空 APPROVE 或 REQUEST-CHANGES | **narrow** | 可保留非空 verdict，但 `REQUEST-CHANGES` 只有逐条映射上述用户 acceptance 才阻塞；out-of-scope finding 记 follow-up。 |
| K3-05 | orchestrator 读 diff、运行全闸、核对 Goal Acceptance | **keep** | 八条用户请求的最终端点核对，尤其“四 host K3”“CI 防漂移”。 |
| K3-05 | 分组 commit/push，Draft PR 说明与证据完整 | **keep** | “Draft PR，不 merge”。 |
| K3-05 | main 与 feature worktree clean | **narrow** | 作为本仓交付卫生执行，但不新增产品 acceptance；只要求本次 Draft PR 不夹带无关改动。 |
| K3-05 | 不 merge | **keep** | “Draft PR，不 merge”逐字支持。 |

## Unfinished K3-01P line

| Task | Acceptance fragment | Decision | 用户原始请求支持 / 收窄结果 |
|---|---|---|---|
| K3-01P | knowledge 可在 repo/source 与 private scratch candidate 参与编译 | **keep** | “图 first / skill 产物” + “knowledge 不进 dist/package”：knowledge 是研发源，skill 是产品制品。 |
| K3-01P | publish 前删除 candidate `knowledge/**`，清除 runtime Markdown 的 repo-only knowledge 链接 | **keep** | “knowledge 不进 dist/package” + “skill 产物”。这是可机械实现的最小边界，不要求新 transaction。 |
| K3-01P | 四 host dist、package staging、archive 解包均无 `knowledge/**` | **keep** | “四 host K3” + “knowledge 不进 dist/package”。archive 按 package 产物检查。 |
| K3-01P | required CI 机械扫描回归 | **keep** | “CI 防漂移”。 |
| K3-01P | H1/H2/H4 与 `hop<=3` 不作为 knowledge 分发边界的新协议 | **narrow** | K3-01P 只验 publish 前删除和机械扫描，不要求它另造 public graph/oracle/sealed protocol；H1–H4 仍由 K3-01 对 repo graph 与 skill-local runtime navigation surface 验收。 |
| K3-01P | independent oracle / sealed release protocol 不作为 blocker | **keep (non-goal)** | 八条请求没有 oracle / sealed protocol；minimum sufficient scan 已能验“knowledge 不进 dist/package”。 |
| K3-01P-TX4 | fast/medium/slow 时间预算 | **drop** | 无用户原始请求支持。 |
| K3-01P-TX4 | P1–P8 与 stop criteria 全满足 | **defer** | 属 trusted transaction hardening；没有本轮授权，不阻塞。 |
| K3-01P-TX4 | fresh independent APPROVE | **defer** | 独立 reviewer 不是用户 acceptance；只保留 K3-04/K3-05 的 in-scope endpoint check。 |
| K3-01P-TX4 | commit 后 dist-sync RC0 | **keep** | “CI 防漂移” + “四 host K3”。 |
| K3-01P-TX4 | 四 host package/release 全绿 | **narrow** | 保留四 host package 边界与 K3 checks；release protocol / producer 另行授权。 |
| K3-01P-TX5D | private graph 与 public runtime projection 各有一套为 release transaction 新造的 closed topology / H gate | **drop** | 作为 K3-01P 分发边界的独立双图协议无授权；K3-01 仍按 approved specification 验 repo graph 与既有 skill-local runtime navigation H1–H4，不复制第二套 authority。 |
| K3-01P-TX5D | trusted expected 独立于 compiler/materializer | **defer** | independent oracle 无用户原句支持；可作安全 hardening follow-up。 |
| K3-01P-TX5D | required CI 传递同一 sealed four-host release manifest | **defer** | “CI 防漂移”只支持最小机械 gate，不授权 sealed release 新协议。 |
| K3-01P-TX5D | 三实现 lane + fan-in，禁止逐链接/逐测试补丁 | **drop** | 是派生实现组织方式，不是 acceptance。 |
| K3-01P-TX5DR | 独立 reviewer 批准 TX5D 合同或给出 REQUEST_CHANGES | **drop** | 它只服务已 drop/defer 的 TX5D 设计，不能继续阻塞当前 slice。 |
| K3-01P-TX5DR | 确认“三根因闭合”且 RED 命中 production seam | **defer** | 可随 TX5D hardening 一并作为另行授权的 follow-up；不是本轮八条用户 acceptance。 |
| K3-01P-TX5DR | 三个实现 lane 无重叠循环 | **drop** | 是派生执行拓扑的自洽条件，不是用户交付条件。 |

## Human stop line

当前 slice 的最短收口路径是：采用已完成 `K3-01P-MIN` 的机械边界证据；只补齐本报告
标为 `keep` / `narrow` 的缺口；让 K3-04 reviewer 携带逐字 acceptance + non-goals 做一次
in-scope review；然后执行 K3-05，开 Draft PR 并停在用户 review，绝不 merge。

为 K3-01P 新造的 public graph 产品面、independent oracle、sealed release protocol 均不得继续作为
本轮 blocker。K3-01/K3-04 仍必须证明 approved specification 已规定的 repo graph 与四 host
skill-local runtime navigation H1–H4；这不允许把 `plugin/src/knowledge/**` 分发出去。若维护者仍
希望推进额外 hardening，先取得用户新的 scope 授权，并作为独立 follow-up 重新立 acceptance。
本报告不修改 board；由 human reviewer 决定如何重写 task/dependency 状态。
