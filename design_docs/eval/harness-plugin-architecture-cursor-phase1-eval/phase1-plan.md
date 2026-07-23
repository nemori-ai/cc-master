# harness-plugin-architecture Cursor Phase 1 — measure-first plan

日期：2026-07-10。此计划只覆盖与 cross-harness worker orchestration 相对解耦的 dev-skill
Phase 1：把已发布 Cursor adapter 的维护指导、N-host parity、Capability INTENT / CONTRACT-first
纪律接入现有 `harness-plugin-architecture`。Phase 2 等 cross-harness execution 设计落地后，再补
“IDE plugin adapter vs headless CLI worker transport”的边界和对应 host 资料。

## 1. 当前 craft 两轴诊断

诊断对象：`.claude/skills/harness-plugin-architecture` 当前 body + 四个 references。

### process-control：5/5（strong）

| 题 | 判定 | 证据 |
| --- | --- | --- |
| Q1 可复现性 | yes | 每个 host 都需稳定地产出 source → host-native dist、coverage/strategy/validation 形状。 |
| Q2 序列敏感 | yes | fact/intent/contract 必须先于 adapter implementation；先复制实现会把错误假设固化为 spec。 |
| Q3 集成契约 | yes | hook CONTRACT、Capability Card、strategy、manifest 与生成矩阵均被多处消费。 |
| Q4 错误代价 | yes | 错误 host 语义会以“已发布兼容”外泄，之后修复需要迁移用户行为与 release artifact。 |
| Q5 多 actor 协议 | yes | source maintainer、per-host adapter、projection、tests、release 都依赖同一能力契约。 |

### cognitive-override：5/5（strong）

| 题 | 判定 | 证据 |
| --- | --- | --- |
| Q1 反直觉 | yes | 需要压住“同名 hook / 最近邻 host 可直接复制”的强 prior。 |
| Q2 判断需求 | yes | 维护者须判断 1:1、等价类替代、显式降级或 unsupported，而非机械映射。 |
| Q3 substrate 引用 | yes | 正确性锚在 host-neutral intent、CONTRACT 与 capability equivalence，不在文件名/事件名。 |
| Q4 抗压 | yes | release deadline、既有绿色生成物和沉没成本会诱发先 ship 后补 contract。 |
| Q5 泛化 | yes | 规则必须覆盖 Cursor 及未来 N+1 host，而不是再做一个 Cursor 特例。 |

结论：目标 skill 应为 **Craft C（纪律级）**。当前正文已有流程骨架、source/dist 不变量和
“host facts 不能猜”，但整体更接近 Craft A：缺少一个明确命名的认知锚（例如
“capability parity ≠ event-name parity”）、N-host / Track A-B 决策门、以及把该锚连接到现有
Capability Cards / hook CONTRACT 的 repo-specific backstop。不能整篇改写，只做条目级 delta。

## 2. judgment 子集与事实审计

### 当前做得对的

- `SKILL.md` 已把 `plugin/src` 定为语义源、`plugin/dist/<host>` 定为生成物，并要求验证
  host-native dist。
- `references/source-to-adapter.md` 已说明 SAP / PHIP，且 hook 共享点是 contract 不是脚本。
- `references/host-adapter-boundaries.md` 已列出 Cursor facts、compatibility matrix 与
  `capabilities/` 目录，说明“host 事实不能靠猜”。

### 具体缺口（不是整篇重写理由）

1. 目标 skill 没有指向 `ADR-031-n-host-capability-parity.md`，也没把 Capability Card 与单 hook
   CONTRACT 的职责分工作为新增 host 的决策入口。
2. `SKILL.md` 的工作流仍以 “Claude Code only / Codex second host / generic multi host” 表述阶段，
   没显式承认 Cursor 已成为已发布第三 host，也没提示 Track A / Track B。
3. `cursor.md` 同页存在状态漂移：兼容矩阵与 ADR superseded note 明确 Phase C 已落地，Plugin
   Shape 前段仍写“未实现，仅 sketch”；部分 “预期/待 probe” 文字也应逐项对照 shipped 事实。
4. 当前 description 只有正向概要，没有 `Triggers`、`Do NOT use` 和与
   `adapter-projection-engineering` / `plugin-release-engineering` / cross-harness worker transport
   的边界；这会使 Track A near-miss 无明确语义锚。
5. 目标 skill 没有 `OBJECTIVE.md`，也没有 `evals/trigger.json` 或专属 Track B fixture。

## 3. 当前 J / eval 设施

### 设施状态

- 轻量 J：**不存在**（`.claude/skills/harness-plugin-architecture/OBJECTIVE.md` 缺失）。
- Track A eval set：**不存在**。
- 运行 `scripts/eval-trigger.sh harness-plugin-architecture` 的改前结果（逐字）：

```text
no eval set at: /data/qiwei/repos/cc-master/plugin/src/skills/harness-plugin-architecture/evals/trigger.json
```

- wrapper 只解析 `plugin/src/skills/<name>/...`；目标是 `.claude/skills` 下的 dev-only skill，
  即使新增 dev-only eval set也不能直接使用现有 wrapper。应复用 skill-creator 的 `run_eval`，
  显式传 `--skill-path .claude/skills/harness-plugin-architecture`，而不是重造 eval 引擎。
- Track A 测量通道本机已有 documented floor：loaded/cold environment 中 positive recall 可全 0。
  本轮没有为了凑一个数字发起 10×N 次无基线 corpus 调用；当前 pre-change baseline 是
  **“eval set/path 均缺失，信号不可用”**，不是伪造的 0%。
- Track B：通用半手动流程和 aggregator 存在，但没有本 skill 的 J、fixture、assertions 或
  iteration tree；本轮的三次 RED 是定性 ceiling evidence，不是 Track B 数字。

### Phase 1 候选轻量 J（先放 ignored plan，不写 target）

```text
J_top: 维护者为 N 个 agent harness 维护单一共享语义，同时让每个 host 以原生机制兑现可测试的能力等价类，并把无法 1:1 的差异显式建模而非静默复制。
baseline_reference:
  user_task: 新增或修订一个 host adapter，含 skills/hooks/commands/manifest/projection surface。
  without_skill_floor: 维护者按事件名或最近邻 host 复制实现，把绿色生成测试当行为等价；跨 surface gap 没有 Capability Card，单 hook 规则没锁进 CONTRACT，planned/shipped 文档漂移。
  expected_uplift: 新 host 先经 fact → capability intent/acceptance → CONTRACT/equivalence fixture → host-native implementation/projection，且 declared divergence 可追踪。
strict_dims: [canonical-single-SSOT, N-host-capability-equivalence]
rationale: 第一维防 canonical/adapter fork；第二维防事件名与文件形状冒充用户可见能力等价。具体 host 机制、示例和措辞保留演化空间。
```

## 4. Track A train / holdout

已准备两个 substantive corpus：

- `trigger-train.json`：10 条（5 should-trigger + 5 semantic near-miss）。只允许用于调
  description。
- `trigger-holdout.json`：4 条（2 + 2）。只用于最终验证，不能针对它回调 description。

near-miss 刻意覆盖相邻职责：projection 实现、release engineering、skill body authoring、
README stewardship，以及不改 plugin adapter 的 cross-harness CLI worker dispatcher。它们不是
“写 Fibonacci”式平凡负例。

改前 / 改后建议直接调用既有 runner（不改脚本也能测）：

```bash
SC="$HOME/.claude/plugins/cache/claude-plugins-official/skill-creator/unknown/skills/skill-creator"
cd "$SC"
uv run --python 3.12 python -m scripts.run_eval \
  --eval-set "$REPO/design_docs/plans/harness-plugin-architecture-cursor-phase1-eval/trigger-train.json" \
  --skill-path "$REPO/.claude/skills/harness-plugin-architecture" \
  --runs-per-query 3 --verbose
```

holdout 同命令只替换 eval-set。若 positive 全 0 或全部 query 满分，按 documented floor 判通道
死亡：记录输出，降级为 description diff 的独立定性 review + predicted-delta 对账，不对死指标
调词。

## 5. 改前可证伪 predicted delta（写死，不事后改）

### P1 — reference/how-to / factual delta

若只修 `cursor.md` planned/shipped 口径、在 `host-adapter-boundaries.md` 增加 ADR-031 / Capability
Card / CONTRACT 的查阅地图，不改纪律语义：

- 预测 `git diff` 只包含可逐条指向已实现 artifact/probe 的事实修正与 pointer；
- 预测现有 projection / content tests 行为判决 0 变化；
- 预测不会新增 Cursor 事实的第二 SSOT（skill 只指针，不复制事实表）。

任何不满足都说明所谓“reference-only”其实夹带了行为或新 SSOT，应拆开重审。

### P2 — discipline delta（ceiling 形态）

若给 `SKILL.md` 增加最小 N-host 决策门 / 命名锚：

- 预测同一 RED 场景的 A/B/C **pass-rate delta = 0**（without 已是 3/3 A；不得把 0 宣称成
  行为提升）。
- 预测 with-skill 3/3 会明确引用新增段落或其链接的 SSOT，并按
  fact → Capability INTENT/acceptance → hook CONTRACT/equivalence fixture → host-native adapter
  顺序论证；若只是凭常识选 A、不引用新增 substrate，GREEN 为弱/未通过。
- 预测一条不暴露 A 选项术语的新 Track B case，在 with-skill 的四项行为断言上至少 3/3 pass；
  without 若仍全部通过，则该 case 对 pass-rate 仍是零证据，只能验证一致性/引用，不得保留为
  “uplift benchmark”。

### P3 — description delta

若 description 增加 Cursor/N-host/Capability CONTRACT 触发词和明确 Do NOT 边界：

- 预测 train/holdout 的所有正例仍应触发；projection-script-only、release-only、skill-body-only、
  README-only 与 CLI-worker-transport-only 应保持不触发。
- 若 Track A 通道可用，目标为 train ≥ 8/10、holdout ≥ 3/4，且 positive recall 非 0；这是首个
  可用 baseline 的门，不声称相对当前数字有提升，因为当前数字不存在。
- 若通道死亡，预测的定性边界仍须由非作者 reviewer 对 14 条逐条裁决，无静默跳过。

## 6. 最小 delta 分类与合法性

### 无 pressure baseline 也可做（reference/how-to / mechanical）

1. `design_docs/harnesses/cursor.md`：逐条修正已被 tracked artifact、probe、compatibility matrix
   或 ADR superseded note 证实的 planned/shipped 漂移；不改变设计纪律。
2. `references/host-adapter-boundaries.md`：增加纯 pointer map：ADR-031、Capability Cards、hook
   CONTRACT、Cursor facts 的职责和查阅顺序；不复制整张 Cursor 事实表。
3. `references/source-to-adapter.md`：补一张 Track A / Track B 固定术语与 artifact 落点的 how-to
   对照表，只陈述现有 SSOT 和文件位置。
4. 机械死链、计数、文件路径修正。

这些可以合法进入 tracked 编辑；验证靠事实 source、dead-link/content tests、skill lint。

### discipline prose（本 RED 未产生失败借口）

候选最小 delta 只有一处：在 `SKILL.md` 的工作流前增加命名锚 + 决策门，明确
“capability parity ≠ event-name parity；N+1 host 必须先分 Track A/Track B，CONTRACT/Capability
INTENT first，green projection 不是行为等价”。它是在诱惑下该怎么选的主张，因此受 Iron Law
约束。

本轮 strong-model RED 三次不败，故：

- 不得新增臆造的 Rationalization Table / Red Flags；
- 不得声称 baseline fail→pass；
- **仅凭本 RED 不能无条件授权纪律 prose。** 首选是寻找一个真实 dogfood finding、弱模型或
  compaction 场景的合法失败证物；找不到时，只能按 grounding-skill-evals 的 ceiling 路径把它
  作为 repo-specific consistency backstop，小步落一处，并完成 P2 的精确引用 GREEN + 独立
  Track B/codex 裁决。任一缺失就回退该纪律 delta，保留 reference/how-to 更新。

## 7. GREEN / Track A / Track B / 第二评委步骤

1. **Reference GREEN**：独立 reviewer 对每个 facts delta 检查“source 证据、时态、是否复制
   SSOT”；跑 dead-link/content contract、`scripts/skill-lint.sh` 和 Codex skill symlink sync check。
2. **Discipline GREEN（若有合法入口才做）**：用同一 `red-scenario.md`，把修改后的目标 skill
   明确提供给三个全新 with-skill agent；3/3 选 A 且精确引用新增锚/决策门才算 GREEN。仅选 A
   不引用 = 弱 GREEN。
3. **Track A**：改 description 前后分别跑 train；改后只跑一次 sealed holdout。通道全 0/全满
   时按 floor 降级并记录，不对噪声调参。
4. **Track B fixture（本 skill 专属，至少 3×2 runs）**：不在选项中泄露术语，让受试收到混杂
   Cursor facts、同名非等价事件、已有绿色 direct mapping；断言：
   - 先建立权威 fact status，绝不从 stale 文档任选其一；
   - 区分 1:1 Track A 与 non-1:1 Track B；
   - Track B 先写/更新 Capability Card 与相关 hook CONTRACT；
   - 验收按 equivalence class，绿色 projection/generator 不等于 capability passed；
   - 不 fork canonical，也不让实现成为 accidental spec。
5. **第一 grader**：逐 transcript 对上述五断言写 `grading.json`；机械证据尽量脚本化。若
   without 也 pass，标记 non-discriminating，绝不虚高 uplift。
6. **Codex 第二评委**：对完全相同 transcript + 五断言用 read-only `codex exec` 独立裁决，
   不用 diff-oriented `scripts/codex-review.sh` 冒充 transcript grader。分歧必须调查，不取平均。
7. **Diff 第二审**：完成 tracked delta 后再用非作者 Codex reviewer 审事实证据、scope 和
   delta-only；空 review / OAuth failure = 未通过。
8. **收口**：source meta-skill 改动后运行 `bash scripts/sync-codex-skills.sh`，确认 `.agents/skills`
   投影；全仓 `run-tests.sh`、skill lint 与 `git diff --check` 全绿。生成项与 source 同 commit。

## 8. 进入编辑的 gate

判定分两层：

- **可以立即合法进入 Phase 1 reference/how-to + facts 编辑**：有具体 tracked 漂移证据，且这类
  delta 不受 pressure baseline gate。
- **暂不能把 discipline prose 当作“RED 已授权”直接写**：3 轮 strong-model RED 都不败。只有
  补到合法失败证物，或严格执行 ceiling consistency 路径并让 GREEN/Track B/第二评委全部通过，
  才能保留那一处最小纪律 delta。

这允许 Phase 1 先高效推进事实收口和 pointer/how-to；不会为了等 cross-harness execution 设计
而阻塞。Phase 2 再增量补 CLI/headless worker transport 与 IDE plugin runtime 的明确边界。
