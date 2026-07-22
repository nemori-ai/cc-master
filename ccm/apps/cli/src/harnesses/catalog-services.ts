import {
  type HarnessCapabilityBinding,
  type HarnessCatalog,
  type HarnessId,
  harnessId,
  type InstallationDiscoveryFace,
} from './capability-model.js';
import { builtInHarnessCatalog } from './composition.js';
import type {
  Env,
  HarnessDescriptor,
  HarnessInstallation,
  HarnessSelection,
  InspectInstallationOptions,
  PoolDescriptor,
} from './types.js';

export interface SelectedHarness {
  readonly id: HarnessId;
  readonly displayName: string;
  readonly aliases: readonly string[];
  readonly known: boolean;
}

type Catalog = HarnessCatalog;

export function selectHarness(
  selection: HarnessSelection = {},
  catalog: Catalog = builtInHarnessCatalog,
): SelectedHarness {
  const env = selection.env ?? process.env;
  const explicit = normalizeHarnessId(
    selection.harnessFlag ||
      env.CC_MASTER_HARNESS ||
      env.CC_MASTER_HOST ||
      env.CCM_HOST ||
      env.CC_MASTER_HARNESS_HOST ||
      '',
  );
  if (explicit) return selectExplicit(explicit, catalog);
  for (const binding of catalog.installation.list()) {
    if (binding.face.detect(env)) return selectionFromBinding(binding);
  }
  const fallback = catalog.installation.forHarness(harnessId('claude-code'));
  if (!fallback) throw new Error('static composition is missing the claude-code fallback');
  return selectionFromBinding(fallback);
}

export function resolveHarnessId(
  selection: HarnessSelection = {},
  catalog: Catalog = builtInHarnessCatalog,
): string {
  return selectHarness(selection, catalog).id;
}

export function detectTrustedHarnessId(
  env: Env = process.env,
  catalog: Catalog = builtInHarnessCatalog,
): string | null {
  for (const binding of catalog.installation.list()) {
    if (binding.face.detect(env)) return binding.harnessId;
  }
  return null;
}

export function harnessSessionId(
  selection: HarnessSelection = {},
  catalog: Catalog = builtInHarnessCatalog,
): string {
  const env = selection.env ?? process.env;
  const selected = selectHarness(selection, catalog);
  return catalog.session.forHarness(selected.id)?.face.observeSession(env).id ?? '';
}

export function selectedInstallation(
  selection: HarnessSelection = {},
  opts?: InspectInstallationOptions,
  catalog: Catalog = builtInHarnessCatalog,
): HarnessInstallation {
  const env = selection.env ?? process.env;
  const selected = selectHarness(selection, catalog);
  const binding = catalog.installation.forHarness(selected.id);
  return binding
    ? binding.face.discoverInstallation(env, opts)
    : unsupportedInstallation(selected, env);
}

export function inspectKnownHarnesses(
  env: Env = process.env,
  opts?: InspectInstallationOptions,
  catalog: Catalog = builtInHarnessCatalog,
): HarnessInstallation[] {
  return catalog.installation.list().map((binding) => binding.face.discoverInstallation(env, opts));
}

export function installedKnownHarnesses(
  env: Env = process.env,
  catalog: Catalog = builtInHarnessCatalog,
): HarnessInstallation[] {
  return inspectKnownHarnesses(env, undefined, catalog).filter(
    (installation) => installation.installed,
  );
}

export class MachineHarnessInventory {
  private constructor(private readonly descriptors: readonly HarnessDescriptor[]) {
    deepFreeze(this.descriptors);
    Object.freeze(this);
  }

  static sweep(
    env: Env = process.env,
    opts?: InspectInstallationOptions,
    catalog: Catalog = builtInHarnessCatalog,
  ): MachineHarnessInventory {
    const descriptors = catalog.installation.list().map((binding) => {
      const installation = binding.face.discoverInstallation(env, opts);
      const session = catalog.session.forHarness(binding.harnessId);
      const usage = catalog.usage.forHarness(binding.harnessId);
      const account = catalog.account.forHarness(binding.harnessId);
      if (!session || !usage) {
        throw new Error(`static composition is incomplete for harness ${binding.harnessId}`);
      }
      return {
        ...installation,
        sessionStoreRoots: [...session.face.sessionStoreRoots(env)],
        usageSource: { ...usage.face.source(env) },
        accountPoolLocation: account?.face.poolLocation(env) ?? null,
      };
    });
    return new MachineHarnessInventory(descriptors);
  }

  installed(): HarnessDescriptor[] {
    return this.descriptors.filter((harness) => harness.installed);
  }

  poolOf(harness: string | HarnessDescriptor): PoolDescriptor | null {
    const id = typeof harness === 'string' ? harness : harness.id;
    const descriptor = this.byId(id);
    return descriptor?.accountPoolLocation
      ? Object.freeze({ harness: descriptor.id, location: descriptor.accountPoolLocation })
      : null;
  }

  byId(id: string): HarnessDescriptor | null {
    return this.descriptors.find((harness) => harness.id === id) ?? null;
  }

  toJSON(): {
    schema: 'ccm/machine-harness-registry/v1';
    installed: string[];
    installedSurfaces: string[];
    harnesses: readonly HarnessDescriptor[];
    pools: readonly PoolDescriptor[];
  } {
    const harnesses = this.descriptors.map((descriptor) =>
      presentHarnessInstallationV1(descriptor),
    ) as HarnessDescriptor[];
    const pools = this.descriptors
      .map((harness) => this.poolOf(harness))
      .filter((pool): pool is PoolDescriptor => pool !== null);
    return Object.freeze({
      schema: 'ccm/machine-harness-registry/v1',
      installed: deepFreeze(this.installed().map((harness) => harness.id)),
      installedSurfaces: deepFreeze(installedSurfaceIds(harnesses)),
      harnesses: deepFreeze(harnesses),
      pools: deepFreeze(pools),
    });
  }
}

export function installedSurfaceIds(harnesses: readonly HarnessInstallation[]): string[] {
  return harnesses.flatMap((harness) =>
    harness.surfaces.filter((surface) => surface.installed).map((surface) => surface.id),
  );
}

/** v1 CLI compatibility: the canonical `cursor-agent-cli` identity was historically rendered as `cursor-agent`. */
export function presentHarnessInstallationV1<T extends HarnessInstallation>(installation: T): T {
  return deepFreeze({
    ...installation,
    surfaces: installation.surfaces.map((surface) => ({
      ...surface,
      id: surface.id === 'cursor-agent-cli' ? 'cursor-agent' : surface.id,
    })),
  }) as T;
}

function selectExplicit(value: string, catalog: Catalog): SelectedHarness {
  for (const binding of catalog.installation.list()) {
    if (binding.harnessId === value || binding.aliases.includes(value)) {
      return selectionFromBinding(binding);
    }
  }
  const id = harnessId(value);
  return deepFreeze({ id, displayName: value, aliases: [value], known: false });
}

function selectionFromBinding(
  binding: HarnessCapabilityBinding<InstallationDiscoveryFace>,
): SelectedHarness {
  return deepFreeze({
    id: binding.harnessId,
    displayName: binding.displayName,
    aliases: [...binding.aliases],
    known: true,
  });
}

function normalizeHarnessId(raw: string): string | null {
  const value = String(raw).trim().toLowerCase().replace(/_/g, '-');
  return value || null;
}

function unsupportedInstallation(selected: SelectedHarness, env: Env): HarnessInstallation {
  const command = selected.id || 'unknown';
  return deepFreeze({
    id: selected.id,
    displayName: selected.displayName,
    installed: false,
    active: Boolean(env.CC_MASTER_HARNESS || env.CC_MASTER_HOST || env.CCM_HOST),
    reason: `unsupported harness: ${selected.id}`,
    cli: { name: command, path: null, available: false },
    configPaths: [],
    surfaces: [],
    capabilities: {
      accountPool: { supported: false, reason: 'No account-pool implementation is registered.' },
      externalStatusline: {
        supported: false,
        reason: 'No statusline implementation is registered.',
      },
      pluginDistribution: { supported: false, reason: 'No plugin implementation is registered.' },
    },
  });
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}
