import type { UsageSignal } from '@ccm/engine';

export type Env = Record<string, string | undefined>;
export type HarnessId = string;
export type UsageSignalSource =
  | 'account'
  | 'codex-app-server'
  | 'cursor-dashboard'
  | 'unavailable'
  | string;

export interface Capability {
  supported: boolean;
  reason?: string;
}

export interface HarnessSession {
  id: string;
  source: 'env' | 'none' | string;
}

/**
 * Actionable, secret-free recovery hint for when a harness's usage signal is unavailable because a
 * short-lived credential must be manually refreshed *by the harness itself*. ccm is observe-only on
 * credentials — it NEVER refreshes / rotates / writes them. This structure only tells the user/agent
 * which harness-native command refreshes the credential and how to re-query afterward.
 *
 * Generic across harnesses: any short-lived-token harness can populate it (kimi-code is the first
 * instance). Persistent-credential harnesses (claude-code / codex / cursor) leave it unset.
 */
export interface UsageRefreshHint {
  /** Honest, secret-free reason the signal is unavailable (same text as unavailableReason). */
  reason: string;
  /** True when the user can self-recover without ccm touching any credential. */
  recoverable: boolean;
  /** Exact harness-native command to run to recover (e.g. `kimi -p 'hi'`), or null when nothing is user-actionable. */
  command: string | null;
  /** One-line instruction combining the command + why + recheck; null when not user-recoverable. */
  remedy: string | null;
  /** Command to re-query the signal after recovery (e.g. `ccm usage show --harness kimi-code`), or null. */
  recheck: string | null;
}

export interface CurrentUsageReading {
  signal: UsageSignal | null;
  source: UsageSignalSource;
  unavailableReason: string;
  /**
   * Present only when signal is null and the harness can describe a user-actionable manual recovery
   * (short-lived credential that the harness itself refreshes). ccm never mutates credentials.
   */
  refreshHint?: UsageRefreshHint | null;
  authority?: CurrentQuotaAuthorityRefs;
  authSource?: string;
  quotaScopeFingerprint?: string | null;
}

/** Owner-only authenticated scope refs; never expose these directly to an agent-facing payload. */
export interface CurrentQuotaAuthorityRefs {
  schema: 'ccm/machine-quota-collector-authority/v1';
  account_key: string;
  identity_fingerprint: string;
  payer_scope: string;
  pool_id: string;
  aggregation_key: string;
  policy: {
    revision: string;
    hard_ceiling_used_pct: number;
  };
  requirement: {
    revision: string;
    required_bucket_ids: string[];
    safety_margin: Record<string, number>;
  };
}

export interface PluginUpgradeRequest {
  env: Env;
  to: string;
  dryRun: boolean;
  json: boolean;
  verbose: boolean;
  out: (line: string) => void;
  err: (line: string) => void;
  jsonOk: (data: unknown) => string;
  resolveLatestPluginTag: () => Promise<string | null>;
}

export interface PluginUpgradeResult {
  component: 'plugin';
  harness: string;
  action: 'updated' | 'dry_run' | 'skipped' | 'failed';
  exitCode: number;
  reason?: string;
  latest?: string | null;
  source?: string;
  target?: string;
  count?: number;
  plugin_root?: string;
  marketplaceRoot?: string;
  pluginInstalled?: boolean;
}

export interface HarnessCliProbe {
  name: string;
  path: string | null;
  available: boolean;
}

export type HarnessSurfaceKind = 'ide-plugin' | 'cli-headless';
export type SurfaceFactState = 'unknown' | 'available' | 'unavailable';
export type SurfaceCapabilityState = 'supported' | 'unsupported' | 'forbidden' | 'unknown';

export interface SurfaceFact {
  state: SurfaceFactState;
  source: string;
}

export interface SurfaceCapability {
  state: SurfaceCapabilityState;
  reason?: string;
}

export type CursorAgentMode = 'ask' | 'plan' | 'agent';
export type CursorAgentSandboxRequest = 'required' | 'not-requested';
export type CursorAgentSandboxState = 'supported' | 'unavailable' | 'not-requested' | 'unknown';
export type CursorAgentResultSchemaState = 'valid' | 'invalid-empty' | 'invalid-shape' | 'unknown';
export type CursorAgentTaskAcceptanceState = 'accepted' | 'rejected' | 'unknown';

export interface CursorAgentAdmissionRequest {
  mode: CursorAgentMode;
  sandbox: CursorAgentSandboxRequest;
}

export interface CursorAgentTransportState {
  terminated: boolean;
  exit_code: number | null;
  signal: string | null;
}

export interface CursorAgentAdmissionEvidence {
  request: CursorAgentAdmissionRequest | null;
  binary: HarnessCliProbe;
  authentication: SurfaceFact;
  quota: SurfaceFact;
  sandbox: CursorAgentSandboxState;
  result_schema: CursorAgentResultSchemaState;
  task_acceptance: CursorAgentTaskAcceptanceState;
  transport: CursorAgentTransportState;
}

export interface CursorAgentAdmission extends CursorAgentAdmissionEvidence {
  schema: 'ccm/cursor-agent-admission/v1';
  schedulable: boolean;
  blockers: string[];
}

export interface HarnessSurfaceDescriptor {
  id: string;
  displayName: string;
  kind: HarnessSurfaceKind;
  installed: boolean;
  available: boolean;
  reason: string | null;
  binary: HarnessCliProbe;
  configPaths: string[];
  facts: {
    authentication: SurfaceFact;
    quota: SurfaceFact;
  };
  admission: CursorAgentAdmission | null;
  capabilities: {
    accountMutation: SurfaceCapability;
    accountAutoswitch: SurfaceCapability;
    pluginDistribution: SurfaceCapability;
  };
}

export interface HarnessInstallation {
  id: HarnessId;
  displayName: string;
  installed: boolean;
  active: boolean;
  reason: string | null;
  cli: HarnessCliProbe;
  configPaths: string[];
  surfaces: HarnessSurfaceDescriptor[];
  capabilities: {
    accountPool: Capability;
    externalStatusline: Capability;
    pluginDistribution: Capability;
  };
}

export type UsageSourceKind = 'statusline-sidecar' | 'app-server' | 'dashboard-api';
export type QuotaModel = 'rolling-5h-7d' | 'billing-period' | 'primary-secondary';

export interface HarnessUsageSource {
  kind: UsageSourceKind;
  pollable: boolean;
  quotaModel: QuotaModel;
}

export interface HarnessDescriptor extends HarnessInstallation {
  sessionStoreRoots: string[];
  usageSource: HarnessUsageSource;
  accountPoolLocation: string | null;
}

export interface PoolDescriptor {
  harness: HarnessId;
  location: string;
}

export type AccountSwitchPreflight = { action: 'continue' } | { action: 'noop'; reason: string };

export interface InspectInstallationOptions {
  // 是否对 headless worker surface（cursor-agent）真正探测认证态（spawn 只读 `status --format json`）。
  //   默认 false：inspectInstallation 保持轻量、绝不 spawn 子进程（routing / upgrade 等热路径不受影响）。
  //   仅面向用户的 harness 清单展示路径（harness list / current / machine-wide sweep）按需 opt-in，
  //   让清单如实反映登录态而非硬编码 unknown。非 cursor adapter 忽略本选项。
  probeHeadlessAuth?: boolean;
}

export interface HarnessAdapter {
  id: HarnessId;
  displayName: string;
  aliases: readonly string[];
  detect(env: Env): boolean;
  inspectInstallation(env: Env, opts?: InspectInstallationOptions): HarnessInstallation;
  session(env: Env): HarnessSession;
  sessionStoreRoots(env: Env): string[];
  usageSource(env: Env): HarnessUsageSource;
  accountPoolLocation(env: Env): string | null;
  readCurrentUsage(env: Env): CurrentUsageReading;
  readCurrentUsageForSurface?(surfaceId: string, env: Env): CurrentUsageReading;
  accountSwitchPreflight(env: Env): AccountSwitchPreflight;
  upgradePlugin(request: PluginUpgradeRequest): Promise<PluginUpgradeResult>;
  accountPool: Capability;
  externalStatusline: Capability;
  pluginDistribution: Capability;
}

export interface HarnessSelection {
  env?: Env;
  harnessFlag?: string;
}
