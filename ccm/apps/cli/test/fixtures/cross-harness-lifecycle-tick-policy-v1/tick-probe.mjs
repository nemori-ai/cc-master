import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.CCM_XH_C3_MONITOR_MODULE;
const sourcePolicyPath = process.env.CCM_XH_C3_SOURCE_POLICY_MODULE;
const statePath = process.env.CCM_XH_C3_STATE_PATH;
if (!modulePath || !sourcePolicyPath || !statePath) throw new Error('tick probe paths missing');

const monitor = await import(`${pathToFileURL(modulePath).href}?oracle=${Date.now()}`);
assert.equal(
  typeof monitor.__setMonitorLifecycleObserver,
  'function',
  'HONEST RED [same-tick-observer]: production monitor lacks __setMonitorLifecycleObserver',
);
assert.equal(typeof monitor.serve, 'function', 'production monitor lacks public serve entry');

const sourcePolicy = await import(pathToFileURL(sourcePolicyPath).href);
assert.equal(
  typeof sourcePolicy.isMonitorSourcePolicyInvocation,
  'function',
  'HONEST RED [source-policy-identity]: source policy lacks invocation verifier',
);

const trace = [];
let invocationToken;
let committed = false;
function assertAuthentic(candidate) {
  assert.equal(
    sourcePolicy.isMonitorSourcePolicyInvocation(candidate),
    true,
    'AUTHENTIC_SOURCE_POLICY_REQUIRED: observer evidence was not emitted by a real source-policy composition invocation',
  );
  if (invocationToken) {
    assert.equal(
      candidate,
      invocationToken,
      'SAME_TICK_IDENTITY_REQUIRED: observer events crossed invocation tokens',
    );
  }
}

const allowedObserver = {
  async onCompositionStart(token) {
    assert.equal(invocationToken, undefined, 'source-policy composition started more than once');
    assertAuthentic(token);
    invocationToken = token;
    trace.push('composition.start');
  },
  async onPolicyCommit(token, decision) {
    assertAuthentic(token);
    assert.equal(committed, false, 'policy decision committed more than once in one tick');
    assert.equal(decision?.mode, 'cached-only', 'default lifecycle tick must stay cached-only');
    committed = true;
    trace.push('policy.commit:cached-only');
  },
  async onCacheRead(token) {
    assertAuthentic(token);
    assert.equal(committed, true, 'cache read occurred before same-tick policy commit');
    trace.push('cache.read');
  },
  async onCompositionEnd(token, result) {
    assertAuthentic(token);
    assert.equal(result?.mode, 'cached-only', 'source policy returned a live mode');
    trace.push('composition.end');
  },
};
const observer = new Proxy(Object.freeze(allowedObserver), {
  get(target, property, receiver) {
    if (typeof property === 'symbol' || Reflect.has(target, property)) {
      return Reflect.get(target, property, receiver);
    }
    throw new Error(`CLOSED_EFFECT_SANDBOX: unknown effect ${String(property)} denied`);
  },
});
monitor.__setMonitorLifecycleObserver(observer);

const before = JSON.parse(readFileSync(statePath, 'utf8'));
const allowedServiceEntries = new Set(['log', 'pid', 'state.json']);
await monitor.serve({
  values: { state: statePath, iterations: '1', home: process.env.CC_MASTER_HOME },
  positionals: [],
  flags: {
    json: true,
    dryRun: false,
    force: false,
    yes: false,
    quiet: true,
    verbose: false,
    color: false,
  },
  sid: 'oracle-session',
  env: { ...process.env },
  out: () => undefined,
  err: () => undefined,
});
const undeclaredServiceEntries = readdirSync(dirname(statePath)).filter(
  (entry) => !allowedServiceEntries.has(entry),
);
assert.deepEqual(
  undeclaredServiceEntries,
  [],
  'CLOSED_EFFECT_SANDBOX: undeclared service state mutation denied',
);
const after = JSON.parse(readFileSync(statePath, 'utf8'));
assert.equal(
  after.tick_count,
  before.tick_count + 1,
  'public serve did not complete exactly one tick',
);
assert.equal(after.wanted, true, 'tick mutated monitor wanted-state');
assert.deepEqual(
  trace,
  ['composition.start', 'policy.commit:cached-only', 'cache.read', 'composition.end'],
  'HONEST RED [same-tick-consumption]: public monitor tick did not consume source policy before effects',
);
process.stdout.write(`${JSON.stringify({ ok: true, trace })}\n`);
