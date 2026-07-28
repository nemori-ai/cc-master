# 研究议程：文献没有替 cc-master 回答的六个问题

## 1. 为什么仍需要仓内实验

近一年研究支持 typed graph、hierarchical routing、bounded context、maintenance lifecycle 和
evidence binding，但没有论文直接研究：

- 中文 discipline-enforcing Markdown skills；
- 一个 skill 文件内多种知识 kind；
- canonical → 多 host adapter 的 point-level projection；
- 任意 point 对任意 point `≤3 hops`；
- top skill 每次 compaction 重注、必须保持瘦；
- cc-master 的八 skill non-overlap 红线。

因此下一步不是“按论文实现”，而是把关键假设逐一做成可证伪实验。

## 2. H1：stable span markers 能否在正常写作中低摩擦存活

### 实验

选两个 fixture：

1. 同 skill 内的端点验收 principle/router/procedure；
2. 一个跨 skill owner/handoff 链。

执行编辑序列：

- 标题改名；
- 前文插入；
- 同文件移动；
- 跨文件移动；
- refine；
- split；
- merge；
- retire。

### 晋级门

- ID 不因位置变化而改变；
- source map 每次正确重算；
- 非法 crossing/missing marker 必然失败；
- agent 编辑后的补图负担可接受；
- 不需要手写行号。

若 markers 在常规编辑中频繁损坏，应重新比较 AST-sidecar/fingerprint anchor，而不是合理化。

## 3. H2：module 粒度能否同时满足三跳与预算

### 实验

对完整 inventory 生成多种候选粒度：

- heading-derived coarse modules；
- human-curated intent modules；
- skill-level modules；
- mixed hierarchy。

分别计算：

- directed diameter；
- atlas/module router tokens；
- p50/p95 point count；
- hub load/articulation；
- route ambiguity。

### 晋级门

- supported host 的 accepted point graph diameter ≤ 3；
- atlas 与 router 均在预先批准的 token/line budget；
- 不依赖“列出全部 points”的 giant hub；
- module summary 能区分相邻意图。

## 4. H3：typed cues 是否真的提升 agent 选路

### 对照

1. 当前 prose/filesystem；
2. plain links；
3. typed links + `when`；
4. role-labeled path contract；
5. role-labeled + Avoid/Debt。

### 用例

- 单 point 精确命中；
- 同名但 owner 不同；
- 需要 prerequisite + procedure + check；
- alternative/fallback；
- 图内无答案；
- host 不支持目标能力。

### 指标

- correct owner/module/point；
- ordered composition；
- wrong-owner；
- hops/reads/tokens；
- evidence-grounded action；
- abstention/debt calibration。

只有方案 4/5 相对 plain links 有稳定增益，role schema 才值得进入 hard contract。

## 5. H4：三跳是否真是合理阈值

三跳来自产品目标，不来自现有论文共识。应测：

- 1/2/3/4 hops 对成功率与 token 的边际影响；
- 最短路是否漏掉必要 Support/Check；
- agent 是按链接走，还是跳过 router 直接 search；
- 三跳结构是否诱导 giant hub；
- point-to-point diameter 与 intent-to-point distance 是否需要分别规定。

若三跳导致必要检查被省略，应保留 `≤3 navigation hops`，但允许一个 hop 展开小型 role-labeled
group，而不是把“知识读取步数”偷换为“文件打开次数”。

## 6. H5：自动 proposer 能做到什么程度

### 可测试候选

- heading/anchor 提议；
- repeated term/summary 候选；
- broken/missing edge 提议；
- semantic duplicate 候选；
- stale owner/host projection 候选。

### 安全边界

自动化只能创建 proposal。以下变更必须经 verifier/admission：

- accepted owner；
- merge/split；
- authority edge；
- retirement；
- runtime route；
- cross-skill transfer。

测 precision/recall 与人审时间；如果 proposer 的净维护成本为负，宁可只保留 deterministic checks。

## 7. H6：library-time maintenance 是否带来净收益

### 双面板

Library-time：

- node/edge growth；
- stale age；
- duplicate candidates；
- validation gap；
- split/merge/retire；
- graph churn；
- maintainer time。

Task-time：

- trigger/routing success；
- context cost；
- action correctness；
- failure/recovery；
- wrong-owner；
- abstention。

### 反自欺

- 不用 task success 单独掩盖 library 爆炸；
- 不用 lint 全绿证明 agent 会用；
- 不用更少 hops 证明 token 更低；
- 不用更多 edges 证明 coverage 更好；
- 不在同一组训练 query 上调 schema 又做最终判决。

## 8. 推荐的最小评测集

| 类别 | 最少数量 | 目的 |
|---|---:|---|
| 单 point direct | 8 | 基础定位 |
| 同 skill 多 point | 8 | 文件内消歧 |
| 跨 skill handoff | 8 | owner 与 portfolio 边界 |
| ordered chain | 6 | prerequisite/next/check |
| negative/avoid | 6 | 防误路由 |
| no-answer/debt | 6 | evidence boundary |
| host divergence | 每 host 4 | projection 诚实性 |
| mutation fixtures | 8 operators 各 1 | lineage/compiler |

train/holdout 分开；修改 cues/schema 前先预测 holdout 结果，再验证。

## 9. 研究更新机制

本专栏应按季度或关键标准变更更新，重点跟踪：

- Agent Skills specification 是否出现 point/module/graph 扩展；
- SkillOps/GoSkills/SkillComposer 的评审与复现；
- dynamic skill lifecycle benchmark 是否报告长期 library trajectory；
- learned routing 在自然语言 procedural skills 上的证据；
- provenance/evidence-binding 的标准化；
- 多 host skill projection 的公开实践。

更新时保留旧结论的日期与证据等级，不用新论文标题静默覆盖历史判断。

## 10. 停止条件

以下任一发生，应暂停扩大 graph：

- marker/manifest authoring 成本持续高于路由收益；
- atlas 为守三跳持续膨胀；
- wrong-owner 不降反升；
- agent 频繁只读 summary、不读 evidence span；
- host projections 无法保持稳定 point identity；
- graph churn 高但 task-time 指标无改善；
- 自动 proposer 引入更多错误 accepted changes。

健康诊断的目标是减少 skill technical debt，不是制造一层更难维护的 graph technical debt。
