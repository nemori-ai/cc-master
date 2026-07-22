import type { StatuslineActionResult } from '@ccm/engine';
import type { ProviderRuntime } from '../provider-runtime.js';
import type { WorkerDescriptor } from '../worker-descriptors.js';
import type {
  AccountSwitchPreflight,
  CurrentQuotaAuthorityRefs,
  CurrentUsageReading,
  Env,
  HarnessInstallation,
  HarnessSession,
  HarnessSurfaceKind,
  HarnessUsageSource,
  InspectInstallationOptions,
  PluginUpgradeRequest,
  PluginUpgradeResult,
  UsageRefreshHint,
} from './types.js';

declare const harnessIdBrand: unique symbol;
declare const surfaceIdBrand: unique symbol;
declare const quotaTargetIdBrand: unique symbol;

export type HarnessId = string & { readonly [harnessIdBrand]: true };
export type SurfaceId = string & { readonly [surfaceIdBrand]: true };
export type QuotaTargetId = string & { readonly [quotaTargetIdBrand]: true };

export const CAPABILITY_KEYS = [
  'installation-discovery',
  'session-observation',
  'usage-observation',
  'machine-quota',
  'account-management',
  'statusline-projection',
  'plugin-projection',
  'worker-execution',
] as const;

export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

export const SUPPORT_STATES = ['supported', 'unsupported'] as const;
export type SupportState = (typeof SUPPORT_STATES)[number];

export const RUNTIME_OUTCOMES = ['ok', 'runtime-unavailable', 'unknown', 'failed'] as const;
export type RuntimeOutcome = (typeof RUNTIME_OUTCOMES)[number];

export type UnsupportedReason =
  | 'not-provided-by-harness'
  | 'not-supported-by-ccm'
  | 'host-surface-mismatch';

export type CapabilityBinding<T> =
  | { readonly support: 'supported'; readonly implementation: T }
  | {
      readonly support: 'unsupported';
      readonly reason: UnsupportedReason;
      readonly detail?: string;
    };

export interface SurfaceDescriptor {
  readonly id: SurfaceId;
  readonly displayName: string;
  readonly kind: HarnessSurfaceKind;
  readonly aliases?: readonly string[];
}

export interface InstallationDiscoveryFace {
  detect(env: Env): boolean;
  discoverInstallation(env: Env, opts?: InspectInstallationOptions): HarnessInstallation;
  discoverSurfaceInventory?(env: Env): unknown;
}

export interface SessionObservationFace {
  observeSession(env: Env): HarnessSession;
  sessionStoreRoots(env: Env): readonly string[];
}

export interface UsageObservationRequest {
  readonly env: Env;
  readonly surfaceId?: SurfaceId;
}

export interface UsageObservationFace {
  source(env: Env): HarnessUsageSource;
  observeUsage(request: UsageObservationRequest): CurrentUsageReading;
}

export type MachineQuotaWindowName =
  | 'five_hour'
  | 'seven_day'
  | 'billing_period'
  | 'billing_period_usage_based';

export interface MachineQuotaTargetDraft {
  readonly id: QuotaTargetId;
  readonly surfaceId: SurfaceId;
  readonly order: number;
  readonly providerId: string;
  readonly bucketId: string;
  readonly windowName: MachineQuotaWindowName;
  readonly poolKind?: 'first_party' | 'usage_based';
  readonly poolIds?: readonly string[];
  readonly durationSec: number;
  readonly collectorId: string;
  readonly sourceSchema: string;
  readonly authSource: string;
}

export interface MachineQuotaTarget extends MachineQuotaTargetDraft {
  readonly harnessId: HarnessId;
}

export interface MachineQuotaObservation {
  readonly status: 'refreshed' | 'unknown' | 'unsupported' | 'error';
  readonly signal?: import('@ccm/engine').UsageSignal | null;
  readonly source?: string;
  readonly reason?: string;
  readonly authority?: CurrentQuotaAuthorityRefs;
  readonly authSource?: string;
  readonly quotaScopeFingerprint?: string | null;
  readonly refreshHint?: UsageRefreshHint | null;
}

export interface MachineQuotaFaceDraft {
  readonly targets: readonly MachineQuotaTargetDraft[];
  observeTarget(target: MachineQuotaTarget, env: Env): Promise<MachineQuotaObservation>;
}

export interface MachineQuotaFace {
  readonly targets: readonly MachineQuotaTarget[];
  observeTarget(target: MachineQuotaTarget, env: Env): Promise<MachineQuotaObservation>;
}

export interface AccountManagementFace {
  poolLocation(env: Env): string | null;
  switchPreflight(env: Env): AccountSwitchPreflight;
}

export interface StatuslineProjectionFace {
  install(env: Env, command: string): StatuslineActionResult;
  uninstall(env: Env): StatuslineActionResult;
  autoInstall(env: Env, command?: string, binPath?: string): void;
}

export interface PluginProjectionFace {
  upgrade(request: PluginUpgradeRequest): Promise<PluginUpgradeResult>;
}

export const WORKER_EXECUTION_MODES = ['headless-cli', 'native-subagent'] as const;
export type WorkerExecutionMode = (typeof WORKER_EXECUTION_MODES)[number];

export type WorkerProcessState = 'exited' | 'timed_out' | 'cancelled' | 'failed' | 'rejected';

export interface WorkerProcessRequest {
  descriptor: WorkerDescriptor;
  providerArgv: string[];
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
  stdinFd: number | 'ignore';
  env: Record<string, string | undefined>;
  runtime: ProviderRuntime;
  signal?: AbortSignal;
}

export interface WorkerProcessResult {
  schema: 'ccm/worker-process-result/v1';
  harness: string;
  executable: string | null;
  argv: string[];
  cwd: string;
  state: WorkerProcessState;
  exit_code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  stdout_bytes: number;
  stderr_bytes: number;
  truncated: { stdout: boolean; stderr: boolean };
  timed_out: boolean;
  cancelled: boolean;
  reaped: boolean;
  duration_ms: number | null;
  cleanup: { temporary_resources_removed: true };
  error: { code: string; message: string } | null;
}

export interface WorkerExecutionStarted {
  readonly pid: number;
}

export interface WorkerExecutionObserver {
  onStarted?(started: WorkerExecutionStarted): void;
  onStdoutText?(text: string): void;
  onStderrText?(text: string): void;
}

export interface WorkerExecutionFace {
  readonly executionModes: readonly WorkerExecutionMode[];
  execute(
    request: WorkerProcessRequest,
    observer?: WorkerExecutionObserver,
  ): Promise<WorkerProcessResult>;
}

export interface CapabilityFaces {
  readonly 'installation-discovery': InstallationDiscoveryFace;
  readonly 'session-observation': SessionObservationFace;
  readonly 'usage-observation': UsageObservationFace;
  readonly 'machine-quota': MachineQuotaFace;
  readonly 'account-management': AccountManagementFace;
  readonly 'statusline-projection': StatuslineProjectionFace;
  readonly 'plugin-projection': PluginProjectionFace;
  readonly 'worker-execution': WorkerExecutionFace;
}

export interface CapabilityFaceDrafts extends Omit<CapabilityFaces, 'machine-quota'> {
  readonly 'machine-quota': MachineQuotaFaceDraft;
}

export type CapabilityPortfolio = {
  readonly [K in CapabilityKey]: CapabilityBinding<CapabilityFaces[K]>;
};

export type CapabilityPortfolioDraft = {
  readonly [K in CapabilityKey]: CapabilityBinding<CapabilityFaceDrafts[K]>;
};

export interface HarnessModule {
  readonly id: HarnessId;
  readonly displayName: string;
  readonly aliases: readonly string[];
  readonly surfaces: readonly SurfaceDescriptor[];
  readonly capabilities: CapabilityPortfolio;
}

export interface HarnessModuleDraft {
  readonly id: HarnessId;
  readonly displayName: string;
  readonly aliases: readonly string[];
  readonly surfaces: readonly SurfaceDescriptor[];
  readonly capabilities: CapabilityPortfolioDraft;
}

export interface MachineQuotaObserver {
  readonly target: MachineQuotaTarget;
  observe(env: Env): Promise<MachineQuotaObservation>;
}

export interface MachineQuotaDirectory {
  listTargets(): readonly MachineQuotaTarget[];
  findTarget(id: QuotaTargetId): MachineQuotaTarget | undefined;
  observerFor(id: QuotaTargetId): MachineQuotaObserver | undefined;
  supportFor(id: HarnessId): CapabilityBinding<MachineQuotaFace> | undefined;
}

export interface UsageObservationDirectory {
  listSurfaces(): readonly SurfaceDescriptor[];
  observerFor(surface: SurfaceId): UsageObservationFace | undefined;
  forHarness(id: HarnessId): HarnessCapabilityBinding<UsageObservationFace> | undefined;
  supportForHarness(id: HarnessId): CapabilityBinding<UsageObservationFace> | undefined;
}

export interface WorkerExecutionBinding {
  readonly harnessId: HarnessId;
  readonly face: WorkerExecutionFace;
}

export interface WorkerExecutionDirectory {
  candidatesFor(mode: WorkerExecutionMode): readonly WorkerExecutionBinding[];
  forHarness(harnessOrAlias: string, mode: WorkerExecutionMode): WorkerExecutionBinding | undefined;
}

export interface HarnessCapabilityBinding<T> {
  readonly harnessId: HarnessId;
  readonly displayName: string;
  readonly aliases: readonly string[];
  readonly surfaces: readonly SurfaceDescriptor[];
  readonly face: T;
}

export interface HarnessFaceDirectory<T> {
  list(): readonly HarnessCapabilityBinding<T>[];
  forHarness(id: HarnessId): HarnessCapabilityBinding<T> | undefined;
  supportFor(id: HarnessId): CapabilityBinding<T> | undefined;
}

export function harnessId(value: string): HarnessId {
  return identity(value, 'harness') as HarnessId;
}

export function surfaceId(value: string): SurfaceId {
  return identity(value, 'surface') as SurfaceId;
}

export function quotaTargetId(value: string): QuotaTargetId {
  return identity(value, 'quota target') as QuotaTargetId;
}

export function supported<T>(implementation: T): CapabilityBinding<T> {
  return { support: 'supported', implementation };
}

export function unsupported<T = never>(
  reason: UnsupportedReason,
  detail?: string,
): CapabilityBinding<T> {
  return { support: 'unsupported', reason, ...(detail ? { detail } : {}) };
}

export function defineHarnessModule(draft: HarnessModuleDraft): HarnessModule {
  validatePortfolio(draft.capabilities);
  validateModuleCapabilityInvariants(draft.id, draft.capabilities);
  const ownedSurfaces = new Set<string>();
  const surfaces = draft.surfaces.map((surface) => {
    if (ownedSurfaces.has(surface.id)) {
      throw new Error(`duplicate surface id within harness ${draft.id}: ${surface.id}`);
    }
    ownedSurfaces.add(surface.id);
    return {
      ...surface,
      aliases: surface.aliases ? [...surface.aliases] : undefined,
    };
  });
  const capabilities = clonePortfolio(draft.id, draft.capabilities, ownedSurfaces);
  return deepFreeze({
    id: draft.id,
    displayName: draft.displayName,
    aliases: [...draft.aliases],
    surfaces,
    capabilities,
  });
}

export class HarnessCatalog {
  readonly installation: HarnessFaceDirectory<InstallationDiscoveryFace>;
  readonly session: HarnessFaceDirectory<SessionObservationFace>;
  readonly usage: UsageObservationDirectory;
  readonly machineQuota: MachineQuotaDirectory;
  readonly account: HarnessFaceDirectory<AccountManagementFace>;
  readonly statusline: HarnessFaceDirectory<StatuslineProjectionFace>;
  readonly plugin: HarnessFaceDirectory<PluginProjectionFace>;
  readonly worker: WorkerExecutionDirectory;

  private constructor(modules: readonly HarnessModule[]) {
    this.installation = createHarnessFaceDirectory(modules, 'installation-discovery');
    this.session = createHarnessFaceDirectory(modules, 'session-observation');
    this.account = createHarnessFaceDirectory(modules, 'account-management');
    this.statusline = createHarnessFaceDirectory(modules, 'statusline-projection');
    this.plugin = createHarnessFaceDirectory(modules, 'plugin-projection');
    this.usage = createUsageDirectory(modules);
    this.machineQuota = createMachineQuotaDirectory(modules);
    this.worker = createWorkerDirectory(modules);
    deepFreeze(this);
  }

  static create(modules: readonly HarnessModule[]): HarnessCatalog {
    validateCatalog(modules);
    return new HarnessCatalog([...modules]);
  }
}

function identity(value: string, kind: string): string {
  const normalized = String(value).trim();
  if (!normalized) throw new Error(`${kind} id must not be empty`);
  return normalized;
}

function validatePortfolio(portfolio: CapabilityPortfolioDraft): void {
  const record = portfolio as unknown as Record<string, unknown>;
  for (const key of CAPABILITY_KEYS) {
    if (!Object.hasOwn(record, key)) throw new Error(`missing capability declaration: ${key}`);
    const binding = record[key] as Record<string, unknown>;
    if (binding?.support === 'supported' && !Object.hasOwn(binding, 'implementation')) {
      throw new Error(`supported capability ${key} requires implementation`);
    }
    if (binding?.support === 'unsupported' && Object.hasOwn(binding, 'implementation')) {
      throw new Error(`unsupported capability ${key} must not carry implementation`);
    }
    if (binding?.support !== 'supported' && binding?.support !== 'unsupported') {
      throw new Error(`capability ${key} must declare supported or unsupported`);
    }
  }
  for (const key of Object.keys(record)) {
    if (!(CAPABILITY_KEYS as readonly string[]).includes(key)) {
      throw new Error(`unknown capability declaration: ${key}`);
    }
  }
}

function clonePortfolio(
  owner: HarnessId,
  portfolio: CapabilityPortfolioDraft,
  ownedSurfaces: ReadonlySet<string>,
): CapabilityPortfolio {
  const cloned = {} as Record<CapabilityKey, CapabilityBinding<CapabilityFaces[CapabilityKey]>>;
  for (const key of CAPABILITY_KEYS) {
    const binding = portfolio[key];
    if (binding.support === 'unsupported') {
      cloned[key] = { ...binding };
      continue;
    }
    if (key === 'machine-quota') {
      const face = binding.implementation as MachineQuotaFaceDraft;
      const targets = face.targets.map((target) => {
        if (!ownedSurfaces.has(target.surfaceId)) {
          throw new Error(
            `quota target ${target.id} references foreign surface ${target.surfaceId} from harness ${owner}`,
          );
        }
        return {
          ...target,
          poolIds: target.poolIds ? [...target.poolIds] : undefined,
          harnessId: owner,
        };
      });
      cloned[key] = {
        support: 'supported',
        implementation: { targets, observeTarget: face.observeTarget.bind(face) },
      };
      continue;
    }
    cloned[key] = {
      support: 'supported',
      implementation: binding.implementation as CapabilityFaces[CapabilityKey],
    };
  }
  return cloned as CapabilityPortfolio;
}

function validateCatalog(modules: readonly HarnessModule[]): void {
  const harnesses = new Set<string>();
  const surfaces = new Set<string>();
  const targets = new Set<string>();
  for (const module of modules) {
    validateModuleCapabilityInvariants(module.id, module.capabilities);
    if (harnesses.has(module.id)) throw new Error(`duplicate harness id: ${module.id}`);
    harnesses.add(module.id);
    for (const surface of module.surfaces) {
      if (surfaces.has(surface.id)) throw new Error(`duplicate surface id: ${surface.id}`);
      surfaces.add(surface.id);
    }
    const quota = module.capabilities['machine-quota'];
    if (quota.support === 'supported') {
      for (const target of quota.implementation.targets as readonly MachineQuotaTarget[]) {
        if (targets.has(target.id)) throw new Error(`duplicate quota target id: ${target.id}`);
        targets.add(target.id);
      }
    }
  }
}

function validateModuleCapabilityInvariants(
  owner: HarnessId,
  portfolio: CapabilityPortfolioDraft | CapabilityPortfolio,
): void {
  const worker = portfolio['worker-execution'];
  if (worker.support === 'supported') {
    const modes = worker.implementation.executionModes;
    if (modes.length === 0) {
      throw new Error(`harness ${owner} supported worker-execution requires an execution mode`);
    }
    const seen = new Set<WorkerExecutionMode>();
    for (const mode of modes) {
      if (!(WORKER_EXECUTION_MODES as readonly string[]).includes(mode)) {
        throw new Error(`harness ${owner} declares unknown worker execution mode: ${mode}`);
      }
      if (seen.has(mode)) {
        throw new Error(`harness ${owner} declares duplicate worker execution mode: ${mode}`);
      }
      seen.add(mode);
    }
  }
  const quota = portfolio['machine-quota'];
  if (quota.support === 'unsupported') return;
  if (portfolio['usage-observation'].support === 'unsupported') {
    throw new Error(
      `harness ${owner} supported machine-quota requires supported usage-observation`,
    );
  }
  if (quota.implementation.targets.length === 0) {
    throw new Error(`harness ${owner} supported machine-quota requires a non-empty target catalog`);
  }
}

function createHarnessFaceDirectory<K extends CapabilityKey>(
  modules: readonly HarnessModule[],
  key: K,
): HarnessFaceDirectory<CapabilityFaces[K]> {
  const bindings = modules.flatMap((module) => {
    const capability = module.capabilities[key];
    if (capability.support === 'unsupported') return [];
    return [
      deepFreeze({
        harnessId: module.id,
        displayName: module.displayName,
        aliases: module.aliases,
        surfaces: module.surfaces,
        face: capability.implementation,
      }),
    ];
  });
  deepFreeze(bindings);
  const byHarness = new Map(bindings.map((binding) => [binding.harnessId, binding]));
  const supportByHarness = new Map(
    modules.map((module) => [
      module.id,
      module.capabilities[key] as CapabilityBinding<CapabilityFaces[K]>,
    ]),
  );
  return deepFreeze({
    list: () => bindings,
    forHarness: (id: HarnessId) => byHarness.get(id),
    supportFor: (id: HarnessId) => supportByHarness.get(id),
  });
}

function createUsageDirectory(modules: readonly HarnessModule[]): UsageObservationDirectory {
  const surfaces: SurfaceDescriptor[] = [];
  const observers = new Map<SurfaceId, UsageObservationFace>();
  const bindings: HarnessCapabilityBinding<UsageObservationFace>[] = [];
  const supportByHarness = new Map<HarnessId, CapabilityBinding<UsageObservationFace>>();
  for (const module of modules) {
    const capability = module.capabilities['usage-observation'];
    supportByHarness.set(module.id, capability);
    if (capability.support === 'unsupported') continue;
    bindings.push(
      deepFreeze({
        harnessId: module.id,
        displayName: module.displayName,
        aliases: module.aliases,
        surfaces: module.surfaces,
        face: capability.implementation,
      }),
    );
    for (const surface of module.surfaces) {
      surfaces.push(surface);
      observers.set(surface.id, capability.implementation);
    }
  }
  deepFreeze(surfaces);
  deepFreeze(bindings);
  const byHarness = new Map(bindings.map((binding) => [binding.harnessId, binding]));
  return deepFreeze({
    listSurfaces: () => surfaces,
    observerFor: (surface: SurfaceId) => observers.get(surface),
    forHarness: (id: HarnessId) => byHarness.get(id),
    supportForHarness: (id: HarnessId) => supportByHarness.get(id),
  });
}

function createMachineQuotaDirectory(modules: readonly HarnessModule[]): MachineQuotaDirectory {
  const entries: Array<{ target: MachineQuotaTarget; observer: MachineQuotaObserver }> = [];
  const supportByHarness = new Map(
    modules.map((module) => [module.id, module.capabilities['machine-quota']]),
  );
  for (const module of modules) {
    const capability = module.capabilities['machine-quota'];
    if (capability.support === 'unsupported') continue;
    for (const target of capability.implementation.targets as readonly MachineQuotaTarget[]) {
      entries.push({
        target,
        observer: {
          target,
          observe: (env: Env) => capability.implementation.observeTarget(target, env),
        },
      });
    }
  }
  entries.sort((left, right) => left.target.order - right.target.order);
  deepFreeze(entries);
  const byId = new Map(entries.map((entry) => [entry.target.id, entry]));
  const targets = deepFreeze(entries.map((entry) => entry.target));
  return deepFreeze({
    listTargets: () => targets,
    findTarget: (id: QuotaTargetId) => byId.get(id)?.target,
    observerFor: (id: QuotaTargetId) => byId.get(id)?.observer,
    supportFor: (id: HarnessId) => supportByHarness.get(id),
  });
}

function createWorkerDirectory(modules: readonly HarnessModule[]): WorkerExecutionDirectory {
  const byMode = new Map<WorkerExecutionMode, WorkerExecutionBinding[]>();
  const byAliasAndMode = new Map<string, WorkerExecutionBinding>();
  for (const module of modules) {
    const capability = module.capabilities['worker-execution'];
    if (capability.support === 'unsupported') continue;
    for (const mode of capability.implementation.executionModes) {
      const bindings = byMode.get(mode) ?? [];
      const binding = deepFreeze({ harnessId: module.id, face: capability.implementation });
      bindings.push(binding);
      byMode.set(mode, bindings);
      for (const alias of [module.id, ...module.aliases]) {
        const key = `${mode}\u0000${alias}`;
        const existing = byAliasAndMode.get(key);
        if (existing && existing.harnessId !== module.id) {
          throw new Error(
            `duplicate worker execution alias for ${mode}: ${alias} (${existing.harnessId}, ${module.id})`,
          );
        }
        byAliasAndMode.set(key, binding);
      }
    }
  }
  for (const bindings of byMode.values()) deepFreeze(bindings);
  const empty = deepFreeze<WorkerExecutionBinding[]>([]);
  return deepFreeze({
    candidatesFor: (mode: WorkerExecutionMode) => byMode.get(mode) ?? empty,
    forHarness: (harnessOrAlias: string, mode: WorkerExecutionMode) =>
      byAliasAndMode.get(`${mode}\u0000${harnessOrAlias}`),
  });
}

function deepFreeze<T>(value: T): T {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
  if (Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}
