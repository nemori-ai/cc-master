# DDL 设计契约 codex 审查分诊（orchestrator 裁决）

- 输入：`2026-07-16-ddl-design-review-codex.md`（codex verdict: NEEDS-ATTENTION，1 critical + 10 major + 1 minor）
- 裁决人：master orchestrator（2026-07-16T18:2xZ）；总判：**设计骨架不变，12 条 findings 中 10 条采纳（含 2 条收窄采纳）、2 条部分采纳**；据此修订实现任务书，契约文档本体不重写（本文即修订记录，D7 收口时并入 PR 叙述）。

| # | 裁决 | 修正内容 | 路由 |
|---|---|---|---|
| 1 (critical·版本斜错) | **收窄采纳** | 完整 versioned capability contract 超 12h 预算 → v1 落轻量版：bootstrap 对 `ccm goal deadline` 做能力探测（探测失败 = 老 ccm → 注入「ccm 过旧，DDL 闸不可用，建议升级」note，evidence 照常保留给 agent）；skew 行为写进 CONTRACT；完整 capability versioning 记 follow-up issue | D4A + follow-up |
| 2 (asserted 过闸) | **部分采纳** | 维持 asserted 放行（用户原话中的无歧义绝对时刻**就是**用户输入，机械追问违背 goal-contract 分级确认精神）；但**收紧 asserted 可达条件**：仅 ① 显式 `--ddl` ② 用户输入文本中的无歧义绝对时刻（含明确时区/UTC）两个来源；一切推断/相对日期/歧义表达一律 pending。契约 §3.2 的「asserted 存在理由」补此收紧 | D2（校验注释）+ D5（prose 规则） |
| 3 (审计 + goalAmend 丢 deadline) | **采纳** | ① 加 `deadline.rev`（int，单调递增，每次 set/confirm/confirm-none/amend +1）；② **goalAmend 重建 goal_contract 时必须保留 deadline 子对象**（代码级 catch！）+ 回归测试 | **D2（紧急中继）** |
| 4 (date-only 时区凭空) | **采纳** | `--precision day` 时 `provenance.tz_input` 必填（agent 据它换算当地日末→UTC）；无时区证据的 date-only = 歧义 → pending + 问用户。ccm 仍只收严格 ISO UTC | D2 + D5 |
| 5 (verdict 消费者未盘点) | **采纳** | goal check verdict 集合扩展必须同步全部消费者：reinject（闭集校验→check_unavailable 风险）、verify-board（闭集→误报 integrity failure）、bootstrap、identity-nudge、skills prose、tests；各 hook CONTRACT 同步 + N-host | D4A（任务书扩容） |
| 6 (双通道重复投递) | **采纳** | 单一投递路径：deadline-risk hook 直接注入后**立即 self-ack** 其 coordination notify 条目（durable 只作审计与跨 session 留痕，不参与二次投递）；notification id 确定性生成 | D4B |
| 7 (throughput 冒充 resource-aware) | **采纳** | `on_time_probability` 只允许来自 RCPSP-in-trial 通道；throughput 通道改名 heuristic 且输出不得映射 green；precedence-only 只作显式标注的 optimistic bound | **D3A（紧急中继）** + D3B |
| 8 (校准不可行) | **采纳** | v1 显式 uncalibrated：合成图集只验证调度器正确性≠经验校准；risk band 用保守规则 + `confidence:"synthetic"` 类诚实标注；真实校准依赖 labeled snapshot 数据，记 follow-up | **D3A（紧急中继）** |
| 9 (overdue 谓词无 canonical) | **收窄采纳** | v1 近似谓词：`now>=DDL ∧ owner.active ∧ 存在非 trulyDone task`，局限文档化；engine-owned acceptance marker 记 follow-up | D2/D3B + 契约注 |
| 10 (--ddl 文法未定义) | **采纳** | D4A 任务书补：bootstrap 参数文法（positional goal 与 flags 的切分/优先级/冲突/转义）+ 各 implemented host 的等价 contract tests | D4A |
| 11 (kind:soft 合法但未定义) | **采纳** | v1 schema 单值 enum：FMT-DEADLINE 拒 `soft`（字段保留、取值收紧）；soft 语义随 schema bump 作 follow-up | D2 |
| 12 (细节漂移) | **采纳** | lint 规则计数机械派生不手写；risk 通知措辞按 ADR-018（advisory 不用命令式；或升 directive 须论证） | D2 + D4B |

Follow-up issues（D7 收口时创建）：① DDL capability versioning（跨版本斜错完整方案）；② deadline 经验校准（labeled snapshot 采集 + backtest）；③ `kind:soft` 语义；④ engine-owned delivery-acceptance marker。
