---
description: '渲染一份 cc-master board 摘要——进度、阻塞、临界路径估计（agent 心算，非机器算的 CPM）、以及等待用户拍板的决策。'
---

读取你的编排 board，渲染一份**可一眼扫完、按状态分组**的 board 视图——精神上对标 Claude Code `/workflow` 那种分层、活的、glanceable 进度大纲，只不过映射到 cc-master 的 DAG。Board 集中住在 cc-master home 下的 `boards/` 子目录，以 `<timestamp>-<pid>.board.json` 命名。home 解析：`$CC_MASTER_HOME` 优先，否则 `$CLAUDE_CONFIG_DIR/cc-master`（`CLAUDE_CONFIG_DIR` 默认 `$HOME/.claude`）——全局、用户级、不再 per-project。

先确定要报告哪块 board：

1. 列出 `<home>/boards/`，读取其中每一块 `owner.active` 为 `true` 的 `<timestamp>-<pid>.board.json`。
2. 若恰好只有一块 active，就用它。
3. 若有多块 active，把每块 board 的 `goal` 字段与你当前正在推进的目标做匹配，用匹配上的那块。
4. 若多块匹配、无一匹配、或你无法无歧义地确定 board，**向用户询问该报告哪块 board**（列出候选 board 及其 `goal` 与文件名），不要靠猜。

然后渲染 board 视图。求**可扫性**：先一行 header，再按状态分组、每个任务一行紧凑摘要，最后是健康检查。别堆成段落散文。

**1) Header 行（一眼定位）**——一行给出：`goal`（截断到能扫的长度）· 进度 `done/total`（done 含 `verified`）· `git.branch` · 一条预算/pacing 备注（数字来自下面预算快照那次 `ccm usage advise` 调用——保留它）。

**2) 按状态分组的任务区**——每组一个清楚的视觉小节标题，组内每个任务一行：`<id> · <title>` 加该状态相关的那一点细节。空组直接略过不渲染。建议分组与顺序（把最需要人看的放最上）：

- **⛔ Blocked-on-user（`status:"blocked"` 且 `blocked_on:"user"`）—— 置于最顶、醒目凸显。** 一个长跑的 orchestrator 绝不能默默卡在一个用户闸上；每行给出 `<id> · <title>`（即等用户拍板的那个决策）。**没有这类任务则整组省略**（别渲染一个空的「无」）。
- **▶ In flight（`in_flight`）**——每行：`<id> · <title>` + `mechanism`/`handle` + 自 `dispatched_at` 起的已耗时；对任何已超过其类别 p95 时长、可作 hedge 候选的任务，行尾打一个 hedge 旗标（如 `⚠ p95-超时·可 hedge`）。
- **⛔ Blocked-on-task（`status:"blocked"` 且 `blocked_on:"<taskid>"`）**——每行：`<id> · <title>` + `阻塞于 <taskid>`。
- **◷ Ready（`ready`）**——每行：`<id> · <title>`（依赖已满足、待派发）。
- **✓ Done（`done`，含 `verified`）**——每行：`<id> · <title>` + `artifact`。
- **⚠ 需注意（`stale` / `failed` / `escalated` / `uncertain`）**——把这几类非常态汇到一组、每行标出各自 status，凸显需要路由处置。

**3) 临界路径（Critical path）**：平凡小图你**心算**那条通往目标的最长依赖链（沿 `deps` 看哪条串行链最长）即可，如实呈现为估计。拓扑复杂、心算易错时，跑 `ccm board critical-path --json` 拿**机器算的 CPM**（带 `weight_source` 诚实标注）——这是 board v2 权威的临界路径算法（取代旧的带外 CPM 脚本）。别为一张平凡小图仪式性跑它。

然后跑这些**只读的健康检查**——结构校验**委托 ccm**（board v2 的权威校验关卡），命令只渲染结果 + 补 lint 不覆盖的判断型项。不发明任何新状态，不写回任何东西：

- **结构校验（委托 `ccm board lint --json`）**——跑它拿权威结构校验：JSON 合法性、narrow-waist（`schema`/`goal`/`owner` + 每任务 `id`/`status`/`deps`）、deps 图（悬空 dep、环、可解锁却仍锁着）、R7 rollup 一致性、R8 decision_package 完整性。把它的 `violations`（按 `level`=error/warn + 关联 `task` 分组）如实渲染；有 hard error（exit 3）醒目标出。**别再手检这些**——lint 是 SSOT，手检只会与它分叉。
- **过度调度（Over-scheduling·lint 不覆盖的判断项）**：统计 `in_flight` 任务数，与 `scheduling.wip_limit` 比对（弹性边界·可能缺失：缺失就明说并跳过比对，别假定有上限）。报告 `in_flight N / wip_limit M`；达到或超出上限时标出，提示下回合别再加、考虑推迟高 float 的活。
- **未答的用户决策（Unanswered user decisions·判断项）**：列出每个 `blocked_on:"user"`（`status` 为 `blocked` 或 `in_flight` 都算）的任务的 `title`——这些是编排者正等用户拍板的决策。一个已解决却仍残留 `blocked_on:"user"` 元数据的任务是**已答**，别报成未答。把真正未答的醒目凸显出来（一个长跑的 orchestration 绝不能默默卡在一个未答的用户闸上）。
- **预算快照（Budget snapshot·委托 `ccm usage advise --json`）**：在 pacing 决策前跑它，拿账户权威的双侧走廊 verdict（`throttle` 临界减速 / `accelerate` 欠用或切号加速 / `hold` 走廊内 / `hard_stop` 7d 硬总闸）+ `window_5h_pct` / `window_7d_pct` + 推荐 lever。把 verdict 与两窗用量数字呈现出来。账户信号不可得时它优雅降级（`available:false` + `hold`）——照实说「配额信号暂不可得」，别自己反推。

**下一步（Next·让 status 直接可行动）**——别只报状态，给出能立刻接的动作：

- **可派发（Ready to dispatch）**：跑 `ccm board next --json` 拿现在依赖已满足、可派发的任务 id 列表（权威 readySet），逐个列出 `<id> · <title>`。空列表就说「当前无可派发任务」。
- **等你拍板（Awaiting you）**：对每个 `blocked_on:"user"` 的节点，读它 `decision_package.enter_cmd`，把它**原样**呈现成一条可复制的 `/cc-master:discuss <node-id> …` 命令——让用户一键开一场有备而来的采访式讨论，不用自己拼参数。`enter_cmd` 缺失时退而给 `/cc-master:discuss <node-id>`。

想看可视化的 DAG 图（节点 + 边的 xyflow 本地 webview），跑 `/cc-master:view`。

不要修改 board；这是只读的。
