---
'@ccm/engine': minor
'ccm': minor
---

Add an atomic `task retry` lifecycle operation that archives prior attempt evidence, resets current attempt timestamps, artifact, and typed verification state, and applies the same safety contract to legal retry transitions through `task set-status`.
