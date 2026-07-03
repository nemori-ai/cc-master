# cc-master × 原生 `/goal`·`/loop` 整合设计

**日期**：2026-06-08
**状态**：设计定稿（待用户复审 → writing-plans）
**性质**：在既有 cc-master plugin 之上的增量整合设计——**复用 Claude Code 原生机制,不重造轮子**。
**关联**：现有 `design_docs/spec.md`（plugin 主 spec）；本设计是对其 §5(hooks)/§7(决策程序)/§12(有意排除) 的增量修订。

> ⚠ **/goal 集成方案已被 goal-hook 取代**（agent 无法自设 native `/goal`；改由 verify-board 升级为确定性 Stop-hook 自检闸）——见 `design_docs/2026-06-08-goal-hook-design.md` 与 `dogfood-findings.md` #2。本文档保留作历史留痕。

---

## 1. 动机

cc-master 当初的研究基线评估过 `/loop`(决定用 board 任务循环替代)、明确排除过 scheduled routines / agent-teams,**唯独漏评了原生 `/goal`**。本次调研发现 `/goal` 与 cc-master 的核心机制高度同构,值得正面整合:**让 plugin 站在原生机制肩上,而非平行重造**。

一句话目标:用原生 `/goal`·`/loop` 与 cc-master **互补**——原生补"何时算干完 / 何时醒来",cc-master 守"做什么 / 怎么拆 / 怎么并行"。

---

## 2. 调研结论(设计依赖的事实基线)

> 标注 **[确证]**(来自官方文档调研)与 **[待实测]**(impl 期 5 分钟 smoke-test 复核,延续 cc-master "确认事实 vs 内部未知"两分文化)。

### 2.1 `/goal`(完成条件机制)

- **[确证]** `/goal <完成条件>` 设一个完成条件;每个 turn 结束,一个**独立小模型**(默认 Haiku)读"条件 + 至此对话"判 yes/no,**no 则自动续 turn**并把理由作为下一 turn 指导,**不交还控制权**。`/goal` 查看状态,`/goal clear` 清除。
- **[确证]** 本质 = 一个 **session 作用域、prompt-based 的 Stop hook 的 wrapper**。
- **[确证]** **跨 compaction 保持活跃**;**跨 `--resume` 恢复**(但 turn/timer/token baseline 重置)。
- **[确证]** **每会话仅一个 goal**,新 goal 覆盖旧;条件 ≤4000 字符,可含 `or stop after N turns/hours` 这类 **or 子句**。
- **[确证]** 评估器**只读对话,不会自行读文件系统、不调工具**。→ 凡要它据以判断的东西(验收证据、决策程序自查),agent **必须显式呈现在对话输出里**它才看得到。
- **[确证]** 需 hooks 系统启用(`disableAllHooks` 时不可用);需 v2.1.139+。
- **[确证]** **hook/plugin 不能编程式设 `/goal`**——只能由 agent 主动敲命令(LLM 中介)。→ `/goal` 这层只能是 **best-effort 增强,不能进确定性兜底**。
- **[待实测]** 多个 Stop hook(cc-master `verify-board` + `/goal` 内部 Stop)的**仲裁机制**:同时 block / allow 如何合并、执行顺序。
- **[待实测]** 评估器能否看到对话中 agent 贴出的文件内容/命令输出(预期:能,因其在对话内)。
- **[待实测]** 非交互 / Bedrock·Vertex 等环境下 `/goal` 的可用性(影响 best-effort 定位的边界)。

### 2.2 `/loop`(循环执行机制)

- **[确证]** 内置 bundled skill。固定间隔底层用 **CronCreate**(cron 表达式);动态自步调底层用 **ScheduleWakeup**(模型自定下次唤醒)。会话作用域,**7 天过期**,跨 compaction 存活、跨 resume(7 天内)恢复。
- **[确证]** 动态模式(ScheduleWakeup)**Bedrock / Vertex / Foundry 不支持**;固定间隔依赖 cron 调度。→ 撞 cc-master 的 **ship-anywhere** 硬约束。

### 2.3 与 cc-master 的重叠 / 缺口

| 维度 | `/goal` | `/loop` | cc-master board+方法论 |
|---|---|---|---|
| 概念定位 | 时间轴"何时算干完" | 时间轴"何时醒来看外部" | 空间"做什么/怎么拆/怎么并行" |
| 与 cc-master 关系 | **一处真重叠**(目标记忆/防过早停) | 基本正交 | 原生完全空白,不可替代 |
| 致命短板 | 单条件无 DAG;评估器读不到文件;会**锁死 HITL** | 7 天过期;非 ship-anywhere | —— |

**结论:三者近乎正交,互补 > 替代。** 唯一真重叠(目标记忆 / 防过早停)用"主动叠加"方式处理——见 §3。

---

## 3. 设计决策

### 3.1 整合力度 = 主动叠加(locked)

cc-master 确定性骨架(3 hooks + board + bootstrap 三层兜底)**一根不动**;在其之上**主动**叠加 `/goal`(bootstrap 即引导),`/loop` 用已有积木消解。既"充分利用"原生,又不破坏 cc-master 的确定性保证。

### 3.2 `/goal` = 分阶段自驱发令枪(locked)

`/goal` 有一处致命副作用:**只要 goal 活着,agent 就被自动续 turn、无法停下来问用户**——一个"端到端全程 goal"会把 cc-master 第 7 镜头(该问就问、前台∥后台)和整个 HITL 模型活活架空。

解法是给 goal 找到正确粒度:

> **一个 goal 的生命周期 = 一段「无需 HITL 的自驱区段」。**

这与 cc-master 的 DAG 天然咬合——`blocked_on:"user"` 决策节点本就把 DAG 切成若干自驱区段:

- **阶段内**(到下一 HITL 边界前)= 纯自驱,挂阶段 goal,逼 agent 啃到底、别半途撒手;
- **阶段边界** = HITL 点 = goal 已达成并清除 = agent 正常停下来问用户;
- 用户答完 → 进下一区段 → agent **有感知地**再设下一个阶段 goal。

goal 从"全程枷锁"降级为"分段冲刺的发令枪",HITL 在段缝里得以呼吸。

### 3.3 灵魂公式(核心机制,locked)

阶段 goal 的完成条件统一收敛为:

> **阶段 goal 条件 = 「本阶段业务终态达成」 ∨ 「本阶段已进入正当等待」**
>
> 其中"正当等待" = 决策程序第 6 步判据:*所有剩余路径都阻塞在 in-flight 后台任务、或已抛给用户待答*(HITL 是其子集)。

一箭三雕:

- **防过早收工**——阶段没干完、还有 ready 活/未验节点却想停 → 两分支皆不满足 → 独立裁判把 agent 踹回去干。这正是 `verify-board.sh` 软纪律想要、Stop 机制却做不到的"硬防 idle 偷懒"。
- **不困死 HITL**——撞到必须用户拍板的点 → 落入"正当等待(待用户答)" → 放行,停下来问。
- **不困死后台等待**——所有路径都在等 in-flight 后台 → 落入"正当等待(等后台)" → 放行,安心 yield。

**净效果:`/goal` 把第 4 镜头"罪在能动却被动空等,不在 idle"——全套体系最难自律的一条——从软纪律升级为独立模型执行的硬约束。** agent 只在"该动却想偷停"时挨踹,正当等待一律放行。

**配套前提(必须落地)**:agent 每回合收尾跑决策程序时,**把第 6 步自查结论 + 阶段验收证据显式写进对话**(顺带落 board),裁判才有据可判"正当等待 vs 偷停"。这与"每回合收尾跑决策程序"严丝合缝,只是要求把结论说出口。

**goal 条件写法示例**:

```
/goal "auth 模块迁移完成且 test/auth 全绿(本回合已贴测试输出佐证)
        或 本阶段所有剩余路径均阻塞于 in-flight 后台或已抛给用户待答(本回合已输出决策程序第6步自查)
        —— 二者居一即停"
```

### 3.4 跨 compaction 的阶段感知(locked)

`/goal` 跨 compaction **保持活跃**(只有跨 `--resume` 才重置 timer)——即便 agent 压缩后忘了身份,挂着的阶段 goal 仍在逼它啃当前段,**goal 反替 cc-master 扛了一道 compaction**。

为让 agent 认回"我在冲哪段",board 柔性边新增 `phase` 段 `{ current, goal_condition, task_ids }`(`current` 阶段名 + `goal_condition` 阶段 goal 条件原文 + `task_ids` 本阶段 task 范围)。`reinject.sh` 重注时带出,提醒 agent:认回阶段、核对 goal 是否还挂着;**若 goal 丢了则按 board 记录的条件重设**(hook 读不到 goal 状态,只能提醒 agent 自核)。这是 cc-master "board 扛 compaction"既有套路的自然延伸。

### 3.5 `/loop` = 后台 shell 消解(locked)

cc-master 是事件驱动(后台一完成,harness 自动唤醒重入),**不需要定时轮询**。`/loop` 唯一真场景(等 harness 追踪不到的外部状态:CI / 远程队列 / 审批超时)用 cc-master **已有**的"后台 shell"机制吃掉:

```bash
until <外部状态就绪>; do sleep 60; done   # 丢进 run_in_background,完成后 harness 通知重入
```

更贴事件驱动、完全 ship-anywhere。**连 `/loop`/`ScheduleWakeup` 都不引入**——把需求消解回已有积木,真正兑现"不重造轮子"。

---

## 4. 落地改动清单(按文件)

> 改动面小结:**真正动代码只有 3 处半**(`reinject.sh`、`board.template.json`、`test_reinject.sh`,加 `bootstrap-board.sh` 的 fallback 骨架可选捎带 `phase`);`verify-board.sh`、`hooks.json`、bootstrap 三层兜底**一律不碰**。其余皆为 skill/command 方法论文字。

### 线一:`/goal` 分阶段叠加

| # | 文件 | 性质 | 改什么 |
|---|---|---|---|
| 1 | `commands/as-master-orchestrator.md` | 文档 | bootstrap 指引加「分阶段自驱」段:每个自驱区段起点主动设阶段 goal(灵魂公式),撞边界清 goal→问用户→设下一段。标明 **best-effort 增强**,不进确定性兜底。 |
| 2 | `skills/master-orchestrator-guide/SKILL.md` | 文档 | ① 决策程序补「识别自驱区段 → 起点设阶段 goal → 第 6 步结论+验收证据显式落对话与 board」;② 七镜头/红线加 goal 纪律:**goal 是分段发令枪非全程枷锁,条件必带正当等待逃生口**;③ board 协议要点提 `phase` 段。 |
| 3 | `skills/master-orchestrator-guide/references/async-hitl.md` | 文档 | 写透 goal × HITL 咬合:阶段边界=HITL 点=goal 清除点;逃生口=正当等待判据;两个 Stop hook 相容性(见线三)。 |
| 4 | `skills/master-orchestrator-guide/references/board.md` | 文档 | `phase` 柔性边 schema `{ current, goal_condition, task_ids }`。 |
| 5 | `hooks/scripts/reinject.sh` | **动代码** | 重注文案加:读 board `phase.current` / `phase.goal_condition`,认回阶段、核对 goal 是否还挂着;goal 丢了则按 board 记录条件重设。 |
| 6 | `skills/master-orchestrator-guide/assets/board.template.json` | **动代码** | 加 `phase` 字段骨架。 |

### 线二:`/loop` 后台 shell 消解

| # | 文件 | 性质 | 改什么 |
|---|---|---|---|
| 7 | `skills/master-orchestrator-guide/references/dispatch.md` | 文档 | 「三机制 · shell」加范式:等外部不可追踪状态 → 后台 shell 轮询(`until …; do sleep N; done` + `run_in_background`)靠完成通知重入。点明 **别用 `/loop`/`ScheduleWakeup`,理由 ship-anywhere**。 |

### 线三:相容性 + 决策留痕

| # | 文件 | 性质 | 改什么 |
|---|---|---|---|
| 8 | `hooks/scripts/verify-board.sh`、`hooks.json` | **不动** | 文档说明:cc-master Stop hook 与 `/goal` Stop 评估**并存且方向相容**(都倾向"继续干";空 board 时不会有 goal,不打架)。**[待实测]** 多 Stop hook 仲裁。 |
| 9 | `design_docs/spec.md` + `design-notes.md` | 留痕 | §12 更新:`/goal` 从"未评估"→**纳入**(分阶段叠加);`/loop` 仍不直接引入(shell 消解),理由 ship-anywhere。§10 补 `/goal` 机制事实 + 两 Stop hook 相容。 |
| 10 | `tests/hooks/test_reinject.sh` | **动代码(测试)** | 补断言:含 `phase` 段的 board 被重注时输出带阶段提醒。(board 模板加字段,捎带核 bootstrap test。) |

---

## 5. 相容性:两个 Stop hook 并存

会话里将同时存在两个 Stop hook:cc-master 的 `verify-board.sh` 与 `/goal` 的内部评估。二者方向相容:

- `verify-board`:仅"空 active board"时 block,否则放行。
- `/goal`:阶段 goal 未达成(且未进正当等待)时令 agent 续 turn。
- **不冲突**:空 board 时根本不会有 goal(goal 是 agent 填完 DAG、进入自驱区段后才设的);board 非空时 `verify-board` 放行、由 `/goal` 接管"该不该停"。
- **[待实测]**:多 Stop hook 的合并/顺序须 impl 期实测确认(若任一 block 即 block,则二者并存安全)。

---

## 6. 有意排除 / 取舍留痕

- **不让 `/goal` 接管确定性兜底**:hook 设不了 goal(LLM 中介),`/goal` 只能 best-effort;cc-master 的 bootstrap 三层兜底 + `verify-board` 硬 block 仍是确定性骨架。
- **不引入 `/loop`·`ScheduleWakeup`**:7 天过期 + 非 ship-anywhere;外部等待用后台 shell 消解。
- **goal 不锚 board 镜像**:评估器读不到文件,锚"board 全 done"会沦为橡皮图章 + 逼 agent 刷屏;改锚"业务终态 ∨ 正当等待",证据须呈现在对话。
- **goal 不做端到端全程**:会锁死 HITL;改分阶段。

---

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| agent 不设 goal(best-effort 落空) | cc-master 原决策程序软纪律 + `verify-board` 兜底仍在,功能不退化;goal 是增益非依赖。 |
| 评估器误判"正当等待"放水 → 提前撒手 | 红线"不擅专 + 该问才问"约束;要求自查结论显式落对话,误判面收窄;**[待实测]** 校准。 |
| 多 Stop hook 仲裁未知 | impl 期 smoke-test 优先验证(§2.1 待实测项)。 |
| goal 逃生口 or 子句评估器识别不稳 | 条件写法标准化(§3.3 示例);impl 期实测评估器对 or 分支的判定。 |

---

## 8. 验收("done" 长啥样)

- bootstrap 后,agent 能在第一个自驱区段起点主动设出**符合灵魂公式**的阶段 goal(含正当等待逃生口)。
- 阶段内有 ready 活却想停 → 被 `/goal` 踹回;撞 HITL / 全员等后台 → 正常放行 yield/问用户。
- compaction 后 `reinject` 带出 `phase`(`phase.current`),agent 认回阶段、续编排不丢角色。
- 外部等待场景,agent 用后台 shell 轮询而非 `/loop`。
- `verify-board.sh`/`hooks.json`/bootstrap 骨架零改动;三处半代码改动各有测试覆盖。
- §2 全部 **[待实测]** 项在 impl 期 smoke-test 通过或据实修正设计。

---

## 9. 二审收口(2026-06-08)

落地后经两路**独立对抗二审**(codex 独立诊断 + 对抗 reviewer)**双签**命中 `reinject` 一组健壮性 BLOCKER(全文件 sed 提取 → 杂散同名键捏造假阶段 / 取错值 / 转义截断)——正是主线程与落地 sub-agent 同源盲区漏掉的。已 **TDD 修复**:纯 bash 锚出 `"phase":{...}` 对象、只在其内提取(根治误匹配 + 取错值 + 多行,守住 ship-anywhere 零依赖);转义截断靠 §4 线一 `board.md` 约定 `goal_condition` 用纯文本(不含裸 `"`/`}`)兜底。补红测试 Case G/H/I。

随附 should-fix:多 board × 单 `/goal` 改单数绑定(reinject 文案 + `async-hitl.md`);段中突发 HITL 文档澄清(`surface ≠ stop`,非 bug);step-6 **结构化 ledger** 格式(让 OR 逃生口可被评估器机械判定)。一项**既有缺陷**(`verify-board` 跨 session 误伤,非本次引入)记 **backlog**。

完整处置链与取舍见 `design-notes.md §14`。本节为设计文档与实现的对齐留痕。
