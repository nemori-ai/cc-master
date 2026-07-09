# ADR-032 — 确定性池中介 + board 通知收件箱（演进 ADR-017 配速协调）

> Status: **Accepted**
> Date: 2026-07-09
> Scope: `@ccm/engine`（board model / peers 分区 / pool-aware pacing / inbox 聚合）+ `ccm` CLI（`coordination` namespace + harness machine-wide registry）+ plugin hooks（`usage-pacing` 双通道路由 + 新 `coordination-inbox` check-hook）+ 分发 skills（`using-ccm` / `master-orchestrator-guide` / `pacing-and-estimation` 锁步）。**窄腰一字不动**（新字段全 👁/✎）。
> Source: GitHub #66（多 session 协商）+ 2026-07-09 设计收敛（否决点对点协商 / 否决硬中央调度 / 选确定性中介 + 收件箱）；设计稿 `design_docs/plans/2026-07-09-multi-orchestrator-arbiter-and-notification-inbox.md`。
> Co-signed: 用户拍板 Accepted·2026-07-09
> Related: 演进 ADR-017 §2.2（独立推理 → 关联推理）；消费 ADR-018 / ADR-024 / ADR-031；daemon 生命周期另见 [ADR-033](ADR-033-ccm-monitor-daemon.md)。

---

## 1. Context

ADR-017 建立了多 orchestrator **只读感知层**（`ccm peers` + ✎ `coordination.{priority,state}`），并明确砍掉通信通道：协调靠「共享花名册 + 板级优先级 + 机械 fair-share floor + agentic 独立自调」。

#66 重新打开「多 session 直接交流 / 协商」方向。经调研与设计收敛，结论是：

- **LLM 点对点协商不可靠**（锚定、退化平分、最后一公里谈崩）——否决 claim/yield/propose/ack 消息通道。
- **硬中央调度器**破红线 4/5——否决。
- 真正缺口不是「缺消息」，而是：① peers 今天 **harness-盲**（跨配额池混排）；② 单板 `usage-pacing` 看不见邻居；③ 决策级建议无 durable 投递 / ack；④ 前台 idle 时后台仍烧配额的盲区（由 ADR-033 补）。

需要把 ADR-017 §2.2 的「各板**独立**推理」升级为「各板感知全局后由**确定性池中介**算出一致建议」——关联均衡（correlated equilibrium）形态：机械设备出建议，智能个体决定跟不跟。

## 2. Decision

### 2.1 D1 — 否决点对点协商；保留「协调 ≠ 通信」

不引入 orchestrator 间 message-passing。通信通道仍墓碑。协调一致性靠**确定性联合分配**消解，不靠谈判。

### 2.2 D2 — 每配额池一个确定性机械中介（非 agentic）

- **逻辑单位**：一个 `(harness, account-pool)` 池一次综合算（priority-weighted fair-share + 升级阶梯）。
- **中介是 `@ccm/engine` 纯函数**，不是 LLM agent。确定性保证：同输入 → 同联合结果；各板本地评估或 daemon 集中评估输出互补一致。
- **智能放在消费侧**：orchestrator 读建议 + 花名册人类可读 goal，可 override（advisory-not-enforcing）。
- **`pacingAdvice` 升 pool-aware**：绝对配额压力轴 + 相对池分配轴合成一个大脑；`M==1` 时退化成今日单板 verdict。

### 2.3 D3 — 分区键 `owner.harness`（👁·向后兼容·可变）

- ARM 时由 ccm 从进程 env 自证盖写；handoff 跨 harness 时下次 ARM 重盖。
- 缺省 → `unknown`（保守单例池）。路径反查 session store 为兜底（best-effort）。
- peers / 中介按 harness 分区；跨池不抢配额。

### 2.4 D4 — `coordination.inbox` 收件箱 + 双投递通道

- ✎ `coordination.inbox[]`：durable 决策通知（`unconsumed` → `consumed` | `expired`；同类 supersede ≤1）。
- **路由**：例行/既成事实 → 直接注入（无 ack）；需 agent 拍板的决策 → inbox（must-ack）。
- `ccm coordination inbox list|ack` + `arbitrate|notify`；写只走 `runWrite`。
- 新 hook `coordination-inbox`：只读 surface unconsumed；**不翻态**。
- `usage-pacing`：升为 pool-aware 生产者；与 inbox-check 按 Stop 注册序共存（§设计稿 15）。

### 2.5 D5 — 本机 harness 注册表为地基

扩 `HarnessAdapter`（`sessionStoreRoots` / `usageSource{pollable,quotaModel}` / `accountPoolLocation`）+ `MachineHarnessRegistry.sweep`。解锁分区、跨 harness 用量、路径反查、monitor。

### 2.6 D6 — 感知连续 / 算→通知边沿

监控电平连续；综合算→通知仅在 band 跨越（迟滞）/ roster 变 / 本行 delta>ε 且过冷却+去重时触发。

## 3. Consequences

### 3.1 Positive

- 消解 #66 通信复杂度，同时兑现多-orch 价值感知分配。
- 修 peers harness-盲；单板 pacing 与池分配统一大脑。
- durable 决策可审计（ack + rationale）；daemon-less 核心可跑。

### 3.2 Negative / 代价

- board model + CLI + hooks + skills 同 PR 锁步面大。
- 分配权重/阈值需 requirement-elicitation 校准（非唯一公式）。
- Claude 用量仍活动耦合 sidecar（平台限制）。

### 3.3 Neutral

- 红线 1–6 精神不变；窄腰不动。
- ADR-017 D1（切号机械化）不变；只演进 D2 配速协调形态。
- monitor daemon 生命周期见 ADR-033（本 ADR 不引入常驻进程要求）。

## 4. Alternatives Considered

### 4.1 A：#66 点对点 channel / outbox

否决——LLM 协商失败模式 + 消息生命周期复杂度。

### 4.2 B：硬中央调度器强制下发

否决——破红线 4/5；agentic delta 归零。

### 4.3 C：维持 ADR-017 纯独立自调

否决为「全部」——感知层已建但 skill/hook 未兑现多-orch 指导；决策级建议无 durable 投递；idle 烧配额盲区仍在。降为 daemon-less 退化态的一部分。

### 4.4 D：agentic 中介（强模型替池决策）

否决作生产侧——破确定性 → 破无通信架构；成本/延迟/不可审计；LLM 不擅长分配切分。灵活性留在消费侧 orchestrator。

## 5. Related

- [ADR-017](ADR-017-multi-orchestrator-coordination.md) — 被本 ADR 演进 §2.2
- [ADR-024](ADR-024-single-sided-pacing-switch-stop.md) — 单侧 verdict；本 ADR 升 pool-aware
- [ADR-018](ADR-018-hook-agent-message-protocol.md) — 注入标签
- [ADR-031](ADR-031-n-host-capability-parity.md) — N-host hook / harness 适配
- [ADR-033](ADR-033-ccm-monitor-daemon.md) — 连续监控 daemon
- 设计稿：`design_docs/plans/2026-07-09-multi-orchestrator-arbiter-and-notification-inbox.md`

## 6. References

- Correlated equilibrium（Aumann）/ mediation value
- 2026 LLM multi-agent negotiation failure literature（见设计稿 §1）
- GitHub issue #66
