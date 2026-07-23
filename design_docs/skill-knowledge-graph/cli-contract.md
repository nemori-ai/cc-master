# Skill Knowledge CLI Contract

> Status: **v1alpha1 executable outer contract**
>
> Owner: `scripts/skill-knowledge.mjs`
>
> Scope: dev-only maintainer toolkit；不随 plugin 分发。

本文冻结 knowledge toolkit walking skeleton 的命令、JSON envelope、错误码与 K0 能力边界。领域
拓扑、source/change document 的规范仍分别以
[specification.md](specification.md)和 [schemas/](schemas/)为 SSOT。

JSON 输出的机器合同是
[knowledge-cli-output.schema.json](schemas/knowledge-cli-output.schema.json)。

## 1. Endpoint

从 repo root 调用：

```text
node scripts/skill-knowledge.mjs <command> [options]
```

全局：

```text
--help
--version
```

命令：

| Command | K0 状态 | 合同 |
|---|---|---|
| `contract [--json]` | implemented | 返回能力、plane、operation、invariant 与 exit-code registry |
| `check [--source <dir>] [--stage K0\|K1\|K2\|K3] [--json]` | implemented-k0 | 运行 K0 source scaffold checks |
| `compile` | declared | exit 10，`SKG-CAPABILITY-NOT-IMPLEMENTED` |
| `report` | declared | exit 10，`SKG-CAPABILITY-NOT-IMPLEMENTED` |
| `path` | declared | exit 10，`SKG-CAPABILITY-NOT-IMPLEMENTED` |
| `explain` | declared | exit 10，`SKG-CAPABILITY-NOT-IMPLEMENTED` |
| `change` | declared | exit 10，`SKG-CAPABILITY-NOT-IMPLEMENTED` |

Declared 命令存在是为了冻结 vocabulary 和让 agent fail loud，不代表对应能力已经交付。

## 2. JSON envelope

所有 `--json` 输出只向 stdout 写一个 JSON document；诊断不夹杂 ANSI/progress。

共同字段：

```json
{
  "schema": "cc-master/skill-knowledge-cli/v1alpha1",
  "ok": true,
  "command": "check",
  "result_kind": "check",
  "contract_version": "v1alpha1"
}
```

失败也使用同一 envelope：

```json
{
  "schema": "cc-master/skill-knowledge-cli/v1alpha1",
  "ok": false,
  "command": "compile",
  "result_kind": "diagnostic",
  "contract_version": "v1alpha1",
  "diagnostics": [
    {
      "severity": "error",
      "code": "SKG-CAPABILITY-NOT-IMPLEMENTED",
      "message": "compile is declared but not implemented in K0",
      "location": "scripts/skill-knowledge.mjs",
      "witness": {
        "command": "compile",
        "stage": "K0"
      },
      "remediation": "Implement the next admitted slice; do not treat this command as successful."
    }
  ]
}
```

每个 diagnostic 必须包含：

- `severity`: `error | warning | debt | info`
- `code`: 稳定 `SKG-*` code
- `message`
- `location`
- `witness`
- `remediation`

不得吞掉异常、输出空成功，或只返回自由文本。

`result_kind` 区分“用户要求执行哪个 `command`”与“本次 envelope 承载哪类结果”：

- `contract`：能力/词汇 registry；
- `check`：实际执行过 source check，因而必须带 stage、summary 与 capabilities；
- `diagnostic`：usage、declared-but-unavailable 或 unexpected failure；即使 `command=check`，
  也不伪造一份未执行的 check summary。

## 3. `contract`

JSON 结果必须包含：

- `implemented_commands`
- `declared_commands`
- `operations`
- `planes`
- `invariants`
- `exit_codes`
- `schemas`
- `source_layout`
- `capabilities`

`capabilities` 在 K0 必须诚实声明：

```json
{
  "source_json_parse": true,
  "source_envelope_validation": true,
  "global_id_uniqueness": true,
  "full_json_schema_validation": false,
  "markdown_binding": false,
  "graph_invariants": false,
  "runtime_projection": false,
  "hop_analysis": false,
  "typed_change_transactions": false
}
```

## 4. K0 `check`

默认 source root：

```text
plugin/src/knowledge
```

K0 真正执行：

1. source root 存在且是目录；
2. normative source/change schema 文件存在、可解析为 JSON；
3. 递归读取 source root 下 `*.json`；
4. 每份 document 可解析；
5. `schema_version`、`kind`、`id/change_id` envelope 合法；
6. authored document 顶层 ID 在 source root 内唯一；
7. 输出 document counts 与 coverage debt。

K0 明确不执行：

- 完整 JSON Schema；
- Markdown marker binding；
- cross-document owner/authority/edge invariants；
- graph SCC/diameter；
- per-host projection；
- change replay。

零 authored JSON 在 K0 是 `debt`、exit 0；在 K1+ 是 hard failure、exit 4。若 K1+ 已有
documents，但 full schema validator 尚未交付，则 fail loud、exit 10，不把 envelope check 冒充
full validation。

成功报告：

```json
{
  "schema": "cc-master/skill-knowledge-cli/v1alpha1",
  "ok": true,
  "command": "check",
  "result_kind": "check",
  "contract_version": "v1alpha1",
  "stage": "K0",
  "source_root": "plugin/src/knowledge",
  "summary": {
    "documents": 0,
    "portfolio": 0,
    "skill": 0,
    "module": 0,
    "change": 0,
    "errors": 0,
    "debts": 2
  },
  "capabilities": {},
  "diagnostics": []
}
```

`debts` 的精确数量可随 K0 scanner 增加诊断而变化；消费者依赖 code，不依赖数组位置。

## 5. Exit codes

| Exit | Meaning |
|---:|---|
| `0` | 当前 rollout stage 合同满足；可带 K0 debt |
| `2` | CLI usage/argument error |
| `3` | source parse/schema/envelope error |
| `4` | semantic invariant/coverage error |
| `5` | projection error |
| `6` | reachability/hop error |
| `7` | source/dist/change drift |
| `10` | capability declared but not implemented |
| `70` | unexpected internal error |

一次运行按最高优先级失败类别退出，但 JSON 中应保留同轮发现的全部 diagnostics。

## 6. Compatibility

- `schema` 或命令/字段发生 breaking change 时发布新 contract version。
- v1alpha1 内可以新增 diagnostic code、registry item 和 optional field。
- 不得改变已有 exit code 含义。
- human output 不承诺机器兼容；agent/CI 必须消费 `--json`。
- source/change schemas 的破坏性变化不通过本 CLI 文档暗改，必须先改机器 schema 与正式规范。
