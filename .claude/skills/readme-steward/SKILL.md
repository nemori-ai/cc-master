---
name: readme-steward
description: '当你要为 cc-master 创建、更新、重写、审查或同步 README.md / README_zh.md 时使用；覆盖本仓 README 的产品叙事、英文/中文双语一致性、feature claim 诚实性、用户路径、贡献者路径和视觉/徽章克制。Triggers: README, README_zh, 项目首页, landing page, 文档首页, installation docs, quick start, feature claim, 中英文 README 同步, README review。Do NOT use when 只是改 AGENTS.md / skill body / ADR / feature manual / API 文档本身；那些按对应仓库 skill 或普通文档编辑流程处理。'
---

# README Steward

你维护的是 cc-master 的项目入口，不是生成一个通用 README 模板。README 的任务是让第一次打开仓库的人迅速理解：这是什么、为什么值得信、怎么开始、哪些承诺是真的、接下来该去哪。

本 skill 用于 `README.md` 和 `README_zh.md` 的创建、更新、审查与同步。深层标准见 `references/readme-standards.md`；做最终检查时读 `references/review-checklist.md`。

## 心智锚

### README 是信任入口和路径入口，不是完整说明书

README 首屏要建立方向感和信任感，随后给清晰路径。不要把 feature manual、ADR、AGENTS、安装细节、内部工程规约全塞进 README。README 只承载读者做下一步决策所需的最小真相：用户价值、可运行路径、诚实能力边界、进一步阅读入口。

### 先讲清项目，再做漂亮

视觉、徽章、截图、hero 语气都只能服务理解。cc-master 的 README 可以有产品感，但不能变成营销堆料：不夸大已落地能力，不用无法由仓库事实支撑的形容词，不让图片和口号遮住安装、使用、限制和真实机制。

### 双语是同一产品叙事的两种原生表达

`README.md` 和 `README_zh.md` 不是逐句机器翻译关系，也不是两份各写各的文档。它们必须承诺同一组事实、同一条读者路径、同一套能力边界；表达可以按语言自然调整。改动一边时，必须检查另一边是否需要同步。

### Claim 必须能回指事实源

凡是说“已经支持”“会自动”“能估算”“会切号”“不会超支”“适配 Claude Code / Codex”的句子，都必须能回指仓库事实：代码、安装器、feature manual、design spec、ADR、测试或 README 已有上下文。拿不准就降级措辞或加明确边界。

## 工作流

1. **判定任务类型。** 是新建、重写、局部更新、双语同步、安装路径更新、能力 claim 审查，还是 README 质量 review。只做必要范围，不顺手大改整篇。
2. **读最小事实源。** 至少读相关 README、[`AGENTS.md`](../../../AGENTS.md) 中 README / skill / release 相关纪律、以及本次改动涉及的事实源。涉及能力状态时读 `design_docs/feature-manual.md` 或对应 ADR；涉及安装时读 `install.sh` / release 文档；涉及贡献者路径时读 `AGENTS.md` 和相关脚本。
3. **分类读者路径。** 判断这次改动服务谁：第一次来的用户、非工程用户、工程用户、潜在贡献者、当前维护者。README 的正文优先服务用户和潜在采用者；维护者细节放到贡献者段落或链接出去。
4. **按入口结构编辑。** 先保证首屏价值、用法入口、能力边界和下一步路径成立，再处理语言润色、图片、徽章、目录和细节。
5. **同步双语事实。** 改 `README.md` 时检查 `README_zh.md`，反之亦然。允许语言风格不同，不允许事实、版本线、安装命令、能力边界漂移。
6. **跑最终审查。** 读 `references/review-checklist.md`，按 checklist 检查过度承诺、模板化、断链、安装命令、图片路径、中文/英文事实漂移和贡献者路径。

## 编辑原则

- 保持首屏有 cc-master 的核心承诺：给 agent 一个大目标和预算，让它拆解、并行推进、配速、记录状态、在该问人时问人。
- 明确它不是什么：不是许愿机，不替人做品味/方向判断，不适合十分钟小修。
- 把“已落地”和“愿景/还在建设中”分开。需要完整能力状态时链接 feature manual，不在 README 里硬塞状态矩阵。
- 用户路径比内部架构细节更靠前。架构解释可以存在，但应在“for the curious / 给好奇的人”之后。
- 安装和上手命令必须可复制、当前有效，并解释 version line 的最小必要事实。
- 贡献者入口必须提示 `plugin/src` 是 source、`plugin/dist` 是生成物，以及 `.claude/skills` 同步到 `.agents/skills` 的命令。
- 避免通用 README 套话：不要写“modern, powerful, seamless, robust”等无证据词；不要自动加空洞 Features / Tech Stack / Contributing 模板。
- 少用徽章和装饰。只有能增加信任或导航价值的视觉元素才保留。

## Red Flags

- 你正准备只改英文或只改中文，而改动包含事实、命令、能力边界或产品定位。
- README 新增了无法从仓库事实源验证的能力承诺。
- 首屏开始解释内部架构，却没有先说清用户能得到什么。
- 文档越来越完整，但读者更难知道第一步该做什么。
- 把 AGENTS.md、ADR、feature manual 的内容复制进 README，制造第二真相源。
- 为了“更专业”加入大量徽章、emoji、目录、feature list，反而降低可读性。
- 局部更新时顺手重写整篇 README，导致既有叙事、语言质感或事实边界漂移。

## 何时读 references

- 写或重写 README 结构、首屏、产品叙事、安装段、贡献者段：读 `references/readme-standards.md`。
- 做 review、收尾检查、双语同步、claim 审查：读 `references/review-checklist.md`。
