---
"ccm": minor
"@ccm/engine": minor
---

feat: task-scoped bare `--set/--set-json` dotpaths, `board update --set/--set-json`, and written-path echo (Finding #83)

- `ccm task add <id>` / `ccm task update <id>`: a bare dotpath in `--set`/`--set-json`
  (e.g. `--set-json 'decision_package={…}'`) now scopes to **that task** — matching the intuition
  of named flags like `--title`. Previously bare paths silently landed on the board top level
  while the command still reported "task 已更新", polluting the board root with dead data
  (Finding #83). An explicit `tasks[<other-id>].field` prefix keeps its existing cross-task
  semantics (escape hatch preserved). 🔒 load-bearing protection is unchanged — and now bare
  `--set status=…` in a task context is refused (exit 3) instead of silently writing top-level junk.
- `ccm board update` gains `--set <path=val>` / `--set-json <path=json>` as the front door for
  board-top-level ✎ flexible fields (bare path lands on the board root; 🔒 `schema`/`goal`/`owner`/
  `git`/`tasks` still refused; `tasks[<id>].field` prefix targets that task). `board update` with
  only `--set`/`--set-json` (no named flag) is now accepted.
- After any `--set`/`--set-json` write, non-`--json` output echoes the normalized logical path
  actually written (e.g. `set tasks[T7].decision_package`), eliminating the zero-signal
  wrong-destination failure mode.
- Help text for `--set`/`--set-json` on `task add`/`task update`/`board update`/`jc add`/
  `cadence update`/`cadence open` now states the scoping semantics explicitly.
- `jc add` / `cadence update` / `cadence open` keep their existing board-top-level bare-path
  semantics (no task anchor in those contexts) — unchanged.
