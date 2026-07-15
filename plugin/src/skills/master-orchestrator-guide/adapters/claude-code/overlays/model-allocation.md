## Claude Code 分档

- 机械读扫、格式化与有强机械闸的窄叶子用 Haiku。
- 调研摘要与常规文档用 Sonnet。
- 难实现、correctness-critical、复杂并发根因与常规 review 用 Opus。
- 高杠杆独立 review、端点验收、架构仲裁与不可逆裁决用当前可用的最强裁决档；Fable 不可用时改投 Opus 4.8。

长会话主线固定一个模型以保 prompt cache；省配额靠 leaf 分档，不靠中途切主线 `/model`。subagent 有独立 cache，按每个 subagent 的任务分档。不同家族二审只用于高杠杆验收，并持续记录分歧率校准收益。
