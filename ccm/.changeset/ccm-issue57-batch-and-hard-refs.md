---
"ccm": minor
"@ccm/engine": minor
---

feat: batch `task start`/`task done`, early `--artifact` diagnostic, and BIZ-DEV-REFS hard gate

- `ccm task start` / `ccm task done` now accept multiple positional ids (`ccm task done T1 T2 T3
  --verified --artifact X`), running one mutate + one lint + one write for the whole batch instead
  of N independent writes. This fixes the "batch backfill death spiral" where a full-board lint
  hard error on unrelated tasks caused every individual write in a large batch to be rejected
  (only 1 of N calls would ever land). `--force` still applies uniformly across the whole batch;
  any illegal transition or missing id fails the entire batch atomically (no partial writes).
  `--json` output shape is now always an array (length = number of ids given, including single-id
  calls — the one intentional shape change).
- `ccm task update <id> --artifact <v>` now gives an early, friendlier `Usage` error (exit 2) when
  the target task is already `status:done` with `verified` not `true` and `--verified` isn't also
  given — that combination can never satisfy `BIZ-DONE-VERIFIED`, so we surface the fix
  ("add --verified, or use `task done --verified --artifact`") immediately instead of only via the
  full lint report on exit 3. Lint remains the sole validation authority; this is a UX-only
  pre-check.
- `BIZ-DEV-REFS` (development tasks must reference `kind=spec` and `kind=plan`) is upgraded from
  `warn` to `hard` — a `development` task missing spec/plan anchors is now rejected at write time
  (`--force` still crosses it), instead of silently accepted with a warning.
