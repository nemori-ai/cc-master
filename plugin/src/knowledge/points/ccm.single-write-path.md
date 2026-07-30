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
