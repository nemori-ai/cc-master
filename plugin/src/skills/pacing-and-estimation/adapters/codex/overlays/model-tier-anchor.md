## 心智锚 4：模型档位需要 Codex provider mapping

不要套用 Claude model tier 表。Codex 的模型、reasoning effort、Fast tier 和价格/限额语义需要单独 provider mapping；本 adapter 当前没有编码这张表。

临时选择时用任务难度描述：

- 简单读扫、检索、格式化：低成本 / 快速配置。
- 复杂设计、端点验收、跨文件推理：高能力 / 较高 reasoning。
- 临界路径和不可逆决策：优先质量，不为省小成本牺牲正确性。
