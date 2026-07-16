# kimi-code hook output envelope (SSOT)

Maps core `kind` + normalized launcher `event` → kimi hook stdout JSON.
kimi facts: `design_docs/harnesses/kimi-code.md` §6 (HookJsonOutputSchema, `message` /
`hookSpecificOutput.permissionDecision`). Injection model (K4 probe, see `probes/README.md`):

- **UserPromptSubmit** `message` **is injected** (agent-core `applyUserPromptHook` → `appendUserMessage`;
  probe-confirmed live). `permissionDecision:"deny"` blocks the prompt + surfaces the reason.
- **PreToolUse** / **Stop** run via `triggerBlock` → **only the block decision is consumed**; a non-deny
  `message` is discarded. So these events have **no non-blocking advisory channel**.
- **Stop** `permissionDecision:"deny"` → agent **continues once** (single-continuation guard) and the
  `permissionDecisionReason` is injected as a user message (agent-core stop handler). This is the
  verify-board gate.
- **PostToolUse** / **PostCompact** / **SessionStart** hook output is **discarded** (fireAndForgetTrigger
  for PostToolUse/PostCompact; discarded results for SessionStart). No injection channel.

| core kind | event | stdout |
|---|---|---|
| `silent` / `allow` | * | (no output) |
| `block` / `deny` | `pre-tool-use` | `{ "hookSpecificOutput": { "permissionDecision": "deny", "permissionDecisionReason" } }` |
| `block` / `deny` | `user-prompt-submit` | `{ "hookSpecificOutput": { "permissionDecision": "deny", "permissionDecisionReason" } }` |
| `block` / `deny` | `stop` | `{ "hookSpecificOutput": { "permissionDecision": "deny", "permissionDecisionReason" } }` (continue + surface reason) |
| `context` / `system` / `followup` | `user-prompt-submit` | `{ "message" }` (injected) |
| `context` / `system` | `post-tool-use` | `{ "message" }` (best-effort; discarded by fireAndForgetTrigger today) |
| `context` / `system` / `followup` | `stop` | (no output — kimi has no non-blocking Stop advisory) |
| any | `session-start` / `post-compact` / other | (no output — no injection channel) |

Implementation: `launcher.js` → `emitHostResult()`.

Product note: ADR-018 `<ambient>` / `<advisory strength=…>` / `<directive source=…>` tags are written
into the `message` / `permissionDecisionReason` text body (reinject is exempt — role substrate). Advisory
Stop hooks (usage-pacing / coordination-inbox / identity-nudge) have no kimi delivery channel and are not
registered; see each hook's `CONTRACT.md` 降级行为 and `design_docs/harnesses/capabilities/`.
