# 汰换台账（disposition ledger）

面向 skill knowledge graph 的**知识汰换判定**：267 个知识点里哪些该留、哪些该压成线索、哪些该迁给接口、哪些该退役。**只判不删**——删除执行排在结构重排之后，且一律走 tombstone（降级 `lifecycle: retired`）而非物理删除。

## 三份文档

| 文档 | 内容 |
|---|---|
| [`measurement-design.md`](measurement-design.md) | **方法**：要检验的命题、为什么逐点消融不成立（功效/多重比较）、四个效度威胁、测试类型→它能授权的决定、非对称决策规则、预注册模板、诚实边界 |
| [`env-fact-migration-ledger.md`](env-fact-migration-ledger.md) | **判定**：112 条环境事实逐条判「迁 help / 留 skill / 需改行为」，判据是 Unix man 段落规约（单命令 → help，跨命令 → 技术文档） |
| [`D-tier-run-log.md`](D-tier-run-log.md) | **证据与撤回记录**：确定性比对的实测输出，含**两条已撤回的错误论断**及其成因 |
| [`failure-mode-tier-boundary.md`](failure-mode-tier-boundary.md) | **档位边界诊断**：`capability_gap` 与 `motivation_conflict` 之间那条线没画完——62 个点落在同一种情形上却被判成两种档（37:25）。含判据补充提议。**待批，本轮未改任何 `failure_mode`** |
| [`capability-gap-preregistration.md`](capability-gap-preregistration.md) | **能力补课档 87 条的预注册表**（80 条可预注册 + 7 条无法预注册及其原因）。只准备，不测量，不判定。**尚未被任何人审阅——跑之前必须审** |
| [`output-contract-and-help-budget.md`](output-contract-and-help-budget.md) | **两个未决项的裁决**：`--help` 不分层改设预算闸（附 167 条 help 的体量实测）；新增 `--schema` 且必须带一致性闸 |

## 读之前先知道两件事

**一、本轮的净结论是「零漂移」。** 两次找到疑似漂移，两次都被证伪（一次是截断视图，一次是拿源码对引擎而没查投影产物）。`ccm` ⟷ `using-ccm` 的锁步纪律在 84 条校验规则上一条没漏。**因此「副本会骗人」在本仓没有实例支撑**，迁移的理由只剩结构性的那条（副本天然可能过期、且要人维护）。

**二、六次装置缺陷的共性写在 [[Finding #121]]**：不是粗心，是**每次都在对错误的层做比对**。其中最结构性的一条——SAP 架构下 `plugin/src` **不等于**分发内容，中间隔着 adapter 投影与 slot 占位符，凡「分发内容是否含 X」必须查 `plugin/dist/<host>/`。

## 状态

- 环境事实档（112）：**判定完成**，见迁移台账。
- 能力补课档（87）：**预注册已产出、未审、未执行**。见 [`capability-gap-preregistration.md`](capability-gap-preregistration.md)：80 条进第 0 层测试表、7 条判为无法预注册。三层筛 + 批级消融的方案不变。
  - ⚠ **一个会改变分母的悬案（已诊断，见 [`failure-mode-tier-boundary.md`](failure-mode-tier-boundary.md)）**：全量复核后，问题不是「若干条标错」，而是**判据在 `capability_gap` / `motivation_conflict` 边界上没画完**——全部 267 点里有 **62 条**同时具备「方法主体」与「压力失效」，而过滤器没说这种情形谁优先，于是同一种情形被判成了两种档（37 motiv : 25 其它）。**判据补充提议已写，待批；本轮未改动任何 `failure_mode`。** 分母不定，能力补课档的实测预算排不了。
- 护栏（63）/ 义肢（5）：**不测**——两者都不因模型变强而失效，测它们是花钱确认已知。
