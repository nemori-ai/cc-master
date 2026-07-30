---
point: ccm.pointers-routing
---

## 权威陈述

<!-- ccm:k:start point:ccm.pointers-routing -->
## Pointers

{{USING_CCM_POINTERS_HOST}}
- [references/board-model-guide.md](references/board-model-guide.md) —— 面2·board 模型操作指南:领域概念(task 字段 / status 八态 / executor 五种 / judgment_call / cadence / parent / watchdog)解释 + 字段取值判断(acceptance / estimate / deps / executor 怎么选)+ 决策树 + **全部 FMT/GRAPH/BIZ 校验规则速查**(一次写对不撞 exit 3)+ footgun 深化。命令怎么敲看 command-catalog,字段填什么、概念是什么、会撞哪条规则看这本。
- **master-orchestrator-guide** —— 决策层:该编排什么、怎么拆 DAG、何时阻塞等用户、何时换号。本 skill 是它的"手怎么动"。注:board 协议的权威定义在 `ccm` 引擎(enums / 字段元数据 / 不变式 / 状态机);本 skill 只给操作视图、不复述权威定义。
- **authoring-workflows** —— 在 workflow 脚本里编排并行时怎么写(那是脚本 DSL,不是 ccm CLI)。
- 实时真相永远以 `ccm <namespace> <cmd> --help` 为准——本文与 catalog 是地图,`--help` 是当前领土。
<!-- ccm:k:end point:ccm.pointers-routing -->
