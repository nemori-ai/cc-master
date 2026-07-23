# Schema examples

这些文件是 `v1alpha1` 的 schema/golden-input 示例，表达 **K1 目标形态**，不是当前 checkout 已完成的
knowledge inventory。`portfolio.json` 只是一份 **one-skill K1 pilot**；C14 所说的八个 runtime skills
由 CLI registry 与未来 accepted formal inventory 冻结，不能用这份 pilot 冒充全 portfolio。示例里的
Markdown marker 要到 pilot migration 时才写入 canonical source，因此 K0 contract tests 对 examples
只做 JSON parse、定向 contract assertion 与跨文件锁步检查。standalone Draft 2020-12 validators
（三份 emitted CJS bundle + fingerprint/integrity gate）已落地，
`full_json_schema_validation` capability=`true`；不得把示例里的 `full` coverage 当成已盘点
runtime inventory 现状。

读取顺序：

1. [portfolio.json](portfolio.json)
2. [master-orchestrator-guide.skill.json](master-orchestrator-guide.skill.json)
3. [verification.endpoint.module.json](verification.endpoint.module.json)
4. [endpoint-verification-split.change.json](endpoint-verification-split.change.json)
5. [endpoint-verification-split.workspace.json](endpoint-verification-split.workspace.json)
6. [endpoint-verification-split.validation.json](endpoint-verification-split.validation.json)
7. [operation-examples.json](operation-examples.json)
8. [report.json](report.json)

第 5、6 份只演示被 Git 忽略的本地 `begin → validate → apply` workspace 合同；真实 workspace 不提交。
`*.change.json` 才是 accepted tree 中 immutable ledger record，且不承载 Markdown bytes。

`operation-examples.json` 是 `knowledge-change.schema.json#/$defs/operation` 的 **fragment library**，
不是可被 accepted ledger 接受的 finalized change record。standalone Draft 2020-12 validators
已可用；当前 examples 门仍只锁定 fragment key 与 `op` 的 closed set，尚未把 `operations`
中每个值逐项跑过 `$defs.operation` 对应的 operation subschema instance validation——那是
examples 门覆盖缺口，不是 validator 未交付。

`report.json` 是双轨 report envelope 的 golden stub：它同时展示 structural 与 behavioral evidence
状态，但没有 holdout verdict，因此有意不含 improvement claim。
