# Goal Contract 生命周期与防目标漂移规范

日期：2026-07-15  
状态：Accepted for implementation  
决策：[`ADR-035`](../adrs/ADR-035-goal-contract-lifecycle.md)  
能力卡：[`goal-contract-lifecycle`](harnesses/capabilities/goal-contract-lifecycle.md)

## 1. 问题与目标

`as-master-orchestrator` 的参数、自然语言 prompt、issue 或 ticket 是需求证据，不天然是可执行目标。当前部分入口把这段原文直接写进 `board.goal`，导致下游 DAG、验收和 hook 反复强化一份未经澄清的输入；长程执行中即使局部任务全绿，也可能交付错目标。

本能力引入 **Goal Contract（目标契约）**，在“原始请求 → normalized goal → DAG”之间建立可确认、可版本化、可续跑的语义边界：

```text
raw request / issue / ticket
        │  澄清、转写、回显
        ▼
Goal Contract
  ├─ board.goal：短、无歧义、可验收的当前目标
  └─ Goal Brief：复杂背景/范围/验收/权限边界的版本化快照
        │  对当前 revision 切分与追踪
        ▼
board.tasks[]：执行 DAG 与 live 状态
```

三个运行时心智锚：

1. **原始请求是证据，不是目标。** 不照抄参数位置文本。
2. **Goal Contract 先于 DAG。** 未完成 framing，就不把猜测扩散成任务图。
3. **有用不等于相关。** 每项工作必须能解释它对当前 goal revision 的贡献。

## 2. 范围与非目标

### 2.1 范围

- Claude Code、Codex、Cursor 的 fresh/resume 入口。
- `master-orchestrator-guide` 的 framing、re-ground、漂移分类和完成对齐纪律。
- `using-ccm` 的 `ccm goal` 操作面。
- `ccm` 的 Goal Contract 模型、原子写命令、完整性检查和兼容行为。
- bootstrap、reinject、identity-nudge、verify-board 的生命周期守卫。
- README、CHANGELOG、多 harness capability/contract/parity 证据。

### 2.2 非目标

- hook 不使用 LLM 判断自然语言是否语义漂移。
- 不永久保存完整会话 transcript，不把 secret、token 或无关 PII 写入 Brief。
- Goal Brief 不复制 tasks、status、handle、临界路径或 live 进度。
- v1 不给每个 task 增加新的 goal lineage 字段；任务贡献说明复用现有 `task.justification`。
- v1 不自动重判 amendment 后的全部任务；orchestrator 负责分类、重切或取消。
- 不新增第九个分发 skill。

## 3. 权威边界与不变量

| 事实 | 权威落点 |
| --- | --- |
| 原始来源 | 会话与 `board.source` 指针 |
| 当前短目标 | `board.goal` |
| revision / assurance / Brief 完整性元数据 | 可选 observed 字段 `board.goal_contract` |
| 复杂目标背景与验收 | ccm-managed Goal Brief |
| 执行 DAG 与进度 | `board.tasks[]` |
| amendment / confirmation 审计 | append-only `board.log` |

- `board.goal` 仍是现有字符串；`goal_contract` 是 legacy-optional 的 👁 observed 字段，不进入 hook-dependent narrow waist。
- board 写入只经 `ccm`；Goal Brief 只由 `ccm goal` 复制、命名与 hash。
- hooks 经进程边界调用 `ccm` 或只读 board；不得 import `@ccm/engine`。
- skill 负责语义判断；ccm 负责状态机、版本和完整性；hook 负责生命周期提示/硬闸。
- 旧 board 不伪造历史确认；无 contract 时诚实返回 `legacy`。

## 4. 数据契约

### 4.1 `goal_contract`

```json
{
  "goal_contract": {
    "schema": "ccm/goal-contract/v1",
    "revision": 1,
    "assurance": "pending",
    "brief": {
      "ref": "goals/<board-stem>/r0001.goal.md",
      "sha256": "sha256:<64-lowercase-hex>"
    },
    "updated_at": "2026-07-15T10:30:00Z"
  }
}
```

- `revision`：正整数、从 1 单调递增。
- `assurance`：`pending | asserted | confirmed`。
  - `pending`：存在会改变 outcome/scope/acceptance/constraint/authority 的开放问题。
  - `asserted`：请求清晰、低风险；agent 已转写并向用户回显，可推进可逆工作。
  - `confirmed`：用户明确确认当前 revision；只有 `--user-authorized` 可写。
- `brief`：可选；存在时 `ref` 必须是 `$CC_MASTER_HOME` 内的规范相对路径，hash 是文件精确字节的 SHA-256。
- `updated_at`：最近一次 set/confirm/amend 的 UTC ISO-8601 时间。

fresh bootstrap 创建 revision 1 的 pending skeleton：`goal=""`、无 `brief`。首次 `goal set` 填充该 revision，不增到 2。`board init --goal <非空>` 作为显式 ccm API 创建 `asserted` contract；plugin 的 fresh bootstrap 不传 `--goal`。`--github-issue` 只写 `source`，不再用 issue URL 合成 goal。

### 4.2 Goal Brief

存储：`$CC_MASTER_HOME/goals/<board-stem>/rNNNN.goal.md`。

- 每个 revision append-only；amend 写新文件，禁止覆盖旧 revision。
- 输入必须是普通 UTF-8 文件，最大 1 MiB；拒绝设备、目录和越界/symlink 逃逸。
- managed ref 永远相对 `$CC_MASTER_HOME`；复制后以 owner-only 权限保存。
- 生成或复制失败不得更新 board。若 Brief 已落盘而 board 原子写失败，允许留下可安全清理的孤儿文件，不允许半个 contract。
- Brief 至少含：原始来源、真实 job、normalized goal、可观察验收、in/out scope、约束/权限、假设/开放问题、相对上一 revision 的 delta。
- ccm 不解析 Markdown 语义；模板完整性由 command/skill 内容契约与评审保证。

### 4.3 lint 与 verdict

- `FMT-GOAL-CONTRACT`：contract 存在但 schema/revision/assurance/time/ref/hash 形状错误时 hard error。
- `BIZ-GOAL-PENDING`：pending board 存在可执行任务时 warning；需求侦察或合法用户等待可继续存在。
- `board lint` 不读取 sidecar；Brief 文件完整性归 `ccm goal check`。
- `ccm goal check` verdict：
  - `legacy`：无 contract，exit 0；
  - `pending`：形状合法但未 settled，exit 0；
  - `ok`：settled 且 Brief（如有）完整，exit 0；
  - `malformed | missing_brief | hash_mismatch`：exit 3。

## 5. `ccm goal` 命令面

### 5.1 `set`

```bash
ccm goal set --board <path> --summary <normalized-goal> \
  --assurance pending|asserted [--brief-file <path>] [--json]
```

- 仅用于 fresh pending skeleton 或 legacy board 的首次 contract 激活。
- `summary` trim 后非空；`confirmed` 不可由 set 自称。
- 在同一 board lock 下写 goal、contract 与 append-only decision log。

### 5.2 `confirm`

```bash
ccm goal confirm --board <path> --user-authorized [--json]
```

- 当前 contract 必须合法且 goal 非空。
- 只把当前 revision 变为 `confirmed`，不改 goal/Brief、不增 revision。
- 缺 `--user-authorized` 拒绝；agent 不得从上下文推测或自授权。

### 5.3 `amend`

```bash
ccm goal amend --board <path> --summary <new-goal> --reason <why> \
  --assurance pending|asserted [--brief-file <path>] [--json]
```

- 只用于已激活 contract；revision 必须恰好 +1。
- `reason` trim 后非空；同一 mutation 记录旧/新 revision、assurance、reason 和 Brief ref。
- v1 不提供“静默 editorial edit”：只要权威 summary/Brief 字节改变，就按 amendment 留痕。
- amendment 后 orchestrator 必须对 ready/in-flight/blocked tasks 做 Goal Delta Classifier；ccm 不替它做语义判定。

### 5.4 `show` 与 `check`

```bash
ccm goal show --board <path> [--json]
ccm goal check --board <path> [--json]
```

- `show` 返回 board path、summary、contract、resolved Brief path；默认不输出 Brief 全文。
- `check` 做 schema、path containment、存在性和 hash 校验；输出稳定 verdict/reason/revision/assurance。

### 5.5 兼容与绕过封堵

- 一旦 `goal_contract` 存在，`ccm board update --goal` 必须拒绝并指向 `ccm goal amend`。
- legacy board 仍允许旧更新路径；首次 `goal set` 后切换到新生命周期。
- `ccm capability check goal-contract/v1` 供 bootstrap fail-loud 预检。

## 6. Agent 语义协议

### 6.1 Goal Framing Test

在切 DAG 前，orchestrator 必须能回答：

1. **Outcome**：最后可观察到什么变化？
2. **Scope**：包含与明确不包含什么？
3. **Acceptance**：什么证据算完成？
4. **Constraints**：时间、兼容、安全、成本等硬约束是什么？
5. **Authority**：哪些动作可自主做，哪些必须用户批准？

再做三项压力检查：

- **Fork Test**：这句话是否仍容许两个会产出不同交付物的合理解释？若是，澄清。
- **Done Test**：第三方能否仅凭验收判断 done？若不能，细化。
- **Authority Test**：是否可能把不可逆/对外/权限动作误当默认授权？若是，pending。

### 6.2 分级确认

- 清晰、低风险：转写 → 回显 normalized goal → `asserted` → 继续可逆工作。
- 实质歧义或高风险：写 pending contract/Brief → 给用户最小 `decision_package` → 不派发依赖该答案的执行任务。
- 明确用户确认：`goal confirm --user-authorized`。
- 用户新增信息不默认等于改目标；先走 Goal Delta Classifier。

### 6.3 Goal Trace Test

新增/派发任务前，在现有 `task.justification` 留一条短 trace，并验证：

- Contribution：如何推进当前 revision 的哪个验收？
- Counterfactual：不做会阻塞/削弱什么？
- Boundary：是否落在 in-scope 与权限边界内？
- Evidence：完成时拿什么证据判断贡献成立？

四项说不清的“顺手优化”不入 DAG。

### 6.4 Goal Delta Classifier

| 新信息 | 动作 |
| --- | --- |
| 只澄清实现细节，不改变权威语义 | 记录 judgment/log；不增 revision |
| 影响执行路径但不改目标 | replan tasks；不增 revision |
| 改 outcome/scope/acceptance/constraint/authority | `goal amend`，再审任务图 |
| 与当前 contract 冲突且尚未获授权 | `pending` + `decision_package` |
| 有价值但与当前目标无关 | 明确 out-of-scope；不制造 busywork |

### 6.5 强制重对齐点

fresh、resume、compaction、派发前、新输入/新事实、cadence 边界、任务验证、目标 amendment、最终完成前。完成判断必须同时证明：局部 task acceptance 已满足，且交付物满足**当前 revision** 的 Goal Contract。

## 7. Command、skill 与 hook 行为

### 7.1 入口

- fresh bootstrap：建空 goal + pending skeleton；绝不把 `$ARGUMENTS`/prompt 原文传给 `--goal`。
- command/Codex entry skill：读取原始请求 → 加载 Goal Contract 指导 → framing → set/confirm；settled 后才切 DAG。
- resume：保留 contract/tasks/log；第一动作是 `goal check`，存在 Brief 时读取当前 revision，再恢复调度。
- 三 host 必须先检查 `ccm` presence 和 `goal-contract/v1` capability；不支持时拒绝 arm，并注带 source/why 的 directive。

### 7.2 Skill 分工

- `master-orchestrator-guide`：只保留薄锚与关键决策点；详细方法进入 `references/goal-contract.md`。
- `using-ccm`：只教 `ccm goal` 命令、字段和 footgun，不复述语义方法论。
- `slicing-goals-into-dags`：仅增加“输入必须是 settled Goal Contract”的前置条件。
- 不创建新 skill，不把 Goal Contract 逻辑塞进 AGENTS.md 形成双 SSOT。

### 7.3 Hook 边界

| Hook | v1 行为 |
| --- | --- |
| bootstrap-board | pending skeleton；raw 不落 goal；能力预检；fresh/resume context 指向 framing/check |
| reinject | bounded 注入当前 revision/assurance/summary/Brief ref 或 integrity verdict；pending 时先 framing |
| identity-nudge | 低频提醒当前 revision 与“有用≠相关”；用独立 `runtime.last_goal_remind` 节流 |
| verify-board | 完成前校验 contract integrity；pending 仅在结构完整的 user `decision_package` 等待态合法；完成自检绑定当前 revision |
| board-lint | 只消费 engine 结构规则，不读 Brief |

不让 post-tool-batch、board-guard 或 usage-pacing 判断 goal 语义。runtime hook 调 ccm 瞬时失败保持优雅降级；但能确定 integrity error 时不得宣告完成。

## 8. 验收标准

### 8.1 用户行为验收

- **GC-01 Raw separation**：三 host fresh 入口均不会把 raw request/issue URL 逐字写入 `board.goal`。
- **GC-02 Framing first**：agent 在切 DAG 前完成 Goal Framing Test，并写入 normalized goal；有实质歧义时停在 pending `decision_package`。
- **GC-03 Graded assurance**：低风险清晰目标可 asserted；confirmed 只能来自带明确用户授权的 confirm。
- **GC-04 Complex brief**：复杂目标生成受管、版本化、hash 可验证的 Goal Brief；简单目标可省略。
- **GC-05 Resume grounding**：resume/compaction 后先 check 并读取当前 Brief，再继续调度。
- **GC-06 Delta classification**：面对“顺手优化”，agent 用 Goal Trace Test 拒绝或单列 out-of-scope，不把它偷渡进 DAG；不改变成功状态的域内新事实只写 `finding` log（必要时更新 task 执行细节），不升 revision，也不借机改写 Goal Contract。
- **GC-07 Amendment safety**：用户改变验收/范围时生成新 revision，并重审现有任务；不覆盖旧 Brief。
- **GC-08 Global completion**：局部测试全绿但未满足当前 Goal Contract 时，agent不得宣告完成。

### 8.2 机械验收

- **GC-09 Model/CLI**：engine 形状规则、五个 `ccm goal` verbs、日志、锁、exit code 与 `board update --goal` 防绕过均有单测/CLI 测试。
- **GC-10 Brief security**：最大尺寸、UTF-8、owner-only、路径 containment、symlink escape、missing/hash mismatch 有负向测试。
- **GC-11 Hook contracts**：四个受影响 hook 的 CONTRACT 先更新；Claude/Codex/Cursor 兑现同一 intent 或声明有补偿机制的真实 gap。
- **GC-12 Parity**：Capability Card、hooks manifest、parity fixture/matrix 对 Goal Contract 行为一致。
- **GC-13 Skill behavior**：choice pressure baseline 诚实记录现有 SKILL A 已通过的 copy、scope creep、amendment、local-green/global-wrong 判断，不为“造 RED”重复堆纪律；open persistence baseline 必须暴露缺少 revision/Brief/专属 verb 的可操作性失败。加最小 operational reference 后，独立 Codex 评审须同时通过语义判断与持久化路径，且无越界/复述。
- **GC-14 Documentation**：README/README_zh、CHANGELOG、using-ccm command catalog/board model 与真实 CLI 锁步。
- **GC-15 Release gates**：`bash run-tests.sh`、`bash scripts/check-plugin-dist-sync.sh`、`claude plugin validate plugin/dist/claude-code` 全绿；生成 dist 与 source 同 commit。

## 9. 评审策略

### 9.1 评审分层

1. **产品/语义评审**：用 GC-01..08 的黑盒情景判定 agent 是否先转写、会澄清、会拒漂移、会对当前 revision 完成。
2. **规格/模型评审**：检查单一权威、状态迁移、legacy 行为、exit code 与失败原子性；禁止实现私自扩 spec。
3. **安全评审**：path containment、symlink、权限、secret/PII、`--user-authorized` 自授权、篡改 fail-loud。
4. **多 harness 评审**：按 Capability Card 与各 hook CONTRACT 做意图等价，不以“文件存在”代替行为 parity。
5. **Skill 压力评审**：看 baseline 原话、prediction、RED→GREEN 差异；防止把新正文写成空泛口号或复制到多个 SSOT。
6. **回归/发布评审**：legacy board、resume selector、narrow waist、dormant-until-armed、ship-anywhere、generated dist。

### 9.2 必须由人工重点拍板的风险点

- 分级确认是否符合产品预期，尤其 `asserted` 的默认边界。
- Goal Brief 的隐私/留存策略是否足够克制。
- amendment 后由 orchestrator 语义重审、而非 ccm 自动 stale 全任务，是否是可接受的 v1 边界。
- hook 提示频率与 Stop gate 是否既能防漂移又不过度阻塞。

PR 保持 draft，禁止自动 merge；评审者按 GC 编号要求证据或提出变更。

## 10. SDD/TDD 实施 DAG

每一切片必须纵向可验收、先写失败证据、最小实现转绿，再重构：

1. **Slice A — Spec/decision substrate**：本规范 + ADR + Capability Card；评审模型与边界。
2. **Slice B — Skill RED**：对四类压力案例做无新指导 baseline、记录 verbatim rationalization 与预期。
3. **Slice C — Engine/CLI RED→GREEN**：模型规则、Goal Brief storage、`ccm goal`、compat/capability；先单元/CLI 失败测试。
4. **Slice D — Entry RED→GREEN**：三 host fresh/resume fixtures；证明 raw 不再 copy、pending skeleton 与 capability precheck 一致。
5. **Slice E — Drift lifecycle RED→GREEN**：先改 hook CONTRACT，再改 reinject/identity/verify 与 parity fixture。
6. **Slice F — Skill GREEN**：以最小 delta 更新 A reference/薄锚、D 操作面、E 前置；跑独立行为 judge。
7. **Slice G — Docs/projection/release evidence**：README×2、CHANGELOG、生成 dist、全量测试、独立 diff review。

每个 slice 独立 commit；skill 的 judgment-bearing delta 不与无关代码混提交。任何测试若一开始就绿，先证明它没有覆盖新增行为，修正 RED 后再实现。

## 11. 风险、回滚与演进

| 风险 | 缓解 |
| --- | --- |
| 每次启动都变成长问卷 | 分级确认；简单目标允许 asserted、Brief 可省略 |
| Brief 与 board 双写漂移 | board 只保存 hash/ref；ccm 专属原子命令；Brief 不含 live DAG |
| hook 越权做语义判断 | 明确 skill/ccm/hook 三层边界；CONTRACT/parity 测试 |
| legacy board 被强迁移 | `legacy` verdict + 原路径兼容；仅主动 set 后进入新生命周期 |
| prompt 在压力下被合理化 | RED pressure baseline + Rationalization/Red Flags 按证据增量更新 |
| host 能力不对称 | Capability Card 先行；必须补偿或声明分类，不沉默省略 |

回滚时可停止入口创建新 contract，并让 runtime 对 observed 字段降级；已生成的 contract/Brief 保留可读与可审计，不做破坏性迁移。未来若真实 dogfood 证明任务级 lineage 必要，再单独设计 v2，而不预先扩大 board schema。
