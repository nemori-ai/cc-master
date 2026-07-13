---
'ccm': minor
'@ccm/engine': minor
---

Separate review execution completion from dependency approval. Explicit review gates now keep downstream tasks blocked until the current attempt records an `APPROVE` verdict, invalidate prior verdicts at retry boundaries, and never reuse an omitted verdict from an earlier attempt.
