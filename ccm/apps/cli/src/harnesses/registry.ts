import { claudeCodeAdapter } from './claude-code.js';
import { codexAdapter } from './codex.js';
import { genericAdapter } from './generic.js';
import type { Env, HarnessAdapter, HarnessInstallation, HarnessSelection } from './types.js';

const KNOWN_ADAPTERS: readonly HarnessAdapter[] = [codexAdapter, claudeCodeAdapter];

export function resolveHarnessAdapter(selection: HarnessSelection = {}): HarnessAdapter {
  const env = selection.env || process.env;
  const explicit = normalizeHarnessId(
    selection.harnessFlag ||
      env.CC_MASTER_HARNESS ||
      env.CC_MASTER_HOST ||
      env.CCM_HOST ||
      env.CC_MASTER_HARNESS_HOST ||
      '',
  );
  if (explicit) return adapterForExplicitHarness(explicit);

  for (const adapter of KNOWN_ADAPTERS) {
    if (adapter.detect(env)) return adapter;
  }
  // Transitional compatibility: historical no-env local CLI behaved Claude Code-compatible.
  return claudeCodeAdapter;
}

export function resolveHarnessId(selection: HarnessSelection = {}): string {
  return resolveHarnessAdapter(selection).id;
}

export function knownHarnessAdapters(): readonly HarnessAdapter[] {
  return KNOWN_ADAPTERS;
}

export function inspectKnownHarnesses(env: Env = process.env): HarnessInstallation[] {
  return KNOWN_ADAPTERS.map((adapter) => adapter.inspectInstallation(env));
}

export function installedKnownHarnesses(env: Env = process.env): HarnessInstallation[] {
  return inspectKnownHarnesses(env).filter((h) => h.installed);
}

export function harnessSessionId(selection: HarnessSelection = {}): string {
  const env = selection.env || process.env;
  return resolveHarnessAdapter(selection).session(env).id;
}

function adapterForExplicitHarness(id: string): HarnessAdapter {
  for (const adapter of KNOWN_ADAPTERS) {
    if (adapter.id === id || adapter.aliases.includes(id)) return adapter;
  }
  return genericAdapter(id);
}

function normalizeHarnessId(raw: string): string | null {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  return s || null;
}

export type { Env, HarnessAdapter, HarnessInstallation, HarnessSelection } from './types.js';
