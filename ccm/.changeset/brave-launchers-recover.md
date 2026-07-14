---
'ccm': patch
---

Make native runtime launcher materialization safe under concurrent cold invokes, directory-path replacement, and SIGKILL by keeping recoverable owner-only launcher and bootstrap lifecycle roots, binding publication and durability to one pinned directory object, publishing digest-pinned helpers with hard-link no-replace semantics, and reclaiming only strictly attributed abandoned objects.
