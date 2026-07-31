---
point: ccm.field-tiers
---

## 权威陈述

<!-- ccm:k:start point:ccm.field-tiers -->
## 心智锚 3:三档字段 —— 🔒 走专属命令,✎ 默认 `--set` 但可有专属写口

board 字段分三档(权威定义在 `ccm` 引擎:enums / 字段元数据 / 不变式 / 状态机——实时真相用 `ccm <ns> --help`。每字段属哪档 + 怎么取值的操作视图见 [references/board-model-guide.md](references/board-model-guide.md) §A;这里只给**操作规则**):

- **🔒 load-bearing**:`id` / `status` / `deps` / `parent`,以及 board 级 `goal` / `owner` / `git` / `tasks`。**`--set` 一律拒(exit 3)**,只能走专属命令(`task add`/`start`/`done`/`retry`/`block`/`set-status`、`task update --add-dep/--rm-dep/--parent`、`ccm goal set|confirm|amend`、`board update --branch/...`)。新板的 goal 只走 `ccm goal`;`board update --goal` 仅兼容没有 `goal_contract` 的 legacy board。
- **✎ flexible**:`title` / `description` / `estimate` / `acceptance` / `justification` / `artifact` 等。**这些才用 `--set`**,且 scoping 跟着命令语境走:`task add`/`task update <id>` 里**裸 path 作用于该 task**(`ccm task update T1 --set title="新标题"` 就落在 T1 上);板级顶层 ✎ 字段走 `board update --set`;要跨 task 写才用显式前缀 `--set tasks[T2].title=…`。长尾对象/数组用 `--set-json`。写入后非 `--json` 输出会回显实际落点(如 `set tasks[T1].title`),落点不对一眼可见。**少数带 authority/proof 的 ✎ 字段保留专属写口**:`delivery_contract`、task `delivery` / `dependency_requirements` 会拒绝 generic setter,分别走 `target`、`task attest-delivery`、`dependency` 命令。
- **👁 observed**:`scheduling.wip_limit`、`watchdog`、`wip_limit` 等——hook 有则用、缺则降级,走各自具名 flag。

一句话:**改 🔒 找专属命令;改普通 task ✎ 用 `task update <id> --set field=…`(裸 path 即本 task),改普通板级 ✎ 用 `board update --set`;delivery 合约字段例外走具名 domain verb;拿不准先看对应 `--help`。**
<!-- ccm:k:end point:ccm.field-tiers -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删掉后,调用方仍然知道 CLI 一般会有只读/可写字段的区分,但不知道这个具体工具把字段分成三档、每档对应哪些命令,会对 🔒 字段瞎试 --set 撞 exit 3,或对 ✎ 字段搞错落点前缀。

主体是 board 字段哪档、哪些走专属写口、裸 path 的 scoping 规则，是接口事实而非需要意志力遵守的约束（违反直接 exit 3）。

## 失败形态

最隐蔽的违反不是撞 exit 3(那会当场报错并被看见),而是在带 id 的写命令语境下用了裸 path 想写板级字段,实际却悄悄落进了该 task 内;命令成功返回、回显的落点字符串其实已经指出了错误落点,但调用方没检查回显就漏看了,数据落错位置却没有任何报错信号。
