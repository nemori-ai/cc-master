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

| Command | 状态 | 合同 |
|---|---|---|
| `contract [--json]` | implemented | 返回能力、plane、operation、invariant 与 exit-code registry |
| `check [--source <dir>] [--stage K0\|K1\|K2\|K3] [--host <host>] [--base <git-ref>] [--json]` | implemented-k1-pilot | K0 只执行 scaffold；K1+ 对 pilot source 跑 schema + binding + inventory + graph invariants。`--host/--base` 仍 exit 10 |
| `compile [--host <host>] [--check] [--json]` | implemented-k1-pilot | 四 host runtime projection + final surface verifier；`result_kind=compile`；`--check` 对已提交 dist 做 byte drift 门 |
| `report [--format json\|markdown] [--host <host>] [--source <dir>] [--json]` | implemented-k1-pilot | `result_kind=report`；分轨 `structural_status` / `behavioral_evidence_status`；含 graph hash、counts、witness、remediation。`--host` 仍 exit 10 |
| `path --from <id> --to <id> --host <host> [--source <dir>] [--json]` | implemented-k1-pilot | `result_kind=path`；在 **authored navigation plane**（`runtime.enabled_by_default`）上 BFS；对不存在 / 歧义 / 不可达 fail closed，带 shortest-path witness |
| `explain <id-or-code> [--source <dir>] [--json]` | implemented-k1-pilot | `result_kind=explain`；解释 entity 或 diagnostic code；歧义 / 缺失 fail closed |
| `change begin\|validate\|apply` | implemented-k1 | ignored candidate workspace 中的 typed change transaction；`begin → validate → apply` fail-closed 事务链 |

`check --host|--base` / `report --host` 仍为 declared-unavailable。K1 pilot 的 authored `path`/`hop_analysis` **不替代** final-host H1–H4（那由 `compile` + `runtime_projection=true` 证明）。

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
  "command": "check",
  "result_kind": "diagnostic",
  "contract_version": "v1alpha1",
  "diagnostics": [
    {
      "severity": "error",
      "code": "SKG-CAPABILITY-NOT-IMPLEMENTED",
      "message": "check --host is declared but not implemented in K1 pilot",
      "location": "scripts/skill-knowledge.mjs",
      "witness": {
        "command": "check",
        "option": "--host",
        "value": "codex",
        "stage": "K1"
      },
      "remediation": "Omit --host/--base until changed-scope / host portability slices land; do not treat this option as successful."
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
- `hardening_contract`

`hardening_contract` 固定包含 `C1`–`C14`，让后续实现和 CI 不从 prose 猜字段。其最小机器形状：

```json
{
  "C1": {"entry_surface_fields": ["host", "source_file", "binding", "surface_kind", "targets", "lifecycle"]},
  "C2": {"coverage_states": ["full", "partial", "non_knowledge", "excluded"], "denominator": "git_canonical_markdown"},
  "C3": {"derived_fields": ["canonical", "review_policy", "reviewed_canonical_sha256"]},
  "C4": {"accepted_skill_requires_admission": true},
  "C5": {"change_workflow": ["begin", "validate", "apply"], "workspace_root": ".skill-knowledge/workspaces/<change-id>"},
  "C6": {"algorithm": "cc-master/skill-knowledge-canonical-graph-hash/v1", "authored_manifest_kinds": ["portfolio", "skill", "module"], "change_head_digest_excludes": ["result_graph_sha256"], "identity_set_fields": ["skills", "modules", "points", "edges", "entries", "canonical_source_inventory", "inventory", "entry_modules", "relevant_entries", "primary_points", "point_ids"], "semantic_order_fields": ["operations", "when", "avoid_when", "recognition_cues", "includes", "excludes", "unresolved_coverage_debt", "evidence", "verifiers", "targets", "results", "edge_rewrites", "surfaces", "host_coverage", "runtime_hosts", "scope"]},
  "C7": {"algorithm": "cc-master/skill-knowledge-markdown-span-hash/v1", "newline_normalization": "crlf-to-lf"},
  "C8": {"algorithm": "cc-master/skill-knowledge-budget-estimator/v1", "formula": "ceil(utf8_bytes/3)"},
  "C9": {
    "hosts": ["claude-code", "codex", "cursor", "kimi-code"],
    "worker_allowlist": ["codex", "cursor"],
    "payload_modes": ["canonical", "partial", "stub"],
    "anchor_form": "explicit-html-id",
    "path_policy": "relative-final-host-path"
  },
  "C10": {"changed_scope_base_option": "--base", "immutable_chain": true},
  "C11": {"k2_allows_partial": false},
  "C12": {"report_tracks": ["structural_status", "behavioral_evidence_status"]},
  "C13": {"research_supersession_required": true},
  "C14": {"runtime_skill_count": 8, "governance_meta_skill_is_runtime": false}
}
```

数组顺序是 contract 输出顺序；消费者不得按 object key 的序号推断语义。

`capabilities` 在当前 K1 pilot 切片必须诚实声明已交付能力：

```json
{
  "source_json_parse": true,
  "source_envelope_validation": true,
  "global_id_uniqueness": true,
  "full_json_schema_validation": true,
  "markdown_binding": true,
  "graph_invariants": true,
  "runtime_projection": true,
  "hop_analysis": true,
  "typed_change_transactions": true,
  "entry_surface_binding": true,
  "canonical_source_inventory": true,
  "derived_freshness": true,
  "canonical_graph_hash": true,
  "deterministic_budget_estimator": true,
  "host_portability_probe": true,
  "semantic_coverage": true,
  "behavioral_evidence_tracking": false
}
```

K0 `check` 仍只执行 envelope/id 扫描（不跑完整 JSON Schema），但一旦 standalone validator
已提交进仓且与 source schema bytes 的 fingerprint 以及 emitted CJS bundle digests 一致，
`full_json_schema_validation` 必须为 `true`，且不得再报告
`SKG-SCHEMA-VALIDATOR-UNAVAILABLE` / `SKG-SCHEMA-VALIDATOR-STALE` debt。
schema bytes 或任一 validator bundle bytes 漂移/被篡改时 `validatorsAvailable()` 必须为
false（fail closed，不加载被篡改代码），K0 记 debt、K1+ fail loud（exit 10）。
CI 用无副作用的 `node scripts/skill-knowledge/generate-validators.mjs --check` 卡漂移。
K1+ `check` 才对 authored documents 执行完整 Draft 2020-12 校验，并在 pilot source 上跑
binding / inventory / authority / edge / pin-budget / entry-surface 不变式。

`host_portability_probe` 为 **true**：C9 四 host fixture probe + frozen adapter contract 已落地。
诚实区分：probe 模块已交付 ≠ `check --host` CLI 已接线；带 `--host`/`--base` 的 `check`
以及 `report --host` 仍 exit 10。

`runtime_projection` 为 **true**：`compile` 已接通四 host final surface；H1–H4 由 compile
verifier 在真实 link/anchor 上证明。authored `path` 仍只覆盖 authored navigation plane。

仍为 `false`、留给后续切片的 capability：

- `behavioral_evidence_tracking`

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

K0 `check --host` 或 `check --base` 必须返回 exit 10 和
`SKG-CAPABILITY-NOT-IMPLEMENTED`；不得把它们当未知参数返回 exit 2，也不得忽略参数后执行缩小版
检查。`--base` 只在 K1+ 解释 PR changed scope，routine full check 的 coverage denominator 始终是
Git 中全部 canonical Markdown。

零 authored JSON 在 K0 是 `debt`、exit 0；在 K1+ 是 hard failure、exit 4。K1+ 对已有
documents 执行 committed standalone Draft 2020-12 validator；若 validator 文件缺失则 fail
loud、exit 10，不把 envelope check 冒充 full validation。

成功报告（K0 对已落盘的 K1 pilot source 做 envelope 扫描；不再报 `SKG-COVERAGE-EMPTY`）：

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
    "documents": 5,
    "portfolio": 1,
    "skill": 1,
    "module": 3,
    "change": 0,
    "errors": 0,
    "debts": 0
  },
  "capabilities": {
    "source_json_parse": true,
    "source_envelope_validation": true,
    "global_id_uniqueness": true,
    "full_json_schema_validation": true,
    "markdown_binding": true,
    "graph_invariants": true,
    "runtime_projection": true,
    "hop_analysis": true,
    "typed_change_transactions": true,
    "entry_surface_binding": true,
    "canonical_source_inventory": true,
    "derived_freshness": true,
    "canonical_graph_hash": true,
    "deterministic_budget_estimator": true,
    "host_portability_probe": true,
    "semantic_coverage": true,
    "behavioral_evidence_tracking": false
  },
  "diagnostics": []
}
```

空 source root 时 K0 仍报 `SKG-COVERAGE-EMPTY` debt（见 focused empty-fixture tests）。`summary.debts` 与 `diagnostics[].code` 必须与可执行 `check --stage K0` 锁步；消费者依赖 code，不依赖数组位置。

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

## 6. K1 change workspace 与 report 合同

`change begin --op <type> --scope <path...> --base <git-ref>` 创建 ignored workspace，并冻结 resolved
base ref、base graph hash 与 scope file hashes。agent 只编辑 `candidate/`。

`change validate <workspace>` 必须对完整 candidate graph 的 schema、marker/binding、membership、authority、admission、edge endpoint、inventory freshness 与 typed-operation precondition 验证，计算 result graph
hash 与 patch；只有 optimistic lock、scope hash 和 `git apply --check`
全部通过才产生 `candidate_valid: true`。

`change apply <workspace>` 必须重验 accepted scope 后全有或全无写入；成功写入后才 finalized immutable
change record。任一 scope stale/dirty/写失败都拒绝部分写入和 ledger finalize。closed operation set 保持：
`add / wording / refine / move / split / merge / transfer_owner / deprecate / retire`。

`report` envelope 的 `result_kind` 为 `report`，并同时含：

- `structural_status.state`: `pass | fail | debt | not_run`；
- `behavioral_evidence_status.state`: `not_run | baseline | candidate | holdout_verdict`；
- 可选 `graph_hash`（C6 canonical graph hash）与稳定排序的 counts / diagnostics；
- 行为证据未到 `holdout_verdict` 时不得出现 improvement claim。

`path` 成功 envelope 的 `result_kind` 为 `path`，必含 `path_query` + `path_result`
（`reachable` / `hops` / `witness`；可达时附稳定排序的 `nodes`/`edges`）。
`path_result.hops` 合同：`reachable:true` 时必须是非负 integer；`reachable:false` 时必须是
`null`（不可达不是 0 跳）。不可达失败 envelope 仍可附带 `path_query`/`path_result`，且须通过
standalone output validator。
`explain` 成功 envelope 的 `result_kind` 为 `explain`，必含 `explain_target` + `entity`
（含 authority / binding / inbound / outbound / witness 等可选字段）。
实体 `explain` 要求当前 graph `built.ok`；仅显式 `SKG-*` diagnostic code 可在图不健康时解释。
`path --host` 严格限 C9 四 host；`report --format` 严格限 `json|markdown`；未知值非零退出并带
machine diagnostic。任一查询对缺失 ID、歧义解析或断边不可达必须 `ok:false` 且 diagnostics 带
witness + remediation。

## 7. Compatibility

- `schema` 或命令/字段发生 breaking change 时发布新 contract version。
- v1alpha1 内可以新增 diagnostic code、registry item 和 optional field。
- 不得改变已有 exit code 含义。
- human output 不承诺机器兼容；agent/CI 必须消费 `--json`。
- source/change schemas 的破坏性变化不通过本 CLI 文档暗改，必须先改机器 schema 与正式规范。
