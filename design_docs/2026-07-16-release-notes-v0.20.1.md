# Release notes draft — cc-master v0.20.1

Status: release candidate; do not tag or publish from this document.

`v0.20.1` is a plugin-only installer hotfix paired with the unchanged `ccm-v0.21.0`. It does not change ccm, `@ccm/engine`, or `@ccm/web-viewer` package versions or product behavior.

## Fix

The `v0.20.0` transactional publisher compared a mode-aware digest before activation, but Node.js `fs.cpSync` does not promise to preserve directory permissions. The released Claude Code artifact legitimately contains three owner-only (`0700`) attested-skill directories. On a host with umask `0002`, Node.js 22/24 staged them as `0775`, so checksum validation rejected the publisher's own otherwise byte-identical copy and preserved the last-known-good plugin.

The publisher now reapplies source modes to real files and, in post-order, directories before computing the staged digest. It never chmods symlinks. Existing manifest validation, safe-relative-symlink checks, fsync barriers, atomic version pointers, rollback, and failure reporting remain unchanged.

## Verification

- Regression-first Node.js 22 test with a nested `0700` packaged plugin directory.
- Exact `v0.20.0` Claude Code release artifact reproduced the checksum failure before the fix and publishes with identical source/endpoint digests after it.
- Full installer integrity fault matrix, source-to-dist sync, all-host package/checksum/content validation, Claude plugin validation, and local release smoke are release gates.

## Upgrade

After `v0.20.1` is published, retry the normal pinned installer; do not copy plugin trees manually:

```bash
curl -fsSL https://raw.githubusercontent.com/nemori-ai/cc-master/v0.20.1/install.sh | \
  bash -s -- --ccm-version ccm-v0.21.0 --plugin-version v0.20.1 --all-harnesses
```

Reinstalling `ccm-v0.21.0` is idempotent. The installer will then transactionally publish the `v0.20.1` plugin for each locally installed supported harness.
