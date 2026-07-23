# Schema examples

这些文件是 `v1alpha1` 的 schema/golden-input 示例，表达 **K1 目标形态**，不是当前 checkout 已完成的
knowledge inventory。示例里的 Markdown marker 要到 pilot migration 时才写入 canonical source，因此
K0 只应做 JSON Schema 与跨文件 ID 一致性验证，不得把示例的 `full` coverage 当成产品现状。

读取顺序：

1. [portfolio.json](portfolio.json)
2. [master-orchestrator-guide.skill.json](master-orchestrator-guide.skill.json)
3. [verification.endpoint.module.json](verification.endpoint.module.json)
4. [endpoint-verification-split.change.json](endpoint-verification-split.change.json)
