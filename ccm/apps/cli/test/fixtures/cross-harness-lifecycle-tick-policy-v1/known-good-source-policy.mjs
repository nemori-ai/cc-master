const authenticInvocations = new WeakSet();

export function isMonitorSourcePolicyInvocation(token) {
  return (
    typeof token === 'object' &&
    token !== null &&
    authenticInvocations.has(token)
  );
}

export async function runMonitorSourceCycle({ observer }) {
  const token = Object.freeze({});
  authenticInvocations.add(token);
  await observer.onCompositionStart(token);
  await observer.onPolicyCommit(
    token,
    Object.freeze({ mode: 'cached-only', reason: 'policy-absent' }),
  );
  await observer.onCacheRead(token, Object.freeze({ source_id: 'fixture-cache' }));
  const result = Object.freeze({ mode: 'cached-only', observations: 1 });
  await observer.onCompositionEnd(token, result);
  return result;
}
