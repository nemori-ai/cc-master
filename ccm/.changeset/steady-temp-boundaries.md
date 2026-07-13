---
"ccm": patch
"@ccm/engine": patch
---

Prevent statusline auto-install's development guard from trusting repository markers placed at the shared system temporary-directory root. Real repositories below that boundary and worktree invocations remain suppressed, while isolated install paths no longer inherit transient `.git` markers from concurrent workers.
