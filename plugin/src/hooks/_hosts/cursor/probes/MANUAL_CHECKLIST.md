# Cursor Phase 0 — Manual checklist (D1–D12)

Fill this while running the project-local and/or local-plugin probe.
Paste answers into [`design_docs/harnesses/cursor.md`](../../../../../../design_docs/harnesses/cursor.md) §Probe Results
(or reply in chat and ask the agent to backfill).

**Cursor version:** _______________  
**OS:** _______________  
**Date:** _______________  
**Fixture root:** _______________

| ID | Question | Result (PASS/FAIL/BLOCKED) | Evidence (fixture file / Output→Hooks / note) |
| --- | --- | --- | --- |
| D1 | Hook `command` path: relative to what? Absolute works? Any `${…}` plugin root token? | | |
| D2 | Hook child has `node` on PATH? (`node` field / `which_node_hint` in fixture) | | |
| D3 | After compaction, does `sessionStart` fire again? | | |
| D4 | Does `sessionStart.additional_context` reach the model? (agent mentions probe string?) | | |
| D5 | Does `postToolUse.additional_context` reach the model? | | |
| D6 | Does `stop.followup_message` continue the agent? Bound by `loop_limit`? | | |
| D7 | Is `conversation_id` stable across close/reopen of the same chat? | | |
| D8 | In a normal Agent Shell (not hook), are `CURSOR_*` env vars present? | | |
| D9 | After install under `~/.cursor/plugins/local/<name>/`, do hooks fire? | | |
| D10 | If both project `.cursor/hooks.json` and Claude third-party hooks exist, who wins / both run? | | |
| D11 | Does `sessionStart` `env` injection persist to later hooks / subagents? | | |
| D12 | Any Enterprise policy blocking local plugins / hooks? (N/A if not on Enterprise) | | |

## Suggested Agent prompts (copy-paste)

1. `Reply exactly: OK`
2. `Run: echo hello-from-probe && pwd && env | grep -E 'CURSOR_|CC_MASTER' || true`
3. `Write file notes/wrote-by-agent.txt with content probe`
4. (stop followup test — swap stop mode to `followup` in hooks.json first) let agent finish; expect auto-continue with `PROBE_FOLLOWUP_OK`
5. (optional) trigger context compaction; note new fixtures under `preCompact/` / `sessionStart/`

## Fixture inspection

```bash
find "$FIXTURES" -type f -name '*.json' | sort
# For each file, check: cwd, argv, env_subset, stdin_json keys (conversation_id, etc.)
```
