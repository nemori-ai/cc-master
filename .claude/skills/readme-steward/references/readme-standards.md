# cc-master README 标准

## Contents

- [读者与入口](#读者与入口)
- [推荐结构](#推荐结构)
- [本仓 tastes](#本仓-tastes)
- [事实源与 claim 纪律](#事实源与-claim-纪律)
- [双语策略](#双语策略)
- [社区经验的取舍](#社区经验的取舍)

## 读者与入口

cc-master 的 README 同时面对四类读者，但优先级不同：

1. **潜在用户**：想知道它是不是能替自己管理一个长程 AI 编程目标。
2. **非工程用户**：关心“我给目标和预算，它能不能靠谱推进”，不想先读架构。
3. **工程用户 / lead**：关心安装、能力边界、host 支持、成本和风险。
4. **贡献者**：关心 source/dist、skills/hooks、测试和同步命令。

README 的前半服务 1-3，后半服务 4。不要让贡献者细节抢首屏。

## 推荐结构

保持当前 README 的大形状，局部按需调整：

1. **首屏**：项目名、语言互链、一句核心承诺、2-4 段产品叙事、关键图片、最短使用命令。
2. **适用人群**：把“这说的是不是你 / Is this you?”留作读者自我识别。
3. **用户价值**：列 cc-master 替用户做的事情，避免内部术语先行。
4. **端到端场景**：用一个具体例子证明它如何拆解、并行、问人、控预算、验收。
5. **不适用场景**：明确小修小改不该用。
6. **给好奇的人**：解释它是什么、source-to-adapter、版本线、feature manual 诚实边界。
7. **安装 / 上手**：命令必须可复制，版本 pinning 必须准确。
8. **后续文档入口**：feature manual、AGENTS、harness notes、sync commands。

## 本仓 tastes

- **产品感可以强，但必须诚实。** cc-master 的 README 可以有温度和叙事，不必像库文档一样冷；但每个强 claim 都要能被事实支撑。
- **少而准。** 宁可保留一个具体场景，也不要列 20 个泛 feature。
- **读者语言优先于内部代号。** 首屏不要出现 SAP/PHIP/ADR 编号等内部术语；这些放在 “for the curious” 或贡献者段落。
- **路径清楚胜过内容完整。** README 负责把人送到正确下一站，不负责替代下一站。
- **图片要说明真实对象。** 图片应展示 cc-master 管理的 plan / graph / UI 等真实状态，不做抽象装饰。
- **不要 badge soup。** 徽章只在能证明状态或降低风险时使用，例如 release、license、CI；不用为了“开源感”堆徽章。
- **保留边界感。** “不是许愿机”“不适合十分钟小修”这类边界是信任资产，不要为了营销删掉。

## 事实源与 claim 纪律

常见 claim 的事实源：

| README claim | 应检查的事实源 |
|---|---|
| 安装方式、版本 pinning、harness 参数 | `install.sh`、release 文档、README 现有命令 |
| Claude Code / Codex adapter 支持 | `plugin/dist/`、`plugin/src/` adapter strategy、`design_docs/harnesses/` |
| ccm 独立版本线 | `adrs/ADR-022-version-line-decoupling.md`、installer |
| feature 已落地 / 仍在建设 | `design_docs/feature-manual.md` |
| source-to-adapter / SAP / PHIP | `AGENTS.md`、`plugin/src` layout、projection scripts |
| 项目 meta-skill 同步 | `scripts/sync-codex-skills.sh`、`AGENTS.md` §6 |

如果事实源不足，用更诚实的措辞：

- “supports” → “current adapters include …” 或 “planned / documented in feature manual”。
- “automatically switches” → 只有实现和 feature manual 都支撑时才写；否则写“designed to / documented as”。
- “won't overspend” → 改成“helps manage budget / surfaces budget decisions”，避免绝对承诺。

## 双语策略

英文和中文 README 应保持同一事实和路径，但不是逐句翻译：

- 英文可以更直接、短句、面向全球开源读者。
- 中文可以更口语、更有节奏，但不能增加英文没有的能力承诺。
- 命令、版本号、路径、host 名称、链接必须一致。
- 段落顺序原则上保持一致；若语言自然性需要小调整，也要让读者路径等价。
- 改标题时检查互链文本是否仍自然。

## 社区经验的取舍

本 skill 借鉴社区 README skills 的成熟点，但只保留对本仓有用的部分：

- 从通用 readme generator 借鉴“先扫描项目事实，再生成内容”，但不采用模板填空。
- 从 audience-aware README skill 借鉴“按读者和项目类型选结构”，但本仓结构已定，不每次重选模板。
- 从 portfolio-grade README skill 借鉴“首屏价值和视觉克制”，但不追求作品集视觉压倒事实。
- 从 plain/readme-writer 类 skill 借鉴“非母语友好、主动语态、短句”，但中文 README 保留本仓已有语气。
- 从 workflow 化经验借鉴“机械扫描交给 checklist”，但当前不引入脚本；如果 README drift 反复发生，再考虑增加检查脚本。
