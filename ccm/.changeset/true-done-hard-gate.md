---
"@ccm/engine": patch
"ccm": patch
---

Enforce true-done board integrity: `status=done` now requires `verified=true` and a non-empty `artifact`, and `ccm task done` writes without both evidence fields are rejected by validation.
