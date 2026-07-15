import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lintBoard } from '../dist/index.mjs';

function board(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 'cc-master/v2',
    meta: { template_version: 3 },
    goal: '交付可验收的 Goal Contract 生命周期',
    owner: { active: true, session_id: 'sid', heartbeat: '2026-07-15T10:00:00Z' },
    git: { worktree: '', branch: '' },
    scheduling: { wip_limit: 4 },
    tasks: [],
    log: [],
    ...extra,
  };
}

test('GC-09: malformed goal_contract is a hard FMT-GOAL-CONTRACT violation', () => {
  const result = lintBoard(
    JSON.stringify(
      board({
        goal_contract: {
          schema: 'wrong',
          revision: 0,
          assurance: 'maybe',
          updated_at: 'today',
        },
      }),
    ),
  );
  const finding = result.errors.find((v) => v.rule === 'FMT-GOAL-CONTRACT');
  assert.ok(finding, 'malformed observed contract must be reported');
});

test('GC-09: pending contract with executable work emits BIZ-GOAL-PENDING', () => {
  const result = lintBoard(
    JSON.stringify(
      board({
        goal_contract: {
          schema: 'ccm/goal-contract/v1',
          revision: 1,
          assurance: 'pending',
          updated_at: '2026-07-15T10:00:00Z',
        },
        tasks: [
          {
            id: 'T1',
            title: 'premature implementation',
            type: 'design',
            executor: 'subagent',
            status: 'ready',
            deps: [],
            acceptance: 'done',
          },
        ],
      }),
    ),
  );
  const finding = result.warnings.find((v) => v.rule === 'BIZ-GOAL-PENDING');
  assert.ok(finding, 'pending goal must surface premature executable work');
});

test('GC-09: a well-shaped asserted contract passes goal-contract format checks', () => {
  const result = lintBoard(
    JSON.stringify(
      board({
        goal_contract: {
          schema: 'ccm/goal-contract/v1',
          revision: 2,
          assurance: 'asserted',
          brief: {
            ref: 'goals/20260715-100000-42/r0002.goal.md',
            sha256: `sha256:${'a'.repeat(64)}`,
          },
          updated_at: '2026-07-15T10:00:00Z',
        },
      }),
    ),
  );
  assert.equal(
    [...result.errors, ...result.warnings].some((v) => v.rule === 'FMT-GOAL-CONTRACT'),
    false,
  );
});
