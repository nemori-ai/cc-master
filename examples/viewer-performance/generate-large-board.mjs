#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_PATH = join(HERE, 'large-board.board.json');

const TASKS_PER_EPIC = 17;
const EPIC_COUNT = 12;
const START_MS = Date.parse('2026-07-08T09:00:00Z');

function iso(offsetMinutes) {
  return new Date(START_MS + offsetMinutes * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function sha(input) {
  return `sha256:${createHash('sha256').update(input).digest('hex')}`;
}

function idFor(epic, n) {
  return `E${String(epic).padStart(2, '0')}.${String(n).padStart(2, '0')}`;
}

function refs(epic) {
  return [
    { kind: 'spec', ref: `/fixtures/viewer-performance/specs/epic-${String(epic).padStart(2, '0')}.md` },
    { kind: 'plan', ref: `/fixtures/viewer-performance/plans/epic-${String(epic).padStart(2, '0')}.md` },
  ];
}

function acceptance(id, status = 'pending') {
  return {
    criteria: [
      {
        desc: `${id} endpoint behavior is verified against the viewer-performance synthetic plan`,
        kind: status === 'met' ? 'test' : 'review',
        status,
      },
    ],
  };
}

function decisionPackage(id, epic) {
  return {
    prepared_at: iso(35 + epic),
    inputs_hash: sha(`${id}:viewer-performance:${epic}`),
    freshness: 'fresh',
    ask_type: 'decision',
    context_md: `The synthetic viewer-performance board has reached epic ${epic}. This gate models a user-owned sequencing decision that keeps large-board awaiting-user rendering realistic.`,
    question: `For ${id}, should the next epic prioritize breadth-first parallel cleanup or the critical-path integration slice?`,
    what_i_need: 'Choose one option so downstream blocked nodes can be re-sequenced.',
    why_it_matters: 'The choice changes which ready work becomes dispatchable first and gives the viewer several realistic user-gated nodes to render.',
    options: [
      {
        id: 'opt-critical-path',
        label: 'Critical path first',
        rationale: 'Shortens the longest dependency chain before expanding parallel cleanup.',
        tradeoffs: 'Improves makespan; leaves some fill work for later.',
      },
      {
        id: 'opt-breadth-first',
        label: 'Breadth first',
        rationale: 'Keeps more agents busy across independent branches.',
        tradeoffs: 'Improves utilization; may not shorten the critical path immediately.',
      },
    ],
    enter_cmd: `/cc-master:discuss ${id} --board large-board`,
  };
}

function doneFields(id, offset) {
  return {
    artifact: `commit viewer-perf-${id.toLowerCase().replaceAll('.', '-')}`,
    verified: true,
    created_at: iso(offset),
    started_at: iso(offset + 4),
    finished_at: iso(offset + 52),
  };
}

function baseTask(id, status, deps, extra = {}) {
  return {
    id,
    status,
    deps,
    type: extra.type || 'development',
    executor: extra.executor || 'subagent',
    estimate: extra.estimate || { value: 1, unit: 'h' },
    acceptance: extra.acceptance || acceptance(id, status === 'done' ? 'met' : 'pending'),
    references: extra.references || refs(extra.epic || 0),
    ...extra,
  };
}

function makeEpicOwner(epic, status, deps, extra = {}) {
  const id = `E${String(epic).padStart(2, '0')}`;
  const offset = epic * 120;
  const task = baseTask(id, status, deps, {
    epic,
    title: `Epic ${epic}: viewer v2 performance slice`,
    type: 'planning',
    executor: 'master-orchestrator',
    references: undefined,
    acceptance: `Epic ${epic} child slice is reconciled and visible in the large-board viewer fixture`,
    created_at: iso(offset),
    ...extra,
  });
  if (status === 'done') Object.assign(task, doneFields(id, offset));
  if (status === 'in_flight') task.started_at = iso(offset + 4);
  return task;
}

function taskStatus(epic, n) {
  if (epic <= 5) return 'done';
  if (epic === 6) {
    if (n <= 5) return 'done';
    if (n <= 8) return 'in_flight';
    if (n <= 12) return 'ready';
    return 'blocked';
  }
  if (epic === 7) return n <= 4 ? 'in_flight' : 'blocked';
  if (epic === 8) return n <= 3 ? 'uncertain' : 'blocked';
  if (epic === 9) return n <= 3 ? 'stale' : 'blocked';
  if (epic === 10) return n <= 2 ? 'failed' : 'blocked';
  return 'blocked';
}

function taskDeps(epic, n, status) {
  if (epic <= 5) {
    if (n === 1) return epic === 1 ? ['T000'] : [idFor(epic - 1, 12)];
    if (n <= 5) return [idFor(epic, n - 1)];
    if (n <= 12) return [idFor(epic, Math.max(1, n - 3))];
    return [idFor(epic, n - 1), idFor(epic, n - 6)];
  }
  if (epic === 6) {
    if (n <= 5) return [idFor(5, Math.min(12, n + 3))];
    if (n <= 8) return [idFor(6, n - 1)];
    if (n <= 12) return [idFor(6, 5)];
    return [`D${String(n - 12).padStart(2, '0')}`, idFor(6, 8)];
  }
  if (epic === 7) {
    if (n <= 4) return [idFor(6, 5)];
    return [idFor(6, 8), idFor(7, Math.max(1, n - 1))];
  }
  if (status === 'uncertain' || status === 'stale' || status === 'failed') return [idFor(6, 5)];
  return [idFor(epic - 1, TASKS_PER_EPIC), `D${String(((epic + n) % 6) + 1).padStart(2, '0')}`];
}

function makeChild(epic, n) {
  const id = idFor(epic, n);
  const status = taskStatus(epic, n);
  const offset = epic * 120 + n * 4;
  const task = baseTask(id, status, taskDeps(epic, n, status), {
    epic,
    parent: `E${String(epic).padStart(2, '0')}`,
    title: `Epic ${epic} task ${n}: ${status} synthetic viewer workload`,
    handle: status === 'in_flight' ? `bg-vperf-${epic}-${n}` : `bg-vperf-done-${epic}-${n}`,
    model: n % 3 === 0 ? 'sonnet' : 'haiku',
    created_at: iso(offset),
  });

  if (status === 'done') Object.assign(task, doneFields(id, offset));
  if (status === 'in_flight') task.started_at = iso(offset + 4);
  if (status === 'blocked') {
    const blocker = task.deps.find((dep) => dep.startsWith('D')) || task.deps[0];
    task.blocked_on = blocker;
  }
  if (status === 'stale') task.reason = 'Superseded by a newer integration probe but kept for stale-node rendering coverage.';
  if (status === 'failed') task.artifact = `log /tmp/viewer-performance/${id}.failure.log`;
  if (status === 'uncertain') task.artifact = `draft /tmp/viewer-performance/${id}.notes.md`;
  return task;
}

export function createLargeBoard() {
  const tasks = [];
  tasks.push({
    id: 'T000',
    status: 'done',
    deps: [],
    type: 'planning',
    executor: 'master-orchestrator',
    title: 'Seed viewer v2 performance baseline plan',
    acceptance: 'Large-board performance fixture scope is accepted',
    estimate: { value: 1, unit: 'h' },
    ...doneFields('T000', 0),
  });

  for (let i = 1; i <= 6; i++) {
    const id = `D${String(i).padStart(2, '0')}`;
    tasks.push({
      id,
      status: 'blocked',
      deps: [i <= 3 ? idFor(5, 10 + i) : idFor(6, 5)],
      blocked_on: 'user',
      type: 'planning',
      executor: 'user',
      title: `Awaiting user decision ${i} for large-board routing`,
      acceptance: `User answers synthetic decision gate ${i}`,
      estimate: { value: 0.25, unit: 'h' },
      created_at: iso(30 + i),
      decision_package: decisionPackage(id, i + 5),
    });
  }

  for (let epic = 1; epic <= EPIC_COUNT; epic++) {
    const status = epic <= 5 ? 'done' : epic <= 7 ? 'in_flight' : 'blocked';
    const ownerDeps =
      epic === 1 ? ['T000'] : epic <= 6 ? [idFor(epic - 1, 12)] : [idFor(6, 8)];
    const ownerExtra = status === 'blocked' ? { blocked_on: ownerDeps[0] } : {};
    tasks.push(makeEpicOwner(epic, status, ownerDeps, ownerExtra));
    for (let n = 1; n <= TASKS_PER_EPIC; n++) tasks.push(makeChild(epic, n));
  }

  tasks.push({
    id: 'Z999',
    status: 'blocked',
    deps: ['D01', 'D02', 'D03', idFor(12, TASKS_PER_EPIC)],
    blocked_on: 'D01',
    type: 'acceptance',
    executor: 'master-orchestrator',
    title: 'Final large-board endpoint validation',
    acceptance: 'All viewer v2 baseline paths remain responsive on the 200+ node board',
    estimate: { value: 1.5, unit: 'h' },
    created_at: iso(1800),
  });

  assert.equal(tasks.length, 224);
  return {
    schema: 'cc-master/v2',
    meta: {
      template_version: 3,
      created_at: '2026-07-08T09:00:00Z',
      fixture: 'viewer-performance-large-board',
      generated_by: 'examples/viewer-performance/generate-large-board.mjs',
      task_count: tasks.length,
    },
    goal: 'Synthetic 200+ node board for viewer v2 performance baseline smoke tests',
    owner: { active: true, session_id: 'viewer-performance-fixture', heartbeat: '2026-07-08T12:00:00Z' },
    git: { worktree: '/repo/.worktrees/viewer-performance', branch: 'fixture/viewer-performance' },
    scheduling: { wip_limit: 6, owner_wip_limit: 2 },
    tasks,
    judgment_calls: [
      {
        id: 'J-PERF-1',
        summary: 'Use a synthetic fixture instead of copying a real dogfood board',
        category: 'architecture',
        decision: 'Generate a deterministic public-safe board with realistic graph pressure.',
        rationale: 'The fixture needs scale and awaiting-user coverage without leaking project-specific data.',
        impact: 'Viewer v2 can use a stable baseline while avoiding provenance risk.',
        severity: 'medium',
        status: 'pending_review',
        raised_at: '2026-07-08T09:10:00Z',
      },
    ],
    watchdog: null,
    log: [
      { ts: '2026-07-08T09:00:00Z', kind: 'note', summary: 'Generated viewer-performance large-board fixture.' },
      { ts: '2026-07-08T09:05:00Z', kind: 'dispatch', summary: 'Synthetic completed epics model historical throughput.' },
      { ts: '2026-07-08T09:10:00Z', kind: 'decision', summary: 'Six awaiting-user decision gates added for viewer rendering coverage.' },
    ],
  };
}

export function fixtureText() {
  return `${JSON.stringify(createLargeBoard(), null, 2)}\n`;
}

function usage() {
  return [
    'usage:',
    '  node examples/viewer-performance/generate-large-board.mjs --stdout',
    '  node examples/viewer-performance/generate-large-board.mjs --write',
    '  node examples/viewer-performance/generate-large-board.mjs --check',
  ].join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2] || '--stdout';
  const text = fixtureText();
  if (arg === '--stdout') {
    process.stdout.write(text);
  } else if (arg === '--write') {
    writeFileSync(FIXTURE_PATH, text);
    console.log(`wrote ${FIXTURE_PATH}`);
  } else if (arg === '--check') {
    let current = '';
    try {
      current = readFileSync(FIXTURE_PATH, 'utf8');
    } catch (err) {
      console.error(`fixture missing: ${FIXTURE_PATH}`);
      process.exit(1);
    }
    if (current !== text) {
      console.error(`fixture is out of sync with generator: ${FIXTURE_PATH}`);
      process.exit(1);
    }
    console.log(`fixture is in sync: ${FIXTURE_PATH}`);
  } else {
    console.error(usage());
    process.exit(2);
  }
}
