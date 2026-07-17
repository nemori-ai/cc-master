import assert from 'node:assert/strict';
import { test } from 'node:test';
import { run } from '../src/router.js';

function query(provider: string, asOf = '2026-07-15T12:00:00Z') {
  const out: string[] = [];
  const err: string[] = [];
  const code = run(['provider', 'facts', provider, '--as-of', asOf, '--json'], {
    out: (value) => out.push(value),
    err: (value) => err.push(value),
    env: { HOME: '/tmp', PATH: '/usr/bin:/bin', CC_MASTER_NO_AUTOINSTALL: '1' },
  });
  return { code, err, value: JSON.parse(out.at(-1) || '{}') };
}

test('Claude facts are fresh, provenance-complete, and account-scope honest', () => {
  const result = query('claude-code');
  assert.equal(result.code, 0, result.err.join('\n'));
  const facts = result.value.data;
  assert.equal(facts.schema, 'ccm/provider-model-facts/v1');
  assert.equal(facts.freshness, 'fresh');
  assert.equal(facts.catalog_eligible_for_admission_check, true);
  assert.equal(facts.eligible_for_automatic_selection, false);
  assert.ok(facts.automatic_selection_blockers.includes('unknown:live_account_model_entitlement'));
  assert.ok(facts.automatic_selection_blockers.includes('live_transport_admission_required'));
  for (const field of [
    'source',
    'observed_at',
    'valid_until',
    'account_scope',
    'confidence',
    'unknown',
  ])
    assert.ok(Object.hasOwn(facts, field), `missing ${field}`);
  const sonnet = facts.models.find(
    (model: { model_id: string }) => model.model_id === 'claude-sonnet-5',
  );
  assert.equal(sonnet.display_name, 'Sonnet 5');
  assert.equal(sonnet.availability.state, 'published');
  const fable = facts.models.find(
    (model: { model_id: string }) => model.model_id === 'claude-fable-5',
  );
  assert.equal(fable.availability.state, 'conditional');
  assert.equal(fable.tier, 'economy');
  assert.ok(fable.source_refs.includes('anthropic-fable-5-capabilities'));
  assert.equal(facts.revision, '2026-07-16.1');
  assert.notEqual(fable.availability.account_scope, 'global');
});

test('Codex facts preserve official GPT-5.6 cost and benchmark observations', () => {
  const facts = query('codex').value.data;
  const byId = new Map<string, any>(
    facts.models.map((model: { model_id: string }) => [model.model_id, model]),
  );
  assert.equal(byId.get('gpt-5.6-luna').relative_output_cost, 1);
  assert.equal(byId.get('gpt-5.6-terra').relative_output_cost, 2.5);
  assert.equal(byId.get('gpt-5.6-sol').relative_output_cost, 5);
  assert.deepEqual(byId.get('gpt-5.6-sol').benchmarks, {
    swe_bench_pro_pct: 64.6,
    terminal_bench_2_1_pct: 88.8,
  });
  assert.ok(facts.unknown.includes('live_account_model_entitlement'));
});

test('Cursor facts separate Agent CLI first-party selectors from unknown IDE facts', () => {
  const facts = query('cursor').value.data;
  assert.ok(facts.unknown.includes('cursor_ide_task_model_catalog'));
  assert.ok(facts.unknown.includes('cursor_ide_task_selector_acceptance'));
  const selectors = facts.models.flatMap(
    (model: { selectors?: string[] }) => model.selectors || [],
  );
  for (const selector of ['auto', 'composer-2.5', 'composer-2.5-fast', 'cursor-grok-4.5-high']) {
    assert.ok(selectors.includes(selector), `missing ${selector}`);
  }
  assert.equal(facts.account_scope, 'cursor-subscription-first-party; live entitlement separate');
});

test('Kimi facts expose K3/K2.7-code with honest benchmark and quota unknowns', () => {
  const result = query('kimi-code', '2026-07-16T12:00:00Z');
  assert.equal(result.code, 0, result.err.join('\n'));
  const facts = result.value.data;
  assert.equal(facts.schema, 'ccm/provider-model-facts/v1');
  assert.equal(facts.provider, 'kimi-code');
  assert.equal(facts.freshness, 'fresh');
  assert.equal(facts.eligible_for_automatic_selection, false);
  const byId = new Map<string, any>(
    facts.models.map((model: { model_id: string }) => [model.model_id, model]),
  );
  assert.equal(byId.get('kimi-k3').tier, 'frontier');
  assert.equal(byId.get('kimi-k3').benchmarks, null);
  assert.deepEqual(byId.get('kimi-k3').selectors, ['kimi-code/k3']);
  assert.equal(byId.get('kimi-k2.7-code').tier, 'balanced');
  assert.equal(byId.get('kimi-k2.7-code').benchmarks, null);
  assert.ok(byId.get('kimi-k2.7-code').selectors.includes('kimi-code/kimi-for-coding'));
  assert.ok(facts.unknown.includes('kimi_k3_independent_standard_benchmarks'));
  assert.ok(facts.unknown.includes('kimi_code_cli_headless_quota_signal'));
  assert.equal(facts.revision, '2026-07-16.2');
  // Official Moonshot K3 launch-blog limitations must surface on the K3 fact note.
  const k3Note = byId.get('kimi-k3').pricing.note;
  assert.ok(
    k3Note.includes('preserved-thinking-history'),
    'K3 note must warn on preserved-thinking-history fragility',
  );
  assert.ok(
    k3Note.includes('mid-session model switch'),
    'K3 note must warn against mid-session model switch',
  );
  assert.ok(
    k3Note.includes('AGENTS.md'),
    'K3 note must point to explicit boundaries in system prompt / AGENTS.md',
  );
  assert.ok(
    k3Note.includes('Claude Fable 5 and GPT-5.6 Sol'),
    'K3 note must state the UX gap vs frontier',
  );
  assert.ok(
    k3Note.includes('reasoning_effort is max-only'),
    'K3 note must state reasoning_effort max-only at launch',
  );
});

test('expired snapshots remain observable but fail closed for automatic selection', () => {
  const facts = query('claude-code', '2026-07-23T00:00:00Z').value.data;
  assert.equal(facts.freshness, 'hard-stale');
  assert.equal(facts.catalog_eligible_for_admission_check, false);
  assert.equal(facts.eligible_for_automatic_selection, false);
  assert.ok(facts.automatic_selection_blockers.includes('catalog_hard-stale'));
});

test('registry validation rejects freshness and provenance hostile mutants', async () => {
  const module = await import('../src/provider-model-facts.js');
  assert.equal(module.PROVIDER_MODEL_FACTS_REGISTRY.revision, '2026-07-16.2');
  assert.equal(
    module.PROVIDER_MODEL_FACTS_REGISTRY.providers['claude-code'].revision,
    '2026-07-16.1',
  );
  const valid = structuredClone(module.PROVIDER_MODEL_FACTS_REGISTRY);
  const cases: Array<[string, (registry: any) => void, RegExp]> = [
    [
      'missing source',
      (registry) => {
        registry.providers['claude-code'].source = [];
      },
      /source/u,
    ],
    [
      'future observation',
      (registry) => {
        registry.providers['claude-code'].observed_at = '2026-07-16T00:00:00Z';
      },
      /future/u,
    ],
    [
      'expired evidence',
      (registry) => {
        registry.providers['claude-code'].valid_until = '2026-07-14T00:00:00Z';
      },
      /stale|expired/u,
    ],
    [
      'superseded current model',
      (registry) => {
        registry.providers['claude-code'].models.push({
          ...structuredClone(registry.providers['claude-code'].models[0]),
          model_id: 'claude-sonnet-4-6',
          supersedes: [],
        });
      },
      /supersed/u,
    ],
    [
      'conditional presented globally',
      (registry) => {
        registry.providers['claude-code'].models.find(
          (model: any) => model.model_id === 'claude-fable-5',
        ).availability.account_scope = 'global';
      },
      /conditional|account_scope/u,
    ],
  ];
  for (const [label, mutate, pattern] of cases) {
    const registry = structuredClone(valid);
    mutate(registry);
    assert.throws(
      () =>
        module.validateProviderModelFactsRegistry(registry, '2026-07-15T12:00:00Z', {
          requireFresh: true,
        }),
      pattern,
      label,
    );
  }
});
