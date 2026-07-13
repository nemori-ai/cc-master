import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { canonicalJson } from '@ccm/engine';
import { run } from '../src/router.js';

const TMP: string[] = [];
const AS_OF = '2026-07-13T03:05:00Z';

afterEach(() => {
  for (const path of TMP.splice(0)) rmSync(path, { recursive: true, force: true });
});

function candidate(id: string, surface: 'host-native' | 'cli-headless') {
  return {
    id,
    surface,
    adapter: `codex/${surface}-v1`,
    harness: 'codex',
    provider: 'openai',
    model: surface === 'host-native' ? 'host-default' : 'gpt-future',
    effort: 'high',
    capabilities: ['structured-output'],
    effect_floors_met: ['meets-required-capabilities'],
    permission: { profile: 'read-only', denies: ['push-remote', 'account-mutation'] },
    account_mutation: 'forbidden',
    requires: [
      'runtime-healthy',
      'capability-match',
      'effect-floor',
      'permission-compatible',
      'account-mutation-forbidden',
    ],
  };
}

function task(chain = ['codex-native', 'codex-cli']) {
  const candidates = [
    candidate('codex-native', 'host-native'),
    candidate('codex-cli', 'cli-headless'),
  ];
  return {
    id: 'T-shadow',
    status: 'ready',
    deps: [],
    executor: 'subagent',
    estimate: { value: 1, unit: 'h' },
    planning: {
      schema: 'ccm/task-planning/v1',
      assessed_at: '2026-07-13T03:00:00Z',
      assessor: 'master-orchestrator',
      dimensions: {
        reasoning: 'multi-step',
        uncertainty: 'low',
        risk: 'medium',
        scope: 'multi-file',
        context: 'medium',
        coordination: 'none',
        reversibility: 'reversible',
      },
      estimate_confidence: 'high',
      quality: { effect_floor: 'meets-required-capabilities' },
      budget: { posture: 'ample', max_attempts: 2 },
      capabilities: {
        required: [{ id: 'structured-output' }],
        preferred: [],
        forbidden: [{ id: 'push-remote' }],
      },
    },
    routing: {
      schema: 'ccm/agent-routing/v1',
      mode: 'cross-harness',
      policy: {
        objective: 'balanced',
        constraints: {
          effect_floor: 'meets-required-capabilities',
          quota_unknown: 'ineligible',
          cross_harness_quota_admission: 'ample-only',
        },
        candidates,
        chains: {
          ample: chain,
          tight: chain,
        },
        fallback: {
          on: ['transport-error'],
          never_on: [
            'policy-blocked',
            'permission-blocked',
            'security-blocked',
            'workspace-mismatch',
            'task-blocked',
            'acceptance-failed',
          ],
          exhaustion: 'fail-closed',
          same_harness: 'explicit-candidate-only',
        },
      },
      selected: null,
      attempts: [],
    },
  };
}

interface CandidateState {
  availability?: 'available' | 'unavailable' | 'unknown';
  quota?: 'ample' | 'tight' | 'exhausted' | 'unknown';
  auth?: 'authenticated' | 'unauthenticated' | 'expired' | 'unknown';
  model?: 'available' | 'unavailable' | 'unknown';
  runtime?: 'healthy' | 'unhealthy' | 'unknown';
}

interface FixtureOptions {
  chain?: string[];
  native?: CandidateState;
  cli?: CandidateState;
}

interface SecretInjectableEnvelope extends Record<string, unknown> {
  warnings: string[];
  candidates: Array<{
    reason?: string;
    qualifications: Array<{ ref?: string }>;
  }>;
}

function runtimeQualification(runtime: CandidateState['runtime']): 'pass' | 'fail' | 'unknown' {
  return runtime === 'healthy' ? 'pass' : runtime === 'unhealthy' ? 'fail' : 'unknown';
}

function fixture(options: FixtureOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ccm-shadow-route-'));
  TMP.push(root);
  const board = join(root, 'board.json');
  const snapshot = join(root, 'machine.json');
  const context = join(root, 'context.json');
  const boardValue = {
    schema: 'cc-master/v2',
    meta: {},
    goal: 'shadow route',
    owner: { active: true, session_id: 'sid-shadow' },
    git: { worktree: '', branch: '' },
    tasks: [task(options.chain)],
    log: [],
  };
  writeFileSync(board, `${JSON.stringify(boardValue, null, 2)}\n`);
  const boardRevision = `sha256:${createHash('sha256').update(canonicalJson(boardValue)).digest('hex')}`;
  writeFileSync(
    snapshot,
    JSON.stringify({
      schema: 'ccm/machine-context-cache/v1',
      revision: 'machine-r17',
      board_revision: boardRevision,
      observed_at: '2026-07-13T03:00:00Z',
      valid_until: '2026-07-13T03:10:00Z',
      candidates: [
        {
          candidate_id: 'codex-native',
          harness: 'codex',
          surface: 'host-native',
          availability: options.native?.availability ?? 'unavailable',
          quota: options.native?.quota ?? 'ample',
          auth: options.native?.auth ?? 'authenticated',
          model: options.native?.model ?? 'available',
          runtime: options.native?.runtime ?? 'unhealthy',
          qualifications: [
            {
              predicate: 'runtime-healthy',
              status: runtimeQualification(options.native?.runtime ?? 'unhealthy'),
              ref: 'cache://codex/native',
            },
          ],
        },
        {
          candidate_id: 'codex-cli',
          harness: 'codex',
          surface: 'cli-headless',
          availability: options.cli?.availability ?? 'available',
          quota: options.cli?.quota ?? 'ample',
          auth: options.cli?.auth ?? 'authenticated',
          model: options.cli?.model ?? 'available',
          runtime: options.cli?.runtime ?? 'healthy',
          qualifications: [
            {
              predicate: 'runtime-healthy',
              status: runtimeQualification(options.cli?.runtime ?? 'healthy'),
              ref: 'cache://codex/cli',
            },
          ],
        },
      ],
      warnings: [],
    }),
  );
  return { root, board, snapshot, context };
}

function call(argv: string[], extra: Record<string, unknown> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = run(argv, {
    out: (value) => out.push(value),
    err: (value) => err.push(value),
    env: { CC_MASTER_NO_AUTOINSTALL: '1' },
    ...extra,
  });
  return { code, out, err };
}

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .reverse()
      .map(([key, child]) => [key, reverseObjectKeys(child)]),
  );
}

function treeState(root: string): string[] {
  const entries: string[] = [];
  const visit = (path: string, relative: string) => {
    for (const name of readdirSync(path).sort()) {
      const absolute = join(path, name);
      const child = relative ? `${relative}/${name}` : name;
      const stat = statSync(absolute);
      entries.push(`${child}:${stat.isDirectory() ? 'dir' : readFileSync(absolute, 'utf8')}`);
      if (stat.isDirectory()) visit(absolute, child);
    }
  };
  visit(root, '');
  return entries;
}

function contextAndAdvice(
  f: ReturnType<typeof fixture>,
  origin: string,
): { context: Record<string, any>; advice: Record<string, any> } {
  const before = readFileSync(f.board, 'utf8');
  const beforeTree = treeState(f.root);
  const contextCall = call([
    'orchestrator',
    'context',
    '--cached-only',
    '--snapshot',
    `@${f.snapshot}`,
    '--as-of',
    AS_OF,
    '--harness',
    origin,
    '--board',
    f.board,
    '--json',
  ]);
  assert.equal(contextCall.code, 0, contextCall.err.join('\n'));
  const context = JSON.parse(contextCall.out.join('')).data;
  assert.equal(context.cached_only, true);
  assert.equal(context.revisions.machine, 'machine-r17');
  assert.deepEqual(treeState(f.root), beforeTree, 'context command must not persist any state');
  writeFileSync(f.context, JSON.stringify(context));

  const adviceCall = call([
    'route',
    'advise',
    'T-shadow',
    '--context',
    `@${f.context}`,
    '--origin',
    origin,
    '--as-of',
    AS_OF,
    '--board',
    f.board,
    '--json',
  ]);
  assert.equal(adviceCall.code, 0, adviceCall.err.join('\n'));
  const advice = JSON.parse(adviceCall.out.join('')).data;
  assert.equal(advice.spawned, false);
  assert.equal(readFileSync(f.board, 'utf8'), before);
  assert.deepEqual(
    treeState(f.root).filter((entry) => !entry.startsWith('context.json:')),
    beforeTree,
    'route command must not persist board, reservation, or attempt state',
  );
  return { context, advice };
}

test('cached-only context feeds same-native shadow advice without side effects', () => {
  const f = fixture({ native: { availability: 'available', runtime: 'healthy' } });
  const { advice } = contextAndAdvice(f, 'codex');
  assert.equal(advice.outcome, 'same-native');
  assert.equal(advice.selected.surface, 'host-native');
});

test('cached-only context feeds same-harness CLI shadow advice without side effects', () => {
  const f = fixture();
  const { advice } = contextAndAdvice(f, 'codex');
  assert.equal(advice.outcome, 'same-harness-cli');
  assert.equal(advice.selected.surface, 'cli-headless');
});

test('cached-only context preserves an explicit other-harness CLI outcome', () => {
  const f = fixture();
  const { advice } = contextAndAdvice(f, 'cursor');
  assert.equal(advice.outcome, 'other-harness-cli');
  assert.equal(advice.selected.surface, 'cli-headless');
  assert.equal(advice.selected.harness, 'codex');
});

test('cached-only context reports origin-stay only after an earlier CLI rejection', () => {
  const f = fixture({
    chain: ['codex-cli', 'codex-native'],
    native: { availability: 'available', runtime: 'healthy' },
    cli: { availability: 'unavailable', runtime: 'unhealthy' },
  });
  const { advice } = contextAndAdvice(f, 'codex');
  assert.equal(advice.outcome, 'origin-stay');
  assert.equal(advice.selected.surface, 'host-native');
  assert.ok(advice.evaluations[0].reason_codes.includes('availability-unavailable'));
});

test('cached-only context returns no-route when no candidate is eligible', () => {
  const f = fixture({
    native: { availability: 'unknown', runtime: 'unknown' },
    cli: { availability: 'unknown', quota: 'unknown', runtime: 'unknown' },
  });
  const { advice } = contextAndAdvice(f, 'codex');
  assert.equal(advice.outcome, 'no-route');
  assert.equal(advice.selected, null);
});

test('missing or corrupt cache returns exit 0 with explicit unknown and no live fallback', () => {
  const f = fixture();
  const missing = call([
    'orchestrator',
    'context',
    '--cached-only',
    '--as-of',
    AS_OF,
    '--harness',
    'codex',
    '--board',
    f.board,
    '--json',
  ]);
  assert.equal(missing.code, 0, missing.err.join('\n'));
  const missingData = JSON.parse(missing.out.join('')).data;
  assert.equal(missingData.available, false);
  assert.equal(missingData.freshness.state, 'unknown');
  assert.ok(missingData.warnings.includes('machine-context-cache-missing'));

  writeFileSync(f.snapshot, '{broken-json');
  const corrupt = call([
    'orchestrator',
    'context',
    '--cached-only',
    '--snapshot',
    `@${f.snapshot}`,
    '--as-of',
    AS_OF,
    '--harness',
    'codex',
    '--board',
    f.board,
    '--json',
  ]);
  assert.equal(corrupt.code, 0, corrupt.err.join('\n'));
  const corruptData = JSON.parse(corrupt.out.join('')).data;
  assert.equal(corruptData.available, false);
  assert.ok(corruptData.warnings.includes('machine-context-cache-corrupt'));
});

test('board revision uses recursive key-sorted canonical JSON semantics', () => {
  const f = fixture();
  const original = JSON.parse(readFileSync(f.board, 'utf8'));
  const revisionOf = (boardValue: unknown) => {
    writeFileSync(f.board, `${JSON.stringify(boardValue, null, 2)}\n`);
    const result = call([
      'orchestrator',
      'context',
      '--cached-only',
      '--as-of',
      AS_OF,
      '--harness',
      'codex',
      '--board',
      f.board,
      '--json',
    ]);
    assert.equal(result.code, 0, result.err.join('\n'));
    return JSON.parse(result.out.join('')).data.revisions.board as string;
  };
  const canonical = revisionOf(original);
  assert.equal(revisionOf(reverseObjectKeys(original)), canonical);
  const changed = structuredClone(original);
  changed.tasks[0].status = 'blocked';
  assert.notEqual(revisionOf(changed), canonical);
});

test('route endpoint recomputes advice-time freshness and rejects malformed public envelopes', () => {
  const f = fixture();
  const { context } = contextAndAdvice(f, 'codex');
  writeFileSync(f.context, JSON.stringify(context));
  const stale = call([
    'route',
    'advise',
    'T-shadow',
    '--context',
    `@${f.context}`,
    '--origin',
    'codex',
    '--as-of',
    '2026-07-13T04:00:00Z',
    '--board',
    f.board,
    '--json',
  ]);
  assert.equal(stale.code, 0, stale.err.join('\n'));
  assert.equal(JSON.parse(stale.out.join('')).data.outcome, 'no-route');

  const unavailable = structuredClone(context);
  unavailable.available = false;
  writeFileSync(f.context, JSON.stringify(unavailable));
  const unavailableCall = call([
    'route',
    'advise',
    'T-shadow',
    '--context',
    `@${f.context}`,
    '--origin',
    'codex',
    '--as-of',
    AS_OF,
    '--board',
    f.board,
    '--json',
  ]);
  assert.equal(unavailableCall.code, 0, unavailableCall.err.join('\n'));
  assert.equal(JSON.parse(unavailableCall.out.join('')).data.outcome, 'no-route');

  for (const corrupt of [
    { ...context, freshness: { ...context.freshness, as_of: 'bad-time' } },
    {
      ...context,
      freshness: { ...context.freshness, state: 'fresh', as_of: '2026-07-13T04:00:00Z' },
    },
  ]) {
    writeFileSync(f.context, JSON.stringify(corrupt));
    const invalid = call([
      'route',
      'advise',
      'T-shadow',
      '--context',
      `@${f.context}`,
      '--origin',
      'codex',
      '--as-of',
      AS_OF,
      '--board',
      f.board,
      '--json',
    ]);
    assert.equal(invalid.code, 3);
  }
});

test('impossible calendar UTC values fail closed at context and advice endpoints', () => {
  const impossible = '2026-02-31T03:05:00Z';
  const f = fixture();
  const snapshot = JSON.parse(readFileSync(f.snapshot, 'utf8'));
  snapshot.observed_at = '2026-03-01T00:00:00Z';
  snapshot.valid_until = '2026-03-10T00:00:00Z';
  writeFileSync(f.snapshot, JSON.stringify(snapshot));

  const contextCall = call([
    'orchestrator',
    'context',
    '--cached-only',
    '--snapshot',
    `@${f.snapshot}`,
    '--as-of',
    impossible,
    '--harness',
    'codex',
    '--board',
    f.board,
    '--json',
  ]);
  assert.equal(contextCall.code, 0, contextCall.err.join('\n'));
  const contextData = JSON.parse(contextCall.out.join('')).data;
  assert.equal(contextData.available, false);
  assert.equal(contextData.freshness.state, 'unknown');
  assert.ok(contextData.warnings.includes('machine-context-cache-corrupt'));

  const { context } = contextAndAdvice(fixture(), 'codex');
  context.freshness.observed_at = '2026-03-01T00:00:00Z';
  context.freshness.valid_until = '2026-03-10T00:00:00Z';
  context.freshness.as_of = '2026-03-03T03:05:00Z';
  context.freshness.state = 'fresh';
  writeFileSync(f.context, JSON.stringify(context));
  const adviceCall = call([
    'route',
    'advise',
    'T-shadow',
    '--context',
    `@${f.context}`,
    '--origin',
    'codex',
    '--as-of',
    impossible,
    '--board',
    f.board,
    '--json',
  ]);
  assert.equal(adviceCall.code, 3);
});

test('alphabetic high-signal tokens fail closed without echo at cache and public-context CLI boundaries', () => {
  const highSignalValues = [
    'sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX',
    'Bearer ABCDEFGHIJKLMNOPQRSTUVWX',
    ...['!', '?', ')', ':'].map((suffix) => `Bearer ABCDEFGHIJKLMNOPQRSTUVWX${suffix}`),
  ];
  const locations: Array<{
    name: string;
    inject: (value: SecretInjectableEnvelope, secretValue: string) => void;
  }> = [
    {
      name: 'warning',
      inject: (value, secretValue) => {
        value.warnings = [secretValue];
      },
    },
    {
      name: 'candidate reason',
      inject: (value, secretValue) => {
        value.candidates[0]!.reason = secretValue;
      },
    },
    {
      name: 'qualification ref',
      inject: (value, secretValue) => {
        value.candidates[0]!.qualifications[0]!.ref = secretValue;
      },
    },
  ];

  for (const secretValue of highSignalValues) {
    for (const location of locations) {
      const f = fixture();
      const snapshot = JSON.parse(readFileSync(f.snapshot, 'utf8'));
      location.inject(snapshot, secretValue);
      writeFileSync(f.snapshot, JSON.stringify(snapshot));
      const contextCall = call([
        'orchestrator',
        'context',
        '--cached-only',
        '--snapshot',
        `@${f.snapshot}`,
        '--as-of',
        AS_OF,
        '--harness',
        'codex',
        '--board',
        f.board,
        '--json',
      ]);
      assert.equal(contextCall.code, 0, location.name);
      const contextData = JSON.parse(contextCall.out.join('')).data;
      assert.equal(contextData.available, false, location.name);
      assert.ok(contextData.warnings.includes('machine-context-cache-corrupt'), location.name);
      assert.equal(
        [...contextCall.out, ...contextCall.err].join('\n').includes(secretValue),
        false,
      );

      const cleanFixture = fixture();
      const { context } = contextAndAdvice(cleanFixture, 'codex');
      location.inject(context as unknown as SecretInjectableEnvelope, secretValue);
      writeFileSync(cleanFixture.context, JSON.stringify(context));
      const adviceCall = call([
        'route',
        'advise',
        'T-shadow',
        '--context',
        `@${cleanFixture.context}`,
        '--origin',
        'codex',
        '--as-of',
        AS_OF,
        '--board',
        cleanFixture.board,
        '--json',
      ]);
      assert.equal(adviceCall.code, 3, location.name);
      assert.equal([...adviceCall.out, ...adviceCall.err].join('\n').includes(secretValue), false);
    }
  }
});

test('injected composition boundary proves exact reads and zero forbidden effects for 3+1/no-route', () => {
  const cases: Array<[string, FixtureOptions, string, string]> = [
    [
      'same-native',
      { native: { availability: 'available', runtime: 'healthy' } },
      'codex',
      'same-native',
    ],
    ['same-cli', {}, 'codex', 'same-harness-cli'],
    ['other-cli', {}, 'cursor', 'other-harness-cli'],
    [
      'origin-stay',
      {
        chain: ['codex-cli', 'codex-native'],
        native: { availability: 'available', runtime: 'healthy' },
        cli: { availability: 'unavailable', runtime: 'unhealthy' },
      },
      'codex',
      'origin-stay',
    ],
    [
      'no-route',
      {
        native: { availability: 'unknown', runtime: 'unknown' },
        cli: { availability: 'unknown', quota: 'unknown', runtime: 'unknown' },
      },
      'codex',
      'no-route',
    ],
  ];

  for (const [name, options, origin, expected] of cases) {
    const f = fixture(options);
    const board = JSON.parse(readFileSync(f.board, 'utf8'));
    const inputs = new Map<string, string>([[`@${f.snapshot}`, readFileSync(f.snapshot, 'utf8')]]);
    const reads: string[] = [];
    const forbidden = new Map([
      ['process', 0],
      ['network', 0],
      ['credential', 0],
      ['reservation', 0],
      ['attempt', 0],
      ['board-write', 0],
      ['out-of-root-write', 0],
    ]);
    const deny = (kind: string) => () => {
      forbidden.set(kind, (forbidden.get(kind) ?? 0) + 1);
      throw new Error(`forbidden ${kind}`);
    };
    const boundary = {
      resolveBoard: () => {
        reads.push(`board:${f.board}`);
        return { boardPath: f.board, board: structuredClone(board) };
      },
      readInputSpec: (spec: string) => {
        reads.push(`input:${spec}`);
        const value = inputs.get(spec);
        if (value === undefined) throw new Error(`unexpected input ${spec}`);
        return value;
      },
      spawnProcess: deny('process'),
      requestNetwork: deny('network'),
      readCredential: deny('credential'),
      reserve: deny('reservation'),
      writeAttempt: deny('attempt'),
      writeBoard: deny('board-write'),
      writeFile: deny('out-of-root-write'),
    };
    const contextCall = call(
      [
        'orchestrator',
        'context',
        '--cached-only',
        '--snapshot',
        `@${f.snapshot}`,
        '--as-of',
        AS_OF,
        '--harness',
        origin,
        '--board',
        f.board,
        '--json',
      ],
      { shadowRoutingBoundary: boundary },
    );
    assert.equal(contextCall.code, 0, `${name}: ${contextCall.err.join('\n')}`);
    const projected = JSON.parse(contextCall.out.join('')).data;
    inputs.set('@context', JSON.stringify(projected));
    const adviceCall = call(
      [
        'route',
        'advise',
        'T-shadow',
        '--context',
        '@context',
        '--origin',
        origin,
        '--as-of',
        AS_OF,
        '--board',
        f.board,
        '--json',
      ],
      { shadowRoutingBoundary: boundary },
    );
    assert.equal(adviceCall.code, 0, `${name}: ${adviceCall.err.join('\n')}`);
    assert.equal(JSON.parse(adviceCall.out.join('')).data.outcome, expected);
    assert.deepEqual(reads, [
      `board:${f.board}`,
      `input:@${f.snapshot}`,
      `board:${f.board}`,
      'input:@context',
    ]);
    assert.deepEqual(Object.fromEntries(forbidden), {
      process: 0,
      network: 0,
      credential: 0,
      reservation: 0,
      attempt: 0,
      'board-write': 0,
      'out-of-root-write': 0,
    });
  }
});

test('shadow route implementation has no process/network/provider import surface', () => {
  const source = [
    readFileSync(new URL('../src/handlers/shadow-routing.ts', import.meta.url), 'utf8'),
    readFileSync(
      new URL('../../../packages/engine/src/shadow-routing.ts', import.meta.url),
      'utf8',
    ),
  ].join('\n');
  assert.doesNotMatch(source, /node:(?:child_process|net|http|https)|\bfetch\s*\(/);
  assert.doesNotMatch(source, /\b(?:spawn|execFile|execSync|fork)\s*\(/);
  assert.doesNotMatch(source, /login|logout|account\s*switch/i);
});
