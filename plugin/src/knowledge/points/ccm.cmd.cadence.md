---
point: ccm.cmd.cadence
---

## 权威陈述

<!-- ccm:k:start point:ccm.cmd.cadence -->
## namespace cadence

节奏 / iteration 收口。

### cadence update

**写**

```
ccm cadence update [flags]
```

- positional：无
- flags（设 / 改节奏配置 target = `{ship_every, min_unit}`）：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--ship-every <dur>` | | duration | `target.ship_every`（如 `3h`） |
| `--min-unit <str>` | | string | `target.min_unit`（如 `"1 PR"`） |
| `--set <path=val>` | | string（可重复） | 通用设 ✎ 标量（裸 path 落 board 顶层；`tasks[<id>].path` 作用于该 task） |
| `--set-json <path=json>` | | string（可重复） | 通用设 ✎ 对象/数组（scoping 同左） |

- 例：`ccm cadence update --ship-every 3h --min-unit "1 PR"`

### cadence open

**写**

```
ccm cadence open <iter-id> [flags]
```

- positional：

| 名 | 必填 | 含义 |
|---|---|---|
| `<iter-id>` | 是 | iteration id |

- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--goal <str>` | | string | 本 iteration 目标 |
| `--deadline <str>` | | ISO-8601 UTC | 截止时刻（严格 `YYYY-MM-DDTHH:MM:SSZ`） |
| `--members <a,b>` | | csv | 纳入本 iteration 的 task |
| `--set <path=val>` | | string（可重复） | 通用设 ✎ 标量（裸 path 落 board 顶层；`tasks[<id>].path` 作用于该 task） |
| `--set-json <path=json>` | | string（可重复） | 通用设 ✎ 对象/数组（scoping 同左） |

- 例：`ccm cadence open I1 --goal "ship 框架+翻译切片" --deadline 2026-06-05T14:00:00Z --members T0,T1`

### cadence ship

**写**

```
ccm cadence ship <iter-id> [flags]
```

- positional：

| 名 | 必填 | 含义 |
|---|---|---|
| `<iter-id>` | 是 | iteration id |

- 行为：收口一个 iteration（成员须全 `done`+`verified`）
- flags：仅 global flags
- 例：`ccm cadence ship I1`

### cadence status

**读**

```
ccm cadence status [flags]
```

- positional：无
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--json` | | bool | 结构化输出 |

- 例：`ccm cadence status`

---

<!-- ccm:k:end point:ccm.cmd.cadence -->
