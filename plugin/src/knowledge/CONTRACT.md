# Skill knowledge source root

> Status: **K1 walking skeleton — validators/IR available; inventory still empty**
>
> This directory is an authored maintainer source root, not runtime prose and not a distributed
> knowledge claim.

未来 source layout：

```text
plugin/src/knowledge/
├── portfolio.json
├── changes/
└── skills/<skill>/{skill.json,modules/*.json}
```

K0 有意不提交空的 `portfolio.json`：机器 schema 要求真实 skill/module inventory，创建一份零内容或
不完整的 portfolio 会把 coverage debt 伪装成 source truth。当前唯一合法入口是：

```bash
node scripts/skill-knowledge.mjs check --stage K0
```

它必须报告 `SKG-COVERAGE-EMPTY` debt，但返回成功。K1 开始，同一缺口升级为 hard failure。

K1-03 已交付 standalone Draft 2020-12 validators、source loader、canonical/span hash、budget
estimator、marker/source-map 与 inventory attestation 模块；`contract --json` 中对应 capability
为 `true`。生成物携带 source schema SHA-256 fingerprint 与三份 emitted CJS bundle 的
SHA-256（`validators/schema-manifest.json`）；`validatorsAvailable()` / `check` 在 schema
bytes 或 bundle bytes 漂移时 fail closed（不加载被篡改的 validator），并提供
`generate-validators.mjs --check` 做无副作用 CI 门。

K1-04 四 host fixture probe + frozen adapter contract 已落地：`host_portability_probe`
capability=`true`。但 `check --host` CLI 集成尚未接通，带 `--host`/`--base` 的调用与
typed change transactions（`typed_change_transactions=false`）一样继续 exit 10——probe
模块已交付不等于 CLI flag 已接线。

不要把 design examples 复制到这里冒充已盘点完成的 runtime knowledge。

规范与机器合同：

- `design_docs/skill-knowledge-graph/specification.md`
- `design_docs/skill-knowledge-graph/schemas/knowledge-source.schema.json`
- `design_docs/skill-knowledge-graph/schemas/knowledge-change.schema.json`
- `design_docs/skill-knowledge-graph/schemas/knowledge-cli-output.schema.json`
- `design_docs/skill-knowledge-graph/cli-contract.md`
