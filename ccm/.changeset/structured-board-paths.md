---
'ccm': patch
---

Add a versioned `board-init/structured-board-path-v1` JSON capability: real `board init --json`
returns the schema-owned `data.board_path`; `board init --capabilities --json` negotiates it without
resolving a path or writing, and dry-run advertises compatibility without claiming an artifact.
