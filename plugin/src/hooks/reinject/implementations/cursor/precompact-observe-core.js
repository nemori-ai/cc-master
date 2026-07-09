#!/usr/bin/env node
/**
 * Cursor Track B reinject — preCompact observe core.
 *
 * Probe (cursor.md D3): Cursor preCompact is observational only — it cannot inject
 * agent context. sessionStart.additional_context is also unreliable for reinject (D4).
 * Role substrate is carried by the alwaysApply rule under plugin rules/ (projected to
 * dist/cursor/rules/). This core is an intentional silent no-op: exit 0, empty stdout,
 * so the launcher emits nothing to the agent.
 *
 * Registered so the event is wired and future observe/logging can land without changing
 * hooks.json; do not emit additional_context / user_message here.
 */
process.exit(0);
