---
point: pacing.machine-wide-first
---

## 权威陈述

<!-- ccm:k:start point:pacing.machine-wide-first -->
## 先全局，再下钻

1. 先读 `ccm quota status --machine-wide --json`。这是 cached-only 的全机视图，不调用 provider；把
   `summary.decisions[]` 按 `target.harness_id + target.surface_id + target.window` 绑定到候选。只有同一 target
   上的 `state`、`freshness`、`reason_codes[]` 与 source 才能组成一份 posture；不要跨 surface 拼接。
2. 选中一个 target 后，再用 `ccm --harness <target> usage show --accounts current --json` 看原始 current
   window，或用 `ccm --harness <target> usage advise --json` 读单侧 verdict。`usage` 是下钻 advisory，
   不是 machine-wide inventory，也不授权 dispatch。
3. `state:"unknown"`、非 fresh、`available:false`、窗口缺失或过期都保持 unknown；不得从 binary 存在、
   已登录、进程 RC0、同品牌另一 surface 或历史 snapshot 推断为 healthy。

不要在这里复制 provider CLI 参数。
<!-- ccm:k:end point:pacing.machine-wide-first -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删掉后 agent 会直接对已选 target 跑 usage 命令、跳过 machine-wide 视图,或把不同 surface/window 的字段混着拼成一份 posture,把 unknown 误判成 healthy。

主体是 quota status / usage 的具体命令语法、target 绑定规则与 unknown 判定，属本工具命令与约定。

## 边界

只框定“选 target 前如何读全局信号”这一步;target 一旦选定,如何解读它自身 usage/advise 输出的具体字段不在此列。无真实例外。

## 失败形态

确实调用了 --machine-wide,拿到 unknown 后却转而检查“进程是否登录”这类间接信号,写出“应为健康”的结论——命令本身跑对了,结论却已经违反规则。
