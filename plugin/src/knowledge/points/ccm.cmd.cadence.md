---
point: ccm.cmd.cadence
---

## 权威陈述

<!-- ccm:k:start point:ccm.cmd.cadence -->
## namespace cadence

**语法 / positional / 例一律以 `ccm <namespace> <verb> --help` 为准**（本节曾逐条复制它们，已交还——副本天然会过期）。下面只留 help 不说的：在这个 verb 上有额外语义的 flag、语义边界、跨 verb 规则。

节奏 / iteration 收口。

### cadence update

**写**

- flags（设 / 改节奏配置 target = `{ship_every, min_unit}`）：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--ship-every <dur>` | | duration | `target.ship_every`（如 `3h`） |
| `--min-unit <str>` | | string | `target.min_unit`（如 `"1 PR"`） |
| `--set <path=val>` | | string（可重复） | 通用设 ✎ 标量（裸 path 落 board 顶层；`tasks[<id>].path` 作用于该 task） |
| `--set-json <path=json>` | | string（可重复） | 通用设 ✎ 对象/数组（scoping 同左） |

### cadence open

**写**

- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--goal <str>` | | string | 本 iteration 目标 |
| `--set <path=val>` | | string（可重复） | 通用设 ✎ 标量（裸 path 落 board 顶层；`tasks[<id>].path` 作用于该 task） |
| `--set-json <path=json>` | | string（可重复） | 通用设 ✎ 对象/数组（scoping 同左） |

### cadence ship

**写**

- 行为：收口一个 iteration（成员须全 `done`+`verified`）
- flags：仅 global flags

### cadence status

**读**

- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--json` | | bool | 结构化输出 |

---

<!-- ccm:k:end point:ccm.cmd.cadence -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删掉这条，模型无法正确调用 cadence 命令，不知道 update/open/ship/status 的参数和行为。

cadence update/open/ship/status 的参数名与 iteration 收口条件是本工具专属约定，无法从通用知识推出。
