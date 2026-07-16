#!/usr/bin/env node
/**
 * kimi-code Track B reinject — PostCompact observe core.
 *
 * Probe (K4, see _hosts/kimi-code/probes/README.md): kimi fires PostCompact via
 * fireAndForgetTrigger — the hook's output (`message`) is DISCARDED, so a PostCompact hook cannot
 * inject the role substrate into post-compaction context. SessionStart hook output is likewise
 * discarded (triggerSessionStart drops results; probe-confirmed live). The role substrate re-primes
 * natively via the plugin manifest `sessionStart.skill` field: PluginSessionStartInjector is a
 * DynamicInjector whose onContextCompacted() resets injectedAt, and injectAfterCompaction() re-runs
 * inject() — so the sessionStart.skill content is re-rendered after every compaction (stronger than
 * Cursor, which cannot re-fire after compact). What is lost vs a native dynamic reinject: the live
 * board list / empty-board hard-stop / stale nodes (those need a hook message; no channel exists).
 *
 * This core is an intentional silent no-op: exit 0, empty stdout, launcher emits nothing. Registered
 * so the PostCompact event is wired and future observe/logging can land without changing the manifest.
 * Do not emit `message` here — it would be discarded anyway.
 */
process.exit(0);
