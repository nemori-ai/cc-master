---
'ccm': minor
'@ccm/engine': minor
---

Separate review execution completion from dependency approval. Explicit review gates now keep downstream tasks blocked until an `APPROVE` verdict, with CLI flags for declaring gates and recording verdicts.
