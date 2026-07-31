---
point: devloop.ledger-what
---

## 权威陈述

<!-- ccm:k:start point:devloop.ledger-what -->
## 写什么

每次只写会改变下一轮优化方向的信息。你要让接手者一眼看出当前 loss、测量仪器、最近梯度和下一步 probe。

| 信息 | 写法 | 读它的人要能回答 |
|---|---|---|
| objective | task `acceptance` 或 spec ref | 目标函数现在是什么?哪些不是目标? |
| instrument | task ref / log / artifact | 用什么测量?读数可信到什么程度? |
| hypothesis | log / judgment_call / task description | 当前相信哪条改动会降低 loss,理由是什么? |
| gradient | log / artifact | 最近一次测量说明往哪调? |
| plateau | log / status / blocker | 为什么同一路线不再下降? |
| restart | new task / dependency / status transition | 换到哪个新起点?旧路径留下些什么? |
| validation | `verified` + artifact | 收敛是怎么被端点验收确认的? |

你在这里先判断**哪类优化状态必须落 board**。
<!-- ccm:k:end point:devloop.ledger-what -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删掉后 agent 不知道该往 board 写哪几类信息才算“改变下一轮优化方向”,容易写成流水账或反过来什么都不写,接手者拿到 board 后答不出当前 loss、测量仪器和下一步该 probe 什么。

主体是把 objective/instrument/gradient 等优化状态映射到本项目 board 的哪个具体载体（acceptance、artifact、verified、log、status），缺的是本项目字段约定。

## 失败形态

board 上每类信息看起来都有一条记录,但“gradient”那行写的是“进展顺利”这种无方向信息的套话——七类看似齐全,实质上没有一条真正携带决策增量。
