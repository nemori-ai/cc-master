# Schema examples

这些文件是 `v1alpha1` 的 schema/golden-input 示例。K3 graph-only 正式 authored inventory 已落在
`plugin/src/knowledge/`；本目录的 portfolio / composition / candidate analysis / module / report
示例与之锁步，表达 **one-composition / three representative module samples** 形态（composition
本身消费正式全局 14 modules，不把示例目录当第二套 source tree）。C14 所说的八个 runtime skills 仍由 CLI registry 冻结，
本示例子集不得冒充全 portfolio。示例里的 Markdown marker 已写入 canonical source 并由正式
inventory 绑定；K0/K1 contract tests 对 examples 做 JSON parse、定向 contract assertion 与跨文件
锁步检查。standalone Draft 2020-12 validators（三份 emitted CJS bundle + fingerprint/integrity
gate）已落地，`full_json_schema_validation` capability=`true`；不得把示例里的 `full` coverage
当成已盘点全 portfolio runtime inventory 现状。

读取顺序：

1. [portfolio.json](portfolio.json)
2. [master-orchestrator-guide.composition.json](master-orchestrator-guide.composition.json)
3. [master-orchestrator-guide.analysis.json](master-orchestrator-guide.analysis.json)
4. [verification.endpoint.module.json](verification.endpoint.module.json)
5. [conduct.never-play.module.json](conduct.never-play.module.json)
6. [routing.worker-chain.module.json](routing.worker-chain.module.json)
7. [endpoint-verification-split.change.json](endpoint-verification-split.change.json)
8. [endpoint-verification-split.workspace.json](endpoint-verification-split.workspace.json)
9. [endpoint-verification-split.validation.json](endpoint-verification-split.validation.json)
10. [operation-examples.json](operation-examples.json)
11. [report.json](report.json)

第 8、9 份只演示被 Git 忽略的本地 `begin → validate → apply` workspace 合同；真实 workspace 不提交。
`endpoint-verification-split.validation.json` 是 **明确非成功** 的 envelope 形状 fixture（`candidate_valid:false`、
四 host stub abstention、带 example diagnostic），不是 live runtime 绿见证；成功见证只能来自
`change validate` 真实输出。
`*.change.json` 才是 accepted tree 中 immutable ledger record，且不承载 Markdown bytes。
typed change transactions 已实现；`change begin → validate → apply` 在 workspace 中冻结和验证候选，
仅在 rollback-safe publication 后写入 immutable ledger。

`operation-examples.json` 是 `knowledge-change.schema.json#/$defs/operation` 的 **fragment library**，
不是可被 accepted ledger 接受的 finalized change record。standalone Draft 2020-12 validators
已可用；当前 examples 门仍只锁定 fragment key 与 `op` 的 closed set，尚未把 `operations`
中每个值逐项跑过 `$defs.operation` 对应的 operation subschema instance validation——那是
examples 门覆盖缺口，不是 validator 未交付。

`report.json` 是双轨 report envelope 的 golden：同时展示 structural 与 behavioral evidence
状态；behavioral 为 `not_run`，因此有意不含 improvement claim。
