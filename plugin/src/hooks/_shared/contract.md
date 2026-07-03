# Shared Hook Adapter Contract

This contract is the boundary between host-native hook launchers and cc-master hook business logic.

Do not put host-native event envelopes, path tokens, or raw stdin assumptions in shared hook core. A host launcher must normalize them first.

## Normalized Environment

Host launchers set these variables before invoking shared hook core:

```text
CC_MASTER_HARNESS=<claude-code|codex|...>
CC_MASTER_HOOK_EVENT=<user-prompt-submit|session-start|pre-tool-use|post-tool-use|stop|...>
CC_MASTER_SESSION_ID=<host session/thread id if available>
CC_MASTER_AGENT_ROLE=<main|subagent|unknown>
CC_MASTER_HOME=<resolved cc-master home>
CC_MASTER_PLUGIN_ROOT=<absolute plugin root if known>
CC_MASTER_BOARD=<absolute active board path for this session if exactly known>
CC_MASTER_BOARD_STEM=<board filename without .board.json if exactly known>
CC_MASTER_BOARD_SOURCE=<session-state|board-scan if exactly known>
```

Rules:

- `CC_MASTER_HARNESS` is required.
- `CC_MASTER_HOOK_EVENT` is required.
- `CC_MASTER_SESSION_ID` may be empty only when the host payload lacks a stable session id.
- `CC_MASTER_AGENT_ROLE` is `unknown` unless the host payload proves main vs subagent.
- `CC_MASTER_PLUGIN_ROOT` must be an absolute path. Leave it empty rather than inventing a host token.
- `CC_MASTER_BOARD` is set only after the session has been armed and the launcher can identify exactly one active board for `CC_MASTER_SESSION_ID`.
- `CC_MASTER_BOARD_SOURCE=session-state` means the launcher used a host session state file written by bootstrap; `board-scan` means it fell back to scanning active boards by `owner.session_id`.

## Normalized Payload

The launcher passes normalized JSON to shared core on stdin:

```json
{
  "harness": "claude-code",
  "event": "stop",
  "session": {
    "id": "session-id",
    "role": "main"
  },
  "tool": {
    "name": "Bash",
    "input": {}
  },
  "prompt": {
    "text": ""
  },
  "raw": {}
}
```

Rules:

- `raw` preserves the host-native payload for diagnostics and fixture tests.
- Shared core may read `raw` only behind a host capability guard.
- Tool fields are present only for tool lifecycle events.
- Prompt fields are present only for prompt lifecycle events.

## Normalized Result

Shared core returns one JSON object:

```json
{
  "kind": "silent",
  "message": "",
  "context": ""
}
```

Allowed `kind` values:

- `silent`: emit nothing / allow.
- `context`: inject advisory context.
- `block`: block the host action if the host supports blocking for this event.
- `allow`: explicit allow with optional message.

Host launchers own conversion from this result to host-native output. If a host does not support `block` for the event, the launcher must degrade to `context` or fail closed according to the hook strategy; shared core must not guess.

## Path Resolution

Shared core never relies on `${CLAUDE_PLUGIN_ROOT}`, `${CODEX_PLUGIN_ROOT}`, `${CLAUDE_SKILL_DIR}`, or similar host tokens.

Host launchers may use host-supported tokens in host-native registration, but they must pass an absolute `CC_MASTER_PLUGIN_ROOT` to shared core when scripts/resources need plugin-relative paths.
