# Cursor Hook Probes (Phase 0)

Before implementing production Cursor hooks (`implementations/cursor/`), capture fixtures
for the **current Cursor IDE Agent** build. Official docs are secondary to probe results
(`current probe > official docs`).

This is **Phase A** of the Cursor dual-track rollout (ADR-031): measure D1–D12, then scaffold.

## Files

| File | Role |
| --- | --- |
| `probe-hook.js` | Captures stdin/env/cwd/argv; optional output modes |
| `hooks.project.template.json` | Project `.cursor/hooks.json` template (absolute paths) |
| `hooks.plugin-local.template.json` | Local-plugin hooks template |
| `setup-project-probe.sh` | Materialize a temp workdir with project hooks |
| `setup-local-plugin-probe.sh` | Install probe plugin under `~/.cursor/plugins/local/` |
| `MANUAL_CHECKLIST.md` | D1–D12 fill-in sheet |

## Quick start (recommended first)

```bash
# From repo root
bash plugin/src/hooks/_hosts/cursor/probes/setup-project-probe.sh
# → open printed probe_root in Cursor IDE
# → follow notes/HOW_TO_RUN.md
```

Then (install path / D9):

```bash
bash plugin/src/hooks/_hosts/cursor/probes/setup-local-plugin-probe.sh
# → enable local plugin in Cursor Customize
```

## Output modes (`CC_MASTER_CURSOR_HOOK_PROBE_MODE`)

| Mode | stdout | Use for |
| --- | --- | --- |
| `silent` | empty | D1/D2/D7 capture |
| `context` | `{"additional_context":…}` | D4 / D5 |
| `followup` | `{"followup_message":…}` | D6 |
| `deny` | `{"permission":"deny",…}` | preToolUse block smoke |
| `exit2` | stderr + exit 2 | deny-via-exit smoke |

## Where to record results

Backfill **§Probe Results** in [`design_docs/harnesses/cursor.md`](../../../../../design_docs/harnesses/cursor.md).
Do not treat forum anecdotes as PASS without a fixture on your Cursor version.

## What this does *not* do

- Does not write production `implementations/cursor/*`
- Does not extend `sync-plugin-dist.sh --host cursor`
- Does not modify `install.sh`
