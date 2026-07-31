---
point: ccm.cmd.watchdog
---

## 权威陈述

<!-- ccm:k:start point:ccm.cmd.watchdog -->
## namespace watchdog

自我唤醒 watchdog。

### watchdog arm

**写**

```
ccm watchdog arm --fire-at <str> --mechanism <cron|loop|monitor|shell> --job-id <str> [flags]
```

- positional：无
- flags：

| flag | 短名 | 类型 | enum 取值 | 必填 | 含义 |
|---|---|---|---|---|---|
| `--fire-at <str>` | | ISO-8601 UTC | | 是 | 触发时刻（严格 `YYYY-MM-DDTHH:MM:SSZ`） |
| `--mechanism <enum>` | | enum | `cron, loop, monitor, shell` | 是 | 唤醒机制（降级链） |
| `--job-id <str>` | | nonblank string | | 是 | 真实外部调度句柄；用于追踪、recon 与退役，所有 mechanism 都必填 |
| `--checklist <str>` | | string | | | 唤醒后该检查什么 |

- 例：`ccm watchdog arm --fire-at 2026-06-24T12:00:00Z --mechanism cron --job-id cron-abc --checklist "查后台 3 个 subagent"`
- 原子性：缺 `--job-id` → usage error；值为空白 → validation error；两种都不改 board，`--force` 不能越过。

### watchdog disarm

**写**

```
ccm watchdog disarm [flags]
```

- positional：无
- 行为：退役 watchdog（删除 canonical `watchdog` 与 legacy `wakeup` 整字段，结果为 ABSENT，不留 `null` / 空对象）
- flags：仅 global flags
- 例：`ccm watchdog disarm`

### watchdog status

**读**

```
ccm watchdog status [flags]
```

- positional：无
- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--json` | | bool | 结构化输出 |

- 例：`ccm watchdog status`

---

<!-- ccm:k:end point:ccm.cmd.watchdog -->

## 失效类型

`environment_fact`（主体：事实方法） —— 模型不知道这个项目里 ccm watchdog 命令的确切 flags、mechanism 枚举值和原子性规则

主体是 ccm watchdog arm/disarm/status 的 flag、枚举与原子性事实，删掉就敲不对本工具的命令。
