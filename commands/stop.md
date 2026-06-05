---
description: Archive the cc-master board and deactivate the orchestrator (does not delete the board).
---

Wind down cc-master orchestration cleanly:

1. Set `owner.active` to `false` in `.claude/cc-master/board.json` (keep the file — it is the audit record; do not delete it).
2. Remove the active marker so the hooks go dormant:

   ```bash
   rm -f .claude/cc-master/active
   ```

3. Give the user a one-paragraph closeout: what finished (with artifacts), what is still in flight, and what remains blocked on them.
