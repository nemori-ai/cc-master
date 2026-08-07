---
point: ccm.cmd.jc
---

## 权威陈述

<!-- ccm:k:start point:ccm.cmd.jc -->
## namespace jc

**语法 / positional / 例一律以 `ccm <namespace> <verb> --help` 为准**（本节曾逐条复制它们，已交还——副本天然会过期）。下面只留 help 不说的：在这个 verb 上有额外语义的 flag、语义边界、跨 verb 规则。

judgment_calls 自驱决策记录。

### jc add

**写**

- flags：

| flag | 短名 | 类型 | enum 取值 | 含义 |
|---|---|---|---|---|
| `--set <path=val>` | | string（可重复） | | 通用设 ✎ 标量（裸 path 落 board 顶层；`tasks[<id>].path` 作用于该 task） |
| `--set-json <path=json>` | | string（可重复） | | 通用设 ✎ 对象/数组（scoping 同左） |

- 产物：新建 id 形如 `J1`、初始 `status: pending_review`、盖 `raised_at`。

### jc list

**读**（别名 `ls`）

- flags：

| flag | 短名 | 类型 | enum 取值 | 含义 |
|---|---|---|---|---|
| `--json` | | bool | | JSON 数组 |

### jc show

**读**

- flags：

| flag | 短名 | 类型 | 含义 |
|---|---|---|---|
| `--json` | | bool | 完整 jc JSON |

### jc resolve

**写**

---

<!-- ccm:k:end point:ccm.cmd.jc -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删掉这条，模型无法正确构造 jc 命令，参数、flag、格式都会错。

jc 的 category/severity/status 枚举与 add/resolve 参数是本 board 模型的具体字段。
