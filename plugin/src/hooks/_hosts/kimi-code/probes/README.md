# kimi-code hook injection probe (K4 make-or-break)

Probe question (design §3.5 / appendix): **can a `PostCompact` hook inject its `message` into the
post-compaction agent context?** (and: does `SessionStart` re-fire / inject after compaction?) — this
decides whether reinject (魂重注) goes native Track A (PostCompact hook) or static Track B
(`sessionStart.skill` + AGENTS substrate).

Binary probed: kimi v0.26.0 (`/data/qiwei/.kimi-code/bin/kimi`). Methodology: static取证 on the
published SEA binary (`strings` + `grep`, reproducible — the strongest evidence tier per
`design_docs/harnesses/kimi-code.md`) + a live `kimi -p` run in an isolated `KIMI_CODE_HOME`
(credentials symlinked from the real home, never written; real home verified untouched).

## Conclusion: Branch 2 (Track B static substrate) — DEFINITIVE

**PostCompact hook `message` is DISCARDED** (cannot inject). Evidence (static, agent-core):

- `triggerPostCompactHook(data, result)` calls `this.agent.hooks?.fireAndForgetTrigger("PostCompact", …)`.
  `fireAndForgetTrigger` only tracks the promise (`pendingTriggers`); it never consumes the hook
  result's `message`/`action`. Fire-and-forget by definition = output discarded.
- Immediately BEFORE firing PostCompact, the agent runs its own native
  `await this.agent.injection.injectAfterCompaction()` (→ `injectGoal` + `injectToolsDiff` +
  `injectActiveBackgroundTasks` + `inject()` over the lifecycle injectors). Post-compaction re-priming
  is a native mechanism, not a hook channel.

**SessionStart hook `message` is also DISCARDED.** `triggerSessionStart(source)` does
`await this.hookEngine.trigger("SessionStart", …)` and drops the results (no consumption). Live
confirmed: the SessionStart hook fired but its injected token did not reach the model.

**BUT `sessionStart.skill` (manifest field) RE-INJECTS after every compaction natively** — this is the
Track B substrate mechanism, and it is *stronger* than Cursor (which cannot re-fire after compact):

- `PluginSessionStartInjector` is a `DynamicInjector`. Its base `onContextCompacted()` sets
  `injectedAt = null`; `injectAfterCompaction()` re-runs `inject()`, so the
  `<plugin_session_start skill="…">…</plugin_session_start>` block is re-rendered after each compaction.
- Limitation: it is STATIC skill content — it cannot carry the dynamic board list / empty-board
  hard-stop / stale nodes (those need a hook `message`, and no hook event injects post-compaction).

**Which events CAN influence the model on kimi** (drives the whole adapter, ENVELOPE.md):

| event | mechanism | can inject/act? |
|---|---|---|
| UserPromptSubmit | `trigger` → `applyUserPromptHook` → `appendUserMessage` | **yes — `message` injected** (live-confirmed) + `permissionDecision:"deny"` blocks |
| PreToolUse | `triggerBlock` (consumes block decision only) | deny only (no context inject) |
| Stop | `triggerBlock`; on deny → `appendUserMessage(reason)` + continue once (`stopHookContinuationUsed` guard) | **deny → continue + reason injected**; non-deny message discarded |
| PostToolUse / PostCompact | `fireAndForgetTrigger` | no — discarded |
| SessionStart | `trigger`, results dropped | no — discarded |

## Live probe (reproduce)

Isolated home + a probe plugin registering UserPromptSubmit / SessionStart / PostCompact / PreCompact
hooks (each dumps stdin + emits `{"message":"…include token <EVENT>_TOKEN…"}`); then:

```bash
KIMI_CODE_HOME=<iso> kimi -p "Reply with a one-sentence greeting. Do not use any tools." \
  --output-format stream-json
```

Result: assistant output contained `UPS_TOKEN_9F3` (UserPromptSubmit message injected) but NOT
`SS_TOKEN_7A1` (SessionStart hook fired — see hook-fires.log — but message not injected).
PostCompact/PreCompact did not fire (no compaction in a short run); their discard is settled by the
static `fireAndForgetTrigger` evidence above. Live stdin shapes captured: snake_case keys, `session_id`
= `session_<uuid>`, `prompt` = `[{type:"text",text}]`, SessionStart carries `source:"startup"`, hook
cwd = plugin managed dir, `$KIMI_PLUGIN_ROOT` expands in the hook command string.

## Stop continuation (design §3.4 probe #3): CONFIRMED continues

A Stop hook `permissionDecision:"deny"` returns `{continue:true}` and appends `permissionDecisionReason`
as a user message (agent-core stop handler). A built-in single-continuation guard (`stopHookContinuationUsed`)
prevents infinite loops within a stop cycle. → verify-board is a real deny-continue gate (not just
advisory). See `plugin/src/hooks/verify-board/CONTRACT.md` 降级行为.
