---
description: Archive the cc-master board and deactivate the orchestrator (does not delete the board).
---

Wind down cc-master orchestration cleanly. Deactivating a board is **destructive** (it archives the orchestration), so identify the right board and confirm before writing.

1. **Identify the board.** Boards live in the cc-master home (`$CC_MASTER_HOME`, else `<project>/.claude/cc-master/`), named `<timestamp>-<pid>.board.json`. List the home and read every board whose `owner.active` is `true`.
   - If exactly one is active, that is the candidate.
   - If several are active, match each board's `goal` field against the goal you have been driving, and take the one that matches.
   - If several match, none match, or you cannot determine the board unambiguously, **ask the user which board to stop** (list the candidates with their `goal` and file name) rather than guessing — stopping the wrong board archives someone else's orchestration.
2. **Confirm before deactivating.** State which board you are about to stop (its `goal` and file name) and ask the user to confirm, since setting `owner.active` to `false` is irreversible from the hooks' point of view. Do not deactivate without that confirmation.
3. Once confirmed, set `owner.active` to `false` in that board file (keep the file as the audit record; do not delete it). That single edit is what deactivates it: the hooks treat only boards whose `owner.active` is `true` as live, so there is no separate marker file to remove.
4. Give the user a one-paragraph closeout: what finished (with artifacts), what is still in flight, and what remains blocked on them.
