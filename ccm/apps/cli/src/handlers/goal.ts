import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { type DeadlineView, lintBoard, readDeadline } from '@ccm/engine';
import * as discover from '../discover.js';
import * as io from '../io.js';
import * as mutations from '../mutations.js';
import * as render from '../render.js';
import { createDefaultRuntimeBackend } from '../runtime-supply-chain.js';
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

interface PinnedManagedDirectory {
  fd: number;
  lexicalPath: string;
  openedDev: number;
  openedIno: number;
}

function pinManagedDirectory(directory: string): PinnedManagedDirectory {
  const backend = createDefaultRuntimeBackend();
  backend.ensurePrivateDirectory(directory);
  const pathStat = lstatSync(directory);
  const fd = openSync(
    directory,
    constants.O_RDONLY | (constants.O_DIRECTORY || 0) | (constants.O_NOFOLLOW || 0),
  );
  try {
    const opened = fstatSync(fd);
    if (
      !opened.isDirectory() ||
      pathStat.isSymbolicLink() ||
      opened.dev !== pathStat.dev ||
      opened.ino !== pathStat.ino
    ) {
      fail('Goal Brief managed directory changed while being pinned');
    }
    return { fd, lexicalPath: directory, openedDev: opened.dev, openedIno: opened.ino };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function attestPinnedDirectory(pinned: PinnedManagedDirectory, realHome: string): void {
  const opened = fstatSync(pinned.fd);
  const pathStat = lstatSync(pinned.lexicalPath);
  if (
    !opened.isDirectory() ||
    pathStat.isSymbolicLink() ||
    opened.dev !== pinned.openedDev ||
    opened.ino !== pinned.openedIno ||
    pathStat.dev !== opened.dev ||
    pathStat.ino !== opened.ino
  ) {
    fail('Goal Brief managed directory authority changed during publish');
  }
  const realDirectory = realpathSync(pinned.lexicalPath);
  if (!contained(realHome, realDirectory)) {
    fail('Goal Brief managed directory resolves outside CC_MASTER_HOME');
  }
}

function pinnedChildPath(pinned: PinnedManagedDirectory, basename: string): string {
  if (process.platform === 'linux' && existsSync(`/proc/self/fd/${pinned.fd}`)) {
    return `/proc/self/fd/${pinned.fd}/${basename}`;
  }
  return path.join(pinned.lexicalPath, basename);
}

function readRegularNoFollow(filePath: string): Buffer {
  const fd = openSync(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) fail('Goal Brief immutable target is not a regular file');
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

function publishManagedBrief(
  pinned: PinnedManagedDirectory,
  realHome: string,
  targetName: string,
  bytes: Buffer,
  writeFileAtomicSync: (filePath: string, data: string) => void,
): void {
  const backend = createDefaultRuntimeBackend();
  const target = pinnedChildPath(pinned, targetName);
  attestPinnedDirectory(pinned, realHome);
  if (existsSync(target)) {
    const stat = lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      fail('Goal Brief immutable target already exists but is not a regular file');
    }
    if (!readRegularNoFollow(target).equals(bytes)) {
      fail('Goal Brief revision is immutable: target already exists with different bytes');
    }
    return;
  }

  const temp = pinnedChildPath(
    pinned,
    `.${targetName}.publish-${process.pid}-${Date.now().toString(36)}`,
  );
  try {
    writeFileAtomicSync(temp, bytes.toString('utf8'));
    attestPinnedDirectory(pinned, realHome);
    backend.publishUniqueFile(temp, target);
    try {
      fsyncSync(pinned.fd);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform !== 'darwin' || (code !== 'EINVAL' && code !== 'ENOTSUP')) throw error;
    }
    attestPinnedDirectory(pinned, realHome);
  } finally {
    try {
      unlinkSync(temp);
    } catch {
      // Publication normally removes the temp link; cleanup is best-effort and must not mask
      // the publish/attestation result.
    }
  }
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
  if (!/^[A-Za-z0-9._-]+$/.test(stem) || stem === '.' || stem === '..') {
    fail('board filename cannot form a safe Goal Brief path');
  }
  const ref = `goals/${stem}/r${String(input.revision).padStart(4, '0')}.goal.md`;
  const target = path.resolve(home, ref);
  if (!contained(home, target)) fail('Goal Brief target escapes CC_MASTER_HOME');

  if (!input.dryRun) {
    if (!existsSync(home)) mkdirSync(home, { mode: 0o700 });
    const realHome = realpathSync(home);
    const homeAuthority = pinManagedDirectory(realHome);
    let goalsAuthority: PinnedManagedDirectory | null = null;
    let revisionAuthority: PinnedManagedDirectory | null = null;
    try {
      const goalsDir = pinnedChildPath(homeAuthority, 'goals');
      goalsAuthority = pinManagedDirectory(goalsDir);
      const revisionDir = pinnedChildPath(goalsAuthority, stem);
      revisionAuthority = pinManagedDirectory(revisionDir);
      publishManagedBrief(
        revisionAuthority,
        realHome,
        path.basename(target),
        bytes,
        input.writeFileAtomicSync || io.writeFileAtomicSync,
      );
    } finally {
      if (revisionAuthority) closeSync(revisionAuthority.fd);
      if (goalsAuthority) closeSync(goalsAuthority.fd);
      closeSync(homeAuthority.fd);
    }
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

// ── ccm goal deadline <set|confirm|confirm-none|amend|show>（交付 DDL·issue #149·三级命令走 positional 分发）──
//   deadline verbs 嵌在 goal 下（deadline 是 goal_contract 约束）；positionals[0] 选子动作（同 coordination inbox 先例）。
function deadlineWriteArgs(ctx: Ctx) {
  const s = (k: string): string | undefined =>
    typeof ctx.values[k] === 'string' ? (ctx.values[k] as string) : undefined;
  return {
    at: s('at'),
    precision: s('precision'),
    assurance: s('assurance'),
    kind: s('kind'),
    provenanceRaw: s('provenance-raw'),
    source: s('source'),
    tzInput: s('tz-input'),
    reason: s('reason'),
    userAuthorized: ctx.values['user-authorized'] === true,
  };
}

function renderDeadlineWrite(board: BoardArg, ctx: Ctx, dryRun: boolean): string {
  const block = deadlineBlock(board);
  if (ctx.flags.json) return render.jsonString({ deadline: block, dry_run: dryRun });
  const prefix = dryRun ? '[dry-run] ' : '';
  return `${prefix}delivery deadline r${block.rev ?? '?'} state=${block.state}${block.at ? ` at ${block.at}` : ''}`;
}

function deadlineShow(ctx: Ctx): number {
  const found = resolve(ctx);
  const block = deadlineBlock(found.board);
  const dl = readDeadline(found.board);
  const remainingHours =
    dl.at_ms !== null ? Math.round(((dl.at_ms - Date.now()) / 3600000) * 10) / 10 : null;
  ctx.out(
    ctx.flags.json
      ? render.jsonString({ ...block, time_remaining_hours: remainingHours })
      : [
          `deadline state: ${block.state}${block.present ? '' : ' (未询问)'}`,
          `at: ${block.at || '(none)'}`,
          `precision: ${block.precision} · kind: ${block.kind} · rev: ${block.rev ?? '(none)'}`,
          `time remaining: ${remainingHours === null ? '(n/a)' : `${remainingHours}h`}`,
        ].join('\n'),
  );
  return io.EXIT.OK;
}

export function deadline(ctx: Ctx): number {
  const action = String(ctx.positionals[0] || '');
  switch (action) {
    case 'set':
      return runWrite(ctx, {
        mutate: (board) => mutations.deadlineSet(board as BoardArg, deadlineWriteArgs(ctx)),
        render: (board, c, { dryRun }) => renderDeadlineWrite(board as BoardArg, c, dryRun),
      });
    case 'confirm':
      return runWrite(ctx, {
        mutate: (board) =>
          mutations.deadlineConfirm(board as BoardArg, {
            userAuthorized: ctx.values['user-authorized'] === true,
          }),
        render: (board, c, { dryRun }) => renderDeadlineWrite(board as BoardArg, c, dryRun),
      });
    case 'confirm-none':
      return runWrite(ctx, {
        mutate: (board) =>
          mutations.deadlineConfirmNone(board as BoardArg, {
            userAuthorized: ctx.values['user-authorized'] === true,
          }),
        render: (board, c, { dryRun }) => renderDeadlineWrite(board as BoardArg, c, dryRun),
      });
    case 'amend':
      return runWrite(ctx, {
        mutate: (board) => mutations.deadlineAmend(board as BoardArg, deadlineWriteArgs(ctx)),
        render: (board, c, { dryRun }) => renderDeadlineWrite(board as BoardArg, c, dryRun),
      });
    case 'show':
      return deadlineShow(ctx);
    default:
      fail(
        'goal deadline requires a subcommand: set | confirm | confirm-none | amend | show',
        'Usage',
      );
  }
}

// deadline 子块（供 agent / viewer 读·goal check --json 稳定 schema 的一部分）。
interface DeadlineCheckBlock {
  present: boolean;
  state: DeadlineView['state'];
  at: string | null;
  precision: 'minute' | 'day';
  kind: 'hard' | 'soft';
  rev: number | null;
  settled: boolean;
}

interface GoalCheckResult {
  schema: typeof GOAL_CHECK_SCHEMA;
  // deadline_pending（issue #149）：goal 语义 settled（assurance ∈ asserted/confirmed）但交付 DDL 未 settle
  //   （键缺失或 state==pending）——exit 0·与 pending 同档·在 agent 层门控 dispatch，非 exit 3 结构损坏。
  verdict:
    | 'legacy'
    | 'pending'
    | 'deadline_pending'
    | 'ok'
    | 'malformed'
    | 'missing_brief'
    | 'hash_mismatch';
  reason: string;
  board_path: string;
  summary: string;
  revision: number | null;
  assurance: string | null;
  brief_ref: string | null;
  brief_path: string | null;
  deadline: DeadlineCheckBlock;
}

function deadlineBlock(board: BoardArg): DeadlineCheckBlock {
  const dl = readDeadline(board);
  return {
    present: dl.present,
    state: dl.state,
    at: dl.at,
    precision: dl.precision,
    kind: dl.kind,
    rev: dl.rev,
    settled: dl.settled,
  };
}

// settledVerdict：goal 语义 settled 后，再看交付 DDL——DDL 也 settle → ok；未 settle → deadline_pending（exit 0）。
//   issue #149 §2.4：`ok` 收紧为「goal settled 且 deadline settled」；`none`（确认无 DDL）算 settle。
function settledVerdict(dl: DeadlineView): { verdict: 'ok' | 'deadline_pending'; reason: string } {
  if (dl.gating) {
    return {
      verdict: 'deadline_pending',
      reason: dl.present
        ? 'Goal Contract settled but delivery deadline still pending; confirm the deadline or confirm no-DDL before dispatch'
        : 'Goal Contract settled but delivery deadline not yet asked; set/confirm a deadline or confirm no-DDL before dispatch',
    };
  }
  return { verdict: 'ok', reason: 'Goal Contract and delivery deadline are settled' };
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
    deadline: deadlineBlock(board),
  };
  const contract = board.goal_contract;
  if (contract === undefined) {
    return { ...base, verdict: 'legacy', reason: 'board has no Goal Contract' };
  }
  const lint = lintBoard(JSON.stringify(board));
  if (
    lint.errors.some((entry) => entry.rule === 'FMT-GOAL-CONTRACT' || entry.rule === 'FMT-DEADLINE')
  ) {
    return {
      ...base,
      verdict: 'malformed',
      reason: 'goal_contract (or its deadline) failed schema validation',
    };
  }
  const deadlineView = readDeadline(board);
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
    return { ...withBrief, ...settledVerdict(deadlineView) };
  }
  if (assurance === 'pending') {
    return {
      ...common,
      verdict: 'pending',
      reason: 'Goal Contract still needs clarification/confirmation',
    };
  }
  return { ...common, ...settledVerdict(deadlineView) };
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
