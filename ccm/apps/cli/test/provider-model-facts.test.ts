import assert from 'node:assert/strict';
import { test } from 'node:test';
import { run } from '../src/router.js';

function query(provider: string, asOf = '2026-07-22T07:46:31Z') {
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
  assert.equal(fable.tier, 'frontier');
  assert.deepEqual(fable.pricing, {
    currency: 'USD',
    input_per_million_tokens: 10,
    output_per_million_tokens: 50,
    note: 'Claude API public token pricing; Claude Code plan billing and live quota remain separate',
  });
  assert.ok(fable.source_refs.includes('anthropic-fable-5-capabilities'));
  assert.equal(facts.revision, '2026-07-22.1');
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
  assert.deepEqual(byId.get('gpt-5.6-sol').pricing, {
    currency: 'USD',
    input_per_million_tokens: 5,
    output_per_million_tokens: 30,
    note: 'OpenAI API public token pricing; Codex plan billing and live quota remain separate',
  });
  assert.deepEqual(byId.get('gpt-5.6-sol').benchmarks, {
    swe_bench_pro_pct: 64.6,
    terminal_bench_2_1_pct: 88.8,
  });
  assert.ok(facts.unknown.includes('live_account_model_entitlement'));
});

test('Cursor facts separate first-party pool identity, Auto billing, and executable-surface unknowns', () => {
  const facts = query('cursor').value.data;
  assert.ok(facts.unknown.includes('cursor_ide_task_model_catalog'));
  for (const unknown of [
    'cursor_agent_cli_exact_executable_selector',
    'cursor_agent_cli_exact_model_version',
    'cursor_agent_cli_exact_effort',
    'cursor_agent_cli_live_entitlement',
    'cursor_agent_cli_t1_qualification',
    'cursor_ide_exact_executable_selector',
    'cursor_ide_exact_model_version',
    'cursor_ide_exact_effort',
    'cursor_ide_live_entitlement',
    'cursor_ide_t1_qualification',
  ]) {
    assert.ok(facts.unknown.includes(unknown), `missing fail-closed unknown ${unknown}`);
  }
  const selectors = facts.models.flatMap(
    (model: { selectors?: string[] }) => model.selectors || [],
  );
  assert.deepEqual(selectors, []);
  assert.ok(
    facts.source.some(
      (source: { id: string; url: string }) =>
        source.id === 'cursor-models-pricing' &&
        source.url === 'https://cursor.com/docs/models-and-pricing.md',
    ),
  );
  assert.equal(
    facts.account_scope,
    'Cursor public catalog and first-party pool; live plan entitlement and quota separate',
  );
  const byId = new Map<string, any>(
    facts.models.map((model: { model_id: string }) => [model.model_id, model]),
  );
  assert.equal(byId.has('cursor-auto'), false);
  assert.deepEqual(
    facts.models
      .filter((model: { quota_pool?: string }) => model.quota_pool === 'first_party')
      .map((model: { model_id: string }) => model.model_id)
      .sort(),
    ['cursor-composer-2-5', 'cursor-grok-4-5'],
  );
  assert.equal(byId.get('cursor-auto-cost').quota_pool, 'usage_based');
  assert.deepEqual(byId.get('cursor-auto-cost').pricing, {
    currency: 'USD',
    input_per_million_tokens: 1.25,
    cache_write_per_million_tokens: 1.25,
    cache_read_per_million_tokens: 0.25,
    output_per_million_tokens: 6,
    note: 'fixed Auto Cost rates regardless of routed model; exempt from Cursor Token Rate; live plan entitlement and quota remain separate',
  });
  for (const modelId of ['cursor-auto-balance', 'cursor-auto-intelligence']) {
    assert.equal(byId.get(modelId).quota_pool, 'usage_based');
    assert.equal(byId.get(modelId).pricing, null);
    assert.match(byId.get(modelId).availability.account_scope, /actual routed model API rates/u);
    assert.match(byId.get(modelId).availability.account_scope, /Cursor Token Rate/u);
  }
  assert.equal(byId.get('cursor-grok-4-5').availability.state, 'conditional');
  assert.deepEqual(byId.get('cursor-grok-4-5').pricing, {
    currency: 'USD',
    standard: { input_per_million_tokens: 2, output_per_million_tokens: 6 },
    fast: { input_per_million_tokens: 4, output_per_million_tokens: 18 },
    note: 'public token rates; included-pool balance, credits, regional access, and live quota remain separate',
  });
});

test('Kimi facts expose K3/K2.7-code with honest benchmark and quota unknowns', () => {
  const result = query('kimi-code');
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
  assert.deepEqual(byId.get('kimi-k3').reasoning_efforts, ['low', 'high', 'max']);
  assert.equal(Object.hasOwn(byId.get('kimi-k3'), 'open_weights'), false);
  assert.equal(byId.get('kimi-k2.7-code').tier, 'balanced');
  assert.equal(byId.get('kimi-k2.7-code').benchmarks, null);
  assert.equal(Object.hasOwn(byId.get('kimi-k2.7-code'), 'open_weights'), false);
  assert.ok(byId.get('kimi-k2.7-code').selectors.includes('kimi-code/kimi-for-coding'));
  assert.ok(facts.unknown.includes('kimi_k3_independent_standard_benchmarks'));
  assert.ok(facts.unknown.includes('kimi_k3_effective_kimi_code_default_reasoning_effort'));
  assert.ok(!facts.unknown.includes('kimi_k3_open_weights'));
  assert.ok(facts.unknown.includes('kimi_code_cli_headless_quota_signal'));
  assert.equal(facts.revision, '2026-07-22.1');
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
  assert.ok(k3Note.includes('API default max'));
  assert.ok(k3Note.includes('Kimi Code model page documents default high'));
  assert.doesNotMatch(k3Note, /max-only/u, 'K3 note must not retain the superseded max-only claim');
  assert.doesNotMatch(
    byId.get('kimi-k2.7-code').pricing.note,
    /open[ -]?weights|Modified MIT/iu,
    'K2.7 pricing note must not retain open-weights or license commentary',
  );
});

test('expired snapshots remain observable but fail closed for automatic selection', () => {
  const facts = query('claude-code', '2026-07-30T00:00:00Z').value.data;
  assert.equal(facts.freshness, 'hard-stale');
  assert.equal(facts.catalog_eligible_for_admission_check, false);
  assert.equal(facts.eligible_for_automatic_selection, false);
  assert.ok(facts.automatic_selection_blockers.includes('catalog_hard-stale'));
});

test('registry validation rejects freshness and provenance hostile mutants', async () => {
  const module = await import('../src/provider-model-facts.js');
  assert.equal(module.PROVIDER_MODEL_FACTS_REGISTRY.revision, '2026-07-22.2');
  assert.equal(
    module.PROVIDER_MODEL_FACTS_REGISTRY.providers['claude-code'].revision,
    '2026-07-22.1',
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
        registry.providers['claude-code'].observed_at = '2026-07-23T00:00:00Z';
      },
      /future/u,
    ],
    [
      'expired evidence',
      (registry) => {
        registry.providers['claude-code'].valid_until = '2026-07-21T00:00:00Z';
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
        module.validateProviderModelFactsRegistry(registry, '2026-07-22T07:46:31Z', {
          requireFresh: true,
        }),
      pattern,
      label,
    );
  }
});
