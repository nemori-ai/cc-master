---
name: dev-as-ml-loop
description: 'Use when dev work should be run as an ML-style optimization loop, either by a master orchestrator shaping dev-task handoffs/subagent roles or by an execution agent driving one task to acceptance —— 当你要把开发工作当成优化过程来跑:master orchestrator 用它设计外层 dev loop/objective/measurement/subagent 组件分工/restart-stop/board ledger 语义,执行 agent 用它把单个开发任务推进到验收。心智锚:验收=目标函数、loop=迭代优化(提议→测量→调整)、测试=测量仪器/梯度、explore vs exploit、局部最小值=钻牛角尖→restart、收敛即停别过拟合、拟合意图非用例、简单性=正则、持续用 board 维护优化状态以便 compact 后续接。Triggers: 派发或接手 dev 任务、要把 work order 改造成可测优化问题、要设计 subagent 分工/测量/验收/重启条件、要用 board 管理优化目标和迭代状态、compact 后续接 dev loop、卡住在一个方案上越改越深(钻牛角尖)、怎么判断"做完了"、要不要先写测试/测量、要不要换方案。Do NOT use when 你在决定顶层该编排什么 / WIP / 临界路径 / HITL / 配额(master-orchestrator-guide)、怎么把目标切成任务 DAG(slicing-goals-into-dags)、怎么用 ccm 写 board(using-ccm)、workflow 脚本怎么写(authoring-workflows)。'
---

# dev-as-ml-loop —— 把 dev loop 当成一个 ML 优化过程

这是给 **master orchestrator** 和 **执行 agent** 共享的开发心智模型:开发不是"一次性把代码写对",是一个**优化过程**——有目标函数、有测量、有迭代、有收敛。orchestrator 不亲手写代码,但仍在 dev loop 里:你负责外层优化系统的目标、测量、subagent 组件分工、重启/停机语义;执行 agent 负责单任务内层下降。换上这副框架,你推进 dev 的方式会变。

**职责边界(各 skill 互不重叠):** 本 skill 给 dev 工作的**优化心智**:外层帮助 orchestrator 把 dev task 交付成 objective / measurement / artifact / restart-stop / board ledger 语义,内层帮助执行 agent 把一个任务优化到验收。顶层调度 / WIP / 临界路径 / HITL 仍归 `master-orchestrator-guide`;目标切成 DAG 归 `slicing-goals-into-dags`;board 写入命令与字段规则归 `using-ccm`;循环里的 DDD/OOP/SDD/TDD 手艺内容归 `engineering-with-craft`。

---

## 核心论题:dev work 本质是在跑一个优化过程

每一轮 propose 一个改动、跑一下、看结果、再调——这不是"试错",这是**带测量的迭代优化**:目标函数是验收标准,每一轮在缩小"当前状态 ↔ 验收"的距离,直到收敛(验收达标)。**「一次性想清楚、写一大坨、跑一次祈祷它对」是非优化思维**——它放弃了每一轮本可拿到的梯度信息。下面八个命名锚,是这套优化框架的词汇表;它们一起换掉"线性把活干完"的默认心智。

## 两尺度 dev loop:外层编排,内层下降

同一套优化语言在两个尺度上工作:

- **外层 loop(master orchestrator)**:你不写代码,但你定义/锐化 objective,确保测量仪器存在,把 subagents 分配到不同优化组件,调 explore/exploit,识别 plateau 并 replan/restart,在收敛时验收并停机。你拥有的是优化系统,不是实现细节。
- **内层 loop(执行 agent)**:你拿一个带验收标准的任务,陈述当前 hypothesis,做最小有用改动,测量,读梯度,调整/重启/停机。

坏 handoff 把 dev task 写成一句 work order;好 handoff 把它写成可优化问题:objective 是什么、instrument 在哪、artifact 是什么、哪些约束不可碰、何时 stop/restart、哪些优化状态必须持续写回 board。长程任务的外层 loop 要有一份 optimization ledger:目标函数、当前 hypothesis、测量读数、plateau / restart 判断、下一步 probe。compact 是机械动作,你通常只能在 after compact 后感知;所以不要等某个"压缩前时机",而是在工作过程中持续用 board 管住这些信息。怎么用 board 承载这份 ledger,见 [references/optimization-ledger.md](references/optimization-ledger.md)。

## subagents as ML components

派发前先问:这个优化系统缺哪个组件,而不只是"谁来写代码"。

| 组件 | subagent 负责什么 | 典型产物 | 防什么失败 |
|---|---|---|---|
| objective owner | 锐化验收、非目标、真实意图 | acceptance/spec delta/decision_package | 目标模糊下随机游走 |
| instrumentation builder | 建测试、repro、fixture、benchmark、endpoint check | failing test/repro/验证命令 | 闭眼优化或假梯度 |
| hypothesis generator | 探方案、spike、架构备选 | option memo/spike result | 过早 exploit 一条路 |
| optimizer | 做 scoped implementation | patch/diff/artifact | 没有下降 |
| evaluator | 独立端点验收、读 diff | verification transcript/hash | self-report pass-through |
| regularizer | 查复杂度、抽象、依赖、gold-plating | simplification/risk note | green 但长期负债 |
| restart trigger | 识别 plateau、坏仪器、沉没成本 | replan/split/reassign note | 补丁栈局部最小值 |

这些不是每个任务都必须配齐的岗位,而是一套调度词汇。简单任务一个执行 agent 可兼多职;复杂/高风险任务要显式拆出测量、探索、验收、正则化职责。

---

## 心智锚 1:验收标准 = 目标函数(objective / loss)

整个 loop 只有一个朝向:**最小化"当前实现 ↔ 验收标准"的距离**。所以第一件事永远是**把目标函数看清楚**——这个任务的验收标准(DoD)到底是什么、怎么测。

- 验收**清晰**(board 的 `acceptance` 字段就是这个"两态 objective function"):直接拿它当 loss,对着它优化。
- 验收**模糊 / 缺失**:先把它**锐化成可测的**(找 benchmark、定指标与目标值、跟编排者确认),**再**开始优化。**没有明确 objective 的优化是随机游走**——你会在一个没有 loss 的空间里乱走,改半天不知道在不在变好。模糊就先锐化,别带着模糊的目标硬下降。
- 对 orchestrator 来说,模糊验收不是"派给强 agent 让它自己理解"——那是在把 loss function 外包给 worker。先派 objective owner / 问用户 / 写 spec delta,再派实现。

> **board 接地**:这个目标函数就是 board task 的 `acceptance` 字段(一句话 DoD 或 `{criteria:[…]}`)。开工先读它;空/糊则锐化是第 0 步,锐化后用 `using-ccm` 把新 DoD 落回 board、让目标函数对编排者也显式。

---

## 心智锚 2:dev loop = 迭代优化,不是一次成型

**propose 改动 → 测量 → 读梯度 → 调整 → 重复。** 小步、每步测量,优于"写一大坨再跑"——后者等于一步迈到谷底、放弃了沿途所有方向信息。每一轮的产出不是"更多代码",是"更小的 loss + 一点关于下一步往哪走的信息"。

把每一轮当成一个可证伪 hypothesis:"我相信改 X 会因为 Y 降低 loss。"然后做最小有用干预并测量。说不出 hypothesis 却继续写代码,通常是在用 churn 假装优化。

---

## 心智锚 3:测试 / 检查 = 你的测量仪器(梯度的来源)

没有测量,优化就是闭眼下山。**先架好仪器,再下降**——这正是 TDD 的优化学解读:先写验收 / 测试 = 先把目标函数和测量装置摆好,之后每一步都有读数。

- 一次**失败不是噪声,是梯度**:它精确告诉你"哪里、往哪个方向调"。**读懂这次失败** > 盲目再改一版。
- 测不了的东西优化不了。任务里若有"说不清怎么测"的验收维度,那一维你是闭眼的——把它变可测,或显式标注它没法机械验收(留给人验)。
- 先校准仪器,再相信梯度:flaky test、错 endpoint、mock-only 检查、过期 fixture、不可复现失败,都会给你假梯度。TDD 的红绿铁律和 constraint parity 怎么做,见 `engineering-with-craft`;本 skill 只讲它们在优化 loop 里的位置。

---

## 心智锚 4:explore vs exploit(调你的学习率)

- **早期(不确定高)→ explore**:用 spike / 草稿试几个方向,大步长、容忍粗糙,目的是**学到地形**(哪条路通)。explore 必须买到信息:一个 spike 若不降低不确定性,就是随机游走。
- **接近验收(方向已明)→ exploit**:精修、小步长、收尾细节。
- 反模式:**过早 exploit**——一上来就死磕打磨一个还没验证能通的方案。先确认这条路下得去,再精修。
- orchestrator 视角:早期可并行派 hypothesis generator / instrumentation builder;接近收敛时收紧到 optimizer + evaluator。explore/exploit 是调度与模型档位策略,也是执行 agent 的步长策略。

---

## 心智锚 5:局部最小值 = 钻牛角尖;解药是 restart / 换方向,不是再下降

当一个方案 **plateau**(你改了又改,loss 却不再真正下降、离验收还差得远)——你陷在一个**局部最小值**里了。此刻"沿同一条沟再走几步"(给补丁打补丁、再 tweak 一下同一个方案)是错的;正确动作是**退一步、换一个方案 restart**(从不同起点重新下降)。

识别自己卡在局部最小值的信号:
- 连续几轮改动**没有真正缩小与验收的距离**(只是换了种方式失败)。
- 你在**给同一个方案的补丁打补丁**,栈越来越深。
- "再改一下就好了"已经说了第三遍。
- 你说不出当前 hypothesis,只能描述"还在修"。
- 测量结果互相矛盾,但你没有先修 instrument。

**这就是"钻牛角尖"的优化学本质**——不是道德缺陷,是**没识别出该 restart 的时刻**。把它当成"该调高学习率 / 换初始点"的信号,而不是"再坚持一下"。沉没成本(已经在这个方案上花了很多)是**局部最小值的引力**,不是继续的理由。

orchestrator 的 restart 不只是一句"继续试":可以换 hypothesis、拆小任务、派 instrumentation builder、换 evaluator、重切 acceptance、或把失败路径记成 artifact。重启是优化动作,不是失败遮羞。

> **board 接地**:换方向不是"失败收场"、它是 board 状态机里的一档,显式记下来比闷头死磕诚实得多。别把"该 restart 的时刻"硬扛在 `in_flight` 里假装还在下降;用 `using-ccm` 选择正确状态转移,并把失败路径 / 新 hypothesis / 下一步 probe 写进 optimization ledger。

---

## 心智锚 6:收敛 = 验收达标即停,别过拟合

loss 到 0(验收每一条都绿)= **收敛,停**。继续"优化"就是**过拟合**:

- **gold-plating**:优化验收**没要求**的维度(把不在目标函数里的东西做到完美)——这是在拟合一个不存在的 loss。
- **拟合噪声**:为了过某几个特定检查去 hard-code / 特判,而非满足底层意图(见锚 7)。

判断"做完了"的唯一标准是**目标函数达标**,不是"代码我看着舒服 / 还能更完美"。"完美"不是验收里的词。

orchestrator 视角:绿灯只是训练读数,端点验收才是 validation。若 acceptance 已满足,继续扩大抽象/补非目标功能就是 overfitting,除非你显式改变 objective 并让用户/board 接受它。

> **board 接地**:收敛要写成 `done + verified + artifact` 的组合语义——`verified` 这一位表示"loss 真到 0、端点测过",**不是**"我觉得差不多了"(呼应 `master-orchestrator-guide` 的 gate-green≠passed)。loop 跑了一半、"做了但还没确认收敛"是 `uncertain` 这一档 status,**不是** `done`——别把未测的当收敛标出去。命令见 `using-ccm`。

---

## 心智锚 7:拟合意图,别拟合用例(过拟合 vs 泛化)

让实现满足验收**背后的真实意图**,而不是表面骗过那几个检查点。**hard-code 让测试变绿 = 过拟合**:在训练样本(那几个测试用例)上 loss=0,泛化能力=0(真实输入一来就崩)。问自己:我是真解决了这个问题,还是只拟合了验收的几个采样点?

---

## 心智锚 8:正则化 = 简单性先验

在**同样满足目标函数**的多个方案里,选**最简单**的(最小改动、最少新概念、最少新依赖)。复杂度是目标函数没奖励、却要长期偿还的成本——简单性是你的正则项,防止"为复杂而复杂"的过拟合。(这与 `slicing-goals-into-dags` 的"薄增量"同源:小而简,在切分层和执行层都是正则。)

工程手艺是 regularization 的来源:SDD 把 objective 固成契约,DDD/OOP 缩小坏模型空间,TDD 保证 instrument 可读。细节归 `engineering-with-craft`;本 skill 只把它们放进优化图里。

## Taste:好 loop 的手感

好的 dev loop 像稳定训练:objective 清楚、instrument 可信、hypothesis 小、反馈短、失败可读、重启不拖、收敛即停。坏 loop 像失控训练:目标漂移、测量假绿、补丁栈变深、同形失败反复出现、"再改一下"替代 hypothesis、验收已绿还继续镀金。

与敏捷 / 排期 / 持续交付的关系是正交互补: `slicing-goals-into-dags` 切出小 batch,`master-orchestrator-guide` 排程和验收训练 run,本 skill 管每片里的优化形状,`engineering-with-craft` 管每一步的工程质量。持续交付就是高频 validation checkpoint,防止最后才发现泛化失败。

---

## 一图流:一轮 dev 的优化循环

```
读目标函数(验收)──► 它清楚吗?── 不清 ──► 先锐化(锚 1)
        │ 清楚
        ▼
   架/读测量(测试·锚 3)
        ▼
   propose 一个改动(早期 explore / 近收敛 exploit·锚 4)
        ▼
   测量 → 读梯度(失败=方向信息·锚 3)
        ▼
   loss 在降吗?── 否,且 plateau ──► 你在局部最小值:restart 换方向(锚 5)
        │ 在降
        ▼
   验收达标?── 否 ──► 回到 propose(小步迭代·锚 2)
        │ 达标
        ▼
   收敛:停(别过拟合·锚 6)。检查:拟合的是意图非用例(锚 7)、方案最简(锚 8)
```

---

## Pointers

- **slicing-goals-into-dags** —— 在执行**之前**,目标怎么**切**成带验收的任务。它切出小 batch;本 skill 把每片当优化问题跑。
- **master-orchestrator-guide** —— 协调 / 派发 / 端点验收(指挥不演奏)。它拥有外层 dev loop:把任务交成 objective / measurement / artifact / restart-stop,并在端点验证收敛;执行 agent 用本 skill 跑内层 loop。
- **using-ccm** —— 任务做到验收后,怎么把 `done + verified + artifact`、acceptance 更新、状态转移、log / judgment_call 等结果正确写回 board。
- [references/optimization-ledger.md](references/optimization-ledger.md) —— 怎么把 objective / measurement / hypothesis / plateau / restart / compact 后续接所需状态持续落到 board,并与 `using-ccm` 分工。
- **engineering-with-craft** —— 本 skill 给循环的**形状**(怎么把 dev work 优化到验收);engineering-with-craft 给循环里那双手的**工程手艺内容**(领域怎么建模 / 类怎么写 / 要不要 spec-first / **test-first 这条纪律本身怎么执行**)。测试触点:本 skill 锚 3 讲「测试为何是循环里的梯度信号」,`engineering-with-craft` 讲「红绿铁律怎么执行」——不同 plane,互补。
- board 的 `acceptance` 字段语义(两态 objective function:一句话 DoD / `{criteria}`)以 `using-ccm` 为准——本 skill 是它在 dev loop 里的优化心智。
