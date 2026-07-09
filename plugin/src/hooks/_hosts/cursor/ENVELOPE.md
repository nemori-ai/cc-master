# Cursor hook output envelope (SSOT)

Maps core `kind` + normalized launcher `event` → Cursor stdout JSON.

Normalized events: `user-prompt-submit` (`beforeSubmitPrompt`), `pre-tool-use`, `post-tool-use`, `stop`, `pre-compact`.

| core kind | event | stdout |
|---|---|---|
| `silent` / `allow` | * | (no output) |
| `block` / `deny` | `pre-tool-use` | `{ "permission": "deny", "user_message" }` |
| `block` / `deny` | `user-prompt-submit` | `{ "continue": false, "user_message" }` |
| `block` / `deny` / `followup` / `context` / `system` | `stop` | `{ "followup_message" }` |
| `context` / `system` / `followup` | `user-prompt-submit` | `{ "continue": true, "user_message" }` |
| `context` / `system` | `post-tool-use` | `{ "additional_context" }` |
| any other | * | (no output) |

Implementation: `launcher.js` → `emitHostResult()`.

Product note: Stop advisories use `followup_message` because Cursor documents no inject-only field on `stop`; auto-continue is throttled by hook cooldowns and `loop_limit` on verify-board.
