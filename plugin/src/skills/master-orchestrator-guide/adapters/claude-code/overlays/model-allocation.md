## Claude Code 分档

先运行 `ccm provider facts claude-code --json`，只让 `freshness:"fresh"` 且 `catalog_eligible_for_admission_check:true` 的候选进入下一道检查。静态 snapshot 的 `eligible_for_automatic_selection` 应保持 `false`；只有 live entitlement 与精确 selector admission 另有当前证据后，orchestrator 才能组合这些事实做分配。按 facts 返回的稳定 tier 做任务映射：

- `economy`：机械读扫、格式化与有强机械闸的窄叶子。
- `balanced`：调研摘要、常规文档与 acceptance 清楚的常规实现。
- `frontier`：高错误代价实现、独立 review、端点验收与架构仲裁。

`conditional` 只表示需要账号/计划资格证明，不等于全局不可用或自动可用。长会话主线固定一个已准入模型以保 prompt cache；省配额靠 leaf 分档，不靠中途反复切主线。不同家族二审只用于高杠杆验收，并记录分歧率校准收益。
