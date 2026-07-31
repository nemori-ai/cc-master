---
point: routing.executor-vs-target
---

## 权威陈述

<!-- ccm:k:start point:routing.executor-vs-target -->
`executor` 回答「谁以什么责任形状执行」，`target surface` 回答「在哪个可调用面真正启动」。它们正交：`subagent` 不等于当前 origin 的 subagent，`workflow` 也不等于某个固定工具名。当前 origin 只是指挥台，不是 worker pool 边界。

从全机 inventory 中选精确 `harness + surface`，先确认它确实可调用、能返回可 recon 的 handle、对目标 workspace 有所需权限，再比较任务适配度与容量。此 host 当前能用于发车或追踪的机制包括：{{BACKGROUND_DISPATCH_MECHANISM_LIST}}。目标 CLI 的真实调用形状只看本次解析出的 {{CROSS_HARNESS_WORKER_HELP_POINTER}}；不要凭记忆复制 provider flags，也不要把 `ccm` 当成 model / effort 参数翻译层。

如果 worker 要写文件，派前还必须给它一棵独立工作树的绝对路径并验证写权限；多个并行 writer 不共享同一路径。跨 harness 的同步 wrapper 要放进当前 origin 可追踪的后台 terminal / shell / session，真正的后台 handle 来自外层机制。

<!-- ccm:k:end point:routing.executor-vs-target -->

## 失效类型

`capability_gap`（主体：事实方法） —— 不掌握执行角色与可调用面是两个正交问题这一事实，容易把『选了哪个角色』和『能不能在某个面上真的跑起来』混为一谈，凭记忆套用某个相似工具常见的参数形状而不核实当前这个面实际支持什么。

主体是 executor 与 target surface 正交这一概念区分及选面流程，缺的是分析框架而非某个字段值。

## 边界

只适用于跨多个可调用面选择派发目标的场景；若环境里客观只有一种可调用面（没有选择余地），执行角色与调用面天然重合，不构成需要分辨的正交问题。

## 失败形态

命令确实发出去了、也确实返回了一个能追踪的 handle，看起来派发成功——但用的参数是记忆里另一个相似工具的常见写法，目标面默默忽略了不认识的参数、退回默认行为，跑起来的东西和预想的配置对不上。
