import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createAuthorityHarness,
  evaluateEffectCase,
  evaluateReconciliationCase,
  evaluateW1Case,
} from '../src/codex-model-admission-a-now.js';

interface ContractCase {
  name: string;
  patch: Record<string, unknown>;
  expected: Record<string, unknown>;
  invocation?: { mode: 'single' | 'sequential' | 'concurrent'; count: number };
}

interface ContractFixture {
  domain: Record<string, unknown>;
  base: Record<string, unknown>;
  cases: ContractCase[];
}

function fixture(name: string): ContractFixture {
  const path = fileURLToPath(
    new URL(`./fixtures/codex-model-admission-a-now-v1/${name}`, import.meta.url),
  );
  return JSON.parse(readFileSync(path, 'utf8')) as ContractFixture;
}

function merge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const output = structuredClone(base);
  for (const [key, patchValue] of Object.entries(patch)) {
    const baseValue = output[key];
    output[key] =
      patchValue !== null &&
      typeof patchValue === 'object' &&
      !Array.isArray(patchValue) &&
      baseValue !== null &&
      typeof baseValue === 'object' &&
      !Array.isArray(baseValue)
        ? merge(baseValue as Record<string, unknown>, patchValue as Record<string, unknown>)
        : structuredClone(patchValue);
  }
  return output;
}

function input(value: ContractFixture, scenario: ContractCase): Record<string, unknown> {
  return { domain: structuredClone(value.domain), input: merge(value.base, scenario.patch) };
}

test('default W1 regression covers every frozen admission case', () => {
  const value = fixture('w1.json');
  for (const scenario of value.cases) {
    assert.deepEqual(evaluateW1Case(input(value, scenario)), scenario.expected, scenario.name);
  }
});

test('W1 ignores retired 5h and audit payload content but rejects incomplete live binary truth', () => {
  const value = fixture('w1.json');
  const cut = structuredClone(value.base);
  cut.quota_5h = { status: 'exhausted', source: 'audit-only' };
  (cut.provenance as Record<string, unknown>).audit_refs = [
    'audit://must-never-become-positive-authority',
  ];
  assert.equal(
    evaluateW1Case({ domain: value.domain, input: cut }).verdict,
    'admit',
    '5h and audit correlation do not affect W1',
  );

  (cut.binary as Record<string, unknown>).completeness = 'unknown';
  assert.deepEqual(evaluateW1Case({ domain: value.domain, input: cut }).reason_codes, [
    'binary_unknown',
  ]);
});

test('default authority regression observes same-process at-most-once behavior', async () => {
  const value = fixture('authority.json');
  for (const scenario of value.cases) {
    const invocation = scenario.invocation;
    assert.ok(invocation, `${scenario.name}: invocation`);
    let controlledSpawns = 0;
    const harness = createAuthorityHarness(input(value, scenario), {
      spawnControlledFixture: async () => {
        controlledSpawns += 1;
        await new Promise((resolve) => setImmediate(resolve));
        return {
          schema: 'ccm/provider-started-handle/v1',
          handle_ref: 'controlled-fixture://default-regression',
          provider_target: 'controlled-fixture',
        };
      },
    });
    const invoke = () => harness.invoke();
    const results =
      invocation.mode === 'concurrent'
        ? await Promise.all(
            Array.from({ length: invocation.count }, () => Promise.resolve().then(invoke)),
          )
        : await (async () => {
            const serial = [];
            for (let index = 0; index < invocation.count; index += 1) {
              serial.push(await invoke());
            }
            return serial;
          })();
    const expected = scenario.expected as {
      results: unknown[];
      observation: { controlled_fixture_spawns: number };
    };
    assert.deepEqual(results, expected.results, scenario.name);
    assert.equal(
      controlledSpawns,
      expected.observation.controlled_fixture_spawns,
      `${scenario.name}: spawn observation`,
    );
  }
});

test('default reconciliation regression never fabricates actual identity or parent acceptance', () => {
  const value = fixture('reconciliation.json');
  for (const scenario of value.cases) {
    assert.deepEqual(
      evaluateReconciliationCase(input(value, scenario)),
      scenario.expected,
      scenario.name,
    );
  }
});

test('default effect regression permits only the controlled fixture port', async () => {
  const value = fixture('effects.json');
  for (const scenario of value.cases) {
    let controlledSpawns = 0;
    const result = await evaluateEffectCase(input(value, scenario), {
      controlledFixtureSpawn: async () => {
        controlledSpawns += 1;
      },
    });
    const expected = scenario.expected as {
      result: unknown;
      observation: { controlled_fixture_spawns: number };
    };
    assert.deepEqual(result, expected.result, scenario.name);
    assert.equal(
      controlledSpawns,
      expected.observation.controlled_fixture_spawns,
      `${scenario.name}: controlled spawn observation`,
    );
  }
});
