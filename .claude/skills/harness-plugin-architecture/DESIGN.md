# harness-plugin-architecture — 设计宪法

> 本文回答「这 skill 是什么 / 为什么」。「怎么用」在 `SKILL.md`；「成功 = 什么」在 `OBJECTIVE.md`。
> 设计先于实现——任何对 SKILL.md 的实质改动，先在此更新对应段。

## 1. One-liner

维护者设计或审查多 harness plugin adapter 时，用一份 canonical 语义和 host-native Track A/B 合同取代按事件名/文件形状复制，并把 headless runtime 明确移交其 owner。

## 2. Craft 自分类

- **Craft**：Craft C（纪律级）。
- **process-control 轴**：强（Phase 1 诊断 5/5）；fact→intent/CONTRACT→equivalence→adapter→projection/probe 的顺序会影响正确性。
- **cognitive-override 轴**：强（Phase 1 诊断 5/5）；需要压住同名事件等价、最近邻 host 复制、green dist 即行为通过和跨 plane 吞并的 prior。
- **形状蕴含**：SKILL.md 保留薄流程和架构不变量；host事实、Track A/B与origin integration下沉 references；不新增没有失败证物的 Rationalization Table/Red Flags。

## 3. Value triad

### 3.1 Plugin 视角

维护一个 source-to-adapter 产品语义、N-host Capability INTENT/CONTRACT 与 host-native dist 证据链；新增 host 或 cross-harness origin landing 时不 fork canonical，也不把 runtime control plane 塞进 plugin。

### 3.2 Agent 视角

提供从权威 host fact 到 Track A/B、Capability Card / hook CONTRACT、strategy、projection 和真实 probe 的固定判断路径。没有它，维护者会按事件名/最近邻 host 复制、把生成绿色当能力等价，或混淆 Cursor IDE 与 headless CLI。

### 3.3 Human 视角

reviewer 能从 Card/CONTRACT、declared divergence、per-host strategy、equivalence fixture 和 host probe 重放“为何等价/为何降级”；发布声明不会领先于证据。

## 4. 责任边界

### 4.1 IN scope

- plugin source→adapter 架构意图、SAP/PHIP、manifest/path/hook/command/skill host boundaries；
- N-host Capability INTENT、hook CONTRACT、Track A/B、equivalence fixtures；
- origin plugin 的 cached context landing、host-native attempt invoke/bind、worker-role mapping；
- host-native dist 的结构与行为证据门。

### 4.2 OUT of scope

| 关切 | 移交给 |
| --- | --- |
| provider driver、machine facts/quota store、route/admission、supervisor/journal/runtime lifecycle | `design_docs/cross-harness-orchestration-capability-model.md` 的架构/合同 SSOT；实现按普通 engineering / dev loop skills |
| projection script 的 deterministic rewrite / sync 实现 | `adapter-projection-engineering` |
| package、artifact、版本线与 release mechanics | `plugin-release-engineering` |
| 单个 skill body 的写作 / pressure test | `cc-master-skillsmith` |
| master runtime 的 route/WIP/HITL/true-done judgment | `master-orchestrator-guide` 等分发 skills |

### 4.3 Boundary heuristic

问“事实/动作怎样在 origin plugin 原生落地”归本 skill；问“headless worker control plane 怎样 probe、派、管、恢复”先回到 tracked capability model 确认架构/合同，再按普通 engineering / dev loop 推进。

## 5. 触发与反例

### 5.1 Recognition cues

- 新增/修复/review host adapter、第三/第四 host 或 Cursor IDE 非 1:1 语义；
- 建 Capability Card / hook CONTRACT、判 Track A/B、处理 host-specific landing；
- 把 ccm cross-harness context 或 native attempt contract 接入 origin plugin。

### 5.2 Counter-examples

- 只改 projection algorithm / executable bit → `adapter-projection-engineering`；
- 只打包/发版 → `plugin-release-engineering`；
- 只实现 same/other-harness CLI provider、quota/admission/supervisor → 读 tracked `design_docs/cross-harness-orchestration-capability-model.md`，再用普通 engineering / dev loop skills；
- 只改一个 skill 的 discipline/body → `cc-master-skillsmith`。

### 5.3 Pre-flight gate

- (i) 已分清 origin host-native、same-harness CLI/headless、other-harness CLI/headless；
- (ii) 已找到当前 host fact 与 capability/contract owner；
- (iii) 改动确实触碰 plugin/origin plane，而不是只碰 runtime、projection mechanics 或 release。

## 6. 演化锚

- **Lifecycle class**：methodology。
- **Sunset trigger**：不适用；模型越强越应严格维持 single canonical、explicit divergence 和 owner boundary。
- **Fitness 不变量 → 可跑 probe**：
  - canonical 单一 SSOT → projection sync + strategy/source content tests；
  - N-host capability equivalence → Capability Cards/CONTRACT anchors + equivalence fixtures + host probe；
  - origin/runtime plane 不互吞 → Track A near-miss + reference link/scope review；
  - current claim 不领先证据 → host facts、generated matrices、package/probe review。
- **Evidence anchor**：`design_docs/eval/harness-plugin-architecture-cursor-phase1-eval/` 的 Phase 1 RED、Track A 与 Track B；强模型 RED 3/3 已正确，不授权编造新纪律。Independent-review targeted rerun 的 A3 直接证据为 `1/3 → 2/3`，但非 Claude 二评超时不可用；这仍是 open consistency gap，不声称 Track-B 行为门已稳定全过。
- **Cross-major review owner**：`curating-skill-portfolios`。
