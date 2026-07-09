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

export interface CurrentUsageReading {
  signal: UsageSignal | null;
  source: UsageSignalSource;
  unavailableReason: string;
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

export interface HarnessInstallation {
  id: HarnessId;
  displayName: string;
  installed: boolean;
  active: boolean;
  reason: string | null;
  cli: HarnessCliProbe;
  configPaths: string[];
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

export interface HarnessAdapter {
  id: HarnessId;
  displayName: string;
  aliases: readonly string[];
  detect(env: Env): boolean;
  inspectInstallation(env: Env): HarnessInstallation;
  session(env: Env): HarnessSession;
  sessionStoreRoots(env: Env): string[];
  usageSource(env: Env): HarnessUsageSource;
  accountPoolLocation(env: Env): string | null;
  readCurrentUsage(env: Env): CurrentUsageReading;
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
