---
'@ccm/engine': patch
'ccm': patch
---

Add one crash-durable owner-only writer for persistent account, board, monitor, and web-viewer state, with explicit file/directory fsync outcomes and fail-closed hard errors.
