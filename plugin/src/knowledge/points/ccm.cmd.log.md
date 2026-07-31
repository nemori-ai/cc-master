---
point: ccm.cmd.log
---

## 权威陈述

<!-- ccm:k:start point:ccm.cmd.log -->
## namespace log

append-only 审计轨迹。

### log add

**写**（只增不改不删）

```
ccm log add <summary> [flags]
```

- positional：

| 名 | 必填 | 含义 |
|---|---|---|
| `<summary>` | 是 | 一句话摘要 |

- flags：

| flag | 短名 | 类型 | enum 取值 | 含义 |
|---|---|---|---|---|
| `--kind <enum>` | | enum | `dispatch, recon, verify, finding, decision, replan, handoff, note` | log 类别 |
| `--task <str>` | | string | | 关联的 task id |
| `--detail <str>` | | string | | 详情（长文） |
| `--ref <a,b>` | | csv（可重复） | | 关联引用 |

- 例：`ccm log add "派发 T7 给 subagent" --kind dispatch --task T7` · `ccm log add "改用方案 B" --kind decision --detail "理由:..."`

### log list

**读**（别名 `ls`）

```
ccm log list [flags]
```

- positional：无
- flags：

| flag | 短名 | 类型 | enum 取值 | 含义 |
|---|---|---|---|---|
| `--kind <enum>` | | enum | logKind 枚举 | 只列某类 |
| `--task <str>` | | string | | 只列关联某 task 的 |
| `--json` | | bool | | JSON 数组 |

- 例：`ccm log list --task T7` · `ccm log list --kind decision --json`

---

<!-- ccm:k:end point:ccm.cmd.log -->

## 失效类型

`environment_fact`（主体：事实方法） —— 模型不知道这个项目里 ccm log 命令的确切 flags、log kind 枚举值和 --detail 字段的约定

log add/list 的 kind 枚举与 flag 名是本工具的具体命令语法。
