---
'ccm': minor
---

Add a mode-scoped Cursor Agent headless admission contract that independently gates binary, authentication, quota, sandbox, result schema, and explicit task acceptance. Inventory remains provider-silent and fail-closed, while fixture-only process effects reject RC0 empty/invalid results and keep sandbox failures separate from authentication.
