# OBJECTIVE — using-ccm

J_top: agent 要对 board 做读写时，**用 ccm 操作得对**——status 经合法生命周期 verb 转移（不当字段赋值、不踩 `ready→done`）、🔒 字段走专属命令（不 `--set`）、board 变更只走 ccm（不退回 Write/Edit 手改·被 board-guard 拦），不绕写关卡、不踩 footgun、不伪造审计轨迹（如造一个没 `started_at` 的 done）。

baseline_reference:
  user_task: 给 agent 一个具体 board 写操作（如"把端点验收过的 T3 标完成、带 artifact + verified"、"阻塞 T9 等用户决策"），看它用 ccm 落得对不对。
  without_skill_floor: 默认 agent 把 status 当普通字段——pressure baseline 实证：第一反应 `ccm task set T3 --status done`（无此命令·exit 2）、再 `ccm task update T3 --status done`（无此 flag·exit 2）、再直接 `ccm task done`（撞 `ready→done` 非法·exit 3），连试 3 个死路 + 一次 help-peek 才走通 `start`→`done`；逐字合理化："status 不过是个字段，改字段的通用 idiom 就是 set --field 值，我不用懂状态机，赋值就行。" 不知状态机、不知 🔒 守门、并可能踩 `--set status=`（exit 0 静默写 board 顶层 junk、根本没改任务）。
  expected_uplift: 把 strict_dim 从 floor 推过去——一上手就走对的 verb（status 用 start/done/block/set-status、先 start 再 done）、改 ✎ 字段才 `--set tasks[ID].field`、board 变更只走 ccm 不手改、撞闸读 exit code 纠偏而非 `--force` 硬推。

strict_dims: [board 写操作正确性（status 经合法转移 verb 而非字段赋值、🔒 字段走专属命令而非 --set、不产生静默写错 / 不伪造 derived 字段）]

rationale: 本 skill 的承重价值不在"会敲 ccm 命令"这个表面，而在纠正一个**具体且实证**的默认错误心智——"board 是 JSON 字典、status 是可赋值字段"。pressure baseline 2 逐字捕到这条合理化，它直接导致绕过状态机 / 静默写错 / derived 字段失真 / 伪造审计轨迹。命令面知识（命令 / flag / `--json` 形状）是 Pareto-可换的 reference（靠 `--help` + catalog 兜底），不入 strict_dim；唯有"按状态机 verb 操作、🔒 走专属命令"这条是不可回退的核心。单条 strict_dim，符合本仓"1-2 个 strict_dims"约束。

## 非目标（notes）

J 不要求 agent 背下全部命令面（那是 reference，`ccm <cmd> --help` 是当前领土）；只要求它**持有正确心智**、按 verb 操作、踩闸时读 exit code 纠偏，而非用 `--force` 硬推。也不评判 ccm 自身实现质量（那由 ccm 子产品的 CI + 测试守）——只评判 agent 用它用得对不对。
