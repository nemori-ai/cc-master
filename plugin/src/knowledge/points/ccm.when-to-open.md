---
point: ccm.when-to-open
---

## 权威陈述

<!-- ccm:k:start point:ccm.when-to-open -->
## 何时翻开本 skill

你要对 board 做**任何**读或写——建板、建立 / 确认 / 修订 Goal Contract、加 / 改任务、起跑 / 完成 / 阻塞、为 subagent 写多维 planning 画像与 cross-harness routing policy、声明 delivery target 与依赖资格、登记 / 探测派发出去的运行时 agent（凡派发皆登记）、查 ready 集 / DAG / 临界路径、记 judgment_call 或 log、开 / 收 cadence iteration、arm watchdog——就用 ccm,用法看这里。本文给的是**心智 + 纪律 + 热路径**,让你不必逐条 `--help` 也敲得对;深度按两面分进两个 reference,按问题选读:

- **[references/command-catalog.md](references/command-catalog.md)**（面1·命令面）—— 全量命令 / flag / `--json` 输出形状。**「这条命令怎么敲、有哪些 flag」翻它。**
- **[references/board-model-guide.md](references/board-model-guide.md)**（面2·模型与取值）—— board 领域概念（task 字段 / status 八态 / executor 五种 / judgment_call / cadence / parent / watchdog）解释 + 字段**什么时候设什么值**的取值判断（acceptance 怎么写好 / estimate 怎么估 / deps 怎么连 / executor 怎么选）+ 决策树 + footgun 深化。**「这个字段填什么、这个概念是什么、这个场景选哪个」翻它。**

<!-- ccm:k:end point:ccm.when-to-open -->
