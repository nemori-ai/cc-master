---
point: ccm.cmd.goal
---

## 权威陈述

<!-- ccm:k:start point:ccm.cmd.goal -->
## namespace goal

Goal Contract 是 `board.goal` 的 revisioned 写入面。raw request / issue 只作证据；agent 先澄清转写，再通过本 namespace 持久化。`--brief-file` 的输入必须是 ≤1 MiB、有效 UTF-8、非 symlink 的普通文件；ccm 把它复制到 `<home>/goals/<board-stem>/rNNNN.goal.md`，以 `0600` 权限保存，并在 `board.goal_contract.brief` 记录 home-relative ref + SHA-256。revision 文件 immutable，不覆盖旧版。

### goal set

**写**：首次把 pending skeleton / legacy board 转成 r1 Goal Contract。

```bash
ccm goal set --summary "<normalized goal>" --assurance <pending|asserted> [--brief-file /abs/goal.md]
```

- `--summary`、`--assurance` 必填；已有非 skeleton contract 时拒绝，改用 `goal amend`。
- `asserted` 表示 agent 按安全默认补齐且 Goal Framing Test 通过；不是伪造用户确认。
- 例：`ccm goal set --board /abs/x.board.json --summary "交付一份通过验收的 draft PR，不合并" --assurance asserted --brief-file /tmp/goal.md`

### goal confirm

**写**：把当前 revision 的 assurance 升到 `confirmed`，revision 不变。

```bash
ccm goal confirm --user-authorized
```

- `--user-authorized` 必填且只代表当前对话已有真实用户确认；agent 绝不自授权。

### goal amend

**写**：需求语义变化时创建下一 revision，并 append 审计 log；旧 Brief 保留不覆盖。

```bash
ccm goal amend --summary "<new normalized goal>" --reason "<semantic delta>" \
  --assurance <pending|asserted> [--brief-file /abs/new-goal.md]
```

- `--summary`、`--reason`、`--assurance` 必填。新 revision 不继承旧 Brief 指针；仍需完整长背景时显式给新版 `--brief-file`。

### goal show

**只读**：显示 summary、contract 与受管 Brief 绝对路径；legacy board 的 contract 显示为 legacy/null。

```bash
ccm goal show [--json]
```

### goal check

**只读**：校验 contract 形状、Brief containment / 普通文件 / 存在性 / SHA-256。

```bash
ccm goal check [--json]
```

- verdict：`ok`（goal settled **且**交付 DDL settled，integrity valid）、`pending`（goal 还须澄清/确认）、`deadline_pending`（goal 已 settle 但交付 DDL 未 settle——键缺失或仍 pending）、`legacy`（旧板，无 contract）、`malformed`、`missing_brief`、`hash_mismatch`。
- `malformed|missing_brief|hash_mismatch` exit 3；`ok|pending|deadline_pending|legacy` exit 0。exit 0 不代表可以执行——`pending`/`deadline_pending` 都门控派发，调用方必须读取 verdict。
- `--json` 输出附 `deadline` 子块（`{present, state, at, precision, kind, rev, settled}`）供 agent / viewer 读。

### goal deadline

交付 DDL（delivery deadline）生命周期：把「整块 board / 当前 Goal Contract revision 最终交付」的时间承诺落在 `goal_contract.deadline`（单一 SSOT，随 goal revision 走）。三级命令走子动作 positional：`ccm goal deadline <set|confirm|confirm-none|amend|show>`。DDL 与 `cadence.iterations[].deadline`（单个 iteration 的局部 timebox）、ETA（`ccm estimate forecast` 的预测）、task timeout / watchdog 严格区分——它只表达整块交付承诺。

deadline 有自己的四态 settledness 状态机（`pending|asserted|confirmed|none`，与 goal `assurance` 正交），每次写盘 `rev` 单调 +1 并 append 一条 `board.log` decision（revision/reason/timestamp 三件套）。deadline 的任何写**绝不 bump `goal_contract.revision`**（延长/改期不是目标 scope 变更）。

```bash
# set：设候选/断言截止期（fresh framing 或 legacy 首次；state → asserted 或 pending）
ccm goal deadline set --at <ISO-8601-UTC> [--precision minute|day] [--kind hard|soft] \
  [--provenance-raw "<原始表达>"] [--source goal-evidence|cli-flag|user-reply] \
  [--tz-input <IANA tz>] [--assurance asserted|pending] [--json]

# confirm：把当前 pending/asserted 候选升为 confirmed（要 --user-authorized·agent 绝不自授权）
ccm goal deadline confirm --user-authorized [--json]

# confirm-none：用户明确确认「本目标无 DDL」（state → none·要 --user-authorized）
ccm goal deadline confirm-none --user-authorized [--json]

# amend：变更已存在截止期（延长/改期/改精度·要 --reason + --user-authorized·produces confirmed）
ccm goal deadline amend --at <ISO-8601-UTC> --reason "<why>" --user-authorized \
  [--precision minute|day] [--kind hard|soft] [--tz-input <IANA tz>] [--json]

# show：只读当前 deadline 子对象 + 剩余时间
ccm goal deadline show [--json]
```

- **`--at` 只收严格 ISO-8601 UTC**（`YYYY-MM-DDTHH:MM:SSZ`）；用户给本地时刻（如「北京时间 8/1 下午5点」）由 **agent 换算成 UTC** 后传入，原始表达存 `--provenance-raw`、假定时区存 `--tz-input`。ccm 不做时区换算 / 自然语言解析（语义归 agent）。
- **`--precision day`**：只给日期（可传裸 `YYYY-MM-DD` 或完整 ISO）→ 落当日 UTC **末刻 `23:59:59Z`**（「当日交付」而非「当日 00:00」）；`--precision day` 时**必须带 `--tz-input`**（date-only 无时区证据不可落板）。
- **`--assurance`（仅 set）**：`asserted`（默认）只用于**显式 `--ddl` 或用户输入文本里的无歧义绝对时刻**；推断 / 相对（「周五前」）/ 歧义一律用 `pending`（识别到候选但未 settle）。
- **`--kind`（set/amend）**：`hard`（默认·硬承诺——超期升级为**须向用户报告裁决**的 directive）或 `soft`（软目标——超期只 **advisory nudge**，提示但不阻断、可继续推进）。`set` 缺省 `hard`；`amend` / 再次 `set` 缺省**沿用既有 `kind`，绝不 silent 把 `soft` 翻成 `hard`**——要换软硬档必须显式传 `--kind`。非法值 fail-loud（exit 2）。
- **`confirm` / `confirm-none` / `amend` 强制 `--user-authorized`**（缺失 → exit 3·mirrors goal confirm）；`amend` 额外强制 `--reason`。`set` 已 confirmed / none 后拒绝（指向 amend）。
- **绕路封堵**：deadline 只能经这些 verb 写；`ccm board update` 无 deadline arg、`ccm board set-param` 白名单只含 `runtime.*`、`--set goal_contract.*` 被拒——都指向专属 verb。
- exit：0 成功·2 用法错（非 ISO / precision=day 缺 tz-input / amend 缺 reason）·3 校验拒绝（confirm 缺 --user-authorized / set 已 confirmed / 写后 FMT-DEADLINE）。

<!-- ccm:k:end point:ccm.cmd.goal -->

## 失效类型

`environment_fact`（主体：事实方法） —— 缺 ccm goal namespace 的具体命令、flag、exit code，模型按旧文档或猜测敲命令会踩 exit 2/3

Goal Contract 与 deadline 子命令的必填 flag、四态状态机和 exit code 是本项目专属写入面。
