---
description: Archive the cc-master board and deactivate the orchestrator (does not delete the board).
---

Wind down cc-master orchestration cleanly:

1. Set `owner.active` to `false` in this orchestration's board file — the one under the cc-master home you have been driving (keep the file as the audit record; do not delete it). That single edit is what deactivates it: the hooks treat only boards whose `owner.active` is `true` as live, so there is no separate marker file to remove.
2. Give the user a one-paragraph closeout: what finished (with artifacts), what is still in flight, and what remains blocked on them.
