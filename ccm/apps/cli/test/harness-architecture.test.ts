import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BUILT_IN_HARNESS_MODULES, builtInHarnessCatalog } from '../src/harnesses/composition.js';

const ROOT = fileURLToPath(new URL('../src/', import.meta.url));

function source(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

test('M5 architecture gate: the god adapter, generic fallback, and legacy registry stay deleted', () => {
  assert.equal(existsSync(join(ROOT, 'harnesses/registry.ts')), false);
  assert.equal(existsSync(join(ROOT, 'harnesses/generic.ts')), false);
  assert.equal(existsSync(join(ROOT, 'host.ts')), false);
  assert.doesNotMatch(source('harnesses/types.ts'), /interface\s+HarnessAdapter\b/);
  for (const path of [
    'router.ts',
    'usage-reading.ts',
    'agent-probe.ts',
    'handlers/account.ts',
    'handlers/board.ts',
    'handlers/harness.ts',
    'handlers/monitor.ts',
    'handlers/statusline.ts',
    'handlers/upgrade.ts',
  ]) {
    assert.doesNotMatch(source(path), /harnesses\/registry|resolveHarnessAdapter|HarnessAdapter/);
  }
});

test('M5 anti-fork gate: quota catalog and collector routing have no parallel target or harness switch', () => {
  const quota = source('machine-wide-quota.ts');
  const router = source('router.ts');
  const usageReading = source('usage-reading.ts');
  assert.doesNotMatch(quota, /\bTARGETS\b|default_collector_harness|defaultCollectorHarness/);
  assert.doesNotMatch(router, /default_collector_harness|knownHarnessAdapters/);
  assert.match(router, /machineQuota\.observerFor\(targetId\)/);
  assert.doesNotMatch(
    usageReading,
    /status\.readings[\s\S]{0,300}\.find\([\s\S]{0,300}surface_id/,
    'cached usage must not select the first reading by surface id',
  );
  assert.match(usageReading, /findMachineQuotaReading\([\s\S]{0,300}machineQuota/);
});

test('M5 composition gate: #188 owns executable harness worker capabilities', () => {
  for (const module of BUILT_IN_HARNESS_MODULES) {
    assert.deepEqual(Object.keys(module.capabilities).sort(), [
      'account-management',
      'installation-discovery',
      'machine-quota',
      'plugin-projection',
      'session-observation',
      'statusline-projection',
      'usage-observation',
      'worker-execution',
    ]);
    assert.equal(module.capabilities['worker-execution'].support, 'supported');
  }
  assert.deepEqual(
    builtInHarnessCatalog.worker
      .candidatesFor('headless-cli')
      .map((candidate) => candidate.harnessId),
    ['codex', 'cursor', 'kimi-code', 'claude-code'],
  );
  assert.equal(
    builtInHarnessCatalog.worker.forHarness('cursor-agent', 'headless-cli')?.harnessId,
    'cursor',
  );
  const model = source('harnesses/capability-model.ts');
  assert.match(model, /interface\s+WorkerExecutionFace\b/);
  assert.doesNotMatch(model, /boardRepo|board\.owner|dispatch_state|worker_state/);
  assert.doesNotMatch(source('worker-process.ts'), /interface\s+WorkerExecutionFace\b/);
});
