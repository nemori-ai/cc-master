---
'@ccm/engine': patch
'ccm': patch
---

Require every armed watchdog to carry a non-blank real wakeup handle, diagnose legacy missing-handle or expired records without blocking unrelated writes, and make disarm delete canonical and legacy records completely.
