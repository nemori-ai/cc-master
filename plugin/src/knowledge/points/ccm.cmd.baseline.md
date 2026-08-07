---
point: ccm.cmd.baseline
---

## 权威陈述

<!-- ccm:k:start point:ccm.cmd.baseline -->
## namespace baseline

**语法 / positional / 例一律以 `ccm <namespace> <verb> --help` 为准**（本节曾逐条复制它们，已交还——副本天然会过期）。下面只留 help 不说的：在这个 verb 上有额外语义的 flag、语义边界、跨 verb 规则。

EVM 计划基线（plan baseline）：从当前 tasks 的 `estimate` + `deps` 快照成 `board.baseline`（`task_estimates` + `dag_snapshot` + `bac_h`），供 estimate 引擎算 EVM / SPI。**board 内唯一写 noun**——`usage` / `estimate` 两 namespace 纯只读，baseline 刻意置于只读之外（写关卡）。

### baseline snapshot

**写**

- 行为：从当前 tasks 快照 `board.baseline`；**已存在则 exit 3（VALIDATION）**——用全局 `--force` 覆盖，或 `baseline reset` 移旧入 history
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--force` | `-f` | bool（全局） | 已有 baseline 时覆盖（否则 exit 3） |
| `--dry-run` | `-n` | bool | 试跑不落盘 |
| `--json` | | bool | 结构化输出 |

### baseline show

**读**

- 行为：只读当前 `board.baseline`；无 baseline 也 exit 0（`has_baseline:false`）
- flags：`--json`（结构化输出）

### baseline reset

**写**

- 行为：re-baseline——旧 baseline 进 `history[]`（只增不删）+ 建新快照；**非 TTY 须 `--yes`**（破坏性）
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--yes` | `-y` | bool | 非 TTY 确认（破坏性操作） |
| `--json` | | bool | 结构化输出 |

---

{{USING_CCM_POLICY_NAMESPACE}}

### policy show

`ccm policy show [--json]` 只读 stored policy 与 effective 值。

### policy set

`ccm policy set --autonomous-account-switch <allow|deny> --user-authorized [--json]`

`--autonomous-account-switch` 必填；非 TTY 必须由用户明确授权 `--user-authorized`。host overlay
仍可把账号切换能力收窄为永久 unsupported；policy 字段存在不等于该 host 能执行 mutation。

---

<!-- ccm:k:end point:ccm.cmd.baseline -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删掉这条，模型无法正确调用 baseline 命令，不知道各参数含义和行为差异（snapshot vs show vs reset）。

主体是 baseline 三个 verb 的语法、flag 与已存在时的 exit 3 行为，纯命令事实。
