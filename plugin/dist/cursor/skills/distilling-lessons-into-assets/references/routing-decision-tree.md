# 归宿判断决策树

<a id="ccm-k-point-distill-routing-tree"></a>
<!-- ccm:k:start point:distill.routing-tree -->
## 顶层三问

```
这条经验的本质是「事实」还是「判断力」?
  │
  ├─ 事实(这次因为具体原因踩了坑,下次注意这件具体的事) ──► 纪律文档
  │
  └─ 判断力(一套可迁移到其他任务的决策方法/品味)
        │
        这条判断力是「确定性可编排的机制形状」吗?(无需临场判断,纯结构)
        │
        ├─ 是 ──► workflow
        │
        └─ 否
              │
              这条判断力需要「角色化的专职视角」吗?
              (独立 persona + 工具边界,会被反复以同一角色调用)
              │
              ├─ 是 ──► subagent
              │
              └─ 否 ──► skill
```

逐问展开:

**第 1 问(事实 vs 判断力)**——问自己:"如果换一个完全不同的项目、完全不同的任务,这条经验还有用吗?"
有用 = 判断力;没用、只对这个项目/这次任务成立 = 事实。**警惕的陷阱**:一件事实听起来"很重要"不代表
它是判断力——重要程度和可迁移性是两个独立的轴。一个项目专属的、代价惨痛的教训依然只是事实,老实记进
纪律文档,不要因为它教训惨痛就误判成"该升级成 skill"。

**第 2 问(机制 vs 判断力)**——问自己:"这一步该怎么做,不管遇到哪个具体案例,答案都一样吗?" 答案
不随案例变化 = 确定性机制,该固化成 workflow;答案要看情况判断 = 判断力,继续第 3 问。**警惕的陷阱**:
把"我们目前观察到的这一种做法"误判成"确定性机制"——只观察到一次的模式还不能确认它是"不管遇到哪个
案例都一样"的机制,证据不够就先按判断力对待(继续往下问),不要过早固化成看似确定性的脚本。

**第 3 问(判断力 vs 角色)**——问自己:"这套判断力需要一个专门的、独立的视角与工具边界,且会被反复以
这个身份召唤吗?" 是 = subagent;否 = skill(默认落点)。**警惕的陷阱**:大多数判断力不需要专职角色,
只需要在被触发时把这套方法论内化——**skill 是默认落点,subagent 是需要专门论证的加冒**,别为了"显得
更正式"就升级成 subagent。

<!-- ccm:k:end point:distill.routing-tree -->
<!-- ccm:k:nav:start point:distill.routing-tree -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:distill.routing](../../../knowledge/modules/distill.routing.md#ccm-k-module-distill-routing)
- [next: 允许双落点](./routing-decision-tree.md#ccm-k-point-distill-dual-dest)
- [requires: 泛化 vs 收窄细则](./evidence-fidelity.md#ccm-k-point-distill-evidence-fidelity)
- [fallback_to: 不确定绝不丢弃](./routing-decision-tree.md#ccm-k-point-distill-fallback-no-drop)
- [requires: 四类资产定义与判据](./asset-taxonomy.md#ccm-k-point-distill-taxonomy)
<!-- ccm:k:nav:end -->
<a id="ccm-k-point-distill-dual-dest"></a>
<!-- ccm:k:start point:distill.dual-dest -->
## 二义性:允许双落点

一条候选经验可能**同时**该在纪律文档留一句指针、又该在 skill 里承载完整细节——比如"这个项目决定不用
某种做法"是一句该记进纪律文档的事实性决定,但"什么时候该用什么替代做法"是一套值得独立成 skill 一节的
判断力。**这种情况允许双落点,不强求唯一归宿**:纪律文档留一句指针(是什么决定 + 指向哪份 skill 材料
能看到判断力细节),skill 承载判断力本身。蒸馏计划里对这类候选经验应显式标注"双落点"。

<!-- ccm:k:end point:distill.dual-dest -->
<!-- ccm:k:nav:start point:distill.dual-dest -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:distill.routing](../../../knowledge/modules/distill.routing.md#ccm-k-module-distill-routing)
- [requires: 泛化 vs 收窄细则](./evidence-fidelity.md#ccm-k-point-distill-evidence-fidelity)
- [routes_to: 归宿判断决策树完整体](./routing-decision-tree.md#ccm-k-point-distill-routing-tree)
<!-- ccm:k:nav:end -->
<a id="ccm-k-point-distill-fallback-no-drop"></a>
<!-- ccm:k:start point:distill.fallback-no-drop -->
## 不确定时的兜底:绝不静默丢弃

若三问都判不清(常见于来源文档里本就写着"待后续判断"这类占位),**不要逐条去问别人**——按下面的兜底
处理:

1. **先给出最佳猜测,落到纪律文档**(默认托底选项)——因为纪律文档的落地成本最低,即便判断错了,后续
   改起来的代价也最轻。落成 skill/workflow/subagent 判断错了,后续要拆迁一整份带触发机制的独立文档,
   代价重得多。
2. **显式标注"归宿不确定,已默认落纪律文档,可在审阅时改判"**——让后续的人工审阅环节能一眼看出这是
   一个待确认的归宿,而不是被悄悄当成了确定归宿。

同理适用于"基础设施缺失"的情形(比如目标项目本身没有 skill 机制、没有专职分工机制、没有确定性编排
脚本的既有约定):**不要因为"没地方放"就让这条经验消失**——降级成纪律文档里的一句指针(内容:这条
经验是什么 + 若未来引入相应基础设施,应该落到哪一种资产),并显式标注"该项目无对应基础设施,已降级"。

一句话:**归宿判断可以错、可以浅,但绝不能让一条经验因为判不清或没地方放就悄悄蒸发。**
<!-- ccm:k:end point:distill.fallback-no-drop -->
<!-- ccm:k:nav:start point:distill.fallback-no-drop -->
Knowledge navigation:
- [Knowledge atlas](../../../knowledge/atlas.md)
- [Module module:distill.routing](../../../knowledge/modules/distill.routing.md#ccm-k-module-distill-routing)
- [requires: 泛化 vs 收窄细则](./evidence-fidelity.md#ccm-k-point-distill-evidence-fidelity)
- [routes_to: 归宿判断决策树完整体](./routing-decision-tree.md#ccm-k-point-distill-routing-tree)
<!-- ccm:k:nav:end -->
