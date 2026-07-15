import { createHash } from 'node:crypto';
import { dependencyQualified, isISOUTC } from '@ccm/engine';
import { resolveDeliveryFacts } from '../delivery-proof.js';
import * as io from '../io.js';
import * as mutations from '../mutations.js';
import { type BoardArg, type Ctx, runRead, runWrite } from './_common.js';

interface KindedError extends Error {
  errKind?: string;
  violations?: unknown[];
}

function error(message: string, kind: string): never {
  const value = new Error(message) as KindedError;
  value.errKind = kind;
  throw value;
}

function requirement(ctx: Ctx): Record<string, unknown> {
  const level = String(ctx.values.level ?? '');
  const target = ctx.values.target;
  if (level === 'candidate') {
    if (target !== undefined)
      error('FMT-DEPENDENCY-REQUIREMENTS: candidate requirement cannot name a target', 'Usage');
    return { level };
  }
  if (level === 'delivered' && typeof target === 'string' && target) return { level, target };
  return error('FMT-DEPENDENCY-REQUIREMENTS: delivered requirement requires --target', 'Usage');
}

function output(data: unknown, ctx: Ctx, human: string): string {
  return ctx.flags.json ? io.jsonOk(data) : human;
}

export function require(ctx: Ctx): number {
  const downstream = ctx.positionals[0] as string;
  const upstream = ctx.positionals[1] as string;
  const value = requirement(ctx);
  return runWrite(ctx, {
    mutate: (board) =>
      mutations.setDependencyRequirement(board as BoardArg, downstream, upstream, value),
    render: (_next, c, { dryRun }) =>
      output(
        { downstream, dependency: upstream, requirement: value, dry_run: dryRun },
        c,
        `${dryRun ? '[dry-run] ' : ''}dependency ${downstream} <- ${upstream}: level=${value.level}${value.target ? ` target=${value.target}` : ''}`,
      ),
  });
}

export function defaultRequirement(ctx: Ctx): number {
  const downstream = ctx.positionals[0] as string;
  const value = requirement(ctx);
  return runWrite(ctx, {
    mutate: (board) => mutations.setDependencyDefault(board as BoardArg, downstream, value),
    render: (_next, c, { dryRun }) =>
      output(
        { downstream, dependency: '*', requirement: value, dry_run: dryRun },
        c,
        `${dryRun ? '[dry-run] ' : ''}dependency ${downstream} <- *: level=${value.level}${value.target ? ` target=${value.target}` : ''}`,
      ),
  });
}

export function explain(ctx: Ctx): number {
  const downstream = ctx.positionals[0] as string;
  const upstream = ctx.positionals[1] as string;
  return runRead(ctx, {
    compute: (raw) => {
      const board = raw as BoardArg;
      const facts = {
        ...resolveDeliveryFacts(board),
        strict_preview: Boolean(ctx.values['strict-dry-run']),
      };
      return dependencyQualified(board, downstream, upstream, facts);
    },
    render: (value, c) => {
      const q = value as any;
      const codes = q.reasons.map((reason: any) => reason.code).join(',') || 'none';
      return output(
        q,
        c,
        `dependency ${downstream} <- ${upstream}: state=${q.state} basis=${q.basis} target_delivered=${String(q.target_delivered ?? false)} qualified_by=${q.qualified_by ?? 'none'} diagnostics=${codes}`,
      );
    },
  });
}

export function waive(ctx: Ctx): number {
  if (ctx.values['user-authorized'] !== true) {
    error('DELIVERY_WAIVER_AUTHORITY: --user-authorized is required', 'Authorization');
  }
  const downstream = ctx.positionals[0] as string;
  const upstream = ctx.positionals[1] as string;
  const target = String(ctx.values.target);
  const reason = String(ctx.values.reason ?? '').trim();
  const expiresAt = String(ctx.values['expires-at'] ?? '');
  const authorizedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  if (!reason || !isISOUTC(expiresAt) || Date.parse(expiresAt) <= Date.parse(authorizedAt)) {
    error(
      'DELIVERY_WAIVER_MALFORMED: reason and future strict-UTC --expires-at are required',
      'Usage',
    );
  }
  const body = {
    downstream,
    dependency: upstream,
    target,
    reason,
    authorized_at: authorizedAt,
    expires_at: expiresAt,
  };
  const waiver = {
    id: `W-${createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 20)}`,
    authorized_by: 'user',
    ...body,
  };
  return runWrite(ctx, {
    mutate: (board) =>
      mutations.setDependencyWaiver(board as BoardArg, downstream, upstream, waiver, {
        userAuthorized: true,
      }),
    render: (next, c, { dryRun }) => {
      const qualification = dependencyQualified(
        next as BoardArg,
        downstream,
        upstream,
        resolveDeliveryFacts(next as BoardArg),
      );
      return output(
        { waiver, qualification, dry_run: dryRun },
        c,
        `${dryRun ? '[dry-run] ' : ''}waiver ${waiver.id}: qualified_by=${qualification.qualified_by ?? 'none'} target_delivered=${String(qualification.target_delivered ?? false)} expires_at=${expiresAt}`,
      );
    },
  });
}
