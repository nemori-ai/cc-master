const authenticInvocations = new WeakSet<object>();

export type MonitorQuotaSourceMode = 'cached-only' | 'machine-wide';

export interface MonitorLifecycleObserver {
  onCompositionStart(token: object): void | Promise<void>;
  onPolicyCommit(
    token: object,
    decision: { mode: MonitorQuotaSourceMode; reason: string },
  ): void | Promise<void>;
  onCacheRead(token: object, source: { source_id: string }): void | Promise<void>;
  onCompositionEnd<T>(
    token: object,
    result: T & { mode?: MonitorQuotaSourceMode },
  ): void | Promise<void>;
}

const NOOP_OBSERVER: MonitorLifecycleObserver = {
  onCompositionStart: () => undefined,
  onPolicyCommit: () => undefined,
  onCacheRead: () => undefined,
  onCompositionEnd: () => undefined,
};

export function monitorLifecycleNoopObserver(): MonitorLifecycleObserver {
  return NOOP_OBSERVER;
}

export function isMonitorSourcePolicyInvocation(token: unknown): boolean {
  return typeof token === 'object' && token !== null && authenticInvocations.has(token);
}

export async function runMonitorSourceCycle<T extends object>(input: {
  observer: MonitorLifecycleObserver;
  readCached: () => T | Promise<T>;
  mode?: MonitorQuotaSourceMode;
  refreshMachineWide?: () => unknown | Promise<unknown>;
}): Promise<T & { mode: MonitorQuotaSourceMode; machine_wide?: unknown }> {
  const token = Object.freeze({});
  authenticInvocations.add(token);
  const observer = input.observer || NOOP_OBSERVER;
  const mode = input.mode ?? 'cached-only';
  await observer.onCompositionStart(token);
  await observer.onPolicyCommit(token, {
    mode,
    reason: input.mode === 'machine-wide' ? 'explicit-owner-policy' : 'default-policy',
  });
  let machineWide: unknown;
  if (mode === 'machine-wide') {
    if (!input.refreshMachineWide) {
      throw new Error('machine-wide quota refresh boundary is unavailable');
    }
    machineWide = await input.refreshMachineWide();
  }
  await observer.onCacheRead(token, { source_id: 'ccm-local-cache' });
  const cached = await input.readCached();
  const result = Object.freeze({
    ...cached,
    mode,
    ...(mode === 'machine-wide' ? { machine_wide: machineWide } : {}),
  });
  await observer.onCompositionEnd(token, result);
  return result;
}
