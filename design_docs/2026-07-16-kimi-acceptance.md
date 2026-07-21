# 2026-07-16 kimi-code 适配（第四 host）验收清单

> 场景：goal r1 任务 K7（WS-K 收口 PR #159）。核对目标——「调研全部 harness-wide 拓展点 → 设计
> → 敏捷实现 → 本机实测」——逐条对照 `design_docs/2026-07-16-kimi-code-adapter-design.md` 的拓展点
> 清单，标 ✓（已落地+有证据）或 gap（能力边界，已 Capability Card 声明，非遗漏）。用户拍定的验收
> 标准是「能力边界内最大适配」——凡 Track A 可行必须 Track A，无等价物才允许显式 gap，禁止静默省略。

> **验收后增量（2026-07-21）**：本清单保留 2026-07-16 当时的验收证据。后续 Kimi
> `kimi-usages-api` collector 已落地 current-login 5h/7d + locked OAuth auto-refresh，因此下文
> “usage 恒 unavailable / machine-wide 无 target”的条目是历史快照，不再是当前能力结论；当前仍
> unsupported 的是 account pool、external statusline 与非阻断 Stop pacing delivery。现状以
> Capability Cards、`harnesses/kimi-code.md` 与代码为准。

## 0. 总览

| 分类 | 计数 |
| --- | --- |
| 分发 skill（8 个） | 7 copy（Track A）+ 1 unsupported_stub（`authoring-workflows`，gap） |
| 分发 command（6 个） | 6 全 `host_native`（Track A，优于 codex 的 `adapter_guidance`） |
| PHIP hook（10 个业务 hook + 1 共享库） | 5 implemented（含 1 track-b）+ 5 unsupported + 1 共享库 planned |
| ccm harness 维度（5 个：registry/worker/board-enum/agent-enum/provider-driver-MVP） | 5/5 落地（provider driver 走 MVP raw passthrough，非 rich driver——已在 follow-up 声明） |
| Capability Card（跨 hook/command/skill 硬缺口） | 12 张卡含 kimi-code 行，全部有 INTENT + 等价类 + 降级声明 |
| KNOWN_HOSTS 全矩阵测试门 | `tests/content/capability-host-coverage.test.mjs` 已含 `kimi-code`，跑绿（`run-tests.sh` 123/123 pass） |
| 本机真实 kimi CLI 实测 | 有（v0.26.0，隔离 home，凭证零改动，见 §5） |

---

## 1. SAP（8 个分发 skill）

| skill | 落地形态 | 证据 |
| --- | --- | --- |
| `master-orchestrator-guide` | ✓ copy + 24 slot | `plugin/dist/kimi-code/skills/master-orchestrator-guide/`；今日 codex-review 后新增 `sessionStart.skill` 接线 + `handoff.md` 投影（原设计漏项，已修） |
| `using-ccm` | ✓ copy + 45 slot | `plugin/dist/kimi-code/skills/using-ccm/`；worker/harness enum 段落已含 kimi-code |
| `pacing-and-estimation` | ✓ copy，pacing overlay 声明 kimi 无配额信号 | `pacing-read-only-capability.cjs` 的 `HOST_PROFILES` 含 kimi-code |
| `slicing-goals-into-dags` | ✓ copy | — |
| `dev-as-ml-loop` | ✓ copy（0 slot，host-neutral） | — |
| `engineering-with-craft` | ✓ copy（0 slot） | — |
| `distilling-lessons-into-assets` | ✓ copy（0 slot） | — |
| `authoring-workflows` | **gap**（`unsupported_stub`） | kimi 无 Workflow 等价物；stub 保留中文路由 description + `Do NOT use` + gap 边界（skill-lint 已核） |

**path token**：`${KIMI_SKILL_DIR}` 文本替换生效（`path-token-resolution` Capability Card：kimi-code `implemented`，**比 Cursor 强**——Cursor 该 token 为 null）。

## 2. commands（6 个）

全部 `host_native`（`plugin/src/commands/*/adapters/kimi-code/`，投影至 `plugin/dist/kimi-code/commands/*.md`，manifest `commands: "./commands/"`）。`cc-master:as-master-orchestrator` 首行 sentinel 双通道（native command + UserPromptSubmit hook 识别）实测跑通（见 §5）。

**修正**：`as-master-orchestrator` 命令体原有一段照抄 Claude Code 的账号池/pacing 指导（过度声称 kimi 有 `usage-pacing` hook 与 `ccm account` 支持），今日 codex-review 发现后已重写为诚实缺口声明（见 `2026-07-16-kimi-codex-review.md` Finding 5）。

## 3. PHIP（11 个 hook 条目：10 业务 hook + 1 共享库）

按 `plugin/src/hooks/_manifest/hooks.yaml` 的 `host_coverage.kimi-code`：

| hook | kimi-code 状态 | 备注 |
| --- | --- | --- |
| bootstrap-board | ✓ `implemented-minimal-fresh` | UserPromptSubmit，本机实测建板+武装（§5） |
| verify-board | ✓ `implemented-blocking` | Stop deny→continue 硬门，probe **CONFIRMED continues**（§5） |
| reinject | ✓ `implemented-track-b` | PostCompact 输出被丢弃（probe 定论），改用 manifest `sessionStart.skill` 原生 re-inject（每次 compaction 后自动重触发，比 Cursor 强） |
| board-lint | ✓ `implemented` | PostToolUse |
| board-guard | ✓ `implemented` | PreToolUse，本机实测 deny 直接改 board 文件（§5） |
| usage-pacing | gap `unsupported` | 无 CLI 配额信号 + 无非阻断 advisory 通道 |
| coordination-inbox | gap `unsupported` | 订阅注册可用（走 `ccm coordination subscription register`，今日已修通——见 codex-review Finding 3），但 inbox **投递**无 kimi 非阻断通道 |
| identity-nudge | gap `unsupported` | 同上，无非阻断 Stop advisory 通道 |
| orchestrator-context | gap `unsupported` | SessionStart/PostToolUse hook 输出均被引擎丢弃（probe 定论） |
| posttool-batch | gap `unsupported`（`event-unavailable`） | kimi 无 `PostToolBatch` 事件（`grep -c PostToolBatch` = 0，K1 实测） |
| hook-common（共享库） | `planned` | 非独立事件 hook，共享 helper，同 codex/cursor 现状 |

**5 implemented + 5 unsupported + 1 shared-planned = 11**，与设计 §0 一致，无遗漏无静默省略。

## 4. Probe 结论（K4 首要动作，design §3.5/§附录 的 make-or-break 项）

来源：`plugin/src/hooks/_hosts/kimi-code/probes/README.md`（静态取证 kimi v0.26.0 SEA 二进制源码 + 隔离 home 真实 `kimi -p` 活体复核，双重证据）。

1. **PostCompact `message` 注入** → **DISCARDED（definitive）**。`fireAndForgetTrigger` 按定义丢弃结果；引擎自身有独立的 `injectAfterCompaction()` 原生重注机制，与 hook 无关。
2. **SessionStart hook（事件）`message` 注入** → **DISCARDED（activity-confirmed）**。`triggerSessionStart` 丢弃结果；live 复测确认注入 token 未到模型侧。
3. **`sessionStart.skill`（manifest 字段，非 hook 事件）** → **每次 compaction 后原生重触发**（`PluginSessionStartInjector.onContextCompacted()` 重置 `injectedAt`，逐次重渲染）——**比 Cursor 强**（Cursor 无法在 compact 后重触发）。局限：仅静态 skill 内容，无法带动态板列表/空板硬停/stale 节点。
4. **Stop `permissionDecision="deny"` 续跑语义** → **CONFIRMED continues**（`{continue:true}` + reason 注入用户消息 + 内建单次续跑 guard 防死循环）。verify-board 因此是**真实 deny-continue 硬门**，不只是 advisory。

**结论对齐**：这 4 项 probe 全部落定论（非「待定/unresolved」），reinject 走 Track B（`sessionStart.skill`）是**probe 驱动的确定选择**，不是懒惰兜底。

## 5. 本机真实 kimi CLI 实测（K6，design §8.3 六项断言）

来源：`design_docs/2026-07-16-kimi-e2e-smoke.md`，本机真实 kimi v0.26.0（`~/.kimi-code/bin/kimi`）。

| design §8.3 断言项 | 状态 | 证据 |
| --- | --- | --- |
| 1. 真实 managed 安装（隔离 home） | ✓ | `KIMI_CODE_HOME=<iso>` 复制 dist + 写 `installed.json`；真实 `~/.kimi-code` 冒烟前后凭证 sha256+mtime 逐字节不变 |
| 2. hook stdin 归一化断言 | ✓ | `--echo-normalized`：`harness=kimi-code`、event 映射、`session_id` 提取、`prompt` 数组解析全部正确 |
| 3. `kimi -p` 驱动闭环（真实 CLI，非合成） | ✓ | 真实 `kimi -p "cc-master:as-master-orchestrator ..."` → stream-json 输出含 UserPromptSubmit hook 注入文本；board 落盘 `owner.harness=kimi-code`、`owner.session_id=session_92cceec0-...`（真实 kimi session id，非合成）；auth 失败发生在 hook 建板**之后**，证明 hook 先于 LLM/auth 步骤触发 |
| 4. hook 链断言（board-guard/verify-board） | ✓（Phase A：真实 dist hook + kimi 形状合成 stdin） | board-guard PreToolUse deny 正确（`permissionDecision:"deny"` + reason）；verify-board Stop deny 正确注入 `<directive source="verify-board">` |
| 5. worker driver 断言（`ccm worker help/run --harness kimi-code`） | ✓（单测覆盖，非本次活体 kimi CLI 探测） | `pnpm -C ccm test` 覆盖 `worker help defaults to agent scope...`、`worker run preserves raw argv...` 等用例，全绿；`kimi` 作为 `executableKey` 已接入 `provider-runtime.ts` resolveExecutable 链 |
| 6. reinject probe | ✓ | 见 §4，K4 首要动作，双重证据法（静态源码 + 活体复测）已给出definitive结论 |

**诚实边界**：`board-guard`/`verify-board` 的活体验证是「真实 dist 代码 + kimi 形状的合成 stdin」（Phase A），不是端到端真实 kimi 触发（`kimi -p` 因本机无凭证在 auth 步骤即报错退出，无法继续到工具调用/Stop 阶段）；bootstrap-board 一环是唯一打通**全真实链路**（真实 kimi 二进制 + 真实 auth 失败前的 hook 触发）的一跳。这是本机凭证限制下**能做到的最强证据**，已如实标注，非夸大为「全链路真实验证」。

## 6. ccm 侧（K5 + K8B）

| 维度 | 状态 | 证据 |
| --- | --- | --- |
| A. Harness registry | ✓ | `ccm/apps/cli/src/harnesses/kimi-code.ts`：`detect`/`inspectInstallation`/`session`/`sessionStoreRoots`/`usageSource`/`accountSwitchPreflight`/`upgradePlugin`/`capability` 三元组全部实现，诚实降级理由内联为具名常量（`ACCOUNT_POOL_REASON`/`STATUSLINE_REASON`/`USAGE_UNAVAILABLE_REASON`） |
| B. Worker driver | ✓ | `worker-descriptors.ts`：`WorkerHarness`/`WORKER_HARNESSES` 含 `'kimi-code'`，`executableKey:'kimi'`；`registry.ts` 两处 `--harness` enum（今日 codex-review 后追加 `coordination.inbox`/`coordination.subscription` 的 origin enum，见 codex-review Finding 3） |
| C/C′. board `owner.harness` / `agents[].harness` 枚举 | ✓ | `board-model.ts` `ENUMS.harness`/`ENUMS.agentHarness` 含 `'kimi-code'`；本机实测 `FMT-HARNESS` 不误报（§5） |
| D. Provider driver | **MVP raw passthrough**（design 已声明的 follow-up，非本轮范围） | rich driver（`kimi-provider-driver.ts` 解析 stream-json + reconcile + admission）留作 follow-up；MVP 走 `ccm worker run` 透传，测试覆盖已通过 |
| K8B 模型档位 | ✓（超出「不阻塞 skeleton」的最低要求，已完整落地） | `provider-model-facts.json` 含 `kimi-k3`/`kimi-k2.7-code` 完整 block（selectors `kimi-code/k3`、`kimi-code/kimi-for-coding[-highspeed]`、pricing/benchmark source_refs、`account_scope` 诚实标注） |
| using-ccm 锁步 | ✓ | `command-catalog.md`/`board-model-guide.md` 的 harness enum 段落已含 kimi-code（K5 commit 一并同步，符合 AGENTS.md §6 抗漂移纪律） |

**K9 追加发现（超出原设计范围，价值加分项）**：`design_docs/2026-07-16-kimi-quota-signal-research.md` 通过开源仓库源码考古**推翻**了 K1 阶段「kimi 无配额信号」的旧结论——找到真实上游 API `GET https://api.kimi.com/coding/v1/usages`（Bearer OAuth，5h/周两档滚动窗口）。当前 `readCurrentUsage` 仍诚实返回 `signal:null`（MVP 未接线 collector），但已有具体、有证据支撑的 v1 落地路线（对标 `cursor-agent-dashboard` collector），不是死胡同 gap。

## 7. Capability Cards（跨 hook/command/skill 硬缺口，用户要的 5 张核心卡）

12 张卡含 kimi-code 行，全部含 INTENT + 等价类判据 + `降级行为`（三分类学 + `tracked_by`）：

| Card | kimi-code 状态 | 一句话 |
| --- | --- | --- |
| `role-substrate-reinject` | `implemented`（Track B） | `sessionStart.skill` 原生 compaction 后重触发；动态板列表/空板硬停丢失 |
| `stop-continuation-gate` | `implemented` | Stop deny→continue 硬门（probe confirmed） |
| `goal-contract-lifecycle` | `implemented` | 经 `ccm goal`，harness-neutral，同其余 host |
| `path-token-resolution` | `implemented` | `${KIMI_SKILL_DIR}` 文本替换，强于 Cursor |
| `cross-harness-session-bound-worker` | `partial` | raw passthrough MVP；rich driver 是 follow-up |
| `cross-harness-notification-subscription` | `partial` | 订阅注册可用；inbox 投递 unsupported |
| **`workflow-authoring`**（用户要的卡①） | `unsupported`（`event-unavailable`） | 无 Workflow 等价物；替代=内置 subagent/Bash 后台/Agent Swarm |
| **`post-tool-batch-gate`**（用户要的卡②） | `unsupported`（`event-unavailable`） | 无 `PostToolBatch` 事件；WIP/pacing 靠 board-guard+verify-board 兜底 |
| **`ccm-quota-account`**（用户要的卡③④，配额+号池合一） | `unsupported`（`protocol-capability-gap`） | 无 CLI 配额面；号池绑 Claude OAuth，`ccm account *` NotImplemented |
| `usage-pacing-midflight` | `unsupported` | 无配额信号+无非阻断 Stop 通道 |
| `machine-wide-quota-notification` | `unsupported` | 无 kimi quota TARGETS 条目 |
| `cross-harness-cached-context` | `unsupported` | SessionStart/PostToolUse hook 输出均被丢弃 |

**用户要的第⑤张卡（自定义 subagent 角色）**：未落成独立 Capability Card 文件，而是声明在 `plugin/src/skills/_hosts/kimi-code/capabilities.yaml`（`background_dispatch.subagent.notes`：「manifest 无 `agents` 字段 → 无自定义角色，只有内置 `coder/explore/plan/general` + Agent Swarm」）与 `workflow-authoring.md` 卡的替代方案行。**判断**：内容已如实声明、未被静默省略，但落点形态与设计 §7「新增建议卡或并入现有卡」的两个选项都不完全一致（选了第三种：`capabilities.yaml` host 能力矩阵）——不算违反「不静默省略」红线，但建议 follow-up 时把它并入 `workflow-authoring.md` 或新开一张独立卡，以对齐其余四张卡的呈现一致性。**轻微缺口，已如实记录，不影响 merge 判断**。

## 8. 诚实缺口总清单（非遗漏，是能力边界）

1. 无自定义 subagent 角色（内置 coder/explore/plan/general + swarm only）。
2. 无 Workflow / 确定性编排引擎等价物。
3. 无 `PostToolBatch` 事件。
4. 无 CLI 配额信号（MVP；但 K9 已找到具体 v1 落地路径，见 §6）。
5. `ccm account` 号池管理 unsupported（kimi 单一 managed OAuth 登录，无号池概念）。
6. reinject 丢失动态板列表/空板硬停/stale 节点重现（`sessionStart.skill` 只带静态身份内容）。
7. `coordination-inbox`/`identity-nudge`/`orchestrator-context`/`usage-pacing` 无非阻断 Stop advisory 投递通道。
8. provider driver 是 raw passthrough MVP，非 rich stream-json 解析/reconcile/admission。

以上 8 项每项都有 Capability Card 或 CONTRACT.md 降级声明 + `tracked_by` 指向，无一处静默省略。

## 9. 验收结论

对照用户的验收标准「调研全部 harness-wide 拓展点 → 设计 → 敏捷实现 → 本机实测」+「能力边界内最大适配」：

- **调研**：K1 事实文档 + K9 追加调研（推翻旧配额结论）均完成，双重证据法（源码/二进制静态取证 + 活体复测）。
- **设计**：全拓展点 Track A/B/gap 三分表完整（design doc §0），无遗漏拓展点。
- **实现**：8 skill / 6 command / 11 hook 条目 / 5 ccm 维度全部按设计落地；`KNOWN_HOSTS` 全矩阵测试门绿；四闸全绿。
- **实测**：本机真实 kimi v0.26.0 跑通 plugin 装载 + UserPromptSubmit bootstrap 全真实链路；board-guard/verify-board 用真实 dist 代码复核；probe 结论全部 definitive（非「待定」糊弄）。
- **能力边界内最大适配**：能 Track A 的全部 Track A（含 3 处优于 Cursor 的强项：path token / `sessionStart.skill` compaction 后重触发 / host_native commands）；无等价物的 8 处诚实声明为 gap，全部有 Capability Card 或 CONTRACT.md 落点，无静默省略。

**唯一轻微瑕疵**：第⑤张「自定义 subagent 角色」卡未落成独立文件（§7），已记录为 follow-up 观察项，不构成验收失败。
