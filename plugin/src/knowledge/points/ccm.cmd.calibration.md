---
point: ccm.cmd.calibration
---

## 权威陈述

<!-- ccm:k:start point:ccm.cmd.calibration -->
## namespace calibration（显式写校准语料）

### calibration capture

**写 home-level calibration store；只读 board**

```
ccm calibration capture [flags]
```

- positional：无
- 行为：复用 `estimate deadline-risk` 的同一预测计算路径，将捕获时的真实 backlog、预测 band / probability、coverage / confidence、WIP 与未回填 label 一起追加到 `<home>/calibration/deadline-snapshots.jsonl`。board 本身只读、不改窄腰字段。
- 稳定身份：`board_id` 是 canonical board 文件路径的 SHA-256 身份；同一 board 在不同采集时刻保持同一 `board_id`，避免用可变 goal / session 当实体键。
- 幂等：`snapshot_id = <board_id>@<captured_at_ms>`；同 board + 同 `--as-of` 重放不重复计数（`captured:false, duplicate:true`），不同 `--as-of` 是该 board 的新观察。无 deadline 时跳过落盘。
- 边界：本命令只采预测侧 observed snapshot；label 回填与 calibration flip 不在此命令内。`ccm estimate deadline-risk` 仍是纯只读、绝不创建 store。
- flags：

| flag | 短名 | 类型 | 取值 | 含义 |
|---|---|---|---|---|
| `--scope <v>` | | enum | `home`（默认）\| `this-repo` \| `this-board` | 历史语料范围（与 deadline-risk 同口径） |
| `--as-of <str>` | | ISO-8601 UTC | | 采集时刻；同 board+as-of 是幂等键（默认 now） |
| `--runs <n>` | | string | | MC trials（默认 2000） |
| `--seed <n>` | | string | | PRNG 种子（默认 42） |
| `--effective-n <n>` | | string | | 只缩 throughput 参考，不改 RCPSP verdict |
| `--json` | | bool | | 输出 `{captured,duplicate,dry_run,skipped_reason,store_path,snapshot}` |

- 例：`ccm calibration capture --json` · `ccm calibration capture --scope this-board --as-of 2026-07-20T12:00:00Z --json`

---

<!-- ccm:k:end point:ccm.cmd.calibration -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删掉这条，模型无法正确调用 calibration 命令，不知道 capture 的参数（scope/as-of/runs）、幂等性保证、与 deadline-risk 的分工。

calibration capture 的落盘路径、board_id 身份算法与幂等键都是本实现的具体事实。
