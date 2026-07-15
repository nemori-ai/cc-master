import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { lintBoard } from '@ccm/engine';
import * as discover from '../discover.js';
import * as io from '../io.js';
import * as mutations from '../mutations.js';
import * as render from '../render.js';
import { type BoardArg, type Ctx, runWrite } from './_common.js';

const GOAL_CHECK_SCHEMA = 'ccm/goal-check/v1';
const MAX_BRIEF_BYTES = 1024 * 1024;

interface KindedError extends Error {
  errKind?: string;
}

function fail(message: string, errKind = 'Validation'): never {
  const error = new Error(message) as KindedError;
  error.errKind = errKind;
  throw error;
}

export interface ManagedBriefInput {
  sourcePath: string;
  home: string;
  boardPath: string;
  revision: number;
  dryRun?: boolean;
  writeFileAtomicSync?: (filePath: string, data: string) => void;
}

export interface ManagedBriefResult {
  ref: string;
  sha256: string;
  path: string;
}

function contained(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function boardStem(boardPath: string): string {
  const name = path.basename(boardPath);
  return name.endsWith('.board.json') ? name.slice(0, -'.board.json'.length) : name;
}

function digest(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function readBriefSource(sourcePath: string): Buffer {
  const absolute = path.resolve(sourcePath);
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink())
    fail('Goal Brief source must be a regular file, not a symlink', 'Usage');
  if (!stat.isFile()) fail('Goal Brief source must be a regular file', 'Usage');
  if (stat.size > MAX_BRIEF_BYTES) fail('Goal Brief exceeds the 1 MiB limit', 'Usage');
  const bytes = readFileSync(absolute);
  try {
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    fail('Goal Brief must be valid UTF-8', 'Usage');
  }
  return bytes;
}

export function prepareManagedBrief(input: ManagedBriefInput): ManagedBriefResult {
  if (!Number.isInteger(input.revision) || input.revision < 1 || input.revision > 9999) {
    fail('Goal Brief revision must be an integer in [1,9999]', 'Usage');
  }
  const bytes = readBriefSource(input.sourcePath);
  const home = path.resolve(input.home);
  const stem = boardStem(input.boardPath);
  if (!/^[A-Za-z0-9._-]+$/.test(stem)) fail('board filename cannot form a safe Goal Brief path');
  const ref = `goals/${stem}/r${String(input.revision).padStart(4, '0')}.goal.md`;
  const target = path.resolve(home, ref);
  if (!contained(home, target)) fail('Goal Brief target escapes CC_MASTER_HOME');

  if (!input.dryRun) {
    const directory = path.dirname(target);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    if (existsSync(target)) {
      const targetStat = lstatSync(target);
      if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
        fail('Goal Brief immutable target already exists but is not a regular file');
      }
      const existing = readFileSync(target);
      if (!existing.equals(bytes)) {
        fail('Goal Brief revision is immutable: target already exists with different bytes');
      }
    } else {
      (input.writeFileAtomicSync || io.writeFileAtomicSync)(target, bytes.toString('utf8'));
    }
    chmodSync(target, 0o600);

    // 防 parent symlink 把受管文件导出 home；文件存在后用真实路径再校验一次。
    const realHome = realpathSync(home);
    const realTarget = realpathSync(target);
    if (!contained(realHome, realTarget)) fail('Goal Brief target resolves outside CC_MASTER_HOME');
  }

  return { ref, sha256: digest(bytes), path: target };
}

function homeFor(ctx: Ctx): string {
  return discover.resolveHome({
    homeFlag: typeof ctx.values.home === 'string' ? ctx.values.home : undefined,
    env: ctx.env,
  });
}

function maybeBrief(
  ctx: Ctx,
  boardPath: string,
  revision: number,
): { ref: string; sha256: string } | undefined {
  const source = ctx.values['brief-file'];
  if (typeof source !== 'string' || source.trim() === '') return undefined;
  const result = prepareManagedBrief({
    sourcePath: source,
    home: homeFor(ctx),
    boardPath,
    revision,
    dryRun: ctx.flags.dryRun,
  });
  return { ref: result.ref, sha256: result.sha256 };
}

function lifecycleData(board: BoardArg, boardPath: string, home: string): Record<string, unknown> {
  const contract = board.goal_contract;
  const ref = contract && typeof contract === 'object' && contract.brief?.ref;
  return {
    board_path: boardPath,
    summary: typeof board.goal === 'string' ? board.goal : '',
    contract: contract ?? null,
    brief_path: typeof ref === 'string' ? path.resolve(home, ref) : null,
  };
}

export function set(ctx: Ctx): number {
  return runWrite(ctx, {
    mutate: (board, _ctx, { boardPath }) =>
      mutations.goalSet(board as BoardArg, {
        summary: String(ctx.values.summary || ''),
        assurance: ctx.values.assurance as 'pending' | 'asserted',
        brief: maybeBrief(ctx, boardPath, 1),
      }),
    render: (board, c, { dryRun, boardPath }) => {
      const data = lifecycleData(board as BoardArg, boardPath, homeFor(c));
      return c.flags.json
        ? render.jsonString({ ...data, dry_run: dryRun })
        : `${dryRun ? '[dry-run] ' : ''}Goal Contract r1 set (${(board as BoardArg).goal_contract.assurance})`;
    },
  });
}

export function confirm(ctx: Ctx): number {
  return runWrite(ctx, {
    mutate: (board) =>
      mutations.goalConfirm(board as BoardArg, {
        userAuthorized: ctx.values['user-authorized'] === true,
      }),
    render: (board, c, { dryRun, boardPath }) => {
      const data = lifecycleData(board as BoardArg, boardPath, homeFor(c));
      return c.flags.json
        ? render.jsonString({ ...data, dry_run: dryRun })
        : `${dryRun ? '[dry-run] ' : ''}Goal Contract r${(board as BoardArg).goal_contract.revision} confirmed`;
    },
  });
}

export function amend(ctx: Ctx): number {
  return runWrite(ctx, {
    mutate: (board, _ctx, { boardPath }) => {
      const current = (board as BoardArg).goal_contract;
      const revision = Number(current && current.revision) + 1;
      return mutations.goalAmend(board as BoardArg, {
        summary: String(ctx.values.summary || ''),
        reason: String(ctx.values.reason || ''),
        assurance: ctx.values.assurance as 'pending' | 'asserted',
        brief: maybeBrief(ctx, boardPath, revision),
      });
    },
    render: (board, c, { dryRun, boardPath }) => {
      const data = lifecycleData(board as BoardArg, boardPath, homeFor(c));
      return c.flags.json
        ? render.jsonString({ ...data, dry_run: dryRun })
        : `${dryRun ? '[dry-run] ' : ''}Goal Contract amended to r${(board as BoardArg).goal_contract.revision}`;
    },
  });
}

interface GoalCheckResult {
  schema: typeof GOAL_CHECK_SCHEMA;
  verdict: 'legacy' | 'pending' | 'ok' | 'malformed' | 'missing_brief' | 'hash_mismatch';
  reason: string;
  board_path: string;
  summary: string;
  revision: number | null;
  assurance: string | null;
  brief_ref: string | null;
  brief_path: string | null;
}

function inspectGoal(board: BoardArg, boardPath: string, home: string): GoalCheckResult {
  const base: Omit<GoalCheckResult, 'verdict' | 'reason'> = {
    schema: GOAL_CHECK_SCHEMA,
    board_path: boardPath,
    summary: typeof board.goal === 'string' ? board.goal : '',
    revision: null as number | null,
    assurance: null as string | null,
    brief_ref: null as string | null,
    brief_path: null as string | null,
  };
  const contract = board.goal_contract;
  if (contract === undefined) {
    return { ...base, verdict: 'legacy', reason: 'board has no Goal Contract' };
  }
  const lint = lintBoard(JSON.stringify(board));
  if (lint.errors.some((entry) => entry.rule === 'FMT-GOAL-CONTRACT')) {
    return { ...base, verdict: 'malformed', reason: 'goal_contract failed schema validation' };
  }
  const revision = Number(contract.revision);
  const assurance = String(contract.assurance);
  const common = { ...base, revision, assurance };
  if (contract.brief) {
    const ref = String(contract.brief.ref);
    const target = path.resolve(home, ref);
    const withBrief = { ...common, brief_ref: ref, brief_path: target };
    if (!contained(home, target)) {
      return { ...withBrief, verdict: 'malformed', reason: 'brief ref escapes CC_MASTER_HOME' };
    }
    try {
      const stat = lstatSync(target);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        return { ...withBrief, verdict: 'malformed', reason: 'brief target is not a regular file' };
      }
      const realHome = realpathSync(home);
      const realTarget = realpathSync(target);
      if (!contained(realHome, realTarget)) {
        return {
          ...withBrief,
          verdict: 'malformed',
          reason: 'brief target resolves outside CC_MASTER_HOME',
        };
      }
      if (digest(readFileSync(target)) !== contract.brief.sha256) {
        return {
          ...withBrief,
          verdict: 'hash_mismatch',
          reason: 'Goal Brief content hash differs from board',
        };
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return { ...withBrief, verdict: 'missing_brief', reason: 'Goal Brief file is missing' };
      }
      return {
        ...withBrief,
        verdict: 'malformed',
        reason: `cannot inspect Goal Brief: ${String(error)}`,
      };
    }
    if (assurance === 'pending') {
      return {
        ...withBrief,
        verdict: 'pending',
        reason: 'Goal Contract still needs clarification/confirmation',
      };
    }
    return { ...withBrief, verdict: 'ok', reason: 'Goal Contract and Brief integrity are valid' };
  }
  if (assurance === 'pending') {
    return {
      ...common,
      verdict: 'pending',
      reason: 'Goal Contract still needs clarification/confirmation',
    };
  }
  return { ...common, verdict: 'ok', reason: 'Goal Contract is valid (inline-simple, no Brief)' };
}

function resolve(ctx: Ctx): { boardPath: string; board: BoardArg; home: string } {
  const resolved = discover.resolveBoard({
    boardFlag: typeof ctx.values.board === 'string' ? ctx.values.board : undefined,
    sid: ctx.sid,
    homeFlag: typeof ctx.values.home === 'string' ? ctx.values.home : undefined,
    goalSubstr: typeof ctx.values.goal === 'string' ? ctx.values.goal : undefined,
    env: ctx.env,
  });
  return { boardPath: resolved.boardPath, board: resolved.board as BoardArg, home: homeFor(ctx) };
}

export function show(ctx: Ctx): number {
  const found = resolve(ctx);
  const data = lifecycleData(found.board, found.boardPath, found.home);
  ctx.out(
    ctx.flags.json
      ? render.jsonString(data)
      : [
          `goal: ${String(data.summary || '(empty)')}`,
          `contract: ${data.contract ? JSON.stringify(data.contract) : 'legacy'}`,
          `brief: ${String(data.brief_path || '(none)')}`,
        ].join('\n'),
  );
  return io.EXIT.OK;
}

export function check(ctx: Ctx): number {
  const found = resolve(ctx);
  const result = inspectGoal(found.board, found.boardPath, found.home);
  ctx.out(
    ctx.flags.json
      ? render.jsonString(result)
      : `${result.verdict}: ${result.reason}${result.revision ? ` (r${result.revision}, ${result.assurance})` : ''}`,
  );
  return ['malformed', 'missing_brief', 'hash_mismatch'].includes(result.verdict)
    ? io.EXIT.VALIDATION
    : io.EXIT.OK;
}
