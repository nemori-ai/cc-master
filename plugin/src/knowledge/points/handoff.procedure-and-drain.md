---
point: handoff.procedure-and-drain
---

## 权威陈述

<!-- ccm:k:start point:handoff.procedure-and-drain -->
命令体（`handoff-to-new-session.md`）给的是逐步落地；这里只钉每步的**为什么**与纪律边界：

1. **Quiesce** —— 立刻停止派发新活（本回合起不再有新任务进 WIP）。已在飞的让它跑，只是不再开新的——因为你正要离场，开新活就是给新 session 多留一个盲验的孤儿。
2. **Drain** —— 让在飞任务在**当前** session 跑完、每个落地即就地端点验收。当前 session 还握着 live handle，验起来比新 session 盲验省（详见下「drain 纪律」）。
3. **Write** —— 写一份**叙事层** handoff 文档（详见下「叙事层纪律」+「6 段模板」）。
4. **Log** —— board 柔性边 `log` 段追加一条指向 handoff 文档路径的指针 + 一行最终态；bump `owner.heartbeat`。只动柔性边，绝不碰硬 narrow-waist 字段（见 `board.md`）。
5. **Archive** —— 置 `owner.active:false`（同 `/stop`），让新 session 的 `--resume` 走无摩擦路径（详见下「归档换无摩擦 resume」）。
6. **告诉用户** —— handoff 文档路径 + 新 session 要跑的确切 `--resume <选择器>` 命令。

---

## drain 纪律 + straggler 兜底

**为什么仍优先在当前 session drain，而不是把一切甩给新 session：** 你现在握着 live context 与直接控制面，收割输出、就地端点验收通常最便宜。Agent Registry 让部分跨 session 恢复成为可能，却不保证每个 handle 都可接入或仍存活：交接前先用 `ccm agent list` 重建 roster，对在飞条目做 `ccm agent show` / `ccm agent probe`；`ccm agent show` 若返回已存的自包含 attach command，把它连同 worktree 一起留作恢复入口。能在当前 session 排空、验完的仍然当场收口，只有真 straggler 才走恢复兜底。

- **drain 的 happy path**：在飞任务逐个收敛，每个落地即就地端点验收（亲跑闸 + 读 diff，见 `resume-verify.md` §3——不信任何 agent 自报），标 `done`/`verified`。收敛后多半只剩一份干净的 board 可交。
- **straggler 兜底**：某个**真长跑**的在飞任务在合理收敛窗口内排不空时——别让收敛把「切 session」无限期焊死。把**这一个**作为 registry-tracked straggler 交接：写清 agent id、probe 结论、stored attach command（若有）、产物落点、端点验法与 content-hash 提示，并 **surface 给用户**：等它跑完再交，还是现在按这些证据交出去。这是一个 `blocked_on:"user"` 形态的抉择。
- **纪律边界**：straggler 兜底是**针对单个长跑任务的逃生口**，不是「整批在飞都不验」的许可证。agent terminal ≠ task done；无论新 session 能否接入 runtime agent，父 task 都须独立验收。

---

<!-- ccm:k:end point:handoff.procedure-and-drain -->

## 失效类型

`motivation_conflict`（主体：行为约束） —— 删掉后 agent 在交接压力下容易把“子任务的执行 agent 已终止”直接等同于“父任务已完成”,跳过就地端点验收就写交接文档,或把 straggler 兜底当成整批不验的许可证。

主体是交接时的纪律边界：先停派发、在当前 session 排空并亲验，甩给新 session 是更省力的近路。

## 为什么它随模型变强而更重要

模型越强,越能把“agent 进程已退出、产物文件存在”包装成一段听起来完整的验收叙事,却始终没有真正读 diff、跑闸——越会写故事,就越容易说服自己这就够了。

## 失败形态

六步流程走得规规矩矩、文档也写了,但某个标“done”的任务其实只是它的执行 agent 终止、产物文件存在,没人真正跑过验收闸或读过 diff——formatting 完全合规,验收环节已被悄悄空心化。
