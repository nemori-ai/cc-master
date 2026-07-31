---
point: deadline.constraint-axes
---

## 权威陈述

<!-- ccm:k:start point:deadline.constraint-axes -->
你已经在一条走廊里配速：**配额消耗**走廊（5h / 7d / billing-period 窗口，别顶满）。DDL 是**另一条正交的轴**——**挂钟时间**。配额没烧穿不代表你按期，按期也不代表配额够。两条各有各的信号源、各有各的收紧动作：配额侧读 `usage` verdict，DDL 侧读 `estimate deadline-risk` verdict。别拿一条替另一条判。
<!-- ccm:k:end point:deadline.constraint-axes -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删掉后 agent 只知道配额走廊这一个信号来源,不知道 DDL 有独立的 estimate deadline-risk verdict,容易拿配额健康状况当作按期与否的证据。

主体是本系统存在配额与挂钟两条正交走廊及各自的 verdict 读数来源，是本项目的具体事实。

## 边界

只适用于目标本身设有挂钟 DDL 的编排;没有 DDL 的编排只有资源约束这一个轴,不存在正交判断的问题,管好配额走廊即可。

## 失败形态

配额走廊显示宽松(usage verdict 正常)就在进度汇报里断言按计划推进,却没单独查过 deadline-risk;或者 deadline-risk 报警后立刻加速消耗配额而不先确认配额走廊是否真有空间——两条轴的名字和『还好/紧张』用语相似,极易在脑内被合并成一个信号,这是最隐蔽的违反形态。
