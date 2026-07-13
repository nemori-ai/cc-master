---
'ccm': patch
'@ccm/web-viewer': patch
---

Fix the graph view's "reset layout" button not clearing manually dragged node positions: the node/edge builder's memo was missing `resetKey` from its dependency list, so it kept returning the stale (dragged) positions even after the underlying dagre layout was recomputed. Reset now snaps every node back to its dagre position and refits, while manual drag persistence across polls and zero-repositioning on status-only updates are unaffected.
