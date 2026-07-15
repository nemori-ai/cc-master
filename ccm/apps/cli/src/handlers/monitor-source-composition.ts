const authenticInvocations = new WeakSet<object>();

export interface MonitorLifecycleObserver {
  onCompositionStart(token: object): void | Promise<void>;
  onPolicyCommit(
    token: object,
    decision: { mode: 'cached-only'; reason: string },
  ): void | Promise<void>;
  onCacheRead(token: object, source: { source_id: string }): void | Promise<void>;
  onCompositionEnd<T>(token: object, result: T & { mode?: 'cached-only' }): void | Promise<void>;
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
}): Promise<T & { mode: 'cached-only' }> {
  const token = Object.freeze({});
  authenticInvocations.add(token);
  const observer = input.observer || NOOP_OBSERVER;
  await observer.onCompositionStart(token);
  await observer.onPolicyCommit(token, { mode: 'cached-only', reason: 'default-policy' });
  await observer.onCacheRead(token, { source_id: 'ccm-local-cache' });
  const cached = await input.readCached();
  const result = Object.freeze({ ...cached, mode: 'cached-only' as const });
  await observer.onCompositionEnd(token, result);
  return result;
}
