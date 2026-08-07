---
point: ccm.cmd.watchdog
---

## 权威陈述

<!-- ccm:k:start point:ccm.cmd.watchdog -->
## namespace watchdog

**语法 / positional / 例一律以 `ccm <namespace> <verb> --help` 为准**（本节曾逐条复制它们，已交还——副本天然会过期）。下面只留 help 不说的：在这个 verb 上有额外语义的 flag、语义边界、跨 verb 规则。

自我唤醒 watchdog。

### watchdog arm

**写**

- flags：

| flag | 短名 | 类型 | enum 取值 | 必填 | 含义 |
|---|---|---|---|---|---|
| `--job-id <str>` | | nonblank string | | 是 | 真实外部调度句柄；用于追踪、recon 与退役，所有 mechanism 都必填 |

- 原子性：缺 `--job-id` → usage error；值为空白 → validation error；两种都不改 board，`--force` 不能越过。

### watchdog disarm

**写**

- 行为：退役 watchdog（删除 canonical `watchdog` 与 legacy `wakeup` 整字段，结果为 ABSENT，不留 `null` / 空对象）
- flags：仅 global flags

### watchdog status

**读**

- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--json` | | bool | 结构化输出 |

---

<!-- ccm:k:end point:ccm.cmd.watchdog -->

## 失效类型

`environment_fact`（主体：事实方法） —— 模型不知道这个项目里 ccm watchdog 命令的确切 flags、mechanism 枚举值和原子性规则

主体是 ccm watchdog arm/disarm/status 的 flag、枚举与原子性事实，删掉就敲不对本工具的命令。
