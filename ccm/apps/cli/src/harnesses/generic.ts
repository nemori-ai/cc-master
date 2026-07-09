import type { HarnessAdapter } from './types.js';

export function genericAdapter(id: string): HarnessAdapter {
  const displayName = id || 'generic';
  return {
    id: id || 'generic',
    displayName,
    aliases: [],
    detect: () => false,
    inspectInstallation: () => ({
      id: id || 'generic',
      displayName,
      installed: false,
      active: false,
      reason: `${displayName} harness has no registered installation probe`,
      cli: { name: displayName, path: null, available: false },
      configPaths: [],
      capabilities: {
        accountPool: {
          supported: false,
          reason: `${displayName} harness has no registered account-pool adapter`,
        },
        externalStatusline: {
          supported: false,
          reason: `${displayName} harness has no registered external status line adapter`,
        },
        pluginDistribution: {
          supported: false,
          reason: `${displayName} harness has no registered plugin distribution adapter`,
        },
      },
    }),
    session: () => ({ id: '', source: 'none' }),
    sessionStoreRoots: () => [],
    usageSource: () => ({
      kind: 'app-server',
      pollable: false,
      quotaModel: 'primary-secondary',
    }),
    accountPoolLocation: () => null,
    readCurrentUsage: () => ({
      signal: null,
      source: 'unavailable',
      unavailableReason: `${displayName} harness has no registered usage provider`,
    }),
    accountSwitchPreflight: () => ({ action: 'continue' }),
    async upgradePlugin(req) {
      const reason = `${displayName} harness has no registered plugin distribution adapter`;
      req.err(
        `upgrade(plugin): NotImplemented: ${displayName} harness 暂不支持通过 ccm 升级 cc-master plugin。${reason}`,
      );
      if (req.json) {
        req.out(
          req.jsonOk({
            component: 'plugin',
            action: 'skipped',
            reason,
            harness: id || 'generic',
          }),
        );
      }
      return {
        component: 'plugin',
        harness: id || 'generic',
        action: 'skipped',
        exitCode: 2,
        reason,
      };
    },
    accountPool: {
      supported: false,
      reason: `${displayName} harness has no registered account-pool adapter`,
    },
    externalStatusline: {
      supported: false,
      reason: `${displayName} harness has no registered external status line adapter`,
    },
    pluginDistribution: {
      supported: false,
      reason: `${displayName} harness has no registered plugin distribution adapter`,
    },
  };
}
