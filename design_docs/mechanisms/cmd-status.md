# 机制契约：`commands/status.md`（deprecated）

> 状态：**deprecated / historical**。这是旧 `/cc-master:status` prompt-time status 入口的机制记录。目标机制已由 [ADR-030](../adrs/ADR-030-ccm-status-report-and-viewer-module.md) 迁到 `ccm status-report show` + `ccm/status-report/v1` artifact；旧 command 若短期保留，只能作为 deprecated shim 指向 `ccm status-report show`，不再作为正式入口、也不再承载报告渲染逻辑。
>
> 类别：legacy command（只读 board 摘要渲染）。源码：`commands/status.md`。命令体是注入 agent context 的 prompt——指示 agent 渲染一份按状态分组的 board 视图。**纯只读，不改 board。**

## 目标替代机制

`ccm status-report` 负责生成静态、可程序化、可缓存的状态报告：

- `render`：纯计算，输出稳定 JSON / human view，不写 artifact。
- `write`：原子写 `<home>/reports/status-report/` 下的 report artifact。
- `show`：用户入口，复用 fresh artifact 或按需刷新。
- `watch`：可选周期刷新；web viewer 不能依赖 watch 才正确。

Web viewer 的每块 board 页面通过 `/status-report.json?board=<file>` 读取同一 `ccm/status-report/v1` schema。下方旧 prompt 渲染流程只作为历史行为说明，供迁移时删除或压成 shim。

## 触发输入
- 历史入口：用户敲 `/cc-master:status`。目标入口是 `ccm status-report show`；Codex/Claude/plugin guidance 不应再把 `/cc-master:status` / `$cc-master-status` 作为正式入口。
- 读：cc-master home（`$CC_MASTER_HOME`，否则 `<project>/.claude/cc-master/`）下每块 `owner.active:true` 的 `<ts>-<pid>.board.json`；可选一次 `cc-usage.sh` 调用。

## 业务流
1. 认准要报告的 board：恰一块 active 用它；多块 active 按 `goal` 匹配正推进的目标；多块匹配/无一匹配/无法无歧义 → 向用户询问（列候选 + goal + 文件名），不靠猜。
2. 渲染按状态分组的 glanceable 视图（不堆段落散文）：① Header 行（goal 截断 · `done/total` · `git.branch` · pacing 备注）；② 按状态分组的任务区（Blocked-on-user 置顶醒目 → In flight 带 hedge 旗标 → Blocked-on-task → Ready → Done → 需注意(stale/failed/escalated/uncertain)，空组略过）。
3. 临界路径：agent **心算估计**的最长依赖链（board 无机器算的 float 字段），如实标为估计。
4. 只读 program-state 健康检查（全从已读 board 派生）：narrow-waist 完整性、deps 图一致性（悬空 deps / 环 / 可解锁却仍锁着）、过调度（`in_flight N / wip_limit M`，缺 wip_limit 跳过比对）、未答用户决策（`status:"blocked"` 且 `blocked_on:"user"` 双字段，已答的不报）、预算快照（跑 `cc-usage.sh` 读 5h/7d，标 source 是 account 权威还是 approx 反推）。

## 输出副作用
- 仅向用户渲染文本视图。**不修改 board**（命令体末行重申只读）。

## 关键不变式
- 只读——绝不写 board。
- 临界路径是 agent 心算估计、非机器 CPM（board 无 float 字段）。
- 未答用户决策必须 `status:"blocked"` AND `blocked_on:"user"` 双字段（与 `verify-board.js` 契约一致）——已 done 却残留 `blocked_on:"user"` 元数据的是已答决策，不报。

## 失败模式
- 多块 active 无法无歧义确定 → 询问用户，不靠猜（报错 board 无害——只读）。
- `cc-usage.sh` 缺/降级 → 预算快照标 `local-derived-approx`（reset 倒计时可能严重失真）。
