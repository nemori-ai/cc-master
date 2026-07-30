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

具体命令语法、字段取值、状态机合法转移都归 `using-ccm`。你在这里先判断**哪类优化状态必须落 board**;要敲命令时再切到 `using-ccm`。

<!-- ccm:k:end point:devloop.ledger-what -->
