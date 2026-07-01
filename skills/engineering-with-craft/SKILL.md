---
name: engineering-with-craft
description: 'Use when you (a coding/execution agent) are designing, building, or testing actual code and want to apply established engineering theories well —— 当你(执行 agent)在动手设计 / 开发 / 测试代码、想遵循 DDD / SDD / TDD / OOP 的最佳实践与品味时:怎么给领域建模(bounded context / aggregate / 不变式)、怎么写好类(SOLID / 四柱 / 组合优于继承)、怎么 spec-first(契约即 SSOT)、怎么 test-first(红绿铁律 / constraint parity)。核心是工程心智模型 + 哲学 + 艺术品味 + 方法论,叠加 no-silent-failure / spec 不漂移 / 无 idle wrapper 等红线。五条共享根:不变式即锚 / 契约即 SSOT / 组合优于包装 / 分层思维 / 证据优于声称。Triggers: 要设计一个模块 / 给领域建模 / 划 bounded context / 写类纠结继承还是组合 / 要不要先写 spec / 先写测试还是先写实现 / 这个抽象值不值 / 怎么躲开贫血模型或 god class。Do NOT use when 你在决定该编排什么 / 怎么派发(orchestrating-to-completion)、怎么把目标切成任务 DAG(slicing-goals-into-dags)、把一个任务迭代优化到验收的循环形状本身(dev-as-ml-loop)、怎么用 ccm 写 board(using-ccm)、workflow 脚本怎么写(authoring-workflows)。'
---

# engineering-with-craft —— 设计 / 开发 / 测试的工程手艺与红线

> **分发 skill。** 给在 **design → build → test** 动手的**执行 agent** 的工程手艺：把 **DDD**（领域建模）/ **OOP**（写类品味）/ **SDD**（spec-first）/ **TDD**（test-first）的最佳实践、哲学与品味带进你的活里。核心是**心智模型 + 艺术品味 + 方法论**，叠加几条不可跨的**红线**。
>
> **职责边界（红线3）：** 本 skill 是「循环里那双手该有的手艺」，与编排 / 切分 / 执行循环**不同 plane**——
> - **orchestrating-to-completion**（SKILL A）协调 / 排期 / 派发（指挥不演奏）。
> - **slicing-goals-into-dags** 把目标**切**成 board 纵切片（**交付计划**的轴）。
> - **dev-as-ml-loop** 给执行单任务的**循环形状**（验收=objective / 迭代 / plateau→restart，**理论无关的元过程**）。
> - **本 skill** 给循环里的**内容**：怎么建模、怎么写类、怎么 spec/test-first。**F 是循环的形状，本 skill 是带进循环的手艺。**

---

## 核心论题：四个理论，一条脊椎

DDD、SDD、TDD、OOP 不是四套要分别背的 checklist——它们是同一种工程良知在 design / build / test 三阶段的不同切面，从**同一组根**长出来。这五根不止长出四理论的**手艺**，也贯穿**交付尺度**——顶层怎么敏捷切（=slicing-goals-into-dags）、任务内怎么迭代（=dev-as-ml-loop），指向下文接力段的三层范式：这是把五根从「四理论之根」提升为「delivery + craft 同根的 apex」（工程质量总纲的答案——非一套新原则，是 framing 提升）。先握住下面五条根（这是本 skill 的灵魂），再到各 reference 取深度。**根对了，四个理论彼此印证；根没握住，它们就退化成四张互不相干的清单。**

---

## 根 1：不变式即锚

先找到那条**任何时刻都必须为真**的约束——它同时决定了三件事：边界划在哪、守卫放进哪个对象、拿什么测试去戳它。

- **DDD**：aggregate 的边界由它要保护的不变式划定（不是按「谁重要」）。
- **OOP**：不变式住在能**原子持有**它的最小所有者里（entity 的方法，不是散落在一堆 service）。
- **TDD**：一个测试要能**触发 / 观察**这条约束——测不到的约束等于没在测它。

---

## 根 2：契约即 SSOT

每个边界都有一份**先达成、被双方共同遵守**的合约。它在哪定、谁拥有、**改它的顺序**，比任何实现细节都先。

- **SDD**：spec 是**先于实现**的合约单一真相源——**整条 SDD 立在这根上**。改合约先改 spec，再改实现与测试。
- **DDD**：ubiquitous language 锁定术语；事件 / 命令 / 枚举名来自合约源，**临时起名在集成时必死**。
- **OOP**：domain 拥有接口 / Protocol，**不靠 wrapper 翻译**（DIP 的合约就是 spec）。
- **TDD**：test double 必须强制与真实后端**同样的约束**（constraint parity）——否则你测的是 mock 不是世界。

---

## 根 3：组合优于包装

每多一层都要**挣到**它的开销——它得改变合约、翻译语言、或挂上行为。只「转发一下」的层是负债。

- **idle wrapper 红线**：无 hook、无翻译、无合约变化的层 = 死重，删。
- ACL（anti-corruption layer）只放在**边界**翻译外部语言，不渗进 domain。
- 继承只在三个合法形（template-method pipeline / class-var 契约 ABC / 泛型后端 family）里用，其余一律组合。

---

## 根 4：分层思维

把「**算什么**」和「**从哪取 / 往哪写**」分开，依赖**只许从外朝里指**。

- 依赖**单向**：domain 不依赖 persistence / web；外层实现内层定义的接口。
- **编排与规则分离**：应用层纯编排（拉数据、发事件），领域层纯规则（不碰 I/O）。**双因改变的症状是测试要 mock 一堆 I/O**——那是该拆的信号。
- 测试随之分层：domain → unit（无 I/O），边界 → integration（对真实后端）。

---

## 根 5：证据优于声称

「做完了」是一个**关于世界的声称**，要**事后证据**——不是感觉、不是绿闸本身。

- completion gate 看证据：测试**观察到**预期行为、约束被**真后端**拒绝、实现**对着 spec** 验收。
- 这正是 cc-master「**gate-green ≠ passed**」红线在工艺层的同构：绿了不等于过了，过了要拿得出证据。

---

## 设计 → 开发 → 测试：何时取哪把刀

| 阶段 | 主用理论 | 这一刀回答什么 | 深度 reference |
|---|---|---|---|
| **设计** | DDD + SDD | 领域怎么划 / 建模？合约先长什么形？ | [references/ddd.md](references/ddd.md) · [references/sdd.md](references/sdd.md) |
| **开发** | OOP + SDD | 类 / 对象怎么写到品味线？实现怎么对齐 spec？ | [references/oop.md](references/oop.md) · [references/sdd.md](references/sdd.md) |
| **测试** | TDD | test-first 这条纪律具体怎么执行？ | [references/tdd.md](references/tdd.md) |
| **横跨三阶段** | 五条根 + 红线 | 始终成立的脊椎 | 本文 |

**四理论是接力，不是并列**：SDD 冻结合约形状 → DDD 在其上划 bounded context 与不变式所有权 → OOP 实现到合约 → TDD 对着合约红绿。这条接力顺序管的是「哪种手艺在哪阶段**领跑** + 合约先行」，**不是**「相位闸、不许回头」——它是**典型领棒次序**，**不是瀑布**。

把它放进三个尺度看得更清——**顶层敏捷 · 片内有序 · 任务内迭代**，同一种工程良知在三层反复出现，三层都反对『大设计先行、攒到最后才见反馈』的重型瀑布：①**顶层：敏捷迭代**（目标纵切薄增量 / walking skeleton / 按 cadence 交付·见 slicing-goals-into-dags）；②**片内：纪律化顺序**（每薄片端到端走 SDD→DDD→OOP→TDD 四棒·给典型领棒次序 + 合约先行，但**不锁相位、不禁回头**，故**不是瀑布**——『局部瀑布』直觉指的正是这份 order-ness，它与重型瀑布差在三轴：范围=一薄片非整个项目 / 反馈在每片边界就回来非攒到最末 / 与下一层任务内迭代共存）；③**任务内：迭代优化**（片里每个 dev 任务按 propose→measure→adjust 逼近验收·见 dev-as-ml-loop）。F 的迭代循环在每一棒**内部**跑，与接力的阶段次序不同尺度、不打架。

---

## 红线（工程硬规则，违背字面就是违背精神）

这几条是四个理论共同的底线，**跨语言跨项目成立**，也对齐 cc-master 既有红线。它们不在「品味可权衡」那一层——是不跨的线。深度展开见各 reference。

| 红线 | 一句话 | 深度 |
|---|---|---|
| **no silent failure** | 吞异常 = 对调用者说谎；agent-facing 更糟（教假世界模型）。绝不裸 catch-all、绝不让错误悄悄变默认值。 | oop.md |
| **spec 不漂移** | 实现偷偷偏离 spec 而不更新 spec = 契约谎言。改合约**先改 spec**。 | sdd.md |
| **test-first 不是可选** | 没有失败测试就没有产码；没看它失败，你不知道它在测什么。 | tdd.md |
| **constraint parity** | test double 必须强制与真实后端同样的约束，否则你测的是 mock 不是世界。 | tdd.md |
| **无 idle wrapper / 无虚造名** | 不挣开销的层删掉；事件 / 命令 / 枚举名来自合约源、不临时起。 | oop.md · ddd.md |

---

## Pointers

- [references/ddd.md](references/ddd.md) —— 领域建模手艺（BC 发现 / aggregate / 不变式所有权 / ubiquitous language / 应用层派生）。
- [references/oop.md](references/oop.md) —— 写类品味（四柱 / SOLID as judgment / 封装即词汇 / 组合优于继承 / 8 类反模式）。
- [references/sdd.md](references/sdd.md) —— spec-first（契约即 SSOT / 三者对齐 / 何时值得 / spec 漂移红线）。
- [references/tdd.md](references/tdd.md) —— test-first 纪律（红绿铁律 / verify by evidence / constraint parity / rationalizations）。
- **dev-as-ml-loop** —— 执行单任务的**循环形状**（验收=objective / plateau→restart）。本 skill 是带进那个循环的手艺；F 是循环本身。测试触点：F 讲「测试为何是循环里的梯度信号」，本 skill 的 tdd.md 讲「test-first 纪律怎么执行」。
- **slicing-goals-into-dags** —— 把目标**切**成 board 纵切片（交付计划轴，与 DDD 的领域建模轴正交：一个纵切片往往横穿多个 bounded context）。
- **orchestrating-to-completion** / **using-ccm** —— 编排决策 / 怎么用 ccm 写 board（本 skill 不碰）。
