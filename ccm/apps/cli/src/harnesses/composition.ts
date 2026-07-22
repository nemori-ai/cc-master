import { autoInstallStatuslineOnce, installStatusline, uninstallStatusline } from '@ccm/engine';
import { createHeadlessWorkerExecutionFace } from '../worker-process.js';
import {
  type AccountManagementFace,
  type CapabilityBinding,
  type CapabilityPortfolioDraft,
  defineHarnessModule,
  HarnessCatalog,
  type HarnessModule,
  harnessId,
  type InstallationDiscoveryFace,
  type MachineQuotaFaceDraft,
  type MachineQuotaTargetDraft,
  type PluginProjectionFace,
  quotaTargetId,
  type SessionObservationFace,
  type StatuslineProjectionFace,
  type SurfaceDescriptor,
  supported,
  surfaceId,
  type UsageObservationFace,
  unsupported,
  type WorkerExecutionFace,
} from './capability-model.js';
import {
  claudeAccountManagement,
  claudeInstallationDiscovery,
  claudePluginProjection,
  claudeSessionObservation,
  claudeUsageObservation,
} from './claude-code.js';
import {
  CODEX_ACCOUNT_POOL_REASON,
  CODEX_STATUSLINE_REASON,
  codexInstallationDiscovery,
  codexPluginProjection,
  codexSessionObservation,
  codexUsageObservation,
} from './codex.js';
import {
  CURSOR_ACCOUNT_POOL_REASON,
  CURSOR_STATUSLINE_REASON,
  cursorInstallationDiscovery,
  cursorPluginProjection,
  cursorSessionObservation,
  cursorUsageObservation,
} from './cursor.js';
import {
  buildCursorSurfaceInventory,
  defaultCursorAgentQuotaReader,
  inspectCursorExecutionSurfaces,
} from './cursor-surfaces.js';
import {
  KIMI_ACCOUNT_POOL_REASON,
  KIMI_STATUSLINE_REASON,
  kimiInstallationDiscovery,
  kimiPluginProjection,
  kimiSessionObservation,
  kimiUsageObservation,
} from './kimi-code.js';

function quotaTarget(
  input: Omit<MachineQuotaTargetDraft, 'id' | 'surfaceId'> & {
    readonly harness: string;
    readonly surface: string;
  },
): MachineQuotaTargetDraft {
  const { harness, surface, ...target } = input;
  return {
    ...target,
    id: quotaTargetId(`machine-wide/${harness}/${surface}/${input.windowName}`),
    surfaceId: surfaceId(surface),
  };
}

const CODEX_TARGETS = [
  quotaTarget({
    harness: 'codex',
    surface: 'codex-cli',
    order: 0,
    providerId: 'codex',
    bucketId: 'seven-day-global',
    windowName: 'seven_day',
    durationSec: 604_800,
    collectorId: 'codex-app-server',
    sourceSchema: 'codex/account-rate-limits/v1',
    authSource: 'codex-cli-current-login',
  }),
] as const;

const CLAUDE_TARGETS = [
  quotaTarget({
    harness: 'claude-code',
    surface: 'claude-cli',
    order: 1,
    providerId: 'anthropic',
    bucketId: 'five-hour-global',
    windowName: 'five_hour',
    durationSec: 18_000,
    collectorId: 'claude-statusline-sidecar',
    sourceSchema: 'claude-code/rate-limits/v1',
    authSource: 'claude-cli-current-login',
  }),
  quotaTarget({
    harness: 'claude-code',
    surface: 'claude-cli',
    order: 2,
    providerId: 'anthropic',
    bucketId: 'seven-day-global',
    windowName: 'seven_day',
    durationSec: 604_800,
    collectorId: 'claude-statusline-sidecar',
    sourceSchema: 'claude-code/rate-limits/v1',
    authSource: 'claude-cli-current-login',
  }),
  quotaTarget({
    harness: 'claude-code',
    surface: 'claude-fable-5-cli',
    order: 3,
    providerId: 'anthropic',
    bucketId: 'seven-day-fable-global',
    windowName: 'seven_day',
    durationSec: 604_800,
    collectorId: 'claude-statusline-sidecar',
    sourceSchema: 'claude-code/rate-limits/v1',
    authSource: 'claude-cli-current-login',
  }),
] as const;

const CURSOR_TARGETS = [
  quotaTarget({
    harness: 'cursor',
    surface: 'cursor-ide-plugin',
    order: 4,
    providerId: 'cursor',
    bucketId: 'billing-period-global',
    windowName: 'billing_period',
    poolKind: 'first_party',
    poolIds: ['cursor-total', 'cursor-auto'],
    durationSec: 2_592_000,
    collectorId: 'cursor-dashboard',
    sourceSchema: 'cursor/GetCurrentPeriodUsage/v1',
    authSource: 'cursor-ide-current-login',
  }),
  quotaTarget({
    harness: 'cursor',
    surface: 'cursor-ide-plugin',
    order: 5,
    providerId: 'cursor',
    bucketId: 'billing-period-usage-based',
    windowName: 'billing_period_usage_based',
    poolKind: 'usage_based',
    poolIds: ['cursor-api', 'cursor-spend-limit'],
    durationSec: 2_592_000,
    collectorId: 'cursor-dashboard',
    sourceSchema: 'cursor/GetCurrentPeriodUsage/v1',
    authSource: 'cursor-ide-current-login',
  }),
  quotaTarget({
    harness: 'cursor',
    surface: 'cursor-agent-cli',
    order: 6,
    providerId: 'cursor',
    bucketId: 'billing-period-global',
    windowName: 'billing_period',
    poolKind: 'first_party',
    poolIds: ['cursor-total', 'cursor-auto'],
    durationSec: 2_592_000,
    collectorId: 'cursor-agent-dashboard',
    sourceSchema: 'cursor/GetCurrentPeriodUsage/v1',
    authSource: 'cursor-agent-current-login',
  }),
  quotaTarget({
    harness: 'cursor',
    surface: 'cursor-agent-cli',
    order: 7,
    providerId: 'cursor',
    bucketId: 'billing-period-usage-based',
    windowName: 'billing_period_usage_based',
    poolKind: 'usage_based',
    poolIds: ['cursor-api', 'cursor-spend-limit'],
    durationSec: 2_592_000,
    collectorId: 'cursor-agent-dashboard',
    sourceSchema: 'cursor/GetCurrentPeriodUsage/v1',
    authSource: 'cursor-agent-current-login',
  }),
] as const;

const KIMI_TARGETS = [
  quotaTarget({
    harness: 'kimi-code',
    surface: 'kimi-cli',
    order: 8,
    providerId: 'moonshot',
    bucketId: 'five-hour-global',
    windowName: 'five_hour',
    durationSec: 18_000,
    collectorId: 'kimi-usages-api',
    sourceSchema: 'kimi-code/usages/v1',
    authSource: 'kimi-code-current-login',
  }),
  quotaTarget({
    harness: 'kimi-code',
    surface: 'kimi-cli',
    order: 9,
    providerId: 'moonshot',
    bucketId: 'seven-day-global',
    windowName: 'seven_day',
    durationSec: 604_800,
    collectorId: 'kimi-usages-api',
    sourceSchema: 'kimi-code/usages/v1',
    authSource: 'kimi-code-current-login',
  }),
] as const;

function quotaFace(
  usage: UsageObservationFace,
  targets: readonly MachineQuotaTargetDraft[],
): MachineQuotaFaceDraft {
  const quota: MachineQuotaFaceDraft = {
    targets,
    async observeTarget(target, env) {
      const reading = usage.observeUsage({ env, surfaceId: target.surfaceId });
      return reading.signal
        ? {
            status: 'refreshed',
            signal: reading.signal,
            source: reading.source,
            authority: reading.authority,
            authSource: reading.authSource,
            quotaScopeFingerprint: reading.quotaScopeFingerprint,
          }
        : {
            status: 'unknown',
            signal: reading.signal,
            source: reading.source,
            reason: reading.unavailableReason,
            refreshHint: reading.refreshHint,
          };
    },
  };
  return quota;
}

const CLAUDE_STATUSLINE: StatuslineProjectionFace = {
  install: (env, command) => installStatusline(env, command),
  uninstall: (env) => uninstallStatusline(env),
  autoInstall: (env, command, binPath) => {
    if (command) autoInstallStatuslineOnce(env, command, binPath);
  },
};

const CURSOR_INSTALLATION: InstallationDiscoveryFace = {
  ...cursorInstallationDiscovery,
  discoverSurfaceInventory: (env) =>
    buildCursorSurfaceInventory(
      inspectCursorExecutionSurfaces(env, { readQuota: defaultCursorAgentQuotaReader }),
    ),
};

function module(input: {
  id: string;
  displayName: string;
  aliases: readonly string[];
  surfaces: readonly SurfaceDescriptor[];
  targets: readonly MachineQuotaTargetDraft[];
  installation: InstallationDiscoveryFace;
  session: SessionObservationFace;
  usage: UsageObservationFace;
  account: CapabilityBinding<AccountManagementFace>;
  statusline: CapabilityBinding<StatuslineProjectionFace>;
  plugin: CapabilityBinding<PluginProjectionFace>;
  worker: CapabilityBinding<WorkerExecutionFace>;
}): HarnessModule {
  const capabilities: CapabilityPortfolioDraft = {
    'installation-discovery': supported(input.installation),
    'session-observation': supported(input.session),
    'usage-observation': supported(input.usage),
    'machine-quota': supported(quotaFace(input.usage, input.targets)),
    'account-management': input.account,
    'statusline-projection': input.statusline,
    'plugin-projection': input.plugin,
    'worker-execution': input.worker,
  };
  return defineHarnessModule({
    id: harnessId(input.id),
    displayName: input.displayName,
    aliases: input.aliases,
    surfaces: input.surfaces,
    capabilities,
  });
}

export const BUILT_IN_HARNESS_MODULES = Object.freeze([
  module({
    id: 'codex',
    displayName: 'Codex',
    aliases: ['codex', 'openai-codex'],
    surfaces: [{ id: surfaceId('codex-cli'), displayName: 'Codex CLI', kind: 'cli-headless' }],
    targets: CODEX_TARGETS,
    installation: codexInstallationDiscovery,
    session: codexSessionObservation,
    usage: codexUsageObservation,
    account: unsupported('not-provided-by-harness', CODEX_ACCOUNT_POOL_REASON),
    statusline: unsupported('not-provided-by-harness', CODEX_STATUSLINE_REASON),
    plugin: supported(codexPluginProjection),
    worker: supported(createHeadlessWorkerExecutionFace('codex')),
  }),
  module({
    id: 'cursor',
    displayName: 'Cursor',
    aliases: ['cursor', 'cursor-ide', 'cursor-agent', 'cursor-agent-cli'],
    surfaces: [
      {
        id: surfaceId('cursor-ide-plugin'),
        displayName: 'Cursor IDE Agent plugin',
        kind: 'ide-plugin',
      },
      {
        id: surfaceId('cursor-agent-cli'),
        displayName: 'Cursor Agent headless CLI',
        kind: 'cli-headless',
        aliases: ['cursor-agent'],
      },
    ],
    targets: CURSOR_TARGETS,
    installation: CURSOR_INSTALLATION,
    session: cursorSessionObservation,
    usage: cursorUsageObservation,
    account: unsupported('not-provided-by-harness', CURSOR_ACCOUNT_POOL_REASON),
    statusline: unsupported('not-provided-by-harness', CURSOR_STATUSLINE_REASON),
    plugin: supported(cursorPluginProjection),
    worker: supported(createHeadlessWorkerExecutionFace('cursor-agent')),
  }),
  module({
    id: 'kimi-code',
    displayName: 'Kimi Code',
    aliases: ['kimi', 'kimi-code', 'kimicode', 'moonshot-kimi'],
    surfaces: [{ id: surfaceId('kimi-cli'), displayName: 'Kimi CLI', kind: 'cli-headless' }],
    targets: KIMI_TARGETS,
    installation: kimiInstallationDiscovery,
    session: kimiSessionObservation,
    usage: kimiUsageObservation,
    account: unsupported('not-provided-by-harness', KIMI_ACCOUNT_POOL_REASON),
    statusline: unsupported('not-provided-by-harness', KIMI_STATUSLINE_REASON),
    plugin: supported(kimiPluginProjection),
    worker: supported(createHeadlessWorkerExecutionFace('kimi-code')),
  }),
  module({
    id: 'claude-code',
    displayName: 'Claude Code',
    aliases: ['claude', 'claude-code', 'claudecode'],
    surfaces: [
      { id: surfaceId('claude-cli'), displayName: 'Claude CLI', kind: 'cli-headless' },
      {
        id: surfaceId('claude-fable-5-cli'),
        displayName: 'Claude Fable 5 CLI',
        kind: 'cli-headless',
      },
    ],
    targets: CLAUDE_TARGETS,
    installation: claudeInstallationDiscovery,
    session: claudeSessionObservation,
    usage: claudeUsageObservation,
    account: supported(claudeAccountManagement),
    statusline: supported(CLAUDE_STATUSLINE),
    plugin: supported(claudePluginProjection),
    worker: supported(createHeadlessWorkerExecutionFace('claude-code')),
  }),
]) as readonly HarnessModule[];

export const builtInHarnessCatalog = HarnessCatalog.create(BUILT_IN_HARNESS_MODULES);
