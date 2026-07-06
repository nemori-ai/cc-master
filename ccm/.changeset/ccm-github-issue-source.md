---
"ccm": patch
"@ccm/engine": patch
---

fix: expose board source for GitHub issue bootstrap

`ccm board init` now accepts `--github-issue <url>` and stores it as a board-level source (`board.source.kind=github_issue`, `board.source.url`) so issue-based bootstrap is treated as a requirement source rather than synthetic task seed.
