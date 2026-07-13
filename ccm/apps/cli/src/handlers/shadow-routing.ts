// handlers/shadow-routing.ts — explicit cached-only context and pure C1 route advice.
//
// This handler only reads the selected board and an explicit local JSON input. Provider discovery,
// network access, credential access, reservation, spawn, and board mutation are intentionally absent.

import { createHash } from 'node:crypto';
import {
  adviseShadowRoute,
  buildCachedOrchestratorContext,
  buildOriginContextContent,
  canonicalJson,
  ORCHESTRATOR_CONTEXT_MAX_BYTES,
  type OrchestratorContext,
  type ShadowRouteAdvice,
} from '@ccm/engine';
import * as discover from '../discover.js';
import * as io from '../io.js';
import type { BoardArg, Ctx } from './_common.js';

const EXIT = io.EXIT;

interface KindedError extends Error {
  errKind?: string;
  violations?: unknown[];
  issues?: unknown[];
}

interface OriginContextDelivery {
  schema: 'ccm/origin-context-delivery/v1';
  cached_only: true;
  shadow_only: true;
  dispatch_enabled: false;
  origin_harness: string;
  revisions: { board: string; machine: string };
  content_sha256: string;
  content_bytes: number;
  content: string;
}

export interface ShadowRoutingBoundary {
  resolveBoard: (ctx: Ctx) => { boardPath: string; board: unknown };
  readInputSpec: (spec: string, options: { stdin?: { fd?: number } }) => string;
  spawnProcess: (...args: unknown[]) => never;
  requestNetwork: (...args: unknown[]) => never;
  readCredential: (...args: unknown[]) => never;
  reserve: (...args: unknown[]) => never;
  writeAttempt: (...args: unknown[]) => never;
  writeBoard: (...args: unknown[]) => never;
  writeFile: (...args: unknown[]) => never;
}

function forbiddenEffect(kind: string): (...args: unknown[]) => never {
  return () => {
    throw new Error(`shadow routing forbids ${kind}`);
  };
}

const DEFAULT_BOUNDARY: ShadowRoutingBoundary = {
  resolveBoard: (ctx) =>
    discover.resolveBoard({
      boardFlag: ctx.values.board as string,
      sid: ctx.sid,
      homeFlag: ctx.values.home as string,
      goalSubstr: ctx.values.goal as string,
      env: ctx.env,
    }),
  readInputSpec: (spec, options) => io.readInputSpec(spec, options),
  spawnProcess: forbiddenEffect('process spawn'),
  requestNetwork: forbiddenEffect('network request'),
  readCredential: forbiddenEffect('credential access'),
  reserve: forbiddenEffect('reservation'),
  writeAttempt: forbiddenEffect('attempt write'),
  writeBoard: forbiddenEffect('board write'),
  writeFile: forbiddenEffect('filesystem write'),
};

function error(kind: 'Usage' | 'Validation' | 'NotFound', message: string): KindedError {
  const value = new Error(message) as KindedError;
  value.errKind = kind;
  return value;
}

function parseJsonInput(
  value: unknown,
  flag: string,
  ctx: Ctx,
  boundary: ShadowRoutingBoundary,
): unknown {
  if (typeof value !== 'string' || value.trim() === '') {
    throw error('Usage', `${flag} requires JSON, @file, or -`);
  }
  const source = boundary.readInputSpec(value, { stdin: ctx.stdin });
  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === 'object' && parsed.ok === true && 'data' in parsed
      ? parsed.data
      : parsed;
  } catch (cause) {
    throw error(
      'Validation',
      `${flag} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

function boardRevision(board: BoardArg): string {
  return `sha256:${createHash('sha256').update(canonicalJson(board)).digest('hex')}`;
}

function unavailableContext(
  originHarness: string,
  revision: string,
  asOf: string,
  warning: string,
): OrchestratorContext {
  return {
    schema: 'ccm/orchestrator-context/v1',
    cached_only: true,
    available: false,
    origin_harness: originHarness,
    revisions: { board: revision, machine: 'unknown' },
    freshness: {
      state: 'unknown',
      observed_at: asOf,
      valid_until: asOf,
      as_of: asOf,
    },
    candidates: [],
    warnings: [warning],
    truncation: {
      applied: false,
      omitted_candidates: 0,
      omitted_warnings: 0,
      shortened_fields: 0,
      max_bytes: ORCHESTRATOR_CONTEXT_MAX_BYTES,
    },
  };
}

function mapContractError(cause: unknown): never {
  if (cause instanceof Error && Array.isArray((cause as KindedError).issues)) {
    const mapped = error('Validation', cause.message);
    mapped.violations = (cause as KindedError).issues;
    throw mapped;
  }
  throw cause;
}

function runBoundaryRead(
  ctx: Ctx,
  boundary: ShadowRoutingBoundary,
  compute: (board: unknown) => unknown,
  render: (result: unknown) => string,
): number {
  const resolved = boundary.resolveBoard(ctx);
  const result = compute(resolved.board);
  ctx.out(render(result));
  return EXIT.OK;
}

function contextWithBoundary(ctx: Ctx, boundary: ShadowRoutingBoundary): number {
  if (ctx.values['cached-only'] !== true) {
    throw error('Usage', 'orchestrator context requires --cached-only; no live fallback exists');
  }
  if (typeof ctx.values.harness !== 'string' || ctx.values.harness.trim() === '') {
    throw error('Usage', 'orchestrator context requires --harness');
  }
  return runBoundaryRead(
    ctx,
    boundary,
    (rawBoard) => {
      const board = rawBoard as BoardArg;
      const originHarness = String(ctx.values.harness || '');
      const revision = boardRevision(board);
      const asOf = String(ctx.values['as-of'] || '');
      let context: OrchestratorContext;
      if (typeof ctx.values.snapshot !== 'string' || ctx.values.snapshot.trim() === '') {
        context = unavailableContext(
          originHarness,
          revision,
          asOf,
          'machine-context-cache-missing',
        );
      } else {
        try {
          context = buildCachedOrchestratorContext({
            originHarness,
            boardRevision: revision,
            snapshot: parseJsonInput(ctx.values.snapshot, '--snapshot', ctx, boundary),
            asOf,
          });
        } catch {
          context = unavailableContext(
            originHarness,
            revision,
            asOf,
            'machine-context-cache-corrupt',
          );
        }
      }
      if (ctx.values['agent-visible'] !== true) return context;
      try {
        const projected = buildOriginContextContent({
          board,
          context,
          originHarness,
          boardRevision: revision,
          asOf,
        });
        const delivery: OriginContextDelivery = {
          schema: 'ccm/origin-context-delivery/v1',
          cached_only: true,
          shadow_only: true,
          dispatch_enabled: false,
          origin_harness: originHarness,
          revisions: projected.payload.revisions,
          content_sha256: `sha256:${createHash('sha256').update(projected.content).digest('hex')}`,
          content_bytes: projected.content_bytes,
          content: projected.content,
        };
        return delivery;
      } catch {
        throw error('Validation', 'cannot build bounded agent-visible context');
      }
    },
    (rawResult) => {
      const result = rawResult as OrchestratorContext | OriginContextDelivery;
      return ctx.flags.json
        ? io.jsonOk(result)
        : result.schema === 'ccm/origin-context-delivery/v1'
          ? `agent-visible context ${result.revisions.machine} · ${result.content_bytes} bytes · shadow-only`
          : `cached context ${result.revisions.machine} · ${result.freshness.state} · candidates=${result.candidates.length}`;
    },
  );
}

function adviseWithBoundary(ctx: Ctx, boundary: ShadowRoutingBoundary): number {
  const id = ctx.positionals[0];
  return runBoundaryRead(
    ctx,
    boundary,
    (rawBoard) => {
      const board = rawBoard as BoardArg;
      const task = board.tasks?.find((entry: unknown) => {
        return !!entry && typeof entry === 'object' && (entry as { id?: unknown }).id === id;
      });
      if (!task) throw error('NotFound', `task not found: ${id}`);
      try {
        return adviseShadowRoute({
          task,
          context: parseJsonInput(ctx.values.context, '--context', ctx, boundary),
          originHarness: String(ctx.values.origin || ''),
          boardRevision: boardRevision(board),
          asOf: String(ctx.values['as-of'] || ''),
        });
      } catch (cause) {
        mapContractError(cause);
      }
    },
    (rawResult) => {
      const result = rawResult as ShadowRouteAdvice;
      return ctx.flags.json
        ? io.jsonOk(result)
        : result.selected
          ? `${result.outcome}: ${result.selected.candidate_id} (shadow only; spawned=false)`
          : `no-route (shadow only; spawned=false): ${result.evaluations
              .flatMap((entry) => entry.reason_codes)
              .join(',')}`;
    },
  );
}

export function createShadowRoutingHandlers(boundary: ShadowRoutingBoundary): {
  context: (ctx: Ctx) => number;
  advise: (ctx: Ctx) => number;
} {
  return {
    context: (ctx) => contextWithBoundary(ctx, boundary),
    advise: (ctx) => adviseWithBoundary(ctx, boundary),
  };
}

const DEFAULT_HANDLERS = createShadowRoutingHandlers(DEFAULT_BOUNDARY);

export function context(ctx: Ctx): number {
  return DEFAULT_HANDLERS.context(ctx);
}

export function advise(ctx: Ctx): number {
  return DEFAULT_HANDLERS.advise(ctx);
}

export { EXIT };
