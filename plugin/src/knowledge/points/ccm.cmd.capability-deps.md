---
point: ccm.cmd.capability-deps
---

## 权威陈述

<!-- ccm:k:start point:ccm.cmd.capability-deps -->
## namespace capability

### capability check

**只读、零写**：检查当前独立发版的 ccm 是否兑现指定稳定 capability。

```bash
ccm capability check <capability-id> [--json]
```

- 当前稳定 id：`board-init/structured-board-path-v1`、`goal-contract/v1`、`goal-deadline/v1`。
- 支持时 exit 0 + `supported:true`；未知/不支持时 exit 3。plugin bootstrap 用它/等价 init capability envelope 做写前握手。

### capability list

**只读、零写**：声明本 ccm 兑现的**全部** capability + 版本，作跨版本斜错协商的基础清单。

```bash
ccm capability list [--json]
```

- `--json` 输出结构化清单：`{ "schema": "ccm/capability-manifest/v1", "ccm_version": "<本 ccm 版本>", "capabilities": [ { "id", "name", "version" } ] }`。
- 当前 capabilities（append-only·顺序稳定）：`board-init/structured-board-path-v1`、`goal-contract/v1`、`goal-deadline/v1`。
- 新 plugin 遇旧 ccm 时枚举它做降级判断：想用的 id 不在清单里 → 关掉对应功能或提示用户「升级 ccm 到兑现该 id 的版本」。

### capability negotiate

**只读、零写**：consumer 声明可接受的 capability id 集，engine 返回双方交集里版本最高的一项，或 exit 3 明确拒绝。

```bash
ccm capability negotiate <capability-family> --accept <capability-id> [--accept <capability-id>...] [--json]
```

- `<capability-family>`：能力族名（如 `goal-deadline`）。
- `--accept`：可重复；每项为完整 id（如 `goal-deadline/v1`）或同族版本后缀（如 `v1`）。
- 成功时 `--json` 输出：`{ "schema": "ccm/capability-negotiation/v1", "family", "capability", "version", "negotiated": true }`。
- 无兼容版本时 exit 3，错误信息列出 consumer 接受集与本 ccm 声明集。
- 与 `check` 互补：`check` 断言单个 id；`negotiate` 供 consumer 前向声明多版本（含未来 vN）后由 engine 选定实际兑现项。plugin `deadline-risk` 周期条目经此协商 `goal-deadline` 后再调 `ccm estimate deadline-risk`。

## namespace target

declared-mode v1 的接收端目标。所有 Git 解析只读本地 object database，固定
`GIT_NO_LAZY_FETCH=1` / 禁交互；不 fetch、不起 daemon。CLI registry 只有两级 noun+verb，故设计里的
`delivery target <verb>` 落成等义的 `target <verb>`。

### target set

**写**：`ccm target set <target-id> --kind git-ref --ref <ref> [--repository <local-worktree>]`
或 `ccm target set <target-id> --kind artifact-set --namespace file:/abs/manifest.json`。
本地解析后写 `delivery_contract.mode=declared` 与冻结 snapshot；缺 `--repository` 时用
`board.git.worktree`。支持全局 `--dry-run`。

### target show

**读**：`ccm target show <target-id> [--json]`。同时返回声明、冻结 snapshot 与当前本地
`current|drift|unknown` fact；missing object 是 unknown，不隐式联网补齐。

### target refresh

**写**：`ccm target refresh <target-id> [--dry-run] [--json]`。本地重解 snapshot；ref drift 后旧
observation 不再授权。exact/artifact proof 可按新 snapshot 重验；即使某次刷新记录 negative/unknown，后续刷新仍从
保留的原始 proof method 重试并可恢复为 delivered。reviewed reconciliation 必须重新提供 fresh review binding。

## namespace delivery

### delivery check

**读**：`ccm delivery check <task-id> <target-id> [--json]`。返回 `qualified|unqualified|unknown`、
`candidate_complete`、`target_delivered`、`qualified_by` 与稳定 diagnostic codes。blocked/unknown 是可读事实，
exit 0；命令本身坏输入/坏契约才非零。

### delivery audit

**读**：`ccm delivery audit --strict-dry-run [--json]`。把本次未声明 edge 临时视为 unknown，列全 edge
qualification。它不写板，也不把 `delivery_contract.mode` 改成 strict；declared-mode v1 没有 strict-default 写口。

## namespace dependency

### dependency require

**写**：`ccm dependency require <downstream-id> <dependency-id> --level candidate|delivered
[--target <target-id>] [--dry-run] [--json]`。只写 exact 既有 `deps[]` edge；`delivered` 必须给已声明 target，
`candidate` 不得带 target。

### dependency default

**写**：`ccm dependency default <downstream-id> --level candidate|delivered [--target <target-id>]`。
写该 downstream 的 `*` fallback；exact key 优先。它不创建或改写 `deps[]`。

### dependency explain

**读**：`ccm dependency explain <downstream-id> <dependency-id> [--strict-dry-run] [--json]`。解释派生
qualification 与 diagnostic codes；不持久化布尔。显式 edge 一律先要求上游 true-done，review
`REQUEST-CHANGES` / 缺 APPROVE 优先 fail closed。

### dependency waive

**写**：`ccm dependency waive <downstream-id> <dependency-id> --target <target-id> --reason <text>
--expires-at <UTC> --user-authorized [--dry-run] [--json]`。只接受已存在的 exact delivered requirement；waiver
精确绑定 downstream/dependency/target、过期即失效。缺 `--user-authorized` → exit 7。成功资格输出
`qualified_by:"waiver"` 且 `target_delivered:false`，绝不伪造交付事实。`--set-json` 不能替代本命令写 waiver。

---

<!-- ccm:k:end point:ccm.cmd.capability-deps -->
