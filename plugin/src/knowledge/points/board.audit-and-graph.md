---
point: board.audit-and-graph
---

## 权威陈述

<!-- ccm:k:start point:board.audit-and-graph -->
一个节点被重新定位（re-altitude）、或被一个上游变更顶替时，体现为一个**显式 board 状态**（`escalated` / `stale`），而不是隐式的垃圾回收。被顶替的节点带着它被设的状态留在 board 上，好让历史可审计。

---

## `log` 段 —— 轻量审计（append-only）

回溯与审计骑在柔性边那个轻量的 `log` 段上——它**不是**一套完整的 event-sourcing 存储（YAGNI）。有值得记的事发生时追加一条简短条目（`ts` + `summary` 必填，`kind`/`task`/`detail`/`refs` 可选）。

- **append-only 纪律**：log 条目**写下即不可变——只增不改不删**。每回合 flush 整个 board 时，已有条目原样保留、只在尾部追加。它是一条不可改写的事件轨迹（与可变的 `tasks[]` 状态相对）——回溯、审计、跨 compaction 重建「发生过什么」都靠它的不可变性。**绝不**回头编辑或删旧条目（要更正就追加一条新的修正条目）。

---

## board lint —— 自检真相源

board 是 hook / viewer / resume 三条链路的共同输入。写坏它（不合法 JSON、缺窄腰字段、`status` 拼错、dep 指向不存在的 id、deps 成环）大多**静默**出问题——尤其 viewer 会永久冻结在上一帧好的渲染却不报错。一套 board lint 在 board 被写坏的那一刻（或你随时手动）校验它的结构 / 语法 / 格式正确性。

> **lint 引擎 SSOT = ccm 引擎**。下面几道自检的规则逻辑都不在 plugin 里——经**进程边界** `spawn ccm board lint` 取裁决。**全部 FMT / GRAPH / BIZ 规则逐条速查在 {{USING_CCM_BOARD_MODEL_POINTER}}**——本文不复述规则清单。

**一条正路 + 两道兜底（board 变更只走 `ccm`）：**

- **写时即校验（`ccm` 命令·唯一写路径）**：经 `ccm` 改 board 时，写入关卡在**落盘前**就跑全套校验——有 hard error 直接 `exit 3` 拒绝落盘，坏 board 根本写不进去。这是唯一正路。
- **写关卡硬化（board-guard PreToolUse hook）**：直接 file-edit board 在**执行前**就被 deny，并注一条 `<directive source="board-guard">` 提醒改用 `ccm` verb。把「只走 `ccm`」从纪律硬化为机制。
- **事后 backstop（PostToolUse lint hook·经 `spawn ccm`）**：万一有 `Bash` 手改绕过 guard 溜进来，写盘后的 lint hook 兜一道——注一条点名「违了哪条规则 + 哪个字段 / task + 怎么修」的非阻断提示，**看到就当回合改用 `ccm` 修掉，别带病往下跑**。
- **手动**：任何想确认 board 健康的时刻主动跑 `ccm board lint`（无参 lint home 里唯一 active 板，多块则传 `--board <path>`；`--json` 出结构化 `{errors, warnings}`）。**何时务必手动跑**：① 疑似有 Bash 手段绕过 guard 改过 board；② 大改 `tasks[]`（重规划 / supersession 批量改 status / 重接 deps）后；③ compaction 后重建模型、对 board 健康存疑时；④ `--resume` 认领一块旧板后。

**lint 绝不约束你的自由**：你给 task 加任何柔性字段、省略任何柔性边——lint 一律不报错（silent-on-unknown）。它只在窄腰被破、JSON 不合法、或 deps 图坏了时出 hard fail；柔性边至多 warn、从不 fail。

---

## 图分析 advisory —— 机器算的临界路径（只读，永不回写 board）

lint 守「board 写得对不对」；**图分析**则在 board 写对之后回答「这张 DAG 长什么样」——替你心算大图时易错的临界路径 / 并行度 / impact / owner rollup。你经 `ccm board graph`（引擎同一份 SSOT）取数，**纯只读、只出 stdout/`--json`，绝不回写 board**。

> **advisory ≠ gate**：图分析是只读分析，给编排决策当输入（机器算的临界路径胜过心算）；它**不**强制任何东西。owner rollup 一致性这道**关卡**仍由 hook 强制（verify-board Stop 软提醒 + board-lint 的 `GRAPH-ROLLUP` warn），advisory 只把同一份事实摆给你看。

---
<!-- ccm:k:end point:board.audit-and-graph -->

## 失效类型

`environment_fact`（主体：事实方法） —— 不知道这套系统具体用哪些机制保证审计可信（写时校验的关卡、事后 backstop lint、log 字段形状），即使认同“审计要可追溯”的道理，也不知道该在哪个环节做什么。

删掉后不知本项目的 log 不可变语义、ccm lint/graph 写读路径与字段形状。

## 失败形态

为了“顺手修正一个错别字”或“更新一下措辞”直接原地改写一条已有 log 记录，而不是追加一条新的修正条目——JSON 依旧合法、schema 依旧对、lint 不会报错，审计轨迹的不可变性已经被静默抹掉，事后无法察觉也无法复原。
