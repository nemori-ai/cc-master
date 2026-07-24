# Skill knowledge router behavioral eval

这套带外评测比较三种条件：

- `baseline`：同一 host 的 runtime skills，但删除 compiler 生成的 atlas、module router、point
  anchor、navigation block 与 entry pin；
- `candidate`：train cases + 当前 final-host router；
- `holdout`：冻结的 holdout cases + 当前 final-host router。

每个 split 各含 8 个 substantive cases，每个 runtime skill 恰好一个。case 的 ground truth 来自
当前 K2 authored graph，actor 只看到 prompt 与隔离后的 runtime surface，看不到 expected
point/module/owner 或评分规则。

这里的 ground truth 只认显式全局 `point:*` / `module:*` / `skill:*` ID 与 accepted
composition；绝不从 `knowledge/skills/<name>/`、runtime skill 目录或 Markdown path 反推
owner / membership。Markdown binding 只回答“证据原文落在哪”。当前 v1 loader 通过
`buildAndValidateGraph()` 消费现有 accepted skill/module refs；K3-01A 的全局 module +
skill-as-artifact composition envelope 落地后，应在这个 loader 边界接线，fixture、grader
和指标协议不需要依赖其物理布局。

## 执行

只允许 Codex 与 Cursor：

```bash
node scripts/skill-knowledge-behavior-eval.mjs run \
  --condition baseline --harness codex --runs 3
node scripts/skill-knowledge-behavior-eval.mjs run \
  --condition baseline --harness cursor --runs 3
node scripts/skill-knowledge-behavior-eval.mjs run \
  --condition candidate --harness codex --runs 3
node scripts/skill-knowledge-behavior-eval.mjs run \
  --condition candidate --harness cursor --runs 3
node scripts/skill-knowledge-behavior-eval.mjs run \
  --condition holdout --harness codex --runs 3
node scripts/skill-knowledge-behavior-eval.mjs run \
  --condition holdout --harness cursor --runs 3

node scripts/skill-knowledge-behavior-eval.mjs aggregate
node scripts/skill-knowledge-behavior-eval.mjs publish
```

Codex 以 `read-only` sandbox 运行。Cursor 固定使用只读 `ask` mode；当前受支持的 runner
显式关闭 Cursor kernel sandbox，因为部分 worker 主机内核低于其 v6.2 要求。Cursor 的隔离边界
因此是一次性临时 workspace + ask mode + prompt 禁止读取父目录，而不是内核级 syscall
隔离；发布证据时必须保留这一限制，不得把它描述成等强 sandbox。Cursor 默认模型是本机
first-party catalog 的 `cursor-grok-4.5-high`（`cursor-grok-4.5` 是模型家族名，不是当前
CLI 可直接调用的精确 model id）。

默认 raw run 落在本目录 `.runs/`，由 `.gitignore` 排除。`publish` 只把当前 graph hash、执行覆盖、
聚合指标、verdict 与 raw evidence 的相对 ref 写入 `evidence.json`；它不提交 transcript。
兼容性探针或旧 runner 留下、但没有当前 `protocol_version` 的 raw/run 可以保留用于诊断；
聚合 freshness gate 会确定性丢弃它们，因此磁盘文件数不等于纳入指标的 run 数。

可用 `--case <case-id>` 跑单例 baseline，`--dry-run` 只构建隔离 surface 和 prompt，不调用模型。

## 指标与诚实边界

- `point_hit_accuracy`、`owner_accuracy`、`module_accuracy`、`wrong_owner_rate` 由冻结 ground truth
  确定性判定。
- `evidence_grounding_rate` 要求 point/owner/module 全对，path 对应 expected binding，且 quote
  是 canonical span 的精确子串。
- `navigation_hops` 只接受隔离 final Markdown 中可复验的逐跳链接；搜索、prose mention、
  authority/containment 不计 hop。
- `reads` 是 actor 声明且工具验证为 surface 内真实文件的 trace；字段明确标为
  `validated_agent_trace`，不能冒充 host syscall telemetry。
- `estimated_tokens` 使用与知识图 budget 相同的 `ceil(UTF-8 transcript bytes / 3)`，
  明确不是 provider tokenizer；若 host JSONL 提供 usage，另记 `provider_reported_tokens`。

只有 baseline/candidate/holdout 的 8 skills × 2 harnesses × 3 runs 全部齐备，才允许
`holdout_verdict`。覆盖不足时状态最多是 `baseline` 或 `candidate`，verdict 必为
`inconclusive`，不得生成 improvement claim。

## 与 CI 的边界

LLM runs 不进入 `run-tests.sh` 或 GitHub Actions hard gate。CI 只验证 fixture、grader、surface
隔离、聚合与 report 分轨合同；实际 Codex/Cursor 调用是耗 token、有方差的 pre-release evidence。
