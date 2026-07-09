# readme-steward — 设计宪法（DESIGN.md）

> 本文回答「这 skill 是什么 / 为什么」。「怎么用」在 [`SKILL.md`](SKILL.md)。
> 设计先于实现——任何对 SKILL.md 的实质改动，先在此更新对应段。

## 1. One-liner

维护 cc-master 的 README / README_zh 时用：把通用 README 生成器的模板化冲动覆写为本仓的产品叙事、双语一致性、事实诚实和路径入口纪律。

## 2. Craft 自分类

- **Layer**：dev-only project skill（住 `.claude/skills/`，不随插件分发）。
- **Craft**：Craft C 纪律级。
- **process-control 轴**：强。README 改动需要先读事实源、再编辑、再双语同步与 claim 审查；跳过顺序会造成过度承诺或中英文漂移。
- **cognitive-override 轴**：强。覆写 agent 默认的通用 README 模板、feature 堆料、营销形容词、只改单语和把内部文档复制进 README 的倾向。
- **形状蕴含**：SKILL.md 用命名锚 + 工作流 + hard constraints；细标准和 checklist 下沉 references。

## 3. Value triad（三视角价值）

### 3.1 Plugin 视角 —— 对 cc-master 这个产品 / portfolio 而言

cc-master 的 README 是产品入口和贡献者入口的交界面。没有本 skill，维护者容易拿社区 README 生成器套模板，破坏本仓已有的产品叙事、双语并列、feature manual 诚实边界和 `plugin/src -> plugin/dist` 贡献者路径。本 skill 是维护者面的文档入口纪律，不进入分发 skill portfolio。

### 3.2 Agent 视角 —— 对调用这个 skill 的 AI 而言

在“帮我更新 README / 同步 README_zh / 审查项目首页”的瞬间，agent 得到一条确定路径：先确认读者和事实源，再编辑入口叙事，再审查 claim 与双语漂移。没有它时，agent 默认会生成通用 sections、夸大能力、忘记中文同步，或把 AGENTS/ADR/feature manual 复制进 README。

### 3.3 Human 视角 —— 对维护者而言

维护者得到的差别是可观察的：README 改动更克制，能力承诺更可审计，英文和中文事实一致，用户能更快开始，贡献者也能找到正确入口。没用它时，README 往往“更完整”但更像模板、更难信。

## 4. 责任边界

### 4.1 IN scope

- `README.md` / `README_zh.md` 的创建、重写、局部更新、双语同步。
- README 中产品叙事、安装路径、贡献者路径、能力 claim、视觉/徽章/图片的取舍。
- README review：事实诚实、路径清晰、双语一致、过度模板化检查。

### 4.2 OUT of scope（明确移交给谁）

| 关切 | 移交给 |
|------|--------|
| 改 AGENTS.md 的仓库红线 / 导航地图 | 普通仓库文档编辑 + AGENTS.md edit policy |
| 改一个 skill body 或 description | `cc-master-skillsmith` |
| 判要不要新建 / 拆分 / 合并 skill | `curating-skill-portfolios` |
| 度量 skill 触发或行为效果 | `grounding-skill-evals` |
| 改 feature manual / ADR / spec 的事实源本身 | 对应文档的本地规则和普通实现流程 |

### 4.3 Boundary heuristic

如果目标文档是仓库首页入口（`README.md` / `README_zh.md`）或这两份之间的事实同步，就用本 skill；如果是在改变事实源本身，不用本 skill。

## 5. 触发与反例

### 5.1 Recognition cues

- “帮我写 / 改 / 优化 / review README。”
- “同步 README_zh。”
- “这个能力能不能写进 README？”
- “安装说明 / quick start / 项目首页要更新。”
- “README 现在太模板 / 太营销 / 太长 / 中英文不一致。”

### 5.2 Counter-examples

- “改 AGENTS.md 的红线 / 目录导航” → 按 AGENTS.md edit policy。
- “给某个 skill 写正文” → `cc-master-skillsmith`。
- “把能力状态写进 feature manual” → 改 `design_docs/feature-manual.md`，README 只链接或摘要。
- “写 API / hook / board 协议文档” → 对应 spec / reference 文档，不把完整协议塞进 README。

### 5.3 Pre-flight gate

- (i) 本次任务确实触及 `README.md` 或 `README_zh.md`。
- (ii) 涉及事实承诺时，能指出至少一个事实源；指不出则先降级为审查/调研任务。
- (iii) 涉及单语改动时，已显式检查另一份 README 是否需要同步。

## 6. 演化锚

- **Lifecycle class**：methodology。README 入口设计、事实诚实、双语同步和模板化覆写不会因模型变强而消失。
- **Sunset trigger**：不适用。
- **Fitness 不变量 → 可跑 probe**：
  - README claim 可回指事实源 → 对新增/改写 claim 做人工 grep / 文件引用审查。
  - 英中事实一致 → diff 本次涉及段落，检查命令、版本、能力边界是否同义。
  - 不复制 SSOT → 检查 README 是否整段复述 AGENTS / ADR / feature manual 的细协议。
  - `.agents/skills` 同步 → 新增/改动本 skill 后跑 `bash scripts/sync-codex-skills.sh --check`。
- **Cross-major review owner**：`curating-skill-portfolios` 负责判断它是否仍应作为独立 dev skill，而不是折进某个文档 reference。
