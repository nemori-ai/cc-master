# cc-master 术语表（glossary）——统一措辞的单一真相源

> **这是 dev-side SSOT，不随 plugin 分发。** 单份文件、零死链——`design_docs/` 不进 plugin zip，但本表校验的是**分发文件**（`skills/` `commands/` `hooks/`）+ dev 文档（`AGENTS.md` `adrs/` `.claude/skills/`），由 `scripts/glossary-lint.sh`（dev-only、repo 根调）机械把关。§12 self-contain 只禁「**分发文件 _引用_ 非分发目录**」，不禁「dev-lint _校验_ 分发文件」，故 dev-side 单份足矣，不建分发副本。

## 用法

- **写文档 / skill / 命令体时**：某个承重术语拿不准怎么写，查本表 `canonical` 列照抄；别自造同义变体。
- **`禁用变体` 列是机械可卡的核心**——`scripts/glossary-lint.sh` 读这一列、对分发树 + dev 文档 grep，命中即 `exit 1` 报 `file:line`。故这一列**只收「零合法用法」的错形/typo/漏字**（如 `渐进披露` 漏「式」、`decision package` 空格形、`看门狗` 直译）——**绝不收有合法用法的变体**（如英文 `narrow waist` 作名词短语合法、`端点验证` 作「在端点验证」动词用法合法、`分发` 作「skill 分发」合法），否则 lint 假阳、把正当措辞拦下。
- **`允许变体` 列**是同义可互换的合法写法（如 `narrow-waist` ⟷ `narrow waist` ⟷ `窄腰`），仅供人读、**不进 lint**。

## closed-set 原则（仿 ADR-018）

**这不是求全的词典，是承重术语的抗漂移锚。** 只收**有漂移史 / 承重**的术语（一处措辞飘了就全仓跟着飘的那种），**先收一小撮、宁缺毋滥**。**新增一行前先证明现有集不够用**——多数术语无需登记（读上下文即懂），登记的成本是每加一个禁用变体就多一条 lint 卡点 + 一份维护负担。膨胀冲动长期存在，克制需要持续守护（同 ADR-018 closed set 的自律）。

**锁步纪律**：新增 / 改一个 canonical 术语的措辞 → **同 PR 更新本表 `禁用变体` 列**（见 `AGENTS.md` §6，与 `ccm`⟷`using-ccm` 同型的抗漂移硬约束）。

## 承重术语表

| canonical（英） | canonical（中） | 表述模式 | 允许变体 | 禁用变体（lint 卡） | 用户定义家 |
|---|---|---|---|---|---|
| progressive disclosure | 渐进式披露 | 中文正文优先用中文，可括注英文 | `progressive disclosure`、`渐进式披露（progressive disclosure）` | `渐进披露` | AGENTS.md 卷首 / 触发式深入阅读 |
| master orchestrator | 总指挥 | 英文技术名 + 中文括注 `master orchestrator（总指挥）` | `master orchestrator`、`master-orchestrator`、`总指挥` | `masterorchestrator`、`总司令`、`主指挥` | AGENTS.md §1 charter |
| decision_package | 决策包 | 指 board 字段用 `decision_package`（下划线）；中文叙事可用「决策包」 | `decision_package`、`决策包` | `decision package`、`decision-package` | commands/discuss.md + board.md |
| watchdog | 自我唤醒 / 看门 watchdog | 保留英文 `watchdog`；中文叙事用「自我唤醒」 | `watchdog`、`自我唤醒` | `看门狗`、`守望犬` | ADR-011 self-wakeup-watchdog |
| vertical slice | 纵切薄增量 | 中文用「纵切薄增量」；「纵切」「薄增量」可单用 | `纵切薄增量`、`纵切`、`薄增量` | `纵切薄片`、`竖切薄增量` | slicing-goals-into-dags |
| narrow-waist | 窄腰 | 英文 compound 用连字符 `narrow-waist`；作名词短语 `narrow waist` 亦可；中文「窄腰」 | `narrow-waist`、`narrow waist`、`窄腰` | `瘦腰`、`细腰` | ADR-003 board-narrow-waist |
| endpoint acceptance | 端点验收 | 中文用「端点验收」（名词：终点处的验收动作） | `端点验收` | `端点检收`、`端点验受` | SKILL A red lines |
| dispatch | 派发 | 中文用「派发」（后台工作的派发）；注意「分发」专指 skill/plugin 分发，非本义 | `dispatch`、`派发` | `派送` | dispatch.md |

## 陷阱备注（为什么某些「看似变体」不入禁用列）

- **`narrow waist`（空格英文）不禁**——ADR-003 标题即 "The board narrow waist"，作名词短语是合法英文。只禁明确错形 `瘦腰`/`细腰`。
- **`端点验证` 不禁**——`decomposition.md:91`「在端点验证」是「在端点处验证」的动词合法用法，与名词「端点验收」不同义，禁了会假阳。
- **`分发` 不禁**——`skill 分发` / `随插件分发` 是本仓高频合法词，与 `dispatch`（派发后台工作）不同义。
- **`决策包`（中文）不禁**——它是 `decision_package` 的合法中文叙事名，不是漂移；禁的是英文空格形 `decision package`。
- **`master-orchestrator`（连字符）不禁**——命令名 `as-master-orchestrator` + 独立连字符形均合法；只禁无分隔符 `masterorchestrator` 与错译。
