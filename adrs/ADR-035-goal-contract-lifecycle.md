# ADR-035 — Goal Contract 生命周期取代 prompt-only 目标复制

> Status: **Accepted**
> Date: 2026-07-15
> Scope: `ccm` board/CLI、as-master-orchestrator commands、SKILL A/D/E、bootstrap/reinject/identity-nudge/verify-board、Claude Code/Codex/Cursor adapters
> Source: 2026-07-15 用户要求“澄清并转写无歧义目标、复杂背景独立落文档、skill/hook 防目标漂移”
> Co-signed: 用户授权按完整 spec 实施并提交 PR 人审

---

## 1. Context

原始 prompt、命令参数或 issue 是需求证据，可能混合痛点、猜测方案、背景和歧义。部分 fresh 入口却把它直接写成 `board.goal`；之后 DAG、reinject 和完成 gate 都只能围绕这份未经澄清的文本工作。长程编排最危险的失败因此不是任务没做完，而是从错误目标出发把所有局部任务“正确”做完。

只加一句 prompt 能改善首次行为，却不能给 compaction/resume、目标 amendment、复杂背景和篡改校验提供持久语义锚。另一方面，把 goal revision 复制到每个 task 会扩大迁移面，并在 v1 尚无证据时制造双写和 stale 语义。

## 2. Decision

选择 **Goal Contract 生命周期**：

1. raw request 与 normalized goal 分离；fresh bootstrap 不复制 raw request。
2. `board.goal` 保持短字符串；新增 legacy-optional 的 👁 `goal_contract`，保存 schema/revision/assurance/Brief ref+hash/updated_at，不扩大 narrow waist。
3. 复杂背景落到 `$CC_MASTER_HOME/goals/` 下由 `ccm goal` 管理的 append-only Goal Brief；简单目标可无 Brief。
4. 新增 `ccm goal set|confirm|amend|show|check`，并在 contract 激活后拒绝 `board update --goal` 绕过审计。
5. 采用分级确认：清晰低风险目标可 `asserted`；实质歧义或高风险先 `pending`；`confirmed` 必须显式 `--user-authorized`。
6. Skill 负责 framing/trace/delta/completion 的语义判断；ccm 负责状态、revision 和完整性；hooks 只做生命周期 re-ground 与机械 gate。
7. Claude Code、Codex、Cursor 按一张 Capability Card 兑现同一 intent；机制差异必须补偿或声明真实 gap。
8. v1 不新增 task-level lineage 字段，复用 `task.justification` 留短 trace；amendment 后由 orchestrator 语义重审任务。

完整当前态规范见 [`design_docs/2026-07-15-goal-contract-lifecycle-spec.md`](../design_docs/2026-07-15-goal-contract-lifecycle-spec.md)。

## 3. Consequences

### 3.1 Positive

- 用户可在 DAG 扩散前纠正 agent 对需求的解释。
- resume/compaction/交接能重新加载同一 revision 的完整背景。
- 目标修改留下 append-only revision 与理由，Brief 篡改可机械发现。
- 旧 board 可继续运行，且不伪造历史确认。
- narrow waist、board/task SSOT 和 hook 的确定性边界保持稳定。

### 3.2 Negative

- plugin 与 ccm 两条版本线必须协调 capability precheck，部署需先升级 ccm。
- 新增 sidecar 的文件安全、生命周期和孤儿清理成本。
- 分级确认与 reminder 若措辞/频率失衡，可能给简单任务增加摩擦。
- v1 的 task 相关性仍依赖 orchestrator 判断，无法机械证明语义贡献。

### 3.3 Neutral

- `goal_contract` 是 observed 增强，不成为每个 hook 必读的窄腰字段。
- Goal Brief 是 orchestration contract snapshot，不取代项目自己的正式产品 spec。
- 旧 board 只有主动执行 `goal set` 后才进入新生命周期。

## 4. Alternatives Considered

### 4.1 Prompt-only

只修改 command/Codex skill，要求 agent 改写 goal。改动最小，但 compaction/resume 后没有完整背景，无法校验 amendment 或 Brief 完整性，不能满足长程防漂移目标，否决。

### 4.2 全量 task lineage

在 Goal Contract 之外，强制每个 task 持有 goal revision/section trace，并自动 stale amendment 前的全部任务。可追溯性更强，但需要先定义 supersession/cancel/revalidation 语义，迁移与噪声远超现有证据，延后到真实 dogfood 证明必要时。

### 4.3 把完整背景直接塞进 board.goal

实现简单，却破坏 selector/顶栏可读性，鼓励重复和静默覆写，也不能把 live DAG 与稳定需求背景分层，否决。

## 5. Supersession Criteria

只有在以下证据出现时才重开本决策：

- ccm 获得能把 goal revision 与每个 task 原子绑定、且有清晰 stale/revalidation 语义的模型；
- dogfood 证明 `task.justification` 无法承担最小 trace，并出现可复现的 amendment 漏判；
- harness 提供跨 session 的原生、可审计 goal contract，能等价取代 sidecar；
- 隐私或部署约束证明 home-managed Brief 不可接受，需要改为用户选择的外部存储。

## 6. Related

- [`ADR-003`](ADR-003-board-narrow-waist.md) — board narrow waist
- [`ADR-018`](ADR-018-hook-agent-message-protocol.md) — hook 注入标签协议
- [`ADR-025`](ADR-025-board-write-guard-single-path.md) — board writes 只走 ccm
- [`ADR-031`](ADR-031-n-host-capability-parity.md) — N-host capability parity
- [`design_docs/2026-07-15-goal-contract-lifecycle-spec.md`](../design_docs/2026-07-15-goal-contract-lifecycle-spec.md)

