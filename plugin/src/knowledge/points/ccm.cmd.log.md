---
point: ccm.cmd.log
---

## 权威陈述

<!-- ccm:k:start point:ccm.cmd.log -->
## namespace log

**语法 / positional / 例一律以 `ccm <namespace> <verb> --help` 为准**（本节曾逐条复制它们，已交还——副本天然会过期）。下面只留 help 不说的：在这个 verb 上有额外语义的 flag、语义边界、跨 verb 规则。

append-only 审计轨迹。

### log add

**写**（只增不改不删）

### log list

**读**（别名 `ls`）

- flags：

| flag | 短名 | 类型 | enum 取值 | 含义 |
|---|---|---|---|---|
| `--json` | | bool | | JSON 数组 |

---

<!-- ccm:k:end point:ccm.cmd.log -->

## 失效类型

`environment_fact`（主体：事实方法） —— 模型不知道这个项目里 ccm log 命令的确切 flags、log kind 枚举值和 --detail 字段的约定

log add/list 的 kind 枚举与 flag 名是本工具的具体命令语法。
