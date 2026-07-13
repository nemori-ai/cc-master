import {
  ATTEMPT_WRITE_SET_REQUEST,
  compileAttemptWriteSet,
  isWorktreeWriteLease,
} from '@ccm/engine';
import { buildWriteSetRequest } from '../attempt-write-set.js';
import * as io from '../io.js';
import type { Ctx } from './_common.js';

const EXIT = io.EXIT;

interface KindedError extends Error {
  errKind?: string;
  violations?: unknown[];
}

function usage(message: string): never {
  const error = new Error(message) as KindedError;
  error.errKind = 'Usage';
  throw error;
}

function validation(message: string, violations: unknown[]): never {
  const error = new Error(message) as KindedError;
  error.errKind = 'Validation';
  error.violations = violations;
  throw error;
}

function stringValues(value: unknown): string[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).map(String);
}

export function writeSet(ctx: Ctx): number {
  const raw = io.readInputSpec(String(ctx.values.lease), { stdin: ctx.stdin });
  let lease: unknown;
  try {
    lease = JSON.parse(raw);
  } catch {
    return usage('--lease must contain valid JSON or use @<file> / -');
  }
  const profile = String(ctx.values.profile);
  const plan = isWorktreeWriteLease(lease)
    ? compileAttemptWriteSet(
        buildWriteSetRequest({
          lease,
          profile,
          artifactRootsRw: stringValues(ctx.values['artifact-root']),
          artifactRootsRo: stringValues(ctx.values['artifact-root-ro']),
        }),
      )
    : compileAttemptWriteSet({
        schema: ATTEMPT_WRITE_SET_REQUEST,
        profile,
        lease,
        git_layout: { kind: 'unknown', resolution: 'not-a-worktree' },
        declared_artifact_roots: [],
        writability: [],
      });
  if (!plan.ok) validation('managed attempt write-set preflight refused', [...plan.issues]);
  ctx.out(
    ctx.flags.json
      ? io.jsonOk(plan)
      : `WRITE-SET PREFLIGHT OK (${plan.profile_plan.id})\n${plan.authorized.map((root) => `  ${root.mode} ${root.path}`).join('\n')}\nlaunch_ready=false (${plan.integration_status})`,
  );
  return EXIT.OK;
}
