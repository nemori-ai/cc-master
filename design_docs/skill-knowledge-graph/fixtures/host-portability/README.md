# Host portability fixtures (C9 / K1-04)

Checked-in fixtures for the deterministic host portability probe. They are not live
host runtime transcripts.

Coverage:

- four product hosts: `claude-code`, `codex`, `cursor`, `kimi-code`
- payload modes: `canonical`, `partial`, `stub`
- explicit HTML anchors, relative Markdown links, and path-token fail-closed cases

Worker allowlist (`codex`, `cursor`) is recorded in the frozen adapter contract and is
intentionally separate from the four product-host projection surface.
