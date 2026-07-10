import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import type { Ctx } from '../src/handlers/_common.js';
import * as boardHandler from '../src/handlers/board.js';
import * as taskHandler from '../src/handlers/task.js';
import * as io from '../src/io.js';

const EXIT = io.EXIT;
const TMP: string[] = [];

afterEach(() => {
  for (const path of TMP.splice(0)) rmSync(path, { recursive: true, force: true });
});

function boardFile(tasks: unknown[]): string {
  const root = mkdtempSync(join(tmpdir(), 'ccm-routing-contract-'));
  TMP.push(root);
  const home = join(root, 'boards');
  mkdirSync(home, { recursive: true });
  const path = join(home, 'contract.board.json');
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        schema: 'cc-master/v2',
        meta: { template_version: 3 },
        goal: 'routing contract handler test',
        owner: { active: true, session_id: 'sid-contract', heartbeat: '2026-07-10T08:00:00Z' },
        git: { worktree: '', branch: '' },
        tasks,
        log: [],
      },
      null,
      2,
    )}\n`,
  );
  return path;
}

type TestCtx = Ctx & { outBuf: string[]; errBuf: string[] };
function ctx(
  path: string,
  positionals: string[] = [],
  values: Record<string, unknown> = {},
  flags: Partial<Ctx['flags']> = {},
): TestCtx {
  const outBuf: string[] = [];
  const errBuf: string[] = [];
  return {
    values: { board: path, ...values },
    positionals,
    flags: {
      json: false,
      dryRun: false,
      force: false,
      yes: false,
      quiet: true,
      verbose: false,
      color: false,
      ...flags,
    },
    sid: 'sid-contract',
    env: {},
    out: (value: string) => outBuf.push(value),
    err: (value: string) => errBuf.push(value),
    outBuf,
    errBuf,
  };
}

function planning(): Record<string, unknown> {
  return {
    schema: 'ccm/task-planning/v1',
    assessed_at: '2026-07-10T08:00:00Z',
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
  };
}

function policy(): Record<string, unknown> {
  return {
    objective: 'balanced',
    constraints: {
      effect_floor: 'meets-required-capabilities',
      quota_unknown: 'ineligible',
      cross_harness_quota_admission: 'ample-only',
    },
    candidates: [
      {
        id: 'codex-cli',
        surface: 'cli-headless',
        adapter: 'codex-cli/headless-v1',
        harness: 'codex',
        provider: 'openai',
        model: 'gpt-future',
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
      },
    ],
    chains: { ample: ['codex-cli'], tight: ['codex-cli'] },
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
  };
}

function selection(): Record<string, unknown> {
  return {
    candidate_id: 'codex-cli',
    chain: 'ample',
    selected_at: '2026-07-10T08:01:00Z',
    evidence: {
      observed_at: '2026-07-10T08:00:30Z',
      valid_until: '2026-07-10T08:05:00Z',
      qualification_results: [
        { predicate: 'runtime-healthy', status: 'pass', ref: 'capability://codex/cli' },
        { predicate: 'capability-match', status: 'pass', ref: 'contract://capability' },
        { predicate: 'effect-floor', status: 'pass', ref: 'contract://effect' },
        { predicate: 'permission-compatible', status: 'pass', ref: 'contract://permission' },
        {
          predicate: 'account-mutation-forbidden',
          status: 'pass',
          ref: 'contract://account-mutation',
        },
      ],
    },
    reason_codes: ['capability-best-fit'],
    rationale: 'fixture route',
  };
}

function read(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('enable-contract preflight is read-only and reports active task gaps', () => {
  const path = boardFile([
    {
      id: 'T1',
      status: 'ready',
      deps: [],
      executor: 'subagent',
      estimate: { value: 1, unit: 'h' },
    },
  ]);
  const before = readFileSync(path, 'utf8');
  const call = ctx(path, [], { preflight: true }, { json: true });
  assert.equal(boardHandler.enableContract(call), EXIT.OK);
  const report = JSON.parse(call.outBuf.join('')).data;
  assert.equal(report.ready, false);
  assert.equal(report.tasks[0].task_id, 'T1');
  assert.equal(readFileSync(path, 'utf8'), before);
});

test('dedicated handlers prepare, activate, and bind a route without provider spawn', () => {
  const path = boardFile([
    {
      id: 'T1',
      status: 'ready',
      deps: [],
      executor: 'subagent',
      estimate: { value: 1, unit: 'h' },
    },
  ]);
  assert.equal(
    taskHandler.setPlanning(ctx(path, ['T1'], { profile: JSON.stringify(planning()) })),
    EXIT.OK,
  );
  assert.equal(
    taskHandler.setRouting(ctx(path, ['T1'], { policy: JSON.stringify(policy()) })),
    EXIT.OK,
  );
  assert.equal(boardHandler.enableContract(ctx(path)), EXIT.OK);

  const attempt = {
    id: 'A1',
    candidate_id: 'codex-cli',
    state: 'running',
    started_at: '2026-07-10T08:01:01Z',
    handle: 'run://codex/A1',
    requested: { model: 'gpt-future', effort: 'high' },
  };
  assert.equal(
    taskHandler.routeBind(
      ctx(path, ['T1'], {
        selection: JSON.stringify(selection()),
        attempt: JSON.stringify(attempt),
      }),
    ),
    EXIT.OK,
  );
  const task = read(path).tasks[0];
  assert.equal(task.status, 'in_flight');
  assert.equal(task.handle, 'run://codex/A1');
  assert.deepEqual(task.routing.attempts[0].selection_snapshot, selection());
});

test('force and generic setters cannot bypass route-bind or dedicated writer policy', () => {
  const path = boardFile([
    {
      id: 'T1',
      status: 'ready',
      deps: [],
      executor: 'subagent',
      estimate: { value: 1, unit: 'h' },
    },
  ]);
  taskHandler.setPlanning(ctx(path, ['T1'], { profile: JSON.stringify(planning()) }));
  taskHandler.setRouting(ctx(path, ['T1'], { policy: JSON.stringify(policy()) }));
  boardHandler.enableContract(ctx(path));

  assert.throws(
    () => taskHandler.start(ctx(path, ['T1'], {}, { force: true })),
    (error: any) => error.errKind === 'Validation' && /route-bind/.test(error.message),
  );
  assert.throws(
    () =>
      taskHandler.update(
        ctx(
          path,
          ['T1'],
          { 'set-json': [`planning=${JSON.stringify(planning())}`] },
          { force: true },
        ),
      ),
    (error: any) => error.errKind === 'Validation' && /dedicated/.test(error.message),
  );

  const before = readFileSync(path, 'utf8');
  assert.throws(
    () =>
      boardHandler.update(
        ctx(path, [], { 'set-json': ['meta={"template_version":3}'] }, { force: true }),
      ),
    (error: any) => error.errKind === 'Validation' && /dedicated/.test(error.message),
  );
  assert.throws(
    () =>
      boardHandler.update(ctx(path, [], { 'set-json': ['meta.contracts={}'] }, { force: true })),
    (error: any) => error.errKind === 'Validation' && /dedicated/.test(error.message),
  );
  assert.throws(
    () =>
      taskHandler.update(ctx(path, ['T1'], { executor: 'master-orchestrator' }, { force: true })),
    (error: any) => error.errKind === 'Validation' && /executor/.test(error.message),
  );
  assert.equal(readFileSync(path, 'utf8'), before, '--force attacks leave board bytes unchanged');
});
