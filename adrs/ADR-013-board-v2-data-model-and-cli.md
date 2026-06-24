# ADR-013 — board v2:完整 JS 数据模型 + 统一 CLI 访问层(narrow-waist 演进)

> Status: **Accepted**(设计已定 2026-06-23;数据模型地基 + lint/graph 重写 + 三 hook 收编 node + schema v1→v2 迁移已实现并通过 `run-tests.sh` 全绿 + `plugin validate` 验收·2026-06-23。统一 CLI 与三配套 skill 为后续阶段)
> Date: 2026-06-23
> Scope: board 契约的根形态——从「被动 JSON 文件 + 各消费者各自解析 + 只钉一小撮 waist」演进到「完整 JS 数据模型 SSOT + 统一 CLI 访问层」。约束全部 hook、CLI、viewer、`skills/orchestrating-to-completion/references/board.md`、`assets/board.template.json`,以及 v0.10.0 board 重构全部实现。**演进 ADR-003(narrow waist),不推翻其精神**。
> Source: v0.10.0 board schema 重构需求发现(敏捷开发 Epic #27 / 子需求 #28-#31 + C1 #32 + C6 #34)+ 2026-06-23 设计对话(requirement-elicitation 闸 → 逐分叉裁决)。

---

## 1. Context

board 现状(v0.9.x):一个被动的 `*.board.json` 文件,**hook 用 bash sed/awk 各自解析**,只钉死一小撮 narrow-waist(ADR-003:`schema`/`goal`/`owner`/`git`/`tasks[{id,status,deps,parent}]` + status enum),其余字段 silent-on-unknown、agent 自由塑形。三个消费者(hook / viewer / agent)各有一份解析逻辑(`buildGraph` 已半收敛为单一真相源 + UMD 桥)。

v0.10.0 要把敏捷开发能力(纵切可ship切片 / timebox / 估点 / judgment_calls 自决台账)长进 board,且用户立了硬底线:**严谨(无模糊地带)+ 完整(无未定义,每字段六要素齐全)**。这两个诉求都撞上同一个根问题——**「只钉一小撮、其余放任」的 narrow-waist,承载不了「完整建模 + 机械校验」**:

- 完整建模要求每个字段都有正式定义(类型/缺省/谁读/谁写/何时写/缺失降级),而非只定义一小撮。
- 机械校验(尤其 cadence 的「到点收口」「收口完整性」)要求一个**写入关卡**能机械拒绝违规写——bash 各自解析的现状提供不了。
- 现状已暴露文档↔实物↔lint↔ADR 漂移(template_version、ADR-012 漏索引、heartbeat/owner_wip_limit/wakeup 的 lint 缺口),违「严谨」。

## 2. Decision

**board 演进为「完整 JS 数据模型 SSOT + 统一 CLI 访问层」。** 五个相互绑定的面:

### 2.1 narrow-waist 演进(不推翻 ADR-003 精神)

从「只钉一小撮、其余放任」→「**完整建模所有字段 + 每字段显式标注三档**」:🔒 **load-bearing**(hook 机器读)/ 👁 **observed**(hook 若有则用、缺则降级)/ ✎ **flexible**(agent 自由)。红线2 的精神不变——**真正受红线2 保护的仍只是 🔒 子集**(动它须同 PR 改全 hook + 测试),✎ 字段仍 agent 自由 + silent-on-unknown。变化只是:从「隐式只定义一小撮」变「显式全建模 + 标注哪些 load-bearing」。

### 2.2 JS 数据模型 SSOT

一份 JS 模型定义(字段元数据 + 不变式 + 状态机 + mutations)当单一真相源,lint / graph / CLI / viewer 全部从它派生(把现有 `buildGraph` 单一真相源苗头从图算法推广到整个 board)。零 npm 依赖、纯 stdlib(红线1 / 红线5)。

### 2.3 统一 CLI = 三消费者 + 唯一写入关卡

agent invoke / web viewer / human shell 三消费者经同一 CLI;**agent / human 写 board 必经 CLI**(唯一写入关卡 = 机械约束层),CLI 在写入那刻跑不变式校验、机械拒绝违规写。viewer 只读;hook 只读(除 bootstrap)。这是 cadence 等数据层规则**唯一的真机械牙齿落点**。

### 2.4 bash hook 收编 node

`verify-board` / `reinject` / `posttool-batch` 从 bash sed/awk 收编为 node hook、`require` 同一份 board-model(ADR-006 已允许 node;消除「bash 串解析」与「JS model」两份漂移)。

### 2.5 轻量并发保护

写入用**轻量 advisory 文件锁**(lockfile / flock,写前 acquire 写后 release + 简单 stale 处理),防并发 torn-write——**不搞重型**(现实几乎无 human 手写,够用即可)。

## 3. Consequences

### 3.1 Positive

- 完整建模 + 机械校验**兑现「严谨 + 完整」底线**;一份 SSOT **消除多份解析漂移**。
- CLI 写入关卡给 cadence 等规则**真机械牙齿**(以前 agent 直接 `Write`,无写入校验)。
- 三消费者(agent/viewer/human)统一经一套 CLI,行为一致。

### 3.2 Negative

- 写 board 多一层 CLI 调用(性能开销,可接受)。
- board.md「每回合 `Write` 整个文件」纪律**要改写**为「经 CLI mutation」。
- **「非 CLI 直接写」绕过防护是实现期课题**:agent 仍能用 Bash sed 硬改绕过 CLI,正路经 CLI 校验、直接写由 lint 端点兜底(诚实:挡得住绝大多数,堵不死 100%)。
- narrow-waist 从「一小撮」变「全建模」= 维护面变大(但 load-bearing 标注精确界定真正受红线2 约束的子集)。

### 3.3 Neutral

- 红线2 真正受保护的仍只是 🔒 load-bearing 子集;✎ 字段仍 agent 自由 + silent-on-unknown——ADR-003 的核心权衡未变。

## 4. Alternatives Considered

### 4.1 维持 ADR-003 原样(只钉一小撮 + bash 各自解析)

拒绝:承载不了完整建模 + 机械校验,敏捷能力与「严谨/完整」底线落不了地;现有文档↔实物漂移无机制根治。

### 4.2 完整建模但不引入 CLI 写入关卡(agent 仍直接 `Write`)

拒绝:没有写入关卡 = 没有机械约束牙齿,cadence 等规则只能靠 agent 自觉——用户明确要求「能机械约束的部分要有机械护栏」(数据层规则下沉 CLI/lint 才有真牙齿)。

## 5. Related

- [`ADR-003-board-narrow-waist.md`](ADR-003-board-narrow-waist.md) —— 本 ADR **演进**它(narrow-waist 从「只钉一小撮」→「全建模 + load-bearing 标注」),不推翻其「pinned vs flexible」核心权衡。
- [`ADR-006-hooks-may-use-node-js.md`](ADR-006-hooks-may-use-node-js.md) —— bash hook 收编为 node 的依据。
- [`ADR-012-parent-waist-and-rollup-aware-stop-gate.md`](ADR-012-parent-waist-and-rollup-aware-stop-gate.md) —— 上一次 waist 扩展(`parent`)。
- **另需的 ADR**(本次重构衍生、各自单立):`acceptance` 目标函数 + done 真语义(#32,P3);`cadence` 调度语义(DAG 之上策略层,红线2)。
- 需求来源:Epic #27 + #28/#29/#30/#31 + #32 + #34。

## 6. References

- `assets/board.template.json` / `board.example.json` —— v2 实物需与本 ADR 的字段三档一一对应。
- `skills/orchestrating-to-completion/references/board.md` —— evergreen 协议描述,随 v2 改写。
