# Kimi K3 与 Kimi K2.7 Code 模型档位（effect floor）与适用场景研究

> 研究日期：2026-07-16 · 任务 K8A（goal r1，kimi-code harness 接入）· 执行 agent 产出
> 下游：K8B 据本报告把两模型写进 ccm model-policy registry 并同步 skill 指导。
> **约束诚实声明**：所有结论显式分层为 `[官方硬事实]` / `[本机实测·tested]` / `[第三方/press]` / `[社区·advisory]` / `[推断]`。凡证据不足处如实标注缺口，不硬凑。

> **附录（2026-07-17 更新，来源 <https://www.kimi.com/blog/kimi-k3>）**：月之暗面 K3 发布 blog 现含一节官方 **Limitations** + 官方自评 benchmark 表，超越本报告 §4.3「K3 benchmark 目前为空」与「model card 尚未公布」的原始判断。官方明列三条局限性：① K3 在 preserved-thinking-history 模式下训练——若 harness 未回传全部历史 thinking 内容、或把别的模型的进行中 session 中途切到 K3，生成质量会高度不稳定（官方建议用已验证兼容的 harness 如 Kimi Code，且不要在 session 中途切到 K3）；② K3 偏重长程高难任务，遇到小问题或用户意图含糊时可能擅自替用户做决定（需要边界约束时官方建议在 system prompt 或 `AGENTS.md` 里显式约束）；③ 相比 Claude Fable 5 与 GPT-5.6 Sol 在用户体验上仍有可见差距。另：K3 发布时 `reasoning_effort` 只支持 `max`，low/high 档位后续更新才引入（每次调用都付满档推理成本）。这些已回流进 `ccm/apps/cli/src/provider-model-facts.json` 的 K3 fact note（`moonshot-kimi-k3-blog` source）与 `role-candidates.json` 的 K3 blocker。官方自评 benchmark 仍属厂商自选口径、未经独立跨厂商标准集复现，故 `hard_facts.benchmarks` 仍保持 `null`、`unknown` 保留 `kimi_k3_independent_standard_benchmarks`。

---

## 0. 摘要（TL;DR）

- **Kimi K2.7 Code**（kimi-code CLI 别名 `kimi-code/kimi-for-coding`、`…-highspeed`；官方 API id `kimi-k2.7-code`）——**建议 `candidate_role_grades: ["T1","T2","T3"]`，置信度：中**。专用编程模型，agentic/tool-use 强、价格低（output $4/M）、开源可自托管；但原始 coding 能力低于同代 frontier（Opus 4.8 / GPT-5.5），官方明说非通用场景用途，且有真实的 API 稳定性 / 幻觉可靠性顾虑。不进 O。
- **Kimi K3**（kimi-code CLI 别名 `kimi-code/k3`，默认模型；官方 API id `kimi-k3`）——**建议 `candidate_role_grades: ["T1","T2"]`，置信度：低**。旗舰、2.5T MoE、1M 上下文、frontier 级定价（output $15/M），定位长程 agentic coding；**但 2026-07-16 刚发布、官方 benchmark / model card 尚未公布**，能力证据几乎为零，无法认证 O。1M 上下文是它相对 K2.7 唯一确定的差异化优势（利好 T2 大仓研究 / 长程 T1 实现）。
- **registry SSOT（K8B 要改的地方）**：`ccm/apps/cli/src/provider-model-facts.json`（新增 `kimi-code` provider）+ `ccm/apps/cli/src/data/model-policy/role-candidates.json`（新增 2 个 candidate）+（可选）`ccm/apps/cli/src/data/model-policy/task-affinity.json`（社区 advisory）。**⚠️ 非纯数据改动**：还必须改 5 处硬编码的 TypeScript（provider 白名单、OFFICIAL_HOSTS、model-policy 的 provider 数组、CLI enum）+ 更新对应测试。详见 §9。

---

## 1. 研究方法与证据分层

三条独立证据源，可靠度从高到低：

1. **`[本机实测·tested]`**——本机安装的 kimi-code CLI v0.26.0 只读探测：`kimi --help`、`~/.kimi-code/config.toml`、以及本仓已有的 `design_docs/harnesses/kimi-code.md`（对发布二进制 `strings` + `grep` 静态取证 + CLI 实测）。**这是最强证据**（本仓 harness 事实优先级：本机 probe > 官方文档）。
2. **`[官方硬事实]`**——Moonshot 官方页面：`platform.kimi.ai/docs/pricing/*`（定价 / 上下文 / model id）、`kimi.com/resources/*`（定位）、`huggingface.co/moonshotai/Kimi-K2.7-Code`（K2.7 官方 model card + 官方自评 benchmark + 架构）。
3. **`[第三方/press]` 与 `[社区·advisory]`**——OpenRouter、DevOps.com、CodingFleet、知乎、302.AI、Reddit（r/LocalLLaMA、r/ChatGPTCoding）等。一律标 advisory、带链接与日期。

**关键结构性事实**：K3 与 K2.7 Code 都是**我方知识截止（2026-01）之后发布**的近未来模型（K2.7 Code 2026-06、K3 2026-07-16）。因此硬事实以本机 `[tested]` + 官方页面为准，能力判断高度依赖 Moonshot 自评 benchmark 与早期社区反馈——这是两者置信度不同的根因（K2.7 已有官方 benchmark + 一个月社区样本；K3 发布当天、零 benchmark）。

---

## 2. ccm registry 维护机制（K8B 落点摸底）

### 2.1 三路 origin 共享的三层读模型

`ccm model-policy show --task <taxonomy> --json` 返回一个跨 provider 的三层视图（`ccm model-policy --help` / `ccm provider facts --help` 确认）：

| 层 | 数据文件（SSOT） | 语义 | 能产生什么 / 不能产生什么 |
| --- | --- | --- | --- |
| **hard_facts** | `ccm/apps/cli/src/provider-model-facts.json` | 厂商官方 model / surface / availability / price / benchmark 快照 | 能产生 **candidate**；**不**证明账号 entitlement、exact selector、role grade |
| **project_role_evidence** | `ccm/apps/cli/src/data/model-policy/role-candidates.json` | 本项目对 `O/T1/T2/T3` 的候选、认证状态、blockers | `candidate` **≠** `certified`；所有候选恒有 `eligible_for_automatic_selection:false` |
| **community_advisory** | `ccm/apps/cli/src/data/model-policy/task-affinity.json` | 带来源 / TTL / confidence / contradictions 的任务 taste | **只在硬门已过且基础分进入 equivalence_band（0.05）时做有界 tie-break**；`stale/mixed/unknown` 归零，**永不授予准入或 effect floor**；`confidence < 0.3` 视为极弱 |

**纪律锚（来自 `plugin/src/skills/pacing-and-estimation/canonical/references/model-tiers.md` 与 `plugin/src/skills/master-orchestrator-guide/canonical/references/model-allocation.md`）**：
- **candidate ≠ certified**——registry 里的 candidate 只表示"值得验证"，最终派发还需 exact `surface + selector + version + account/payer` 绑定的 role certification + live admission + quota + permission + workspace + 付费授权。
- **community taste 只影响同分排序**——`mode: bounded-tie-break-only`、`max_affinity_delta: 0.03`；它不能生成可用性、eligibility 或 effect floor。
- **effect floor 是硬门**——只保留满足该任务 `O/T1/T2/T3` 的候选；档位不做强弱传递猜测（列了 `[T1,T2]` 不自动含 O 或 T3）。

### 2.2 role_grade 语义（O / T1 / T2 / T3）

来自 `role-candidates.json` 的 `role_grades` + `task_policy`（16 条稳定 task taxonomy）：

| grade | 定义（原文） | task taxonomy |
| --- | --- | --- |
| **O** | orchestrator-grade system, architecture, specification and high-risk adversarial judgment | `architecture-design` · `system-design` · `spec-authoring` · `high-risk-heterogeneous-review` · `security-adversarial-review` |
| **T1** | implementation from a complete specification and routine heterogeneous review | `implementation-from-spec` · `frontend-ui-implementation` · `unit-test-authoring` · `large-refactor` · `routine-heterogeneous-review` · `code-review-recall` · `code-review-precision` |
| **T2** | read-only repository or primary-source web research and grounded summarization | `repository-code-research` · `web-primary-source-research` · `source-grounded-summarization` |
| **T3** | mechanical deterministic extraction, transformation and verification | `mechanical-deterministic-work` |

> effect floor = 任务要求的**最低模型资格**。`role_grade=O` 只是某个 `model+surface+effort+version` 对高风险判断的**模型资格证据**，与"master-orchestrator 组织角色"正交（O subagent 仍是 subagent）。

### 2.3 既有 provider 的数据形态（K8B 直接对照模板）

- **provider-model-facts.json** 每个 model 字段：`model_id` · `display_name` · `tier`（economy/balanced/frontier/adaptive，`nonemptyString` 校验、无 enum 但按此约定）· `relative_output_cost`（number 或 null）· `availability{state,account_scope}` · `pricing`（object 或 null，Claude 用绝对定价 / Codex 用 null + relative_output_cost）· `benchmarks`（object 或 null，Codex 用 `{swe_bench_pro_pct, terminal_bench_2_1_pct}`）· `selectors[]` · `source_refs[]`（**必须**引用本 provider `source[].id`）· `supersedes[]`。
- **role-candidates.json** 每个 candidate：`candidate_id`（`<surface>:<model_id>`）· `provider` · `surface` · `model_id` · `candidate_role_grades[]` · `state:"candidate"` · `provenance[]`（可选，`{kind,ref,recorded_at}`）· `blockers[]`。
- **task-affinity.json** 每条 evidence：`evidence_id`(唯一) · `provider/surface/model_id`（**必须**指向 role-candidates 里已 track 的 candidate，否则校验抛错）· `task_taxonomy`（必须已知）· `signal`(positive/negative/mixed/unknown) · `direction`([-1,1]) · `confidence`([0,1]) · `source{url(HTTPS),author,published_at,retrieved_at}` · `observed_at` · `valid_until` · `contradictions[]` · `limitations[]`。

---

## 3. 两模型硬事实表

图例：`[T]`=本机实测 · `[O]`=官方页面 · `[P]`=press/第三方 · `[?]`=未公布/未证实

| 事实 | **Kimi K2.7 Code** | **Kimi K3** |
| --- | --- | --- |
| 官方 API model id | `kimi-k2.7-code` `[O]` | `kimi-k3` `[O]` |
| kimi-code CLI 别名（`-m` selector） | `kimi-code/kimi-for-coding`、`kimi-code/kimi-for-coding-highspeed` `[T]` | `kimi-code/k3`（**CLI 默认模型**，`default_effort=max`）`[T]` |
| 显示名 | K2.7 Coding / K2.7 Coding Highspeed `[T]` | K3 `[T]` |
| 发布日期 | 2026-06-12（OpenRouter；官方资源页时间戳 06-25）`[O][P]` | 2026-07-16 软/分阶段发布（K3·Max / K3 Cluster·Max 已对登录用户开放）`[P]` |
| 架构 | MoE，1T 总参 / 32B 激活；61 层（1 dense）；384 experts / 8 选中；MLA；vocab 160K；SwiGLU；视觉编码器 MoonViT 400M `[O]` | 新架构 MoE，~2.5T 总参（leak/press，**官方未确认**）`[P]` |
| 上下文窗口 | 256K（262,144）`[O][T]` | 1M（1,048,576）`[O][T]` |
| 模态 | 文本 + 图像 + 视频（视频为实验特性、仅官方 API）`[O]`；本机 caps `image_in/video_in/tool_use` `[T]` | 文本 + 图像 + 视频 + tool_use `[T]`（leak 另称含音频，**未证实** `[?]`）|
| thinking 模式 | **强制 thinking，无 non-thinking 模式**；`preserve_thinking=true`；thinking token 较 K2.6 减约 30% `[O]` | 强制 thinking（本机 `always_thinking`、`support_efforts=[max]`）`[T]` |
| 定价（官方 platform.kimi.ai，USD / 1M token） | input cache-hit **$0.19** / cache-miss **$0.95**；output **$4.00** `[O]` | input cache-hit **$0.30** / cache-miss **$3.00**；output **$15.00** `[O]` |
| 定价（OpenRouter 转售，参考） | input $0.72 / output $3.50 `[P]` | 未上架 `[?]` |
| 许可 / 权重 | **开源，Modified MIT**（HuggingFace + Ollama 可下载）`[O]` | 权重是否开源**未公布** `[?]` |
| 官方定位 | "purpose-built for coding"；通用（写作/分析/对话）"we recommend K2.6"；优化多文件实现 + 长程 debug `[O]` | 长程 coding 与 agent 工作负载；"coding 对标 GPT-5.5"（press headline）`[P]` |
| **官方 benchmark** | 有（见 §4.1）`[O]` | **无——发布当天未公布任何官方分数** `[?]` |

**证据链接**：
- K2.7 model card + 架构 + 自评 benchmark：<https://huggingface.co/moonshotai/Kimi-K2.7-Code>（retrieved 2026-07-16）
- K2.7 官方定位：<https://www.kimi.com/resources/kimi-k2-7-code>
- K2.7 官方定价：<https://platform.kimi.ai/docs/pricing/chat-k27-code>
- K3 官方定价：<https://platform.kimi.ai/docs/pricing/chat-k3>
- 模型总览：<https://platform.kimi.ai/docs/pricing/chat>
- K2.7 OpenRouter（slug/发布日/转售价）：<https://openrouter.ai/moonshotai/kimi-k2.7-code>
- K3 发布 press：<https://www.kucoin.com/news/flash/moonshot-s-kimi-k3-model-now-available-to-users> · <https://finance.biggo.com/news/1463f539-2df9-479f-9d17-d6c3a1990722>（"coding rivals GPT-5.5" headline，正文抓取失败、仅存标题）
- 本机 harness 事实：`design_docs/harnesses/kimi-code.md`（§1 CLI 表面、§2 模型 catalog、§10 headless/worker、§13 worker driver）

---

## 4. Benchmark 汇总

### 4.1 官方 Moonshot 自评（K2.7 Code · 来自 HuggingFace model card）`[O]`

> ⚠️ **均为 Moonshot 自行命名 / 自选的 benchmark**（Kimi Code Bench / Program Bench / MLS Bench / Kimi Claw / MCP Atlas / MCP Mark），**非** SWE-bench Verified / Terminal-Bench / LiveCodeBench 这类跨厂商可比标准集。分数**不可与 Codex registry 里的 `swe_bench_pro_pct` / `terminal_bench_2_1_pct` 直接对照**（"denominators not comparable"）。

| Benchmark | K2.7 Code | K2.6 | GPT-5.5 | Opus 4.8 |
| --- | --- | --- | --- | --- |
| Kimi Code Bench v2 | 62.0 | 50.9 | **69.0** | 67.4 |
| Program Bench | 53.6 | 48.3 | **69.1** | 63.8 |
| MLS Bench Lite | 35.1 | 26.7 | 35.5 | **42.8** |
| Kimi Claw 24/7 Bench | 46.9 | 42.9 | **52.8** | 50.4 |
| MCP Atlas | 76.0 | 69.4 | 79.4 | **81.3** |
| MCP Mark Verified | 81.1 | 72.8 | **92.9** | 76.4 |

**读法**：K2.7 Code 较上一代 K2.6 全面提升（Kimi Code Bench v2 +21.8%、Program Bench +11.0%、MLS Bench Lite +31.5%）；**但即便在 Moonshot 自选的赛场上，K2.7 Code 在 6 项里几乎全面落后 GPT-5.5 与 Opus 4.8**（唯一亮点：MCP Mark Verified 81.1 反超 Opus 4.8 的 76.4——tool-use/MCP 调用是其相对强项）。第三方 Groundy 评论概括为"K2.7 lost 11 of 12 benchmark cells"。**结论：K2.7 Code 是强开源 coder，但原始能力低于同代 frontier 私有模型。**

### 4.2 第三方 / 标准 benchmark

| 项 | 数值 | 出处 | 备注 |
| --- | --- | --- | --- |
| K2 aider polyglot | 59–60% | Paul Gauthier（<https://x.com/paulgauthier/status/1946165321611526229>）/ llm-stats | **K2 基座**，非 K2.7/K3 |
| K2.6 SWE-bench Verified | ~80.2%（"ties MiniMax"）| codingfleet / benchmark 聚合 | 上一代，社区口径 |
| GPT-5.5 vs K2.6 SWE-bench Pro | 并列 58.6% | <https://codingfleet.com/blog/gpt-5-5-vs-kimi-k2-6/> | K2.6 与 GPT-5.5 在 Pro 上打平 |
| **K2.7 Code 的 SWE-bench Verified / aider polyglot** | **未公布** `[?]` | — | 官方与第三方均无独立标准集分数 |
| **K3 的任何标准 benchmark** | **未公布** `[?]` | — | 见 §4.3 |

### 4.3 K3 benchmark：目前为空 `[?]`

多个独立来源（BenchLM、kimi-k2.org status、groundy、essamamdani）一致确认：**截至 2026-07-16，Moonshot 未公布 K3 的 SWE-bench Verified / Terminal-Bench / LiveCodeBench / AIME / HLE 任一官方分数、model card 或权重**。唯一流传的具体数字（HumanEval 94.1%、SWE-bench ~55%）来自**非官方推广页** `kimik3.xyz`，**无官方背书、不可采信**，仅作"存在此传闻"记录。**这是 K3 置信度只能给"低"的核心原因，并非研究疏漏。**

---

## 5. 社区 taste 综述（advisory 定位）

一律 advisory，带来源 + 日期。K3 因太新，社区样本几乎全是 K2.7 Code（发布约一个月，样本较充分）。

**正向信号（K2.7 Code）**：
- **tool-calling / agentic 是公认强项**——r/LocalLLaMA、r/ChatGPTCoding 对比线程里 tool-use 支持被最多提及；支持单流程 200–300 次连续 tool call。（2026-07，Reddit 聚合）
- **成本是首要迁移动机**——高吞吐流水线用户报 75–90% API 花费下降。（Medium / Reddit usage report，2026-07）
- **长上下文指令跟随改善 + token 省约 30%**——知乎《实测 K2.7 Code：不争全能，专注 coding》与 302.AI 基准实验室《告别过度思考，Token 消耗锐减 30%》一致印证。（知乎 zhuanlan，2026-06/07）
- **中文场景**——Moonshot 为中文实验室，K2 家族中文能力是已知优势项（多个知乎实测正向，2026-06/07）；highspeed 变体被《潦草学者》评"快到不像实力派"（延迟敏感场景利好）。
- **agentic ≈ frontier、coding < frontier**——知乎实测直言："coding 能力打不过 Opus 4.8 与 GPT-5.5（xhigh），但 agentic 能力可以打得有来有回"。这与 §4.1 官方自评（MCP Mark Verified 反超 Opus）方向一致。

**负向 / 风险信号（K2.7 Code / Kimi 家族）**：
- **API 稳定性顾虑**——某科学工作流 agent benchmark 报 Kimi **~43% 断连率**为主要失败模式。（arxiv 科学 agent 评测，2026）`[社区·低置信]`
- **复杂任务幻觉**——某 peer-review 评测称 Kimi Code 在可复现性 / 结果完整性等维度同时落后，并记录"在缺校验算子时生成合成 / 伪造结果"。（arxiv，2026）`[社区·低置信]`
- 官方自陈边界：**非通用**（写作/分析/对话官方推荐用 K2.6）、**强制 thinking**（trivial 机械任务上 thinking token 是纯开销）。

**综合 taste**：K2.7 Code = "省钱 + 强 tool-use 的专用 coder，长上下文与中文是加分，但 raw coding 不及 frontier、可靠性需在强验收下兜底"。K3 = "旗舰长上下文赌注，社区尚无足够样本形成 taste"。

---

## 6. 与既有档位锚定模型的相对比较

registry 现有锚点（`ccm model-policy show` / `provider facts` 实读）：

| 模型 | tier | 定价 output（或 relative） | candidate_role_grades | 定位 |
| --- | --- | --- | --- | --- |
| Opus 4.8 | frontier | $25/M | (O)* | Anthropic 旗舰 |
| GPT-5.6 Sol | frontier | rel 5 | **O** | 强 review/impl（社区 coderabbit 正向）|
| Cursor Grok 4.5 | frontier | — | **O** | — |
| Claude Fable 5 | economy | — | **O** | — |
| Sonnet 5 | balanced | $10/M | **T1, T2** | 促销 $2/$10 |
| GPT-5.6 Terra | balanced | rel 2.5 | **T1, T2** | — |
| GPT-5.6 Luna | economy | rel 1 | **T2, T3** | — |
| Cursor Composer 2.5 | balanced | — | **T1, T2, T3** | — |
| **Kimi K3**（建议） | frontier | **$15/M** | **T1, T2**（建议）| 1M ctx、benchmark 未公布 |
| **Kimi K2.7 Code**（建议） | balanced | **$4/M** | **T1, T2, T3**（建议）| 专用 coder、tool-use 强、便宜 |

*注：Opus 4.8 官方 fact 里 role grade 由 role-candidates 承载，此列对齐 candidate 视图。

**相对定位判断**：
- **K3 定价（output $15/M）落在 frontier 带**（Opus $25 与 Sol/Terra 之间），但**能力未证**——不能仅凭价格 tier 推断 role grade（纪律：tier ≠ effect floor）。与 GPT-5.6 Sol（已有社区 impl/review 正向 + 明确 O）相比，K3 缺一切 benchmark，**不能对齐 Sol 的 O**。
- **K2.7 Code（output $4/M）介于 Luna（economy, T2/T3）与 Terra（balanced, T1/T2）之间**；其 coding 专精 + tool-use 强项让它在 T1 实现 / T3 机械上比同价位通用模型更贴合，故建议给到 `T1,T2,T3`（比 Luna 多 T1、与 Composer 2.5 同覆盖面），但因 raw coding < frontier 且可靠性顾虑，**不进 O**（与 Sonnet 5 的"T1,T2 不进 O"同类保守）。

---

## 7. 档位建议（per role taxonomy）

**总建议**：
- **K3 → `candidate_role_grades: ["T1","T2"]`，置信度 低**
- **K2.7 Code → `candidate_role_grades: ["T1","T2","T3"]`，置信度 中**

> 两者**均不进 O**。理由：O 要求"已证的高风险对抗判断力"。K3 零 benchmark，K2.7 官方明说非通用 + coding 低于 frontier + 有幻觉/可靠性顾虑——都不满足 O 的证据门槛。**保守不入 O 是本仓纪律的默认安全侧**（宁可后续凭 benchmark 升档，不先给不可逆高杠杆 gate）。

### 7.1 逐 taxonomy 判定表

| task taxonomy | 要求 grade | **K3** | **K2.7 Code** | 置信度 | 改判触发（什么证据出现会改） |
| --- | --- | --- | --- | --- | --- |
| architecture-design | O | ❌ 不入 | ❌ 不入 | 高（排除方向明确）| K3 出现对标 Sol/Opus 的官方推理 + agentic benchmark，且经本项目高风险 canary → 才考虑升 O |
| system-design | O | ❌ | ❌ | 高 | 同上 |
| spec-authoring | O | ❌ | ❌ | 高 | 同上 |
| high-risk-heterogeneous-review | O | ❌ | ❌ | 高 | 高杠杆 gate 绝不降档伪装；须 O 级独立复核证据 |
| security-adversarial-review | O | ❌ | ❌ | 高 | 同上 |
| implementation-from-spec | T1 | ✅ 候选 | ✅ **强候选** | K3 低 / K2.7 中 | K2.7：这是其官方主打（长程多文件实现）；K3：1M ctx 利好超大 spec，但需实测通过率。降级触发：agentic 通过率实测显著低于 Terra/Composer |
| frontend-ui-implementation | T1 | ✅ 候选 | ✅ 候选 | 低 | 两者均无 UI 专项证据；出现 UI/前端 benchmark 或实测 |
| unit-test-authoring | T1 | ✅ 候选 | ✅ 候选 | 中 | K2.7 tool-use 强、适合测试脚手架；测试幻觉率若高则降 |
| large-refactor | T1 | ✅ **强候选**（1M ctx）| ✅ 候选 | K3 低 / K2.7 中 | K3 的 1M ctx 对巨型重构是真优势；实测长程一致性 |
| routine-heterogeneous-review | T1 | ✅ 候选 | ✅ 候选 | 中 | **Kimi(Moonshot 家族) 对 Claude/GPT producer 是异族视角**——有打破 monoculture 价值。偏 recall 用；precision 顾虑见下 |
| code-review-recall | T1 | ✅ 候选 | ✅ 候选 | 中 | tool-use/召回强项利好找问题；出现 review recall 实测 |
| code-review-precision | T1 | ⚠️ 谨慎候选 | ⚠️ 谨慎候选 | 低 | **幻觉/精确性顾虑**（§5）——precision-critical 场景风险高。出现低误报率证据才提置信 |
| repository-code-research | T2 | ✅ **强候选**（1M ctx）| ✅ 候选 | K3 中 / K2.7 中 | K3 1M ctx 是大仓只读研究的最佳匹配；低风险（只读）故置信可给到中 |
| web-primary-source-research | T2 | ✅ 候选 | ⚠️ 偏弱 | 低 | K2.7 是 coding-tuned（官方推 K2.6 做通用）→ web 研究非其所长；K3 通用性未知 |
| source-grounded-summarization | T2 | ✅ 候选 | ⚠️ 偏弱 | 低 | 同上；出现通用 grounded summarize 质量证据 |
| mechanical-deterministic-work | T3 | ⚠️ 可但不经济 | ✅ 候选 | K3 低 / K2.7 中 | **K3 output $15/M 做机械活是 cost-inappropriate**（故不列 T3）；K2.7 便宜合适，但强制 thinking 对 trivial 活有 token 开销 |

**为什么 K3 不列 T3**：T3 是机械确定性活，成本敏感。K3 frontier 定价（$15/M output）在此是错配——按 `model-allocation.md` 的 tight-posture 排序会天然被 K2.7 挤掉，直接不列 T3 避免它成为 cost-inappropriate 默认。K2.7 才是 kimi 侧的 T3 候选。

**为什么 K2.7 列 T3 而 K3 不列**：K2.7 output $4/M + tool-use 强，适合确定性提取/变换；K3 只有在需要 >256K 上下文的机械活（罕见）才有理由，届时可显式覆盖，不必写进默认候选集。

---

## 8. 适用场景 taste 指导草稿（供 K8B 同步进 skill 指导）

> 供回流到 `pacing-and-estimation`/`master-orchestrator-guide` 的 model 指导。措辞面向 user-agent（第二人称、无代号、self-contain）。

**选 Kimi K3 当**：任务需要 **>256K 上下文**（整仓只读研究、跨大量文件的长程 agentic 实现/重构），且你接受 frontier 级成本（output $15/M）与"benchmark 未公布"的能力不确定性。它的 cache-hit 输入极便宜（$0.30/M），在 cache 密集的长循环里成本可控。**因其能力未证，务必配强验收门 + 只投可机械验收或低风险（只读）的活，不投高风险不可逆裁决。**

**选 Kimi K2.7 Code 当**：成本敏感、256K 以内的**高频 agentic coding**；重 tool-call 循环（单流程可 200–300 次连续调用）；有**完整 spec + 强验收**兜底的 implementation-from-spec / large-refactor / unit-test（完整 spec + 验收门能收敛其幻觉风险）；想要**开源可自托管 / 权重可控**；**中文**编程任务。延迟敏感时用 highspeed 变体。

**不要选 Kimi（改用已证 frontier）当**：高风险 O 级裁决（架构/安全/spec）——用 Opus 4.8 / GPT-5.6 Sol / Sonnet 等已证模型；**precision-critical review**（幻觉代价高）；**通用非 coding**写作/分析（Moonshot 自己推荐 K2.6，而 K2.6 不在本 coding-agent 候选池）；对**可靠性 SLA 敏感**的长程无人值守（API 断连顾虑）。

**异族 review 价值**：Kimi 属 Moonshot 家族，与 Claude、GPT 产出模型天然异族——用作 heterogeneous reviewer 可打破单一家族 monoculture。但保持它**偏 recall（找问题）**，高风险 gate 仍压在已证 O 模型上，不让 Kimi 单独把关不可逆裁决。

---

## 9. registry 更新 payload 草案（K8B 可直接搬运）

> ⚠️ **这不是纯数据改动。** 除 3 份 JSON 外，K8B **必须**同步改 5 处硬编码 TypeScript + 更新测试，否则 `ccm model-policy show` 不会露出 kimi、或 `provider facts kimi-code` 报 `unsupported provider`、或校验直接抛错。

### 9.1 代码改动清单（先改这些，否则数据无效）

| # | 文件:行 | 现状 | 改成 |
| --- | --- | --- | --- |
| 1 | `ccm/apps/cli/src/provider-model-facts.ts:3` | `type ProviderModelFactsProvider = 'claude-code' \| 'codex' \| 'cursor'` | 追加 `\| 'kimi-code'` |
| 2 | `ccm/apps/cli/src/provider-model-facts.ts:16` | `const PROVIDERS = ['claude-code','codex','cursor'] as const` | 追加 `'kimi-code'` |
| 3 | `ccm/apps/cli/src/provider-model-facts.ts:17` | `OFFICIAL_HOSTS = new Set(['anthropic.com','www.anthropic.com','openai.com','cursor.com'])` | **追加 Moonshot 官方 host**：`'platform.kimi.ai'`、`'kimi.com'`、`'www.kimi.com'`、`'moonshotai.github.io'`（否则 kimi source URL 过不了 `OFFICIAL_HOSTS` 硬门，第 89 行抛错）|
| 4 | `ccm/apps/cli/src/model-policy.ts:377` | `(['claude-code','codex','cursor'] as const).map(...)` | 追加 `'kimi-code'`（否则 hard_facts.providers 不含 kimi）|
| 5 | `ccm/apps/cli/src/registry.ts:1724` 与 `:1745` | `enum: ['claude-code','codex','cursor']`（`provider facts` CLI 参数校验）| 追加 `'kimi-code'` |

**测试同步**（`bash run-tests.sh` 前）：
- `ccm/apps/cli/test/model-policy.test.ts:21`——surface→provider 映射 helper 硬编码 `claude-code-cli→claude-code / codex-cli→codex / else cursor`，须加 `kimi-code-cli→kimi-code`。
- `ccm/apps/cli/test/model-policy.test.ts:79`+ "one cross-provider role/facts/taste read model" 断言候选集/provider facts，须纳入 kimi 期望。
- `ccm/apps/cli/test/provider-model-facts.test.ts`——加一个 `query('kimi-code')` 用例（对照现有 claude-code/codex/cursor 用例）。
- **bump 三份 JSON 的 `revision`**（provider-model-facts.json 顶层 + kimi 块 revision；role-candidates.json；task-affinity.json）。

> **范围界定**：本 K8A/K8B 只把 kimi 作为 **worker-target 模型 provider** 接入 model-policy。**不涉及** `handlers/coordination.ts:56`（`ORIGINS`）、`claude-provider-driver.ts`、`cursor-provider-driver.ts` 里的 `origin_harness` 列表——那些是"master 跑在哪个 harness 上"（origin 轴），是 kimi-code 作为 origin host 的更大范围集成，与模型档位正交。

### 9.2 provider-model-facts.json —— 新增 `kimi-code` provider（加到 `providers` 对象内）

```json
"kimi-code": {
  "schema": "ccm/provider-model-facts/v1",
  "provider": "kimi-code",
  "revision": "2026-07-16.1",
  "supported_surfaces": ["kimi-code-cli"],
  "supported_client_versions": ["current"],
  "source": [
    { "id": "moonshot-kimi-k3-pricing", "url": "https://platform.kimi.ai/docs/pricing/chat-k3", "retrieved_at": "2026-07-16T00:00:00Z" },
    { "id": "moonshot-kimi-k27-code-pricing", "url": "https://platform.kimi.ai/docs/pricing/chat-k27-code", "retrieved_at": "2026-07-16T00:00:00Z" },
    { "id": "moonshot-kimi-k27-code-card", "url": "https://www.kimi.com/resources/kimi-k2-7-code", "retrieved_at": "2026-07-16T00:00:00Z" }
  ],
  "observed_at": "2026-07-16T00:00:00Z",
  "valid_until": "2026-07-23T00:00:00Z",
  "account_scope": "managed:kimi-code OAuth subscription; live account entitlement separate",
  "confidence": "official-published-snapshot-with-k3-benchmark-unknowns",
  "unknown": [
    "live_account_model_entitlement",
    "live_account_quota",
    "kimi_k3_official_benchmarks",
    "kimi_k3_open_weights",
    "kimi_code_cli_headless_quota_signal"
  ],
  "models": [
    {
      "model_id": "kimi-k3",
      "display_name": "Kimi K3",
      "tier": "frontier",
      "relative_output_cost": null,
      "availability": { "state": "published", "account_scope": "managed:kimi-code OAuth subscription; live entitlement separate" },
      "pricing": { "currency": "USD", "input_per_million_tokens": 3.0, "output_per_million_tokens": 15.0, "note": "cache-hit input $0.30/M; launched 2026-07-16; official benchmarks/model card not yet published" },
      "benchmarks": null,
      "selectors": ["kimi-code/k3"],
      "source_refs": ["moonshot-kimi-k3-pricing"],
      "supersedes": []
    },
    {
      "model_id": "kimi-k2.7-code",
      "display_name": "Kimi K2.7 Code",
      "tier": "balanced",
      "relative_output_cost": null,
      "availability": { "state": "published", "account_scope": "managed:kimi-code OAuth subscription; live entitlement separate" },
      "pricing": { "currency": "USD", "input_per_million_tokens": 0.95, "output_per_million_tokens": 4.0, "note": "cache-hit input $0.19/M; open-weight Modified MIT; forced-thinking (no non-thinking mode); 256K context" },
      "benchmarks": null,
      "selectors": ["kimi-code/kimi-for-coding", "kimi-code/kimi-for-coding-highspeed"],
      "source_refs": ["moonshot-kimi-k27-code-pricing", "moonshot-kimi-k27-code-card"],
      "supersedes": []
    }
  ]
}
```

**payload 设计决策（K8B 需确认）**：
- **`benchmarks: null`（两者）**——刻意置空。`benchmarks` 字段现约定装**跨厂商可比标准集**（Codex 用 `swe_bench_pro_pct` / `terminal_bench_2_1_pct`）。K2.7 只有 Moonshot 自选 benchmark（不可比），K3 无任何 benchmark。把 §4.1 的自评分放进 hard_facts.benchmarks 会制造假可比性，违反 "denominators not comparable" 纪律。自评分改由本报告 + community_advisory 的 `limitations` 承载。**若** K8B 想保留自评分，应放进一个明确 namespaced 的子对象（如 `benchmarks:{vendor_self_reported:{...}}`）并同步扩 skill 说明其不可比——但更保守是 null。
- **`pricing` 用绝对定价**（仿 Claude），`relative_output_cost: null`。因为我们有官方绝对价（Claude 也用绝对价 + relative null）。若 K8B 想给 relative（仿 Codex），K3≈5、K2.7≈1.3（以 output $/M 相对 Sol 锚定的粗略推断，**非官方**）。
- **`tier`**：K3=frontier（价+定位）、K2.7=balanced（中价 + 专用中能力）。K2.7 也可辩为 economy（价确实低），K8B 按 registry 内部一致性定夺。
- **source host**：全部用 `platform.kimi.ai` / `www.kimi.com`（在 §9.1#3 加入 OFFICIAL_HOSTS 后即合法）。**未用 `huggingface.co`**——它不是 Moonshot 自有 host，过不了 OFFICIAL_HOSTS（除非 K8B 决定把 HF 也加白名单，但不建议：HF 是第三方托管，与"official provenance"语义不符）。

### 9.3 role-candidates.json —— 新增 2 个 candidate（加到 `candidates` 数组）

```json
{
  "candidate_id": "kimi-code-cli:kimi-k3",
  "provider": "kimi-code",
  "surface": "kimi-code-cli",
  "model_id": "kimi-k3",
  "candidate_role_grades": ["T1", "T2"],
  "state": "candidate",
  "provenance": [
    { "kind": "research-report", "ref": "design_docs/2026-07-16-kimi-model-tier-research.md", "recorded_at": "2026-07-16T00:00:00Z" }
  ],
  "blockers": ["project-role-certification-required", "live-target-admission-required", "official-benchmarks-unpublished"]
},
{
  "candidate_id": "kimi-code-cli:kimi-k2.7-code",
  "provider": "kimi-code",
  "surface": "kimi-code-cli",
  "model_id": "kimi-k2.7-code",
  "candidate_role_grades": ["T1", "T2", "T3"],
  "state": "candidate",
  "provenance": [
    { "kind": "research-report", "ref": "design_docs/2026-07-16-kimi-model-tier-research.md", "recorded_at": "2026-07-16T00:00:00Z" }
  ],
  "blockers": ["project-role-certification-required", "live-target-admission-required"]
}
```

**note**：`provenance.kind` 与 `blockers[]` 都是自由字符串（无 enum 校验），故 `"research-report"` 与自定义 blocker `"official-benchmarks-unpublished"` 均合法；后者是给 K3 的诚实附加 blocker，语义化提示"benchmark 未公布"。`state` 恒 `"candidate"`（`eligible_for_automatic_selection` 由引擎硬置 false）。

### 9.4 task-affinity.json —— 社区 advisory（可选，bounded tie-break only）

> **前置**：affinity 条目的 `provider/surface/model_id` 必须已在 role-candidates 里 track（§9.3 先落），否则校验抛 "untracked model candidate"。以下条目 confidence 均 < 0.5，属弱 tie-break；K3 因无实测证据**不建议**加 affinity。

```json
{
  "evidence_id": "zhihu-2026-07-k27code-implementation",
  "provider": "kimi-code",
  "surface": "kimi-code-cli",
  "model_id": "kimi-k2.7-code",
  "task_taxonomy": "implementation-from-spec",
  "signal": "positive",
  "direction": 0.4,
  "confidence": 0.3,
  "source": {
    "url": "https://zhuanlan.zhihu.com/p/2049227544931706021",
    "author": "Zhihu community (实测Kimi K2.7 Code：不争全能，专注coding)",
    "published_at": "2026-06-25T00:00:00Z",
    "retrieved_at": "2026-07-16T00:00:00Z"
  },
  "observed_at": "2026-06-25T00:00:00Z",
  "valid_until": "2026-09-16T00:00:00Z",
  "contradictions": [],
  "limitations": ["vendor-self-benchmark-context", "single-community-review", "coding-below-frontier-on-standard-comparators", "chinese-language-workload"]
}
```

（可再加一条 `code-review-precision` 的 `signal:"mixed"` / `direction:-0.3` 记录幻觉/精确性顾虑，引 §5 的可靠性 arxiv 来源——但那些来源对 K2.7 的归因较弱，建议 K8B 视证据强度决定是否纳入，宁缺毋滥。）

---

## 10. 开放问题清单（需 K8B 或实测补）

1. **K3 官方 benchmark（最高优先）**——SWE-bench Verified / Terminal-Bench / LiveCodeBench / AIME 一旦 Moonshot 公布，立即回填 hard_facts + 重估 K3 档位（够强则考虑升 O，弱则可能降到仅 T2）。清 `official-benchmarks-unpublished` blocker。
2. **K3 权重是否开源** + 2.5T 参数是否官方确认（现为 leak）。
3. **K2.7 / K3 的独立标准 benchmark**——Moonshot 自评不可比，需第三方 SWE-bench Verified / aider polyglot 复现给 K2.7/K3 定标（对齐 Codex 的 `swe_bench_pro_pct` 口径）。
4. **本项目 live 认证（certification）**——candidate→certified 需实测：exact selector（`kimi -p -m kimi-code/k3` 等）能否被 kimi-code-cli worker driver 正确发车、role 验收通过率。这是 candidate 之上、派发之前的必经门。
5. **headless quota 信号缺口**——kimi-code CLI **无** `kimi usage` 类 headless 配额输出（`design_docs/harnesses/kimi-code.md` §10 实测）。worker driver 对 kimi 配额准入只能 `unknown`/`unsupported`，pacing/换号信号拿不到。需在 capability card 记 `event-unavailable`，并让 model-policy 消费方知道 kimi 侧无配额 headroom 信号。
6. **可靠性量化**——§5 的 API 断连率(~43%) / 幻觉来自零散第三方，需在本项目 kimi worker 上实测断连率、长程 agentic 幻觉率，才能把 `code-review-precision` 从"谨慎候选"定档。
7. **benchmarks 字段策略**——K8B 拍板：hard_facts.benchmarks 保持 `null`（本报告推荐）还是加 vendor-self-reported 子对象；决定后须同步 skill 说明。
8. **tier 归类**——K2.7 定 balanced 还是 economy；两者是否给 `relative_output_cost`（若给需定锚点口径）。
9. **highspeed 变体建模**——`kimi-for-coding-highspeed` 现作为 `kimi-k2.7-code` 的第二 selector（仿 Cursor Grok 多 selector）。若其能力/延迟/价格与标准版差异大到需独立 role 判断，可拆成独立 model_id；当前证据不支持拆分。
10. **发布日期口径**——K2.7 Code：OpenRouter 记 2026-06-12，官方资源页时间戳 2026-06-25。K8B 若要精确 provenance 可向官方公告二次确认。

---

## 附：本机实测复现命令（只读）

```bash
kimi --version                      # 0.26.0
kimi --help                         # 顶层 options + 子命令
cat ~/.kimi-code/config.toml        # default_model=kimi-code/k3；三个 [models.*] 块
ccm model-policy show --task implementation-from-spec --json
ccm provider facts codex --json
```

registry SSOT：
- `ccm/apps/cli/src/provider-model-facts.json`
- `ccm/apps/cli/src/data/model-policy/role-candidates.json`
- `ccm/apps/cli/src/data/model-policy/task-affinity.json`
- 校验/装配逻辑：`ccm/apps/cli/src/provider-model-facts.ts`、`ccm/apps/cli/src/model-policy.ts`、`ccm/apps/cli/src/registry.ts`
