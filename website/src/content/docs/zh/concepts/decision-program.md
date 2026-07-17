---
title: 决策程序
description: 每个回合收尾都跑同一个确定性 loop——对账、抛出、派发、验收——唯有无事可排时才合法等待。
section: concepts
order: 2
deeper:
  - label: master-orchestrator-guide SKILL.md —— orchestrator 的常驻手册
    url: https://github.com/nemori-ai/cc-master/blob/main/plugin/src/skills/master-orchestrator-guide/canonical/SKILL.md
  - label: ADR-009 —— 显式跨 session resume 与再武装
    url: https://github.com/nemori-ai/cc-master/blob/main/adrs/ADR-009-resume-cross-session-re-arm.md
  - label: ADR-011 —— 自我唤醒 watchdog
    url: https://github.com/nemori-ai/cc-master/blob/main/adrs/ADR-011-self-wakeup-watchdog.md
---

orchestrator 不靠 freestyle。**每个回合**结束时它都跑同一个确定性 loop——一个手动执行的 dataflow 调度器。正是这个 loop 让一场长编排不用你盯着也能持续推进；而它最危险的那条边，恰恰是放它停下的那条。

## 这个 loop

1. **对账 board。** 整合已完成的工作、给超过 p95 时长的任务上 hedge、把被上游变更污染的标成 stale。逐个核对每个 `in_flight` 是否对应真实的进程或 agent handle——标着「在跑」却没有 handle 的是幽灵任务（phantom），只有地面真相（git、工具结果）能戳穿它。
2. **立刻抛出用户决策。** 遇到真正需要你拍板的点，立刻带着准备好的决策包摆出来：上下文、选项、取舍。orchestrator 绝不把可预见的问题捂着，也绝不替你决定 merge / 不可逆 / 对外的步骤。
3. **派发一切就绪任务。** 依赖刚清掉的任务立刻派发——在 WIP 上限之内，哪怕正在和你对话也照派。禁止在 barrier 干等；独立工作绝不因为你的答案还没来就串行化。
4. **fill-work，或者验收。** 没有就绪任务？做通过准入测试的工作（解锁一个依赖 / 降低集成风险 / 产出可复用 artifact / 验证一个具体假设）。任何 `done` 但未验收的节点，在 orchestrator 自己的端点独立验收。
5. **等待——只在无事可排时。** 合法的等待意味着剩下的每条路径都卡在后台在飞任务或你的答案上。让出之前，orchestrator 先写它的 ledger（逐路径的证据，对话与 board 双写），再落盘 board。

任何一步找到活，loop 就回到顶部。唯一合法的出口是 ready 集合真正为空。

## watchdog：静默失败的安全网

harness 只在后台任务**完成**时重新唤起 agent——但对 hang 住、静默死掉、或根本没启动（phantom）的任务，它结构性失明。在等一条依赖「可能静默失败的后台任务」的路径之前，orchestrator 会先 arm 一个 **watchdog**：一个自我唤醒，到点把自己叫回来对账地面真相。

机制是一条降级链——harness 提供时用 `CronCreate` / `ScheduleWakeup`，background-shell 的 `until` 轮询循环是 universal floor。watchdog 记录在 board 上（`ccm watchdog arm …`），所以扛得住 compaction；ceiling 到点触发的是复查而不是处决——健康的慢任务会被重新 arm，而不是被误杀。纯等用户答复的等待不需要 watchdog：你的回复本身就是唤醒事件。

## 扛过 compaction 和 session

两个机制让这个 loop 有续命能力：

- **重注入。** 每次 context compaction 之后，SessionStart hook 会把 orchestrator 的完整操作手册和全机事实重新注入 context。角色不会随对话变长而淡忘。
- **board 即身份。** 武装状态由磁盘上的 board 推导（`owner.session_id` + `owner.active`），不依赖对话记忆——所以任何 reset 之后，orchestrator 都能认回自己的这场运行。

## resume 与 handoff

`--resume` 是一次显式、安全的接管：新 session 把自己的 id 盖到选定的一块已有 board 上（对仍在运行的 board 有防双主安全闸），保留 `goal`/`tasks`/`log`，并重新武装所有 hook——包括复活一块已归档的 board。任何 resume 的第 0 步都是先落进 board 记录的 worktree；接管后的 session 对账现实证据，而不是盲信 board。如果是有计划的迁移，`/cc-master:handoff-to-new-session` 会写一份叙事交接文档并归档 board，等下一个 session 接手。
