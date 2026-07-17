---
title: hook 体系
description: 事件驱动的护栏——在 board 证明这个 session 是一场编排之前，它们完全休眠。
section: concepts
order: 3
deeper:
  - label: ADR-007 —— 由 board 推导的武装闸
    url: https://github.com/nemori-ai/cc-master/blob/main/adrs/ADR-007-hook-arming-gate.md
  - label: ADR-018 —— 标签化的 hook→agent 消息协议
    url: https://github.com/nemori-ai/cc-master/blob/main/adrs/ADR-018-hook-agent-message-protocol.md
  - label: hook parity 矩阵 —— 各 harness 覆盖情况（生成物）
    url: https://github.com/nemori-ai/cc-master/blob/main/design_docs/hook-parity-matrix.md
---

hook 是 cc-master 的运行时神经：harness 在生命周期事件（session 启动、prompt 提交、工具调用前后、stop）上触发的小型 bash 或 Node 脚本。它们跑在对 agent context **完全失明**的 shell 里——只能读磁盘上的 board 和 stdin 里的事件 payload——它们触达 agent 的唯一方式，是往 context 里注入文本。

## 未武装即休眠

插件级 hook 会在该 harness 的**每一个** session 里触发，包括那些从未启动过编排的 session。所以每个 cc-master hook 都**未武装即休眠**：每次产出任何东西之前，先检查 boards 目录里是否存在一块 `owner.active` 为 true、且 `owner.session_id` 与本 session 匹配的 board。没有匹配 → 空 stdout、exit 0、不 block。你的普通编码 session 完全不受打扰。

唯一的例外是 `bootstrap-board`——它**就是**武装动作本身。由 `as-master-orchestrator` 入口触发，它创建 board（或在 `--resume` 时重新武装一块旧 board），从那一刻起其他所有 hook 才醒来。解除武装是 `/cc-master:stop`，它归档 board。

## 三类注入消息

不存在中性的注入——任何加进 context 的文本都在塑造下一个 token。所以每条 hook 消息都带一个机器可读的标签，声明**决策归谁**、**推得多用力**：

| 标签 | 决策归谁 | 注意力 |
|---|---|---|
| `<ambient source="…">` | agent | 低——更新世界模型即可，不是待办 |
| `<advisory source="…" strength="weak\|strong">` | agent | 权衡它（weak 顺手、strong 认真）——但拍板的仍是你 |
| `<directive source="…">` | 系统 | 满——遵从，并理解它给出的 why |

绝大多数消息是 advisory：orchestrator 是有判断力的调度脑，不是规则机。directive 留给硬闸（board 写守卫、完成检查、缺失前置），且永远附带原因。每个标签上的 `source` 必填，让每一份影响都可追溯。

## hook 清单

| Hook | 触发阶段 | 干什么 |
|---|---|---|
| `bootstrap-board` | prompt 提交 | 建板或续板——唯一的武装动作；并硬查 `ccm` 是否已安装 |
| `reinject` | session 启动 | compaction 后重注 orchestrator 操作手册 |
| `orchestrator-context` | session 启动 / context 增量 | 把冻结的全机事实（配额态势、peers）作为 ambient 注入 |
| `board-guard` | 工具调用前 | 拦下对 `*.board.json` 的直接文件改写，指引到正确的 `ccm` verb |
| `board-lint` | 工具调用后 | 写入之后的结构性 lint 兜底 |
| `verify-board` | stop | 完成闸——目标未竟、后台活在跑、或任务未验收时阻止停止 |
| `usage-pacing` | stop / 工具批次 | 把 `ccm` 的配额 verdict 以带标签 advisory 形态送进 context |
| `coordination-inbox` | stop | 投递跨编排的决策级通知 |
| `identity-nudge` | stop | 长 session 里的周期性角色与临界路径提醒 |
| `posttool-batch` | 工具批次 | 后台任务完成通知（仅 Claude Code） |

不是每个 harness 都有全部触发阶段——各 harness 的覆盖情况见下方生成的 parity 矩阵；缺阶段的 hook 诚实降级，绝不假装在工作。

## hook 能写什么

hook 只读 board 的窄腰来判断武装——仅此而已。唯一被许可的写路径是 `runtime.*` 参数白名单（比如「上次提醒是什么时候」），经 `ccm board set-param` 写入，与任何写入一样过锁和 lint。除此之外 hook 知道的一切，都以带标签的消息给 agent，绝不进 board。
