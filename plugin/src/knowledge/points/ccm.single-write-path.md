---
point: ccm.single-write-path
---

## 权威陈述

<!-- ccm:k:start point:ccm.single-write-path -->
## 心智锚 4:ccm 是 board 变更的唯一写路径 —— 不降级手改

board 变更**只走 `ccm`**,没有 `Write`/`Edit`/`sed` 的降级退路——两道机制把这条钉死:

- **ccm 硬前置**:`ccm` 是**主机安装前置**;`as-master-orchestrator` 起板时 bootstrap 硬查 `command -v ccm`,缺则**拒 arm**(不建 board、注 directive 提醒用户装 ccm)。故一场已武装的 orchestration 里 `ccm` **必然在**——你不会遇到「ccm 没装、只好手改」。
- **board-guard**:{{USING_CCM_BOARD_GUARD_GUIDANCE}}

**万一 `ccm` 跑起来这一下不响应**(装了但瞬态抽风):**暂停 board 变更、先修 `ccm`**——**绝不**退回手改 JSON 顶上去。运行时 hook(board-lint / usage-pacing)对这种瞬态各自优雅降级(静默不 block),但**你自己的 board 写永远等 `ccm` 恢复**,不自己动手。
<!-- ccm:k:end point:ccm.single-write-path -->

## 失效类型

`motivation_conflict`（主体：行为约束） —— 知道 board 变更没有手改这条退路，但工具瞬时不响应、又不想卡住进度时，会倾向于把“只是临时垫一下，回头一定补跑校验”当成可以接受的例外。

主体是「ccm 抽风也绝不退回手改 JSON」的约束，等 ccm 恢复比直接改文件费力，动机完美的执行者知道后必遵守。

## 为什么它随模型变强而更重要

模型越强，越擅长把“这次改动很小、风险可控、留了事后补校验的退路”包装成审慎而不是违规，这种带着安全阀措辞的论证比直接说“手改一下”更有说服力，也更容易在事后被自己当成合理决定。

## 失败形态

不是整段重写 board 文件，只是用一个命令追加一行、或改一个字段“顺手垫一下”，规模很小、看起来风险有限——但本质仍是绕开写入关卡的直接文件改动，和大改一样破坏了唯一写路径，只是更容易被自己当成“不算违反”。
