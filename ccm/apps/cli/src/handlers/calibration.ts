// handlers/calibration.ts — 显式副作用型 deadline forecast observed snapshot producer（#168.1）。
// `estimate deadline-risk` 保持纯只读；只有 `ccm calibration capture` 会写 home-level calibration store。

import {
  appendDeadlineSnapshot,
  bandsSignature,
  buildDeadlineSnapshot,
  DEFAULT_BANDS,
  snapshotStorePath,
  stableDeadlineBoardId,
} from '@ccm/engine';
import * as discover from '../discover.js';
import * as io from '../io.js';
import type { BoardArg, Ctx } from './_common.js';
import { deadlineRiskObservation } from './estimate.js';

const EXIT = io.EXIT;

export function capture(ctx: Ctx): number {
  const resolved = discover.resolveBoard({
    boardFlag: ctx.values.board as string,
    sid: ctx.sid,
    homeFlag: ctx.values.home as string,
    goalSubstr: ctx.values.goal as string,
    env: ctx.env,
  });
  const homeDir = discover.resolveHome({
    homeFlag: ctx.values.home as string,
    env: ctx.env,
  });
  const observation = deadlineRiskObservation(resolved.board as BoardArg, ctx);
  const snapshot = buildDeadlineSnapshot(observation.result, {
    boardId: stableDeadlineBoardId(resolved.boardPath),
    capturedAtMs: observation.capturedAtMs,
    backlog: observation.backlog,
    bandsSig: bandsSignature(DEFAULT_BANDS),
  });

  const hasDeadline = snapshot.deadline_at_ms != null;
  const captured =
    hasDeadline && !ctx.flags.dryRun ? appendDeadlineSnapshot(homeDir, snapshot) : false;
  const data = {
    captured,
    duplicate: hasDeadline && !ctx.flags.dryRun && !captured,
    dry_run: ctx.flags.dryRun,
    skipped_reason: hasDeadline ? null : 'no-deadline',
    store_path: snapshotStorePath(homeDir),
    snapshot,
  };

  if (ctx.flags.json) {
    ctx.out(JSON.stringify({ ok: true, data }));
    return EXIT.OK;
  }
  if (!hasDeadline) {
    ctx.out('calibration capture: skipped（board 无可校准 deadline）\n');
  } else if (ctx.flags.dryRun) {
    ctx.out(`calibration capture: dry-run（${snapshot.snapshot_id}）\n`);
  } else if (captured) {
    ctx.out(`calibration capture: captured ${snapshot.snapshot_id}\n`);
  } else {
    ctx.out(`calibration capture: duplicate ${snapshot.snapshot_id}（未重复计数）\n`);
  }
  return EXIT.OK;
}
