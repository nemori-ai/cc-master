# goal-hook 设计 spec — 用确定性 Stop hook 取代设不了的 native `/goal`

状态:已 brainstorm + 用户 approve(2026-06-08),待实现(TDD)。
源起:dogfood Finding #2 —— `commands`/`skills`/`hooks` 全链路要求 agent「proactively set a phase
`/goal`」,但 agent **根本无法自行触发 native `/goal`**(assistant 输出的 slash command 是惰性文本,
工具层也无 set-goal tool;ToolSearch 两轮实证)。整条「分阶段自驱」对 agent 是空操作 + 假安全感。

## 决策(用户拍板)

1. **不**把 `/goal` 降级成「给用户的可选动作」,而是 **customize cc-master 自己的 Stop hook**
   (`verify-board.sh` 升级)来确定性地实现「条件未达不让停」。形态 = **「逼 agent 自检 + 用 board 把门」**。
2. **拔除**所有 `/goal`·`/loop`·`ScheduleWakeup`·cron 对 agent 的指导(纯干扰 + 假安全感 + 信息过载)。
3. **删除** `board.phase` 段(原本纯为 `/goal` 服务)。顺带消灭 Finding #5(`goal_condition` 的 `}`/`"`
   静默截断 footgun)、再减 Finding #7(信息过载)。

### 硬约束(不可破)

- hook 纯 bash,**无 jq/node**,ship-anywhere(含 Bedrock/Vertex/Foundry)。
- hook **读不了对话/目标语义**,只读 board + stdin。语义自检只能由 agent 做;hook 只「逼它做 + 用 board 把门」。
- **已知残留极限**:hook 防不住 agent 自检走过场(语义敷衍)。这是确定性 hook 的天花板;本期不补
  native `/goal` 语义兜底(用户未选该层),后续可由用户持有 `/goal` 补。
- 确定性骨架现有 46 条测试中,与本变更无关者**必须保持全绿**。

---

## 一、goal-hook —— `verify-board.sh` 升级

### 1.1 输入与 session 过滤(根治 Finding #4)

- Stop hook 的 stdin 是 JSON(含 `session_id`)。现状 `cat >/dev/null` 丢弃;改为读入后用纯 bash 提取:
  ```sh
  input="$(cat)"
  sid="$(printf '%s' "$input" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
  ```
- 判定**只针对** `owner.session_id == $sid` 的 active board(不再扫全 home 误伤别人的并发编排)。
- **退化防御**:若 `$sid` 为空(stdin 无 session_id)→ 退回现状语义(遍历全 home 的 active board),保证不崩。

### 1.2 判据(只读 board 的 `status` enum 分布,不重建 deps 图)

deps 满足性由 agent 维护 board 时负责(满足未派标 `ready`、未满足标 `blocked`),hook 只读结果状态:

| 本 session 的 active board 状态 | 决定 |
|---|---|
| 不存在(无匹配 active board) | **allow**(dormant) |
| 空(`tasks` 计数为 0) | **block**(现状:DAG 没填) |
| 含 `"status":"ready"` 或 `"status":"uncertain"` | **block**(还有就绪活 / 待验产出) |
| 否则(全 `in_flight`/`blocked`/`done`/`failed`/`escalated`/`stale`) | 进入**自检握手**(§1.3) |

- task 计数沿用现状的 `grep -cE '"id"[[:space:]]*:'`(对 log/note 文本鲁棒,且 `|| tc=0` 在 `$()` 外)。
- status 检测:`grep -qE '"status"[[:space:]]*:[[:space:]]*"ready"'`、同理 `"uncertain"`。
- `blocked_on:"user"` 与 `blocked_on:"<taskid>"` 都属「等」,**不**触发 block。

### 1.3 自检握手(兑现「想停时逼自检」)

完成态不直接放行,先逼 agent 对照 `board.goal` 自检一次。状态存于 **sidecar 文件**(hook 自己写,**绝不碰
board** —— board 仍是 agent 单一真相源):

- 路径:`$HOME_DIR/.<sid>.stopcheck`(`$sid` 为空时用 `.nosession.stopcheck`)。
- 内容:一行两个整数 `<block_streak> <selfcheck_done>`(无文件视为 `0 0`)。

完成态分支逻辑:
- `selfcheck_done == 0` → **block** + 注入自检清单(见下),写回 `selfcheck_done=1`。
- `selfcheck_done == 1` → **allow**(agent 已被逼自检过、仍判完成)+ 清除 sidecar。

自检清单(block 的 `reason` 文案,注入给 agent):
> cc-master: before you stop, self-check against this board's `goal`. (1) Is every point that needs the
> user surfaced / marked `blocked_on:"user"`? (2) Against the **original goal**, is every to-do actually
> done — including any NOT yet listed on the board? If something is missing, add it to `tasks[]` and keep
> going; only stop once the goal is truly met.

**握手重置**:任何「有 actionable(ready/uncertain)」分支触发时,把 `selfcheck_done` 归 0(又有活了,
下次完成态需重新自检)。

### 1.4 fuse(防误判死循环)

- 每次 hook 输出 **block** 时 `block_streak++`;每次 **allow** 时清除 sidecar(streak 归 0)。
- `block_streak >= FUSE`(常量,默认 `5`)→ 强制 **allow** + reason 警告:
  > cc-master: fuse tripped — blocked N times in a row. Releasing the stop. If you are stuck, check the
  > board for a `ready` task that cannot actually proceed (mark it `blocked`/`escalated`) before continuing.
- 防 hook 误判把 agent 永久焊死。FUSE 远大于正常握手轮次(1–2),正常流程不会触发。

### 1.5 输出格式(不变)

- block:`{"decision":"block","reason":<json-escaped string>}`(沿用现状的 sed 转义函数)。
- allow:`exit 0`(无输出)。

### 1.6 行数预算

`verify-board.sh` 从 36 行 → 约 75–90 行,仍纯 bash、零外部依赖。

---

## 二、`/goal`·`/loop`·`phase` 拔除清单(按文件)

> **不动**:`skills/authoring-workflows/` 全部 —— 其 `loop-until-*` 是 workflow 范式、`phase` 是 workflow
> 进度组 API,与 native `/loop`·`/goal` 无关。

| 文件 | 处理 |
|---|---|
| `commands/as-master-orchestrator.md` | 删第 4 步(L17–23 整个 phase `/goal` 段) |
| `skills/.../SKILL.md` | 删红线第 6 条(`/goal`);改 step-3 去「set a phase `/goal`」子项;**改 step-6 ledger**:去「native `/goal` evaluator reads only the conversation」措辞→改成「goal-hook 会读 board 把门;每回合把 step-6 结论 + 验收证据写进对话与 board」;删 soul-formula 段;删 board 协议的「`phase` flexible edge」段 |
| `references/async-hitl.md` | **删整个「Phased self-driving with native `/goal`」章节**(L64–120);保留前面的 async/HITL 正文。可补一小段「goal-hook:Stop 时逼自检 + board 把门」指向新机制 |
| `references/board.md` | 删 `phase` edge 段(L71–90);从 flexible edges 列表移除 `phase`;**修 Finding #9**:`wip_limit` 统一归 flexible(删 pinned 段括注里的 `wip_limit`) |
| `references/dispatch.md` | 删「`/goal` = TFU」引用块(L63–66);「background shell, not `/loop`」段精简成「用后台 shell 等外部状态」,去掉 `/loop`·`ScheduleWakeup` 对比(**修 Finding #8** 顺带) |
| `hooks/scripts/reinject.sh` | 删 phase 提取(L26–37)与 `/goal` 注入文案(L43–45);phase_note 整体移除 |
| `hooks/scripts/bootstrap-board.sh` | 删 fallback JSON 里的 `phase` 段(L28) |
| `assets/board.template.json` | 删 `phase` 段(L7) |

- **保留**:board 的 `goal` 字段(命根子,hook 自检对照基准)、decision-program 的 loop/fuse 等普通词。
- `design_docs/`(spec/design-notes/native-goal-loop-integration):历史记录保留,加一句「`/goal` 方案已被
  goal-hook 取代(见本 spec)」的演进说明,不硬删历史。

---

## 三、测试契约(TDD —— 先 Red 再 Green)

### 3.1 `tests/hooks/test_verify-board.sh`(改 + 增)

保留(不变契约):
- 无 active board → allow(exit 0,无输出)。
- archived-only(active:false)→ allow。
- 空 active board → block。

**改**(旧「有 task → allow」升级为新契约):
- active board 有 `ready` task → **block**。
- active board 有 `uncertain` task → **block**。

**增**(新契约):
- 全 `in_flight`/`blocked`/`done` 且 sidecar 无标记 → **block**(自检握手首次,reason 含自检清单关键词)。
- 同上但 sidecar `selfcheck_done=1` → **allow**。
- session 过滤:home 有两块 active board,只有「`owner.session_id` ≠ stdin sid」的那块是空 → 当前 session
  **allow**(不被别人的空 board 误伤)。← 直接验 Finding #4 修复。
- stdin 无 session_id → 退化为全 home 扫描(不崩)。
- fuse:连续 block 到 `block_streak>=FUSE` → 强制 allow + 警告关键词。
- 测试需能 mock stdin(传入含/不含 `session_id` 的 JSON)与 sidecar 初始内容;每个 case 用独立临时 home,跑完清理 sidecar。

### 3.2 `tests/hooks/test_reinject.sh`(删 phase 相关)

- 删 Case E/H/I 等针对 phase 注入/提取的断言(phase 已移除)。
- 保留/调整:role 重注、goal 列举、无 active → 静默、archived 忽略。
- 加一条:board 即便残留 `phase` 字段(老 board)也**不再**注入 phase note(向后兼容,不报错)。

### 3.3 内容契约测试(Node)

- 若有断言 board.template/bootstrap 含 `phase` 段的,改为断言**不含**。
- `claude plugin validate .` 仍须通过。

### 3.4 总验收

`bash run-tests.sh` 全绿;`claude plugin validate .` 通过。

---

## 四、验收标准

1. `verify-board.sh` 实现 §1 全部判据 + 握手 + fuse + session 过滤,纯 bash 无 jq/node。
2. §2 拔除清单全部完成;全仓 `grep -rn '/goal\|phase /goal\|goal_condition\|ScheduleWakeup'`
   在 `commands/`+`skills/orchestrating-to-completion/`+`hooks/` 下**零命中**(authoring-workflows 不计)。
3. `board.goal` 字段、authoring-workflows 的 loop/phase **完好无损**。
4. §3 测试全绿;`claude plugin validate .` 通过。
5. 顺带收口:G2 遗留(补 CoC/SECURITY、核 README B 方案、CHANGELOG/CONTRIBUTING 调整)、G3 遗留
   (staged-escalation 的 model id → `claude-opus-4-8`)—— 归入 D2/Phase 2,不阻塞 goal-hook 本体。

---

## 五、实现分解(P2 子任务 + single-writer 协调)

文件重叠分析:goal-hook 改 `verify-board.sh` + 其测试;拔除改 `reinject.sh`/`bootstrap`/`template`/
command/SKILL/references + reinject 测试。**两者文件不重叠**,可并行;但都动 `tests/` 与都属确定性骨架,
按 single-committer:各 sub-agent 写文件 + 自证测试绿,**不 commit**,orchestrator 端点验收后统一 commit。

- **P2-a 〔goal-hook 本体〕**:TDD 实现 `verify-board.sh` 升级 + `test_verify-board.sh`(先 Red 后 Green)。
- **P2-b 〔拔除 /goal·/loop·phase〕**:按 §2 清单改文档 + `reinject.sh`/`bootstrap`/`template` + 删
  `test_reinject.sh` 的 phase 断言。
- **P2-c 〔收口〕**:G2/G3 遗留 + design_docs 演进说明 + 全仓 grep 零命中校验 + `run-tests.sh` 全绿 +
  `claude plugin validate .`。依赖 P2-a、P2-b。
- 最终 orchestrator 端点验收 → Phase 3(commit/PR,需 HITL)。
