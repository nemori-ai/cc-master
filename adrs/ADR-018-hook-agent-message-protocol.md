# ADR-018 — Hook→Agent 标签化消息协议(三类 taxonomy + 注意力映射)

> Status: **Accepted**
> Date: 2026-06-26
> Scope: 约束**所有 hook 往 agent context 注入的文本**——当前重构三处(pacing 双侧走廊 / 多-orchestrator coordination channel / verify-board 收口闸)首批照办,现有 hook(`reinject` 除外)渐进迁移。落点二分:**作者侧**纪律进 [`../AGENTS.md`](../AGENTS.md) §13、**读者侧**契约(agent 怎么按 tag 分配注意力)进 SKILL A(须先跑 pressure baseline)。不动 board narrow-waist、不改 hook 武装闸(纯文本注入,红线1/2/5/6 不破)。
> Source: 2026-06-26「hook→agent 信息注入」设计草案(用户洞察:① 没有「纯展示」,凡注入即潜移默化塑造行为;② 用一套 XML/HTML 标签让 agent 知道**怎么分配注意力**)。

---

## 1. Context

hook 给 agent 的**唯一信道**就是往 context 塞文本,而 in-context 的文本**全都条件化下一步 token**——所以「纯展示 = 无影响」是**假二分**:展示也在塑造(潜移默化 prime)。

当前重构有多处 hook 注入将上线——pacing(双侧走廊的欠用加速 / 临界减速,ADR-010)、多-orchestrator coordination channel(peer 状态 + fair-share nudge)、verify-board 收口自检闸——若每处各自措辞,agent 无从机器级判断「这条该分配多少注意力 / 该不该照做」,易把建议误当命令、或把该遵从的闸当背景忽略。

命门由此引出:分类轴**不是**「影响 / 不影响」,而是 **① 决策归谁 + ② 影响力度**;且类别**不能只靠 prose 措辞**暗示(易误读),要用**结构化标签**让它对 agent 机器级可读 → 直接映射成「分配多少注意力」。这是一条横跨所有 hook、有清晰 X-vs-Y(标签化协议 vs 各自 prose 措辞)、跨文件影响(全部 hook + AGENTS.md + SKILL A)的结构性决策,故立 ADR。

## 2. Decision

**所有 hook→agent 注入文本按一套标签化消息协议写。** 七个相互绑定的面:

### 2.1 三类 taxonomy

| 类型 | 决策归谁 | 力度 | agent 该怎么对待 |
|---|---|---|---|
| **Ambient 背景** | agent | 最低(但≠0·primes)| 让它塑造世界模型·无需特定 action·**但自觉它在影响你** |
| **Advisory 建议** | **agent** | 弱 nudge ↔ 强 push | **当判断的输入**·权衡其前提·不盲从也不漠视 |
| **Directive 指令/闸** | **system** | 绑定 | 必须遵从·但**理解 why** |

**绝大多数 hook→agent 通信落 advisory**——agent 是有判断力的 orchestrator(agentic delta),不该被 hook 降格成规则机器;**directive 留给硬约束(红线 / 安全 / 阻断闸),越少越好。**

### 2.2 标签词汇(核心·closed set·别 proliferate)

三个标签固定对应三类;`strength` **只给 advisory**(ambient 恒低 / directive 恒满,保持简单);**所有标签必带 `source`**(注的是哪个 hook·可追溯可审计):

```xml
<ambient source="...">          背景信息·塑模型·无 action </ambient>
<advisory source="..." strength="weak|strong">  建议·喂判断·action 可选 </advisory>
<directive source="...">        硬约束·必须遵从·内含「为什么」 </directive>
```

真实例子(即当前重构里这些 hook 注入该长的样子):

```xml
<!-- pacing hook:欠用·轻推加速 -->
<advisory source="pacing" strength="weak">
5h 配额仅用 76%、约 50min 后 reset;若手头有真就绪的活可考虑加速,否则随它蒸发也无妨。
</advisory>

<!-- pacing hook:7d 逼顶·强推 -->
<advisory source="pacing" strength="strong">
7d 总闸已 87%。强烈建议停派新节点、把在飞跑完、并 surface 给用户。
</advisory>

<!-- 多-orchestrator 协调 channel:背景 + 建议 两块 -->
<ambient source="coordination">
此号池当前有 3 个活跃 orchestrator 在共烧;你看到的配额% 是共享的,headroom 不全是你的。
</ambient>
<advisory source="coordination" strength="weak">
按等分你的份额约是走廊/3;但 peer B 正逼 deadline,可考虑主动让渡更多。
</advisory>

<!-- verify-board:收口自检闸(罕见的 directive) -->
<directive source="verify-board">
停止前必须逐条对照 goal 自检、确认每个 to-do 真完成、需用户拍板的已 surface;唯有真完成才停。
(为什么:agent 在 exhaustion 下会合理化「差不多了就停」——这道闸防过早收工。)
</directive>
```

### 2.3 标签 → 注意力分配(用户要的「怎么分配注意力」)

| 标签 | 注意力 | 落到行为 |
|---|---|---|
| `<ambient>` | **低**·背景 | 更新世界模型即可·别当成待办·但知道它已经在 prime 你 |
| `<advisory strength="weak">` | **轻** | 顺手权衡·可合理忽略(如手头无活时的「加速」提示) |
| `<advisory strength="strong">` | **重** | 认真权衡·默认应响应·但**最终仍你拍**(推理其前提是否成立) |
| `<directive>` | **满** | 遵从·并理解 why(理解了才能识别规则误触、带脑子执行) |

### 2.4 作者纪律 P1–P6 + 反模式

hook 作者 wrap 注入内容时:

- **P1 没有中性注入**——凡注入即塑造,标签要**匹配**你想要的影响;连 ambient 也诚实承认在 prime。
- **P2 默认 advisory、慎用 directive**——用**最低够用**的类别;过度 directive 浪费 agent 判断力 +「狼来了」稀释。
- **P3 标签即承诺**——advisory 别用命令式措辞伪装成 directive;ambient 别偷夹 steering;directive 别滥用。
- **P4 力度配 stakes**——低风险 / 可逆 → `weak`;高风险 → `strong`;硬约束才 `directive`。
- **P5 directive 内含 why**——让有判断力的 agent **带理解地**遵从(还能识别规则误触),而非盲从。
- **P6 source 必填**——每个标签注明来源 hook,影响**可追溯、可审计**(人读 transcript 也能溯源)。

**反模式**:① 把想 steer 行为的东西塞进 `<ambient>` 装无辜;② 把 `advisory` 写得像命令;③ `directive` 不给 why;④ 标签集膨胀(新增类型前先证明「3 类 + strength」不够用)。

### 2.5 reinject(魂重注)排除在本体系外

标签体系管的是 **transient hook 消息**(pacing 提示、协调状态、收口闸……)。`reinject`(每回合 compaction 后整篇重注 SKILL A)是 agent 的**操作 substrate / 手册**——是赖以思考的地基,不是「分配注意力」的某条 transient 信息,故**不进本体系**(不该被包成 ambient/advisory/directive 的任一类)。

### 2.6 ship-anywhere 保持

标签就是**纯文本**·全平台·零新依赖(红线1 / 红线5 不破)。Claude 对 XML 标签的注意力遵从天然强,这条路**与模型特性同向**。

### 2.7 落点二分(作者侧 / 读者侧)

- **作者侧** → AGENTS.md 新增一节(§13)立 hook 作者 wrap content 的落地纪律(§2.1 三类 + §2.2 标签 + §2.3 映射 + §2.4 P1–P6 + 反模式)。本 ADR 是其深层 SSOT。
- **读者侧** → SKILL A(魂)补一小段教 agent **按 tag 分配注意力**(advisory 是喂判断的输入、推理其前提 / directive 遵从且理解 why / ambient 塑模型且自觉受 prime)。这是 agent-facing 纪律、压力下能被**两侧**合理化(「hook 说了就照做」↔「hook 提示我无视」)→ 按 TDD-for-skills **先跑 pressure baseline 看 agent 没这段时怎么误处理**,再写堵漏。
- **现有 hook 渐进迁移**:重构三处(pacing / coordination / verify-board)首批照办,其余随重构滚动迁移,不一次性全迁。

## 3. Consequences

### 3.1 Positive

- 注意力分配从「靠 prose 措辞猜」变成「按 tag 自觉」——agent 机器级可读「决策归谁 + 多少力度」。
- **活体印证**:上一轮某 agent「配额 85% 但拒绝换号」正是把 pacing 信号当 **advisory 输入**、推理其前提(瓶颈是等用户、非配额)后判断不响应——这正是 advisory 的正确对待。标签化让这件事可重复、不靠运气。
- `source` 必填令每条注入**可追溯、可审计**(人读 transcript 能溯源到具体 hook)。
- 一套协议横跨所有 hook,消除「每处各自措辞」的漂移。

### 3.2 Negative

- hook 作者多一道 wrap 纪律(选类 + 配 strength + 填 source);误标(advisory 写成 directive)会失真——靠 P3「标签即承诺」+ PR review 兜。
- 读者侧契约是 judgment-bearing prose,压力下两侧可被合理化——必须 pressure baseline 后落 SKILL A,非直接写。
- closed set 的克制需要持续守护(P3 反模式④):膨胀冲动长期存在。

### 3.3 Neutral

- 纯文本注入,board narrow-waist(红线2)/ hook 武装闸(红线6)一字不动。
- strength 暂只给 advisory;ambient/directive 是否开 strength 留作未来(见 §4.3),当前刻意不开以保最小集。

## 4. Alternatives Considered

### 4.1 只靠 prose 措辞(不引入标签)

拒绝:措辞暗示易误读——同一句「建议你减速」既可被当强制也可被当可忽略背景,agent 无机器级锚点判断该分配多少注意力;且无 `source` 则不可审计。

### 4.2 二分「展示 vs 指令」(纯展示 = 无影响)

拒绝:这是**假二分**——in-context 文本全条件化下一步 token,展示也在 prime。真正的轴是「决策归谁 + 影响力度」(三类),不是「影不影响」(二分)。

### 4.3 更细的标签集(advisory 加中档 / ambient 再分状态 vs 记忆 / directive 也开 strength)

暂拒:守**最小集**(3 类 + advisory 的 weak/strong)。膨胀前先证明不够用(P3 反模式④);ambient 恒低、directive 恒满,开 strength 只增复杂度无收益。留作未来若有真实需求再议。

## 5. Related

- [`ADR-010-two-sided-pacing-corridor.md`](ADR-010-two-sided-pacing-corridor.md) —— pacing 注入是本协议首批 advisory(weak 欠用加速 / strong 临界减速 + 7d 硬总闸)的承载场景。
- [`ADR-011-self-wakeup-watchdog.md`](ADR-011-self-wakeup-watchdog.md) —— watchdog/wakeup 相关的 hook 注入未来按本协议标签化。
- [`ADR-016-board-scoped-orchestrator-authority.md`](ADR-016-board-scoped-orchestrator-authority.md) —— policy 越界拒绝等机制层信号若注入 agent,亦按本协议(directive/advisory 视性质)。
- **(规划中)ADR-017 多-orchestrator 协调** —— 其 coordination channel 注入(ambient peer 状态 + advisory fair-share nudge)是本协议的并行首批落地场景(ADR-017 号段已分配给多-orchestrator 协调,本协议刻意取 ADR-018)。
- [`../AGENTS.md`](../AGENTS.md) §13 —— 作者侧落地纪律(本 ADR 为其深层 SSOT);SKILL A —— 读者侧契约(pressure baseline 后落)。

## 6. References

- 2026-06-26 设计草案「hook→agent 信息注入:标签化信息类型体系」(用户洞察:没有中性注入 + 用 XML 标签让 agent 知道怎么分配注意力)。
- XML/HTML 标签的模型注意力遵从特性——结构化标签比 prose 措辞更稳地引导注意力分配。
