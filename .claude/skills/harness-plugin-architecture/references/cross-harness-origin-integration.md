# Cross-harness origin integration

本文只回答：一个已由 ccm contracts 定义的 cross-harness 能力，怎样在 Claude Code、Codex、Cursor
任一 **origin plugin** 上获得等价、可验收的 landing。它不设计 headless provider runtime。

## Contents

- [1. Scope split](#1-scope-split)
- [2. Capability INTENT 入口](#2-capability-intent-入口)
- [3. 三 origin delivery timing](#3-三-origin-delivery-timing)
- [4. Host-native attempt adapter](#4-host-native-attempt-adapter)
- [5. Worker role 与 security 移交](#5-worker-role-与-security-移交)
- [6. N+1 origin checklist](#6-n1-origin-checklist)

## 1. Scope split

先把 execution surface 分成三类。**是否与 origin 同品牌，不改变 owner 边界。**

Headless runtime 的架构/合同 SSOT 是
[`design_docs/cross-harness-orchestration-capability-model.md`](../../../../design_docs/cross-harness-orchestration-capability-model.md)；
实现按普通 engineering / dev loop skills 推进。下文称它为「runtime SSOT」。

| Surface | 例子 | 本 skill / origin adapter 拥有 | 移交 |
| --- | --- | --- | --- |
| origin host-native | Claude/Codex/Cursor 主会话内部可调用的 subagent / Task surface | host event/command/skill landing；native invoke；真实 handle 映射并 bind 回 ccm | attempt 状态机、writer、route/admission 归 ccm contract |
| same-harness CLI/headless | Codex master 调 `codex exec`，Claude master 调 `claude -p` | 只消费 ccm 返回的 summary/run ref；不因为同品牌而走 native adapter | provider driver、structured result、quota、supervisor 归 runtime SSOT |
| other-harness CLI/headless | Codex master 调 Claude/Cursor CLI，反之亦然 | 同上 | 同上 |

边界判定：

> 问题若是“这个事实或动作怎样进入 origin agent context / native tool”就在本 reference；若是“CLI
> worker 怎样 probe、选模、reserve、spawn、cancel、resume、记 journal”就移交 runtime SSOT，
> 实现按普通 engineering / dev loop 推进。

本 plane 的 IN：

- origin manifest / hook / command / skill / rules surface；
- host-neutral Capability INTENT 到 host-native event/envelope 的 Track A/B 映射；
- cached-only context、decision delta 和 durable attention 的 agent-facing landing；
- origin-native attempt 的 invoke 与真实 handle bind；
- host-native permission/tool/worker-role mapping；
- equivalence fixtures、projection 与 host probe。

本 plane 的 OUT：

- provider CLI flags、stream parser、model/quota probe；
- task planning、route math、admission、reservation、worktree lease；
- supervisor、process tree、journal、attach/reconcile、runtime pin/upgrade；
- model/price/benchmark registry 和 live quota store；
- master 最终 route、WIP、HITL 与 true-done judgment。

## 2. Capability INTENT 入口

origin integration 通常跨 hooks、commands、skills 和 ccm，不要直接从一个 event implementation 开始。

1. 回读 [`design_docs/cross-harness-orchestration-capability-model.md`](../../../../design_docs/cross-harness-orchestration-capability-model.md)，确认 capability owner、current/partial/target 与晋升门。
2. 回读 `design_docs/harnesses/<host>.md` 与 compatibility matrix，确认当前 host 事实；Cursor IDE 与 Cursor Agent CLI 分开。
3. 若用户可见 intent 跨多个 surface，先建立或更新 `design_docs/harnesses/capabilities/<id>.md`；若仅一个 hook 的业务规则变化，更新该 hook 的 `CONTRACT.md`。
4. 对每个 origin 判 Track A / Track B，并写 testable acceptance、declared divergence 与 substitute。
5. 再改 per-host strategy / implementation、projection、equivalence fixture 与真实 probe。

cross-harness origin plane 常见的 Capability INTENT 类别是：

| Intent | Card / contract 应回答 | 不放这里 |
| --- | --- | --- |
| machine resource context | 哪些脱敏事实进 always-context，哪些 delta 才打断，cache 失败如何降级 | collector、quota schema、TTL/headroom 算法 |
| host-native attempt binding | create/invoke/bind/heartbeat/result/cancel 的用户可见等价类 | attempt 状态机和 dedicated writer 实现 |
| cross-session run attention | 新 origin 怎样得知 run_ref、control degradation、operator attention | supervisor hello/journal/attach 实现 |
| worker-role projection | host 如何限制 native worker 的 tools/permission/role | cross-CLI child env/process security |

卡片名称和 wire schema 只有在对应 tracked contract 落地后才算 current；不要从本文发明用户可用命令。

## 3. 三 origin delivery timing

事件和 payload 会随 host 版本变化；精确事实始终回读 host facts。下表锁定的是 intent、timing 与诚实
降级，不是 event-name parity。

| Timing | Claude Code origin | Codex origin | Cursor IDE origin | Acceptance / degradation |
| --- | --- | --- | --- | --- |
| ARM confirmation | UserPromptSubmit context | prompt-first UserPromptSubmit context | beforeSubmitPrompt user message | 只有 bootstrap 可 ARM；ccm 缺失不产生半武装 board |
| Session start/resume | SessionStart startup/resume/compact | SessionStart context | 目标版本 probe 通过才使用 SessionStart；否则 alwaysApply 只放静态 role/ref | cross-harness context 必须 cached-only；missing/corrupt → 空或 unknown，零 provider probe |
| Compaction role | SessionStart compact 重注 | host resume/compact substrate | preCompact 不能注入；alwaysApply Track B 保底 | Cursor 不宣称 full reinject parity；动态 snapshot 不塞 alwaysApply |
| Mid-turn decision delta | PostToolBatch 只在边变化 | 无 PostToolBatch，不用每次 PostToolUse 伪装 batch | 仅目标版本 probe 通过时使用有界 PostToolUse delta | 无等价 event → durable inbox / 下次 start；routine telemetry 静默 |
| Stop action | block/advisory/inbox | block 或 systemMessage/inbox | followup_message 只送真 decision/action | Cursor followup 会开新轮，routine resource summary 不走 Stop |
| Native completion | host task notification | 已发现的 subagent handle/completion | subagentStop / AwaitShell / notify-on-output | 没有真实 handle 不得 bind/running；durability 逐 host probe |
| Cross-CLI completion | ccm coordination delta + reconcile | 同左 | 同左 | same/other CLI 均来自 ccm durable fact，不依赖 origin event |
| Handoff/resume | board resume + run attention | 同左 | 新 conversation 重新 ARM 后同左 | origin 只 surface refs/attention；attach/reconcile mechanics 归 runtime |

Delivery 纪律：

- hook 只调用明确标为 cached-only 的 ccm read surface；不能 refresh、network 或读 credential。
- always-context 有界、脱敏；routine heartbeat 留 run store，不灌模型 context。
- 同 revision / delta 在 cooldown 内去重；decision-grade 变化才进入 durable inbox。
- landing fail-open 只表示 agent context 降级；dispatch authorization 仍由 ccm live gate fail-closed。
- 不复制 raw account、精确余额、model catalog、provider response 或绝对 credential/path 到 hook output。

## 4. Host-native attempt adapter

ccm 外部进程不能替 origin agent 调内部 native tool，因此 native invocation 是明确的 adapter seam：

```text
ccm create native attempt lease
  → origin adapter invoke native tool
  → 取得 host 返回的真实 handle
  → bind(handle + host identity) 回 ccm
  → adapter 转发有证据的 heartbeat / normalized result / cancel outcome
  → ccm 校验 transition 并投影 attempt 摘要
```

职责分开：

| Owner | 必须做 | 禁止做 |
| --- | --- | --- |
| ccm attempt contract | create/idempotency、transition、dedicated writer、artifact refs、terminal taxonomy | 调 host 内部 tool、猜 native handle |
| origin adapter | 调真实 native tool、捕获真实 handle、映射 host event/result/permission、调用稳定 ccm bind/event API | 自己发明 attempt 状态、直接写 board、把 invoke 成功当 task done |
| master | 选择已获授权 candidate、记录 rationale、terminal 后独立验收 | 无 handle 标 in-flight、provider/native success 直接 true-done |

硬验收：

- `create` 成功但 native invoke 失败：attempt 明确终止/uncertain，不能留 phantom running。
- invoke 返回前不能把 board task 标 in-flight；没有真实 handle 就没有 running。
- bind 重试幂等；相同 attempt 不能绑定两个 live handles。
- native handle 是否跨 origin session 持久，必须由该 host probe 证明；未证明就标 session-bound，不伪装 durable run。
- same-harness CLI 和 other-harness CLI **不走本流程**；二者都由 runtime provider/supervisor contract 产出 run_ref。
- attempt terminal 只证明 worker run 结束；父层 acceptance 仍由 master/true-done contract 判定。

## 5. Worker role 与 security 移交

origin adapter 只把已批准的 worker/security intent 映射到 host-native tools：

- 限制 worker 不 ARM master board、不启动 nested master、不直接写父 board；
- 映射 host 的 permission、tool allow/deny、sandbox/workspace 和 cancel surface；
- 把 actual permission / model / workspace 与结果证据 bind 回 attempt；
- host 无法机械表达承重限制时，声明 capability gap，不能靠 prompt 假装 hard gate。

以下一律移交 runtime SSOT / ccm runtime contract：cross-CLI child env allowlist、
credential stripping、process group/Job Object、worktree lease、reservation、network/MCP gate、provider
session、journal 和 supervisor cleanup。本 skill 不复制它们的字段或实现步骤。

cross-harness 总授权不蕴含 commit、push、PR、merge、release、external write、跨 provider 数据或账号
mutation 权限。Codex/Cursor account mutation forbidden 是上游 product/security contract；origin adapter
只能映射和证明没有旁路，不能重新解释。

## 6. N+1 origin checklist

### Scope / facts

- [ ] origin interactive/plugin 与 same-harness / other-harness CLI descriptors 已分开。
- [ ] tracked host facts 有目标版本、official source、retrieved_at、real probe 与冲突仲裁。
- [ ] plugin installed/authenticated 没有被推成 headless worker eligible。

### INTENT / delivery

- [ ] 跨 surface intent 先有 Capability Card；单 hook 规则先有 CONTRACT。
- [ ] ARM、SessionStart/resume、compact、mid-turn、Stop、completion、handoff 逐项判 Track A/B。
- [ ] cached context 有 payload cap、redaction、delta hash/dedupe、fail-open，且 hook 零 provider probe。
- [ ] 无等价 event 时使用声明过的 substitute，不以最近邻 event 冒充 parity。

### Native attempt / role

- [ ] create→invoke→bind 取得真实 handle；无 handle 不 running；重复 bind/terminal 幂等。
- [ ] native handle durability 有 host probe；未知就 session-bound。
- [ ] worker role、permission/tools/workspace/cancel 已映射；承重 gap 明确降级。
- [ ] adapter 不写 board、不实现 attempt state machine、不把 terminal 当 true-done。

### Projection / verification

- [ ] skills、hooks、commands、manifest/rules、per-host strategy 与 source/dist touch set 完整。
- [ ] Track A 通过 equivalence fixture + host-native dist/probe；Track B 通过 substitute acceptance。
- [ ] generated matrix、content tests、projection sync、package contents 与真实 host probe 分层通过。
- [ ] provider driver/supervisor/quota store 的新增工作已回到 runtime SSOT 并用普通 engineering / dev loop 推进，未塞回 origin adapter。
