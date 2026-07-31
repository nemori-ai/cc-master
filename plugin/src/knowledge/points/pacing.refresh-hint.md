---
point: pacing.refresh-hint
---

## 权威陈述

<!-- ccm:k:start point:pacing.refresh-hint -->
## `available:false` 且带 `refresh_hint`：短命 token 的恢复边界

`usage advise` / `usage show` 返回 `available:false` 且 `refresh_hint.recoverable:true` 时，不是配额真耗尽，
而是该 harness 的短命 token 过期、usage 信号暂时读不到。Kimi 是明确例外：collector 默认可在相邻锁内重读
并刷新 Kimi 自己存储的 OAuth，再原子发布旋转后的 token pair；只有自动刷新失败后才返回 harness-native hint。
其余 provider 仍是只读 / 提示式恢复。别把它当 `stop_*` 处理——照 `refresh_hint` 恢复：运行 `refresh_hint.command` 让该 harness 自行刷新
token（完整人读步骤在 `refresh_hint.remedy`），再重跑 `refresh_hint.recheck` 确认信号回来。`recoverable:false`
（网络 / 401 / API 变更）时 `command` / `remedy` 为 `null`，不是你能就地修的，按普通 unknown 处理、不推断为
healthy。无论哪条路径，ccm 都不输出 token；Kimi 以外不替 provider 刷新或写凭证。

<!-- ccm:k:end point:pacing.refresh-hint -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删掉后 agent 会把 available:false 一律当配额耗尽处理、误触发换号或停派,或反过来把 recoverable:false 误当可就地修复而反复重试,也不知道某一 harness 有自动刷新的例外。

主体是 available:false + refresh_hint 各字段含义与恢复步骤（含 Kimi 例外），是本工具的具体行为事实。

## 边界

仅当返回 available:false 且带 refresh_hint 时适用;若只是 state:unknown 而没有 refresh_hint,不套用这套“照 hint 恢复”的流程,应按一般 unknown 处理。

## 失败形态

agent 把 recoverable:true 的这次读数当成“配额真耗尽”处理,直接建议换号或停派,而没有先跑 refresh_hint.command 去恢复——把可恢复的 token 过期误判成了真耗尽。
