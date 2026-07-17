import { claudeCodeAdapter } from './claude-code.js';
import { codexAdapter } from './codex.js';
import { cursorAdapter } from './cursor.js';
import { genericAdapter } from './generic.js';
import { kimiCodeAdapter } from './kimi-code.js';
import type {
  Env,
  HarnessAdapter,
  HarnessDescriptor,
  HarnessId,
  HarnessInstallation,
  HarnessSelection,
  InspectInstallationOptions,
  PoolDescriptor,
} from './types.js';

// Cursor after Codex, before Claude Code: CURSOR_AGENT must win over Claude-compatible fallback env.
// kimi-code after Cursor, before the Claude-compatible fallback: KIMI_CODE_HOME must win over it too.
const KNOWN_ADAPTERS: readonly HarnessAdapter[] = [
  codexAdapter,
  cursorAdapter,
  kimiCodeAdapter,
  claudeCodeAdapter,
];

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

export function detectTrustedHarnessAdapter(env: Env = process.env): HarnessAdapter | null {
  for (const adapter of KNOWN_ADAPTERS) {
    if (adapter.detect(env)) return adapter;
  }
  return null;
}

export function detectTrustedHarnessId(env: Env = process.env): string | null {
  return detectTrustedHarnessAdapter(env)?.id || null;
}

export function knownHarnessAdapters(): readonly HarnessAdapter[] {
  return KNOWN_ADAPTERS;
}

export function inspectKnownHarnesses(
  env: Env = process.env,
  opts?: InspectInstallationOptions,
): HarnessInstallation[] {
  return KNOWN_ADAPTERS.map((adapter) => adapter.inspectInstallation(env, opts));
}

export function installedKnownHarnesses(env: Env = process.env): HarnessInstallation[] {
  return inspectKnownHarnesses(env).filter((h) => h.installed);
}

export class MachineHarnessRegistry {
  private readonly descriptors: readonly HarnessDescriptor[];

  private constructor(descriptors: readonly HarnessDescriptor[]) {
    this.descriptors = deepFreezeArray(
      descriptors.map((descriptor) => deepFreezeDescriptor(descriptor)),
    );
  }

  static sweep(env: Env = process.env, opts?: InspectInstallationOptions): MachineHarnessRegistry {
    const descriptors = KNOWN_ADAPTERS.map((adapter) => {
      const installation = adapter.inspectInstallation(env, opts);
      return {
        ...installation,
        sessionStoreRoots: freezeStrings(adapter.sessionStoreRoots(env)),
        usageSource: Object.freeze({ ...adapter.usageSource(env) }),
        accountPoolLocation: adapter.accountPoolLocation(env),
      };
    });
    return new MachineHarnessRegistry(descriptors);
  }

  installed(): HarnessDescriptor[] {
    return this.descriptors.filter((harness) => harness.installed).map((harness) => harness);
  }

  poolOf(harness: HarnessId | HarnessDescriptor): PoolDescriptor | null {
    const id = typeof harness === 'string' ? harness : harness.id;
    const descriptor = this.byId(id);
    if (!descriptor?.accountPoolLocation) return null;
    return Object.freeze({ harness: descriptor.id, location: descriptor.accountPoolLocation });
  }

  byId(id: HarnessId): HarnessDescriptor | null {
    return this.descriptors.find((harness) => harness.id === id) || null;
  }

  toJSON(): {
    schema: 'ccm/machine-harness-registry/v1';
    installed: string[];
    installedSurfaces: string[];
    harnesses: readonly HarnessDescriptor[];
    pools: readonly PoolDescriptor[];
  } {
    const pools = this.descriptors
      .map((harness) => this.poolOf(harness))
      .filter((pool): pool is PoolDescriptor => pool !== null);
    return Object.freeze({
      schema: 'ccm/machine-harness-registry/v1',
      installed: deepFreezeArray(this.installed().map((harness) => harness.id)),
      installedSurfaces: deepFreezeArray(installedSurfaceIds(this.descriptors)),
      harnesses: this.descriptors,
      pools: deepFreezeArray(pools),
    });
  }
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

function freezeStrings(values: readonly string[]): string[] {
  return deepFreezeArray([...new Set(values.filter(Boolean))]);
}

function deepFreezeDescriptor(descriptor: HarnessDescriptor): HarnessDescriptor {
  Object.freeze(descriptor.cli);
  Object.freeze(descriptor.configPaths);
  Object.freeze(descriptor.capabilities.accountPool);
  Object.freeze(descriptor.capabilities.externalStatusline);
  Object.freeze(descriptor.capabilities.pluginDistribution);
  Object.freeze(descriptor.capabilities);
  for (const surface of descriptor.surfaces) {
    Object.freeze(surface.binary);
    Object.freeze(surface.configPaths);
    Object.freeze(surface.facts.authentication);
    Object.freeze(surface.facts.quota);
    Object.freeze(surface.facts);
    if (surface.admission) {
      Object.freeze(surface.admission.request);
      Object.freeze(surface.admission.binary);
      Object.freeze(surface.admission.authentication);
      Object.freeze(surface.admission.quota);
      Object.freeze(surface.admission.transport);
      Object.freeze(surface.admission.blockers);
      Object.freeze(surface.admission);
    }
    Object.freeze(surface.capabilities.accountMutation);
    Object.freeze(surface.capabilities.accountAutoswitch);
    Object.freeze(surface.capabilities.pluginDistribution);
    Object.freeze(surface.capabilities);
    Object.freeze(surface);
  }
  Object.freeze(descriptor.surfaces);
  Object.freeze(descriptor.sessionStoreRoots);
  Object.freeze(descriptor.usageSource);
  return Object.freeze(descriptor);
}

export function installedSurfaceIds(harnesses: readonly HarnessInstallation[]): string[] {
  return harnesses.flatMap((harness) =>
    harness.surfaces.filter((surface) => surface.installed).map((surface) => surface.id),
  );
}

function deepFreezeArray<T>(values: T[]): T[] {
  return Object.freeze(values) as T[];
}

export type {
  Env,
  HarnessAdapter,
  HarnessDescriptor,
  HarnessInstallation,
  HarnessSelection,
  PoolDescriptor,
} from './types.js';
