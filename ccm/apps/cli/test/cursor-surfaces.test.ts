import assert from 'node:assert/strict';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  buildCursorSurfaceInventory,
  type CursorSurfaceProbeDeps,
  inspectCursorExecutionSurfaces,
} from '../src/harnesses/cursor-surfaces.js';

const NOW = new Date('2026-07-13T04:00:00Z');

interface FakeBinaryOptions {
  name: 'cursor' | 'agent' | 'cursor-agent';
  supported?: boolean;
  authenticated?: boolean;
  secret?: string;
  version?: string;
  versionExit?: number;
}

function makeFixture(options: FakeBinaryOptions[]): {
  env: Record<string, string>;
  root: string;
  invocationLog: string;
  home: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'ccm-cursor-surfaces-'));
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  mkdirSync(bin, { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(join(home, '.cursor'), { recursive: true });
  writeFileSync(join(home, '.cursor', 'auth.json'), '{"sentinel":"unchanged"}\n');
  const invocationLog = join(root, 'invocations.jsonl');

  for (const option of options) {
    const file = join(bin, option.name);
    const payload = JSON.stringify({
      supported: option.supported ?? true,
      authenticated: option.authenticated ?? false,
      secret: option.secret ?? 'not-a-secret',
      version: option.version ?? '2026.07.09-a3815c0',
      versionExit: option.versionExit ?? 0,
    });
    writeFileSync(
      file,
      `#!${process.execPath}\n` +
        `const fs = require('node:fs');\n` +
        `const cfg = ${payload};\n` +
        `fs.appendFileSync(${JSON.stringify(invocationLog)}, JSON.stringify({argv:process.argv.slice(2),credentialEnvPresent:Boolean(process.env.CURSOR_API_KEY)}) + '\\n');\n` +
        `const args = process.argv.slice(2).join(' ');\n` +
        `if (args === '--version') { if (cfg.versionExit) process.exit(cfg.versionExit); if (cfg.version) console.log(cfg.version); }\n` +
        `else if (args === '--help') console.log(cfg.supported ? '--print --output-format --workspace --model status' : 'legacy interactive only');\n` +
        `else if (args === 'status --help') console.log(cfg.supported ? '--format <json|text>' : 'status');\n` +
        `else if (args === 'status --format json') console.log(JSON.stringify({isAuthenticated: cfg.authenticated, userInfo:{email:'private@example.test'}, accessToken:cfg.secret}));\n` +
        `else process.exit(64);\n`,
    );
    chmodSync(file, 0o755);
  }

  return {
    root,
    home,
    invocationLog,
    env: { PATH: bin, HOME: home, CURSOR_API_KEY: 'must-not-be-forwarded' },
  };
}

function deps(overrides: Partial<CursorSurfaceProbeDeps> = {}): CursorSurfaceProbeDeps {
  return { now: () => NOW, ...overrides };
}

function byId(
  surfaces: ReturnType<typeof inspectCursorExecutionSurfaces>,
  id: 'cursor-ide-plugin' | 'cursor-agent-cli',
) {
  const surface = surfaces.find((entry) => entry.surface_id === id);
  assert.ok(surface, `missing ${id}`);
  return surface;
}

test('PATH with only cursor proves IDE presence but cannot derive headless installation or auth', () => {
  const fixture = makeFixture([{ name: 'cursor' }]);
  const surfaces = inspectCursorExecutionSurfaces(fixture.env, deps());

  const ide = byId(surfaces, 'cursor-ide-plugin');
  const headless = byId(surfaces, 'cursor-agent-cli');
  assert.equal(ide.installed, true);
  assert.equal(ide.binary.name, 'cursor');
  assert.equal(ide.auth.state, 'unknown');
  assert.equal(headless.installed, false);
  assert.equal(headless.auth.state, 'unknown');
  assert.equal(headless.eligibility.automatic, false);
});

for (const binary of ['agent', 'cursor-agent'] as const) {
  test(`PATH with only ${binary} discovers headless independently and redacts auth output`, () => {
    const secret = `secret-${binary}`;
    const fixture = makeFixture([{ name: binary, authenticated: true, secret }]);
    const surfaces = inspectCursorExecutionSurfaces(fixture.env, deps());

    const ide = byId(surfaces, 'cursor-ide-plugin');
    const headless = byId(surfaces, 'cursor-agent-cli');
    assert.equal(ide.installed, false);
    assert.equal(ide.auth.state, 'unknown');
    assert.equal(headless.installed, true);
    assert.equal(headless.binary.name, binary);
    assert.equal(headless.auth.state, 'authenticated');
    assert.equal(headless.quota.state, 'unknown');
    assert.equal(headless.eligibility.automatic, false);
    assert.ok(headless.eligibility.reason_codes.includes('quota-unknown'));
    assert.equal(JSON.stringify(surfaces).includes(secret), false);
    assert.equal(JSON.stringify(surfaces).includes('private@example.test'), false);
  });
}

test('agent wins deterministic binary precedence when agent and cursor-agent coexist', () => {
  const fixture = makeFixture([
    { name: 'agent', authenticated: true },
    { name: 'cursor-agent', authenticated: true },
  ]);
  const headless = byId(inspectCursorExecutionSurfaces(fixture.env, deps()), 'cursor-agent-cli');

  assert.equal(headless.binary.name, 'agent');
  assert.equal(headless.binary.source, 'path:agent');
});

test('unsupported Agent CLI stays installed but is never probed as authenticated or eligible', () => {
  const fixture = makeFixture([{ name: 'agent', supported: false, authenticated: true }]);
  const headless = byId(inspectCursorExecutionSurfaces(fixture.env, deps()), 'cursor-agent-cli');

  assert.equal(headless.installed, true);
  assert.equal(headless.binary.state, 'unsupported');
  assert.equal(headless.auth.state, 'unknown');
  assert.equal(headless.eligibility.automatic, false);
  assert.ok(headless.eligibility.reason_codes.includes('binary-unsupported'));
  const calls = readFileSync(fixture.invocationLog, 'utf8');
  assert.equal(calls.includes('status --format json'), false);
});

for (const versionCase of [
  { label: 'empty', version: '' },
  { label: 'garbage', version: 'Cursor Agent development build' },
  { label: 'unsupported', version: '2026.06.30-deadbee' },
  { label: 'exit anomaly', version: '2026.07.09-a3815c0', versionExit: 42 },
]) {
  test(`version contract fails closed for ${versionCase.label} output even when all help flags match`, () => {
    const fixture = makeFixture([
      {
        name: 'agent',
        authenticated: true,
        version: versionCase.version,
        versionExit: versionCase.versionExit,
      },
    ]);
    const headless = byId(inspectCursorExecutionSurfaces(fixture.env, deps()), 'cursor-agent-cli');

    assert.equal(headless.binary.state, 'unsupported');
    assert.equal(headless.compatibility, 'unsupported');
    assert.equal(headless.auth.state, 'unknown');
    assert.equal(headless.eligibility.automatic, false);
    assert.ok(headless.eligibility.reason_codes.includes('binary-unsupported'));
    const calls = readFileSync(fixture.invocationLog, 'utf8');
    assert.equal(calls.includes('status --format json'), false);
  });
}

test('positive auth/quota fixture admits only the headless surface, never the IDE surface', () => {
  const fixture = makeFixture([{ name: 'cursor' }, { name: 'agent', authenticated: true }]);
  let collectorSawCredential = false;
  const surfaces = inspectCursorExecutionSurfaces(
    fixture.env,
    deps({
      readQuota: ({ env }) => {
        collectorSawCredential ||= Boolean(env.CURSOR_API_KEY);
        return {
          state: 'ample',
          source: 'fixture:cursor-agent-quota',
          pool_refs: ['cursor:subscription:first-party'],
          observed_at: NOW.toISOString(),
          valid_until: '2026-07-13T04:05:00Z',
        };
      },
      readModel: ({ env }) => {
        collectorSawCredential ||= Boolean(env.CURSOR_API_KEY);
        return {
          state: 'entitled',
          source: 'fixture:cursor-agent-models',
          model_refs: ['cursor:gpt-5.6'],
          observed_at: NOW.toISOString(),
          valid_until: '2026-07-13T04:05:00Z',
        };
      },
    }),
  );

  assert.equal(byId(surfaces, 'cursor-agent-cli').eligibility.automatic, true);
  assert.deepEqual(byId(surfaces, 'cursor-agent-cli').eligibility.reason_codes, []);
  assert.equal(byId(surfaces, 'cursor-ide-plugin').eligibility.automatic, false);
  assert.deepEqual(byId(surfaces, 'cursor-ide-plugin').eligibility.reason_codes, [
    'surface-not-headless',
  ]);
  assert.equal(collectorSawCredential, false);
});

test('malformed or stale model/pool collector facts fail closed without leaking extra fields', () => {
  const fixture = makeFixture([{ name: 'agent', authenticated: true }]);
  const headless = byId(
    inspectCursorExecutionSurfaces(
      fixture.env,
      deps({
        readQuota: () =>
          ({
            state: 'ample',
            source: 'fixture:malformed-quota',
            pool_refs: [],
            observed_at: NOW.toISOString(),
            valid_until: null,
            secret: 'quota-secret',
          }) as never,
        readModel: () =>
          ({
            state: 'entitled',
            source: 'fixture:stale-model',
            model_refs: ['cursor:gpt-5.6'],
            observed_at: NOW.toISOString(),
            valid_until: '2026-07-13T03:59:59Z',
            secret: 'model-secret',
          }) as never,
      }),
    ),
    'cursor-agent-cli',
  );

  assert.equal(headless.quota.state, 'unknown');
  assert.equal(headless.model.state, 'unknown');
  assert.equal(headless.eligibility.automatic, false);
  assert.ok(headless.eligibility.reason_codes.includes('quota-unknown'));
  assert.ok(headless.eligibility.reason_codes.includes('model-entitlement-unknown'));
  assert.equal(JSON.stringify(headless).includes('quota-secret'), false);
  assert.equal(JSON.stringify(headless).includes('model-secret'), false);
});

test('future-dated model and quota observations fail closed instead of creating automatic eligibility', () => {
  const fixture = makeFixture([{ name: 'agent', authenticated: true }]);
  const headless = byId(
    inspectCursorExecutionSurfaces(
      fixture.env,
      deps({
        readQuota: () => ({
          state: 'ample',
          source: 'fixture:future-quota',
          pool_refs: ['cursor:subscription:first-party'],
          observed_at: '2026-07-13T04:01:00Z',
          valid_until: '2026-07-13T04:06:00Z',
        }),
        readModel: () => ({
          state: 'entitled',
          source: 'fixture:future-model',
          model_refs: ['cursor:gpt-5.6'],
          observed_at: '2026-07-13T04:01:00Z',
          valid_until: '2026-07-13T04:06:00Z',
        }),
      }),
    ),
    'cursor-agent-cli',
  );

  assert.equal(headless.model.state, 'unknown');
  assert.equal(headless.quota.state, 'unknown');
  assert.equal(headless.eligibility.automatic, false);
  assert.ok(headless.eligibility.reason_codes.includes('model-entitlement-unknown'));
  assert.ok(headless.eligibility.reason_codes.includes('quota-unknown'));
});

test('temporally contradictory and non-canonical collector facts fail closed', () => {
  const fixture = makeFixture([{ name: 'agent', authenticated: true }]);
  const cases: Array<{
    name: string;
    observed_at: string;
    valid_until: string;
    source: string;
    ref: string;
  }> = [
    {
      name: 'reversed-window',
      observed_at: '2026-07-13T03:59:00Z',
      valid_until: '2026-07-13T03:58:00Z',
      source: 'fixture:reversed',
      ref: 'cursor:pool',
    },
    {
      name: 'non-canonical-time',
      observed_at: 'July 13 2026 03:59:00 UTC',
      valid_until: 'July 13 2026 04:05:00 UTC',
      source: 'fixture:non-canonical',
      ref: 'cursor:pool',
    },
    {
      name: 'empty-source-and-ref',
      observed_at: '2026-07-13T03:59:00Z',
      valid_until: '2026-07-13T04:05:00Z',
      source: '',
      ref: '',
    },
  ];

  for (const invalid of cases) {
    const headless = byId(
      inspectCursorExecutionSurfaces(
        fixture.env,
        deps({
          readQuota: () => ({
            state: 'ample',
            source: invalid.source,
            pool_refs: [invalid.ref],
            observed_at: invalid.observed_at,
            valid_until: invalid.valid_until,
          }),
          readModel: () => ({
            state: 'entitled',
            source: invalid.source,
            model_refs: [invalid.ref],
            observed_at: invalid.observed_at,
            valid_until: invalid.valid_until,
          }),
        }),
      ),
      'cursor-agent-cli',
    );
    assert.equal(headless.model.state, 'unknown', invalid.name);
    assert.equal(headless.quota.state, 'unknown', invalid.name);
    assert.equal(headless.eligibility.automatic, false, invalid.name);
  }
});

test('bounded inventory projection is deterministic across adversarial path, version, and reasons', () => {
  const fixture = makeFixture([{ name: 'agent', authenticated: true }]);
  const surfaces = structuredClone(inspectCursorExecutionSurfaces(fixture.env, deps()));
  const headless = byId(surfaces, 'cursor-agent-cli');
  headless.binary.path = `/adversarial/${'p'.repeat(5_000)}`;
  headless.binary.version = `version-${'v'.repeat(5_000)}`;
  headless.binary.reason = `binary-${'b'.repeat(5_000)}`;
  headless.auth.reason = `auth-${'a'.repeat(5_000)}`;
  headless.model.reason = `model-${'m'.repeat(5_000)}`;
  headless.quota.reason = `quota-${'q'.repeat(5_000)}`;
  headless.eligibility = { automatic: true, reason_codes: [] };

  const first = buildCursorSurfaceInventory(surfaces);
  const second = buildCursorSurfaceInventory(surfaces);

  assert.deepEqual(second, first);
  assert.equal(Buffer.byteLength(JSON.stringify(first), 'utf8') <= 4_096, true);
  assert.equal(first.truncation.applied, true);
  assert.equal(first.truncation.max_bytes, 4_096);
  assert.ok(first.truncation.fields.includes('cursor-agent-cli.binary.path'));
  assert.ok(first.truncation.fields.includes('cursor-agent-cli.binary.version'));
  assert.ok(first.truncation.fields.includes('cursor-agent-cli.binary.reason'));
  assert.ok(first.truncation.fields.includes('cursor-agent-cli.auth.reason'));
  assert.ok(first.truncation.fields.includes('cursor-agent-cli.model.reason'));
  assert.ok(first.truncation.fields.includes('cursor-agent-cli.quota.reason'));
  assert.deepEqual(first.eligible_surface_ids, []);
  const projectedHeadless = byId(first.surfaces, 'cursor-agent-cli');
  assert.equal(projectedHeadless.eligibility.automatic, false);
  assert.ok(projectedHeadless.eligibility.reason_codes.includes('contract-invalid'));
  assert.equal(projectedHeadless.negative_capabilities.account_switch, 'forbidden');
  assert.equal(projectedHeadless.negative_capabilities.credential_mutation, 'forbidden');
});

test('probe is account-mutation closed: exact read-only argv, no credential forwarding, and isolated HOME unchanged', () => {
  const fixture = makeFixture([{ name: 'agent', authenticated: true }]);
  const before = snapshotTree(fixture.home);

  const surfaces = inspectCursorExecutionSurfaces(fixture.env, deps());
  assert.deepEqual(snapshotTree(fixture.home), before);
  assert.deepEqual(byId(surfaces, 'cursor-agent-cli').negative_capabilities, {
    automatic_login: 'forbidden',
    automatic_logout: 'forbidden',
    account_switch: 'forbidden',
    credential_mutation: 'forbidden',
    credential_import: 'forbidden',
    credential_copy: 'forbidden',
    quota_pool_inference: 'forbidden',
    external_write: 'unknown',
    nested_orchestration: 'unknown',
    network_access: 'unknown',
    mcp_access: 'unknown',
  });

  const calls = readFileSync(fixture.invocationLog, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { argv: string[]; credentialEnvPresent: boolean });
  assert.ok(calls.length > 0);
  const allowed = new Set([
    JSON.stringify(['--version']),
    JSON.stringify(['--help']),
    JSON.stringify(['status', '--help']),
    JSON.stringify(['status', '--format', 'json']),
  ]);
  for (const call of calls) {
    assert.equal(allowed.has(JSON.stringify(call.argv)), true, call.argv.join(' '));
    assert.equal(call.credentialEnvPresent, false, 'CURSOR_API_KEY must not be copied to probe');
  }
});

function snapshotTree(root: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const walk = (dir: string, relative: string) => {
    for (const name of readdirSync(dir).sort()) {
      const absolute = join(dir, name);
      const path = relative ? join(relative, name) : name;
      const stat = lstatSync(absolute);
      if (stat.isDirectory()) {
        result[path] = { kind: 'directory', mode: stat.mode };
        walk(absolute, path);
      } else if (stat.isSymbolicLink()) {
        result[path] = { kind: 'symlink', target: readlinkSync(absolute) };
      } else {
        result[path] = {
          kind: 'file',
          mode: stat.mode,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          content: readFileSync(absolute, 'base64'),
        };
      }
    }
  };
  walk(root, '');
  return result;
}

test('cursorAgentQuotaReadingToFact binds a live billing-period reading to a bounded quota fact', async () => {
  const { cursorAgentQuotaReadingToFact } = await import('../src/harnesses/cursor-surfaces.js');
  const observedAt = '2026-07-13T04:00:00.000Z';
  const fact = cursorAgentQuotaReadingToFact(
    {
      state: 'ample',
      used_percentage: 22.5,
      resets_at: 1_785_398_752,
      quota_scope_fingerprint: 'sha256:deadbeef',
      source: 'cursor-agent-dashboard',
    },
    observedAt,
  );
  assert.equal(fact.state, 'ample');
  assert.equal(fact.source, 'cursor-agent-dashboard');
  assert.deepEqual(fact.pool_refs, ['sha256:deadbeef']);
  assert.equal(fact.observed_at, observedAt);
  assert.ok(fact.valid_until);
  const window = Date.parse(fact.valid_until as string) - Date.parse(observedAt);
  assert.ok(window > 0 && window <= 5 * 60 * 1000, 'valid_until within the 5-minute quota TTL');
});

test('cursorAgentQuotaReadingToFact fails closed to unknown without a quota-scope fingerprint', async () => {
  const { cursorAgentQuotaReadingToFact } = await import('../src/harnesses/cursor-surfaces.js');
  const observedAt = '2026-07-13T04:00:00.000Z';
  const noFingerprint = cursorAgentQuotaReadingToFact(
    {
      state: 'ample',
      used_percentage: 22.5,
      resets_at: null,
      quota_scope_fingerprint: null,
      source: 'cursor-agent-dashboard',
    },
    observedAt,
  );
  assert.equal(noFingerprint.state, 'unknown');
  assert.deepEqual(noFingerprint.pool_refs, []);
  assert.equal(noFingerprint.valid_until, null);

  const unreadable = cursorAgentQuotaReadingToFact(
    {
      state: 'unknown',
      used_percentage: null,
      resets_at: null,
      quota_scope_fingerprint: null,
      source: 'cursor-agent:quota-unavailable',
    },
    observedAt,
  );
  assert.equal(unreadable.state, 'unknown');
  assert.deepEqual(unreadable.pool_refs, []);
});

test('cursorQuotaReadingToSurfaceFact maps ample/tight to available and exhausted to unavailable', async () => {
  const { cursorQuotaReadingToSurfaceFact } = await import('../src/harnesses/cursor.js');
  const base = { used_percentage: null, resets_at: null, quota_scope_fingerprint: null };
  assert.deepEqual(
    cursorQuotaReadingToSurfaceFact({ ...base, state: 'ample', source: 'cursor-agent-dashboard' }),
    { state: 'available', source: 'cursor-agent-dashboard:ample' },
  );
  assert.deepEqual(
    cursorQuotaReadingToSurfaceFact({ ...base, state: 'tight', source: 'cursor-agent-dashboard' }),
    { state: 'available', source: 'cursor-agent-dashboard:tight' },
  );
  assert.deepEqual(
    cursorQuotaReadingToSurfaceFact({
      ...base,
      state: 'exhausted',
      source: 'cursor-agent-dashboard',
    }),
    { state: 'unavailable', source: 'cursor-agent-dashboard:exhausted' },
  );
  assert.deepEqual(
    cursorQuotaReadingToSurfaceFact({
      ...base,
      state: 'unknown',
      source: 'cursor-agent:quota-unavailable',
    }),
    { state: 'unknown', source: 'cursor-agent:quota-unavailable' },
  );
});
