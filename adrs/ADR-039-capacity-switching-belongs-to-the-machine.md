# ADR-039 — 换号归机器：orchestrator 不感知自主换号的权限与能力

> Status: **Accepted**
> Date: 2026-07-30
> Scope: 分发 skill 的知识层与文章层——`master-orchestrator-guide`（`references/cost-decisions.md` 整篇翻转 + SKILL.md 三处 + 四 host reference-row overlay）、`using-ccm`（`references/account-pool.md` + claude-code 的 account/policy overlay 六份）、`pacing-and-estimation`（`pacing-levers.md` / `pool-aware-advice.md` 各一行）、`as-master-orchestrator` 命令体四 host；knowledge graph 侧退役 2 点 / 新增 2 点 / 改 1 模块 / 接 1 条断头边。**ccm 引擎、hook 实现、board schema 一字不动**——本 ADR 只改「agent 被告知什么」。
> Source: 2026-07-30 用户拍板——「ccm daemon 后台会全局统一管控换号；对每个 master orchestrator，除非用户直接命令，否则都不允许也不应该让它们感知到自己有能够自主切号的权限和能力」。
> Co-signed: user (owner)
> Related: 收窄 [ADR-016](ADR-016-board-scoped-orchestrator-authority.md)（`board.policy.autonomous_account_switch` 保留，语义从「授权 agent 自主换号」收窄为「后台自动换号在这块板上是否放行」）；消费 [ADR-024](ADR-024-single-sided-pacing-switch-stop.md) 的 `switch` verdict（消费方从 agent 改为机器）；容量管控层的进程形态见 [ADR-033](ADR-033-ccm-monitor-daemon.md)。

---

## 1. Context

换号（切到下一份订阅配额）是一个**作用域超出单块 board 的动作**：`ccm account switch` 覆写 `$USER` 视角的官方共享凭证，本机所有 claude session 一起切。它消耗用户的真实资源，且对并跑的其他编排产生副作用。

在此之前，知识层把它讲成**编排器手上最重的一根 lever**：

- `capacity.account-switch-gate` 教「当一份配额真要烧穿、而你还握着未消费备号时，有一根最重的 lever：切到下一份配额」；
- `capacity.account-switch-sequence` 给了一套四步**编排决策序列**（探测 → 拍板 → 切 → 续跑），并明说「hook 未自动切时由你接管」；
- `board.policy.autonomous_account_switch` 被描述为「这块板**是否被授权自主换号**」——`allow` 读起来就是「你可以自己切」。

这套叙事与容量管控的实际归属矛盾。容量归属是**整机级**的：谁在什么时刻用哪份配额，只能由一个看得见全机的角色统一决定；每块 board 各自判断「我现在该不该切」，在多编排并跑时必然互相打架。用户据此定下方向：**这件事归后台的 ccm 管控层，编排器连「我有这个权限」都不该感知到，除非用户当面命令它去做。**

再者，这是一条典型的 **motivation_conflict 型**边界——不是「模型不知道怎么做」，而是「知道也记得，但在配额压力下会为越界编出理由」。「池子里还有备号」「默认本来就是 allow」「就切这一次」都是顺耳的论证。**模型越强，这类论证越像样**，护栏因此随模型变强而更重要，而不是更可以省略。

## 2. Decision

### 2.1 D1 — 换号从编排器的 lever 清单里整条移除

编排器在配额压力下的 lever 只剩**同一份配额之内**的腾挪：降模型档、降并发上限、推迟高 float 任务。配额真到边界而后台未续上时，唯一正确动作是**停派发 + 把边界事实与用户选项作 `blocked_on:"user"` surface + 等**。

### 2.2 D2 — 唯一例外：用户直接命令

用户当面让它换号，它照做、回报结果。这被明确框定为「替用户跑一条命令」，**不构成下一次自行决定的资格**——避免「用户批过一次 ⇒ 以后都可以」这条常见的权限蔓延。

### 2.3 D3 — `policy.autonomous_account_switch` 语义收窄（ADR-016 修订）

字段、取值、缺省 `allow`、`--user-authorized` 授权闸、`exit 7` 机制硬闸**全部保留不动**；改的只是它**被描述成什么**：

| | ADR-016 原口径 | 本 ADR 收窄后 |
|---|---|---|
| 门控对象 | agent 的自主换号权限 | **后台自动换号**在这块板上是否放行 |
| `allow` 对 agent 意味着 | 你被授权可以自己切 | 与你无关；你从来就不切 |
| 「绝不自授权」红线 | 有权限但不许自己放权 | 仍在（`--user-authorized` 通用红线），但换号已不是它的决策面 |

**为什么保留字段而不删**：机制硬闸是纵深防御的最后一环，它拦的是「agent 有 shell、理论上能绕过建议层」这种情形；把建议层的叙事拿掉之后，机制层反而更该留着。

### 2.4 D4 — 知识层 typed change（退役 2 / 新增 2）

| 动作 | point | 理由 |
|---|---|---|
| 退役 | `capacity.account-switch-gate` | 断言整条翻转，不是措辞调整；id 与新语义不符 |
| 退役 | `capacity.account-switch-sequence` | 「编排决策序列」在新口径下没有指称对象 |
| 新增 | `capacity.switch-is-not-your-lever` | 护栏：容量不是你的旋钮 + 合理化警告 |
| 新增 | `capacity.post-switch-continuity` | 收到换号通报时该做什么（只刷配速）与不该做什么（重建/重派/重验） |

`module:capacity.account-switch` 保留 id（主题词未变），改 title / intent / cues / boundary；`module:ccm.account-pool` 的 `contrasts_with` 边重新指向新点。

### 2.5 D5 — 本 ADR 不动实现

ccm 引擎的 `account` / `policy` 命令面、`usage-pacing` hook 的机械换号、board schema、hook 武装闸，**一律不改**。本 ADR 的全部改动落在「注入 agent context 的文本」这一层。

## 3. Consequences

### 3.1 Positive

- 一个作用域超出单板的动作，不再由每块板各自判断——多编排并跑时不会互相抢着切号。
- 护栏从「有权限但要过闸」变成「不是你的决策面」。后者更难被合理化：没有闸可以论证「这次可以过」。
- `switch_candidate` / `effective-N` / `pacing_switch` 统一降为**喂给机器的事实**，agent 侧口径与 Codex / Cursor / kimi-code 三家「自动换号永久禁止」自然对齐——四个 host 第一次在这件事上说同一句话。

### 3.2 Negative / 代价

- **叙事与实现之间留了一道缺口，必须诚实记账**：知识层现在说「换号由后台容量管控层统一决定」，而实际执行它的仍是**每个 session 各自的 `usage-pacing` hook**（LBHOOK 机械换号），不是一个全机唯一的 daemon。`ccm monitor`（ADR-033）目前只写 inbox / 刷 sidecar，不切号。多 session 并跑时，多个 hook 仍可能各自触发切换。**收口这道缺口是 ccm 侧的后续工程**，本 ADR 不做，但把它明确登记在此。
- `board.policy` 的两套读法（ADR-016 原文 vs 本 ADR 收窄）会在旧文档里并存一段时间；以本 ADR 为准。
- 若日后真要恢复「编排器可自主换号」，需推翻 D1——这是本 ADR 最实质的可逆点。

### 3.3 Neutral

- 红线 1–6 精神不变；board narrow waist 一字不动；hook 武装闸不变。
- 分发 skill 的边界（红线 3）不变，只是 A 的那一格从「换号决策锚」改称「容量边界锚」。

## 4. Alternatives Considered

**A. 只把默认值从 `allow` 翻成 `deny`。** 不够——`deny` 之下 agent 仍然知道「我有这个能力，只是这块板被关掉了」，「去请用户开一下」立刻成为一条顺畅的合理化路径。用户要的是**不感知**，不是**被禁止**。

**B. 删掉 `policy` 字段与机制硬闸。** 过度——agent 有 shell，建议层不是最后一道防线；把纵深防御的机制层一并拆掉，只剩 prose 在守。

**C. 保留 lever 叙事，只加一句「优先让后台管」。** 这正是被否决的软化写法：两种读法并存时，压力下会选对自己方便的那种。断言必须是单义的。

## 5. Related

- [ADR-016](ADR-016-board-scoped-orchestrator-authority.md) — 被本 ADR 收窄（字段保留、语义改写）
- [ADR-024](ADR-024-single-sided-pacing-switch-stop.md) — `switch` verdict 的生产方不变，消费方改为机器
- [ADR-033](ADR-033-ccm-monitor-daemon.md) — 容量管控 daemon 的进程形态（收口 §3.2 缺口的落点）
- [ADR-038](ADR-038-git-native-skill-knowledge-graph.md) — 本次退役 / 新增走的 typed change 通道
