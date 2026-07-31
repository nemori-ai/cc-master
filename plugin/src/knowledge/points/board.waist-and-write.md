---
point: board.waist-and-write
---

## 权威陈述

<!-- ccm:k:start point:board.waist-and-write -->
- **名字**：`board`。**单一真相源。** **可配置的 home + 每编排一份唯一命名的 board 文件。** home 取 `$CC_MASTER_HOME`（默认 `$HOME/.cc_master/`，全局、harness-neutral）；board 集中落 `<home>/boards/`，每场编排拿到自己那份可按时间排序的文件 `<UTC-timestamp>-<pid>.board.json`（如 `20260605T101821Z-54324.board.json`），这样多场并发编排永不相撞；旧 per-repo board 在 bootstrap 时自动迁入（迁移来源由 host adapter 决定）。bootstrap hook 负责创建该文件、并注入它的精确路径；**哪个 board 是你的，由你自己认领**——compaction 之后，靠列出 home 的 `boards/` 并匹配 `goal` 把它重新找出来。全局 home 在 repo 外天然不入版本控制（in-repo 仍 gitignored）。
- **存储 = 单一真相源的 board 文件（每编排一份命名文件）**：**board 变更只走 `ccm` 命令**——`ccm` 是唯一写入关卡（持锁 / 落盘前校验不变式 / 守状态机 / 盖 derived 字段）。**直接 file-edit（`Write` / `Edit` / `sed` / `echo` / `cat >`）会被 board-guard PreToolUse hook 拦**（手改绕过写关卡、静默腐蚀 deps 图 / 状态机 / 窄腰）；markdown 视图按需生成。校验这次写盘合不合契约的**机械关卡就是 `ccm`**（写时即校验，有 hard error 直接拒绝落盘）；PostToolUse lint hook 只作事后 backstop——见下方「board lint」段。

---

## narrow-waist 原则（narrative）

别把整张表都钉死——只钉死 hook 所依赖的那份最小契约。这既给了 agent 自由，又让手工维护保持安全。

- **硬 waist = hook 机器读的那一小撮字段**：top-level `schema` / `goal` / `owner{active,session_id,heartbeat}` / `git{worktree,branch}`，以及 `tasks[{id,status,deps,parent}]` + status enum。动它是结构性改动：必须同步改全部 hook + 测试。**确切字段清单、status 八态语义与路由、`parent` 的 depth=1 / 无环 / rollup 不变式，全在 {{USING_CCM_BOARD_MODEL_POINTER}}**——本文不复抄。
- **其余全 agent-shaped 柔性边**——你尽可按任务需要随意塑形（`title` / `artifact` / 三时间锚 / `observability` / `accounts[]` / `notes` / `log`…），hook 一概不读、lint 对未知字段 silent-on-unknown。
- **少数柔性边是 soft-observed**：`wip_limit`（超 cap 注过调度软警告）/ `owner_wip_limit`（owner 级两级 WIP）/ canonical `watchdog`（legacy 名 `wakeup`；有 `in_flight` 却无 nonblank `job_id` + 未过期 `fire_at` 的健康记录时提醒 arm）。**不影响硬 waist**。
- **`verified` 是与 `status` 正交的柔性边布尔，不是 status 值**——「已验」写 `"verified": true`，**别写成 `"status":"verified"`**（那会被 lint 当非法 status 拒）。`status` 答「在 DAG 里哪一态、怎么路由」，`verified` 答「验没验过」，二者各表各的。

---

## 单一真相源

内建的 `Task*` 工具至多是一面 in-session 的草稿镜像——**不权威**。唯有 home 里你那份 board 文件，才是一次断电、一次关机、一个 hook 都还认得的存档文件。两者打架时，board 文件赢。

---

## 读 / 写 / flush 纪律

- **每回合写整个文件** —— 快照很小。
- **在决策程序 step 7 flush**（每回合收尾），也可选在 PreCompact 时再 flush 一次。
- hook **基本只读** board（不改编排状态），编排状态的写由 agent 独占。
- **✎ `runtime.*` 是 hook-owned 例外** —— 身份提示 / critpath 等周期 hook 经 `ccm board set-param` 带锁写 `board.runtime.*`（如 `last_identity_remind` / `last_critpath_remind`）。你走 `ccm` 命令改 board 天然保留它（`ccm` 做字段级合并、不整盘覆写）；你自己**永不写 `runtime.*`**（那是 hook 的簿记区）。

---
<!-- ccm:k:end point:board.waist-and-write -->

## 失效类型

`environment_fact`（主体：事实方法） —— 不知道这个系统具体怎么定位“哪块是我的板”（home 目录里按 goal 匹配，而不是随便找一个），也不知道哪些字段是 hook 独占的簿记区，即使理解“要有单一真相源”的道理，也会认错板或写错地方。

删掉后不知 board SSOT、窄腰字段清单、只走 ccm 写入与 runtime.* 权属等本项目契约。

## 失败形态

compaction 之后，没有严格按 goal 与 session 归属去匹配，而是凭“看起来最新、内容差不多对得上”这种宽松直觉认领了一块板——尤其在多场编排并发、目标相近时，这看起来是合理的近似匹配，实质可能接管了别人的板。
