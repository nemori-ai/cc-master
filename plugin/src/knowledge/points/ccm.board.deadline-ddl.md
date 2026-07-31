---
point: ccm.board.deadline-ddl
---

## 权威陈述

<!-- ccm:k:start point:ccm.board.deadline-ddl -->
## O. 交付 DDL 字段取值 + 四态状态机

交付 DDL（delivery deadline）落 `goal_contract.deadline`——「整块 board / 当前 Goal Contract revision 最终交付」的时间承诺，单一 SSOT，随 goal revision 走。它是 👁 观察字段（嵌在已是 👁 的 `goal_contract` 内），窄腰一字不动。只走专属 verb 写：`ccm goal deadline set / confirm / confirm-none / amend`（命令签名见 [command-catalog goal deadline](command-catalog.md#goal-deadline)）；泛型 `--set goal_contract.*` 被拒。

**与三个近邻概念严格区分**（别混）：

| 概念 | 是什么 | 落点 |
|---|---|---|
| **交付 DDL（本字段）** | 整块交付的时间承诺 / 约束 | `goal_contract.deadline` |
| `cadence.iterations[].deadline` | 单个 iteration 的局部 timebox 末端 | `cadence.iterations[i].deadline`（并存·语义正交·DDL 不替代它） |
| ETA | 基于当前 DAG / 吞吐算出的**预测** | `ccm estimate forecast` 的 `p50/p80/p95`（每次算·非承诺） |
| task timeout / watchdog | worker 硬超时 / 自我唤醒 | `watchdog.*`（DDL 不替代任何超时机制） |

**四态 settledness 状态机**（`deadline.state`·与 goal `assurance` 正交）：

| `state` | 含义 | `at` | dispatch 门控 |
|---|---|---|---|
| **（`deadline` 键缺失）** | **未询问**（fresh skeleton 默认） | 无 | 门控（= pending 语义） |
| `pending` | 已识别候选但未 settle（歧义 / 冲突 / 待用户答） | 可无 / 可有暂定候选 | **门控**（不 settle 不派发） |
| `asserted` | 无歧义 evidence / 显式 `--ddl` 转写的候选（可逆推进） | 有 | 放行 |
| `confirmed` | 用户明确确认的截止期（`--user-authorized`） | 有 | 放行 |
| `none` | 用户明确确认**无 DDL** | 无 | 放行（不再追问） |

- **`none` ≠ 键缺失 / `pending`**：`none` 是显式持久状态（用户确认无 DDL）——`goal check` 见它即 `ok`，不再 `deadline_pending`、不再追问。「未询问」（键缺失）与「仍歧义」（pending）才门控派发。
- **`asserted` 语义收紧**：`asserted` 只可来自**显式 `--ddl`**，或**用户输入文本里的无歧义绝对时刻**（如「2026-08-01 09:00 UTC 前交付」）。推断 / 相对表达（「周五前」「尽快」「本月底」）/ 多源冲突一律用 `pending`——识别到候选但未 settle，先向用户确认再升 `asserted`/`confirmed`。别把模糊输入当 `asserted` 蒙混过门。

**字段取值**：

- **`at`**：严格 ISO-8601 UTC（`YYYY-MM-DDTHH:MM:SSZ`）。用户给本地时刻由 **agent 换算成 UTC** 后经 `--at` 传入；ccm 不做时区换算 / 自然语言解析（语义归 agent）。原始表达传 `--provenance-raw`、假定时区传 `--tz-input`（审计留痕）。
- **`precision`**：`minute`（默认·精确到秒的挂钟时刻）或 `day`（只给日期）。`--precision day` 落当日 UTC **末刻 `23:59:59Z`**（「当日交付」而非「当日 00:00」），且**必须带 `--tz-input`**（date-only 无时区证据不可落板）。
- **`kind`**：`hard`（默认·硬承诺）或 `soft`（软目标）——只改超期后的响应档，overdue 判据两者一致：`hard` 超期升级为**须向用户报告裁决**的 directive，`soft` 超期只 **advisory nudge**（提示但不阻断）。经 `--kind` 写（`set` 缺省 `hard`；`amend` / 再次 `set` 缺省**沿用既有 `kind`，绝不 silent 翻档**）；`FMT-DEADLINE` 容 `{hard,soft}`。
- **`rev`**：单调递增修订号，每次 `set/confirm/confirm-none/amend` +1，与 `board.log` decision 条目（revision / reason / timestamp）配套构成审计。
- **`provenance`**：`{raw?, source?, tz_input?}`——原始表达 / 来源（`goal-evidence|cli-flag|user-reply`）/ 假定时区，供审计，不参与任何计算。

**授权与审计**：`confirm` / `confirm-none` / `amend` 强制 `--user-authorized`（agent 绝不自授权）；`amend` 额外强制 `--reason`。deadline 的任何写**绝不 bump `goal_contract.revision`**（延长/改期不是目标 scope 变更），只刷 `deadline.updated_at` + `goal_contract.updated_at` + `rev`+1 + append `board.log`。`ccm goal amend`（目标 scope 变更）**原样保留** deadline 子对象——scope 改了 ≠ deadline 改了，不静默丢弃。

**会撞的规则**：形状坏 → `FMT-DEADLINE` hard（exit 3）；未 settle 却已有可执行任务 → `BIZ-DEADLINE-PENDING` warn；`asserted`/`confirmed` 已过期而交付未验收完成（读交付验收 marker：`goal_contract.delivery.accepted` 或全 task trulyDone 派生）→ `BIZ-DEADLINE-OVERDUE` warn（`soft` 超期 advisory / `hard` 超期 directive·都在 [N 节](#n-校验规则全集速查fmt--graph--biz)）。legacy board（无 `goal_contract` / 无 `deadline` 键）三规则皆早返回、板仍合法。

> **schema 版本说明：** 当前引擎期望 `schema === "cc-master/v2"`。如果你看到的 board 或别处文档写 `cc-master/v1`（旧板 / 旧叙事），以 `ccm board --help` / 引擎 board-model 为准——schema 锚点是机器读的窄腰字段，别手改。

---

> **实时真相永远以 `ccm <namespace> <cmd> --help` 为准**——本文是操作地图，`--help` 是当前领土。全量命令签名 / flag / `--json` 输出形状在 [command-catalog.md](command-catalog.md)。校验规则的权威实现在 ccm 引擎（board-model 注册表给每条规则的 level）。
<!-- ccm:k:end point:ccm.board.deadline-ddl -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删掉后,agent 仍理解“要有截止期”这个概念,但不知道这个系统把它拆成多种 settledness 状态、不知道哪些状态门控派发、也不知道 asserted 只能来自无歧义证据——会把用户一句模糊表达直接落成放行态,或混淆它与 iteration timebox / ETA / watchdog 这几个近邻概念。

主体是 goal_contract.deadline 的字段取值、四态状态机与专属 verb，删掉就不知道本项目这个字段长什么样。

## 失败形态

最隐蔽的违反是把“周五前”“尽快”这类相对/模糊表达直接落成 asserted——状态机顺利放行、格式校验全过,看起来完全合规,实际上是把一次推断伪装成了无歧义证据,这类判断力错误不会被任何格式校验拦下,只有回头追问“这句话有没有指向一个无歧义绝对时刻”才能发现。
