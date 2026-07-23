# Skill knowledge source root

> Status: **K0 scaffold — inactive inventory**
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

规范与机器合同：

- `design_docs/skill-knowledge-graph/specification.md`
- `design_docs/skill-knowledge-graph/schemas/knowledge-source.schema.json`
- `design_docs/skill-knowledge-graph/schemas/knowledge-change.schema.json`
- `design_docs/skill-knowledge-graph/schemas/knowledge-cli-output.schema.json`
- `design_docs/skill-knowledge-graph/cli-contract.md`

不要把 design examples 复制到这里冒充已盘点完成的 runtime knowledge。
