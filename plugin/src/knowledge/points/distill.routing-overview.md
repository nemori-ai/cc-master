---
point: distill.routing-overview
---

## 权威陈述

<!-- ccm:k:start point:distill.routing-overview -->
## 归宿判断决策树(顶层三问,细节见 [references/routing-decision-tree.md](references/routing-decision-tree.md))

1. **这条经验的本质是事实还是判断力?** 事实(这次因为具体原因踩了坑,下次注意这件具体的事)→ 纪律文档;
   判断力(一套可迁移到其他任务的决策方法/品味)→ 继续第 2 问。
2. **这条判断力是确定性可编排的机制形状吗**(无需临场判断,纯结构)? → workflow;否则继续第 3 问。
3. **这条判断力需要角色化的专职视角吗**(独立 persona + 工具边界,会被反复以同一角色调用)? → subagent;
   否则 → skill。

二义性(同一条经验既该在纪律文档留一句指针、又该在 skill 里承载细节)与"三问都判不清"的兜底处理,细节都在
[references/routing-decision-tree.md](references/routing-decision-tree.md)——**核心纪律:归宿不确定或基础
设施缺失时,绝不静默丢弃这条经验**;找不到理想归宿就落成本最低的纪律文档指针,并显式标注"归宿不确定"或
"该项目无对应基础设施,已降级",留给人工审阅时改判。宁可归宿判浅了被人工纠正,也不能让一条经验凭空消失。

<!-- ccm:k:end point:distill.routing-overview -->
