# 面向对象设计手艺（OOP）

> 越过 OOP 和 SOLID 的教科书定义，直接用这套**品味**判断：为什么每条原则在这里有分量、判断标准长什么样、哪些红线永远不跨。`ddd.md` 决定对象*是什么*；这里管它们*建得有多好*。

## 目录

- [四柱：同时透视的四个镜头](#四柱同时透视的四个镜头)
- [SOLID as Judgment](#solid-as-judgment)
- [封装即词汇](#封装即词汇)
- [组合优于继承](#组合优于继承)
- [这个抽象配得上它的开销吗？](#这个抽象配得上它的开销吗)
- [红线](#红线)
- [8 类反模式雷达](#8-类反模式雷达)
- [回扣共享根](#回扣共享根)

---

<a id="ccm-k-point-oop-four-pillars"></a>
<!-- ccm:k:start point:oop.four-pillars -->
## 四柱：同时透视的四个镜头

四柱不是依次勾选的清单——每个类**同时**过这四个镜头。发现冲突，就在注释里**显式权衡**；沉默妥协才是失败，不是权衡本身。

1. **Best practice（可辩护的设计选择）** — 每条原则都有判断地应用，每个模式因问题倒逼出来，绝不作为勋章佩戴。
2. **Industrial-grade（平台存活）** — 对象能在真实运行时活下来：类型系统静态担保、异步不阻塞事件循环、可注入以便测试隔离。
3. **Production-grade safety（假设敌意世界）** — 失败有名字、外部调用有超时、状态机有守卫、检查与动作之间没有竞争窗口。
4. **艺术优雅（代码即领域语言）** — 每个类一条干净的抽象边界，控制流读者可从上到下追踪，零多余复杂度。这一柱没有 linter 能检查，也是本文最要教的。

---

<!-- ccm:k:end point:oop.four-pillars -->
<!-- ccm:k:nav:start point:oop.four-pillars -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:craft.object-design](../../../knowledge/modules/craft.object-design.md#ccm-k-module-craft-object-design)
- [routes_to: 四理论共享脊椎](../SKILL.md#ccm-k-point-craft-shared-spine)
- [deepens_to: 抽象成本审计](./oop.md#ccm-k-point-oop-abstraction-cost)
- [deepens_to: 组合优于继承](./oop.md#ccm-k-point-oop-composition-over-inheritance)
- [deepens_to: 封装即词汇](./oop.md#ccm-k-point-oop-encapsulation-vocabulary)
- [deepens_to: OOP 反模式雷达](./oop.md#ccm-k-point-oop-failure-radar)
- [deepens_to: OOP 红线](./oop.md#ccm-k-point-oop-red-lines)
- [deepens_to: OOP 与共享根接缝](./oop.md#ccm-k-point-oop-shared-root-links)
- [deepens_to: SOLID 判断法](./oop.md#ccm-k-point-oop-solid-judgment)
<!-- ccm:k:nav:end -->
<a id="ccm-k-point-oop-solid-judgment"></a>
<!-- ccm:k:start point:oop.solid-judgment -->
## SOLID as Judgment

### SRP — 编排与规则分离

关键切割不是"类要小"，而是**决策住在 I/O 线的哪一侧**：

- **应用服务**——纯编排：加载聚合、调用领域逻辑、持久化、发事件。不含任何业务规则。
- **领域服务 / 实体方法**——纯规则，无 I/O，不需要任何 mock 即可测试。

**诊断方式**：一个方法既获取数据又做决策，就有两个改变理由。测试里出现了大量 I/O mock 才能断言一条业务规则——这就是症状，规则住在了错误的一侧。

> **判断标准**：说出这个类唯一的改变理由。说不出来？违反 SRP。

### OCP — 注册表派发

开-闭的实现方式：一份契约加一张判别键→实现的注册表，**新变体通过注册自己到达，不修改任何已有代码**。

三个注册表品味判断：

1. **注册失败要大声叫**——键冲突立刻抛异常，静默覆写是在等一个生产事故的扳机。
2. **横切行为折进注册接缝**——装饰器一次性附加元数据 / 包裹信封，而不是让每个子类各自实现（或遗忘）。
3. **派发失败也要大声叫**——未知键抛异常，绝不 `dict.get` 返回 `None` 静默放行。

**反信号**：随变体增加而增长的 `if kind == "x": ... elif ...` 梯子——这是对扩展关闭的代码，每次增加都在编辑共享分支、把每个已有分支再风险一遍。

> **判断标准**：新变体能不改这个文件就到达吗？不能——接缝在哪里？

### LSP — 约束对等，不只行为对等

可替换性是一个比"方法签名相同"更富的承诺：

- **异常合约共享**——实现类在适配器边界把后端原生错误翻译成领域异常类型，调用者不应因为换了一个实现就要捕获不同的异常。
- **状态机对等**——所有后端遍历同样的生命周期状态；某个后端跳过某个状态，破坏所有观察状态机的消费者。
- **硬约束跨后端成立**——当只有一个后端物理上强制某约束（DB 触发器、不可变规则）时，其他后端必须行为上强制。**只有真实后端拒绝的请求，内存 test double 也必须拒绝**——否则测试套件绿了，生产会挂。

**试金石**：在引导层换掉注入的实现——除后端特定集成测试外，所有测试是否以相同断言通过？

> **判断标准**：换实现后还能保留每一条断言吗？不能——找出泄露的具体行为。

### ISP — 窄接口是能力边界

按**消费者角色**定义接口，不按实现者：一个物理后端可以同时实现多个接口，但持有"工具接口"的调用者就是**不能**销毁沙盒——因为那个接口根本没有销毁方法。ISP 这里是**安全边界**，不是卫生习惯。

**粒度判断**：

- 当两类消费者始终使用互不相交的方法子集时，拆分。不要"为了未来"预拆一个 3 方法的接口——那是投机式泛化；等第二个角色真的出现再拆。
- 写-侧接口（一致性边界）与读-侧视图（允许跨聚合读）是不同消费者，需要不同的合约。

> **判断标准**：有消费者拿到了它永远不调用的方法吗？按角色拆。

### DIP — Domain 拥有接口

**依赖规则**：领域层用领域语言**声明自己需要什么**（Protocol / 接口），基础设施层实现它，引导层装配，**Domain 从不导入 Persistence**。

品味叠加：

- **注入能力，不注入服务定位器**——`registry.get(SomeType)` 形式隐藏了真实依赖面。只有当"按类型查能力"本身是领域概念时，registry 注入才是合法的。
- **工厂也是接口**——当创建必须是晚绑定、每次调用全新、或供应商隔离时，注入工厂接口，不让领域代码导入具体 SDK 来构造。
- **同步第三方在边界适配**——`asyncio.to_thread(...)` 写在适配器实现里，接口保持异步；领域代码里没有同步调用。
- **随接口一起交付内存实现**——它是测试基底，也是合约的可执行文档——且必须强制相同的约束（见 LSP），否则文档了一个谎言。

> **判断标准**：任何 `domain/` 或 `application/` 签名出现了具体后端类型吗？推到接口后面。

---

<!-- ccm:k:end point:oop.solid-judgment -->
<!-- ccm:k:nav:start point:oop.solid-judgment -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:craft.object-design](../../../knowledge/modules/craft.object-design.md#ccm-k-module-craft-object-design)
- [routes_to: OOP 四柱](./oop.md#ccm-k-point-oop-four-pillars)
<!-- ccm:k:nav:end -->
<a id="ccm-k-point-oop-encapsulation-vocabulary"></a>
<!-- ccm:k:start point:oop.encapsulation-vocabulary -->
## 封装即词汇

**聚合根是唯一的变更入口**，每个变更都是 ubiquitous language 的动词：`workspace.archive()`，永不是状态戳。如果调用者"需要设置一个字段"，设计出它真正意图的那个动词。守卫、命名异常、状态翻转、时间戳一起封进那个动词——调用者无法"半归档"。

一个规范的实体变更方法携带三样东西：
1. **守卫**（引用编号不变式，一检就抛明确的领域异常）
2. **状态翻转**（由动词语义定义，不是 setter）
3. **时间戳 / 副作用**（在方法内完成，而不是由调用者在外部追加）

**值对象是冻结的**——按值相等、无身份、不可变。这是你能买到的最廉价的正确性。

**设计文档里的不变式不是不变式**。把它编号写进类的文档注释，并在声明它的地方强制它。一个只存在于注释或口头约定里的约束，在任何 agent 或人类读者眼里都是不存在的。

> 回扣根 1（不变式即锚）：不变式住在能**原子持有**它的最小所有者——那就是聚合根，守卫与状态翻转同一个方法调用。

---

<!-- ccm:k:end point:oop.encapsulation-vocabulary -->
<!-- ccm:k:nav:start point:oop.encapsulation-vocabulary -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:craft.object-design](../../../knowledge/modules/craft.object-design.md#ccm-k-module-craft-object-design)
- [routes_to: OOP 四柱](./oop.md#ccm-k-point-oop-four-pillars)
<!-- ccm:k:nav:end -->
<a id="ccm-k-point-oop-composition-over-inheritance"></a>
<!-- ccm:k:start point:oop.composition-over-inheritance -->
## 组合优于继承

继承是**最后**的答案，不是第一个：子类永远耦合父类每一个 protected 细节；组合协作者只耦合一份合约。

### 三个合法的继承形态

继承只有在**基类拥有稳定骨架且变化点显式**时才正确。恰好有三种合法形态；如果你的情况不属于其中任何一种，用组合。

| 形态 | 适用场景 | 识别要点 |
|------|----------|----------|
| **Template-method pipeline** | 基类拥有固定流水线，子类覆盖特定步骤 | 子类**不能**重排流水线——这不可能性就是重点 |
| **Class-var 契约 ABC** | 子类提供 class-var 加一个工厂 hook；基类拥有其余一切 | 合约小且可枚举，读者确切知道子类必须提供什么 |
| **泛型后端 family** | 共享生命周期脚手架，泛型参数即合约 | 后端只能用它自己的配置类型构造，由类型系统（不是运行时断言）保证 |

**红旗——出现任何一条就切换到组合**：

- 一个覆盖只是调用 `super()` 再追加一个与变化点无关的调整——继承接缝在错误的地方。
- 超过两层具体类——没有人能在脑子里保持合并后的行为。
- 继承是为了**复用代码**而不是为了**可替换**——代码复用是组合做的事；继承是一个你未必打算做的 LSP 承诺。
- 兄弟子类通过基类共享辅助方法——那段共享代码想成为一个被组合的协作者。

### idle wrapper 红线

**一个层如果没有 hook、没有翻译、没有合约变化，就是死重，删掉它。**

自查：在加任何中间层之前，说出它引入的 hook、翻译或合约变化。说不出来？删掉它，直接调用底层 API。

关键区分：**领域拥有的接口 port 不是 idle wrapper**——它把合约的语言从基础设施（"怎么持久化"）改成领域（"这个 BC 需要什么"）。一个持久化类同时是基类的子类和接口的实现者，中间没有第三层。

> 回扣根 3（组合优于包装）：消灭 idle wrapper——无 hook / 无翻译 / 无合约变化的层是死重；ACL 只在真实边界。

---

<!-- ccm:k:end point:oop.composition-over-inheritance -->
<!-- ccm:k:nav:start point:oop.composition-over-inheritance -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:craft.object-design](../../../knowledge/modules/craft.object-design.md#ccm-k-module-craft-object-design)
- [routes_to: OOP 四柱](./oop.md#ccm-k-point-oop-four-pillars)
<!-- ccm:k:nav:end -->
<a id="ccm-k-point-oop-abstraction-cost"></a>
<!-- ccm:k:start point:oop.abstraction-cost -->
## 这个抽象配得上它的开销吗？

每个新抽象都增加协调成本；默认是最简单可行的东西。判断标准：**near-decomposability**——一个责任、一条干净接口、可独立理解和测试。

优先扩展现有接缝（注册表、Protocol、hook），而不是竖起新边界；新边界需要结构性理由，不是假设的未来需求。

**两个提示问题**：

1. 如果我删掉这层，调用者直接调用底层 API，少了什么？（hook？翻译？合约语言变化？）如果什么都没少——删。
2. 这个抽象可以被独立理解和测试吗？不能——粒度错了，要么太大要么太细。

> 回扣根 4（分层思维）：依赖单向（domain 不依赖 persistence）；编排与规则分离（应用层纯编排、领域纯规则）。

---

<!-- ccm:k:end point:oop.abstraction-cost -->
<!-- ccm:k:nav:start point:oop.abstraction-cost -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:craft.object-design](../../../knowledge/modules/craft.object-design.md#ccm-k-module-craft-object-design)
- [routes_to: OOP 四柱](./oop.md#ccm-k-point-oop-four-pillars)
<!-- ccm:k:nav:end -->
<a id="ccm-k-point-oop-red-lines"></a>
<!-- ccm:k:start point:oop.red-lines -->
## 红线

硬边界，违背字面就是违背精神。每一条都因为它防止的失败在生产前不可见而存在。

**No silent failure（不允许静默失败）**
吞掉一个异常是在对调用者说谎。面向 agent 的工具在失败时返回正常形态的字符串更糟——它教给 agent 一个错误的世界模型，每个下游决策都继承这个谎言。引擎 / 领域层抛出命名异常；工具层捕获并渲染结构化错误信封。成功、失败、已在目标状态是三个不同的答案——建模它们，不要都返回 `"ok"`。

**绝不裸 catch-all**
捕获所有异常意味着处理任何异常；错误类型*就是*信息，丢弃它让失败无法调试。只捕获你实际能处理的具体类型；其余让它传播。日志不是处理——记日志之后必须重抛或返回结构化错误。

**绝不对不信任输入 eval / exec / 反序列化**
每一个都是穿着便利 API 的任意代码执行。

**No idle wrapper（无死重层）**
见上文组合章节。无 hook / 无翻译 / 无合约变化的层删掉。

**async 里不同步阻塞**
事件循环是共享的——一个阻塞调用冻结所有并发会话。同步第三方在适配器边界用 `asyncio.to_thread`（或对应语言等价物）适配，永不在领域或应用代码里阻塞。外部调用要有超时——一个可以永远 hang 的 await 是同族的存活泄漏。

---

<!-- ccm:k:end point:oop.red-lines -->
<!-- ccm:k:nav:start point:oop.red-lines -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:craft.object-design](../../../knowledge/modules/craft.object-design.md#ccm-k-module-craft-object-design)
- [routes_to: OOP 四柱](./oop.md#ccm-k-point-oop-four-pillars)
<!-- ccm:k:nav:end -->
<a id="ccm-k-point-oop-failure-radar"></a>
<!-- ccm:k:start point:oop.failure-radar -->
## 8 类反模式雷达

`ruff` / `pyright` / 静态分析捕不到的 OO 失败模式，速查表：

| 反模式 | 气味 | 判断标准 | 修复方向 |
|--------|------|----------|---------|
| **贫血模型** | 实体是字段包，规则全在服务里 | 领域层读起来像有类型的字典 | 行为住到聚合上：守卫 + 状态翻转 + 时间戳 = 一个动词 |
| **God class** | `*Manager`/`*Handler` 500+ 行，8+ 注入依赖，测试 mock 世界 | 说出唯一改变理由失败 | 按接缝拆：纯规则→领域方法，编排→应用服务，读侧→查询服务，可调参数→配置模型 |
| **继承滥用** | 3+ 层具体继承，覆盖用来借代码，覆盖方法取消了父类守卫 | LSP 测试：换实现后断言还成立吗？ | 只用三个合法继承形；其余用组合 |
| **隐式共享可变状态** | 可变 class-level 属性当实例状态、模块级可变单例被多处写、异步 check-then-act | 测试通过、生产出现不可复现的状态污染 | 优先：冻结；次选：实例拥有 + 构造注入；必须共享可变→给出单一守卫写入入口 |
| **裸 except / 静默吞咽** | 捕获所有、记警告日志、正常返回 | 工具对 agent 在失败时返回正常形态字符串 | 领域层抛命名异常；工具层渲染结构化错误信封；三种结果三种答案 |
| **idle wrapper** | 层无 hook / 无翻译 / 无合约变化 | 删掉中间层后调用者什么都没少 | 删掉，直接调底层 API；Protocol port 例外（语言变了） |
| **setter 驱动变更** | `set_status()` / `update_field()` 公开在聚合上 | 变更 API 按数据命名而非按意图命名 | 变更 = ubiquitous language 的动词（含守卫 + 时间戳）；不可变数据用 deprecate + supersede |
| **同步泄进异步** | 协程里有阻塞调用（同步 driver、sleep、CPU 密集循环） | 压测下所有并发 session 都卡住 | Protocol 方法是协程；同步第三方在适配器边界用线程池适配；外部调用加超时 |

---

<!-- ccm:k:end point:oop.failure-radar -->
<!-- ccm:k:nav:start point:oop.failure-radar -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:craft.object-design](../../../knowledge/modules/craft.object-design.md#ccm-k-module-craft-object-design)
- [routes_to: OOP 四柱](./oop.md#ccm-k-point-oop-four-pillars)
<!-- ccm:k:nav:end -->
<a id="ccm-k-point-oop-shared-root-links"></a>
<!-- ccm:k:start point:oop.shared-root-links -->
## 回扣共享根

五条共享根让 DDD / OOP / SDD / TDD 凝成同一个 skill 的脊椎。本文回扣其中三条：

- **根 1（不变式即锚）**：不变式住在能**原子持有**它的最小所有者——聚合根的单一方法，守卫与状态翻转不可分割（见[封装即词汇](#封装即词汇)）。
- **根 3（组合优于包装）**：idle wrapper 是死重——无 hook / 无翻译 / 无合约变化的层删掉；ACL 只在真实边界（见[组合优于继承](#组合优于继承) + [红线](#红线)）。
- **根 4（分层思维）**：依赖单向（domain 从不导入 persistence）；编排与规则分离——应用层纯编排、领域层纯规则，双因改变的症状是测试要 mock 一堆 I/O（见 [SOLID as Judgment · SRP](#srp--编排与规则分离) + [DIP](#dip--domain-拥有接口)）。
<!-- ccm:k:end point:oop.shared-root-links -->
<!-- ccm:k:nav:start point:oop.shared-root-links -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:craft.object-design](../../../knowledge/modules/craft.object-design.md#ccm-k-module-craft-object-design)
- [routes_to: OOP 四柱](./oop.md#ccm-k-point-oop-four-pillars)
<!-- ccm:k:nav:end -->
