---
title: 多编排并行
description: 一台机器上的多块 board 共享同一批配额池——只读花名册、通知收件箱和一个确定性中介让它们保持公平。
section: guides
order: 4
deeper:
  - label: ADR-017 —— 多 orchestrator 协调感知层
    url: https://github.com/nemori-ai/cc-master/blob/main/adrs/ADR-017-multi-orchestrator-coordination.md
  - label: 功能手册 —— 协调、monitor 与 viewer 的能力状态
    url: https://github.com/nemori-ai/cc-master/blob/main/design_docs/feature-manual.md
---

你可以同时跑好几场编排——不同项目、不同 session、甚至不同 harness——都在同一台机器上。它们共享一样要命的东西：**配额**。cc-master 的协调层存在的意义，就是不让两个都很饿的 orchestrator 摸黑烧穿同一个窗口。它的设计线很克制：**协调 ≠ 通信**。board 之间绝不互相谈判；一台确定性机器算出公平份额，每个 orchestrator 自己决定跟不跟。

## 看见别的 board：peers 花名册

```bash
ccm peers list --json
```

一份只读的跨板花名册：home 里每一场活着的编排的目标摘要、工作量、板级优先级、活性（心跳新鲜度），以及它属于哪个 harness 池。peers 按 `(harness, 账号池)` 分区——不同池里的 board 互不竞争，花名册也绝不假装它们在竞争。

## 给 board 一个嗓门：priority

```bash
ccm board update --priority high      # urgent | high | normal | low | trivial
```

priority 是中介加权用的输入。建板时设（`as-master-orchestrator --priority high`）或事后用 `board update` 改。它是 agent-shaped 字段——一份声明，不是一把锁——所以请如实填写；中介分不清真截止期和虚荣心。

## 确定性池中介

```bash
ccm coordination arbitrate --json
```

每个配额池一个机械中介，算出可用余量的**优先级加权公平份额**——权重为 `urgent 8 : high 4 : normal 2 : low 1 : trivial 0.5`——再折算成逐板的建议行：`pacing_yield`、`pacing_claim`、`pacing_throttle`、`pacing_switch`、`pacing_stop` 或 `hold`。同输入必同输出，每次如此；智能放在消费侧（你的 orchestrator 读建议行、加判断、可以 override）。只有一块 board 在跑时，看到的就是它本来该有的单板 verdict——不凭空制造协调噪音。

## 收件箱：需要 ack 的决策

```bash
ccm coordination inbox list --json
ccm coordination inbox ack <id...>
```

例行事实直接注入；决策级建议落在本板的 `coordination.inbox`，作为持久通知（`unconsumed` → `consumed`/`expired`，同类通知互相 supersede，不堆积）。`coordination-inbox` hook 把它们投递给 orchestrator；执行后用 `ack` 标记已消费。边沿去重让收件箱保持安静——除非压力档位、花名册或你的目标份额真的变了。

## 补上 idle 盲区：monitor daemon

hook 只在 session 边界触发——而前台 session 闲置时，后台 worker 可能仍在烧窗口、无人看管。`ccm monitor` 是一个可选的 advisory daemon，持续感知、边沿触发写收件箱：

```bash
ccm monitor start
ccm monitor status
ccm monitor install-service   # 可选：launchd / systemd --user
```

它是加速器，永远不是前提：缺席时静默，hook 路径照常工作。home 常驻服务（`monitor`、`web-viewer`）在任何 `ccm` 二进制替换后自动 reconcile——升级绝不会留下一个跑旧逻辑的陈旧 daemon。

## 一览全局：viewer 的 board 切换器

`ccm web-viewer open` 把 home 里每块活着的 board 放在一次点击之内——不用逐块敲终端命令，就能回答「我所有编排此刻都在干什么」。
