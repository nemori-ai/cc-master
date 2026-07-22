import { evaluateQuotaLifecycleEffect } from '@ccm/engine';
import * as discover from '../discover.js';
import * as io from '../io.js';
import {
  type MachineQuotaStore,
  readMachineWideQuotaStatus,
  refreshMachineWideQuota,
  refreshMachineWideQuotaObservations,
} from '../machine-wide-quota.js';
import { runMachineWideQuotaNotificationCycle } from '../machine-wide-quota-notification.js';
import { createQuotaAdmissionStore } from '../quota-admission-store.js';
import {
  QUOTA_FILESYSTEM_CAPABILITIES,
  quotaFilesystemFromBoundary,
} from '../quota-production-effects.js';
import type { Ctx } from './_common.js';

const EXIT = io.EXIT;

interface QuotaStoreExtension {
  status(): Promise<Record<string, unknown>>;
  preflight(request: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>>;
  reserve(request: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>>;
  auditReservation(request: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>>;
  readObservation(sourceKey: string): Promise<Record<string, unknown> | undefined>;
  refreshObservation(
    request: Readonly<Record<string, unknown>>,
    collect: () => Promise<Record<string, unknown>>,
  ): Promise<Record<string, unknown>>;
  readAggregation(aggregationKey: string): Promise<Record<string, unknown>>;
  readMachineProjection(): Promise<Record<string, unknown> | undefined>;
  publishMachineProjection(
    projection: Readonly<Record<string, unknown>>,
  ): Promise<Record<string, unknown>>;
}

function store(
  ctx: Ctx,
  requiredCapabilities: readonly string[] = QUOTA_FILESYSTEM_CAPABILITIES,
): QuotaStoreExtension {
  if (!ctx.quotaEffects) {
    throw new Error('QUOTA_CAPABILITY_UNAVAILABLE: quota effect boundary is required');
  }
  const home = discover.resolveHome({
    homeFlag: ctx.values.home as string | undefined,
    env: ctx.env,
  });
  return createQuotaAdmissionStore({
    home,
    filesystem: quotaFilesystemFromBoundary(ctx.quotaEffects, requiredCapabilities),
  }) as QuotaStoreExtension;
}

function input(ctx: Ctx): Record<string, unknown> {
  const raw = io.readInputSpec(String(ctx.values.input), { stdin: ctx.stdin });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const error = new Error('--input must contain valid JSON') as Error & { errKind?: string };
    error.errKind = 'Usage';
    throw error;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const error = new Error('--input must be a JSON object') as Error & { errKind?: string };
    error.errKind = 'Usage';
    throw error;
  }
  return parsed as Record<string, unknown>;
}

function emit(ctx: Ctx, data: unknown): number {
  ctx.out(ctx.flags.json ? io.jsonOk(data) : JSON.stringify(data, null, 2));
  return EXIT.OK;
}

function emitMachineWide(ctx: Ctx, data: unknown): number {
  // Machine-wide quota is itself a versioned projection consumed by hooks and plugins. Keep the
  // schema at the JSON root instead of hiding it under the generic CLI success envelope.
  ctx.out(ctx.flags.json ? JSON.stringify(data) : JSON.stringify(data, null, 2));
  return EXIT.OK;
}

export async function status(ctx: Ctx): Promise<number> {
  if (ctx.values['machine-wide'] === true) {
    // --refresh: explicit on-demand live fill (no monitor daemon needed). Collects every target
    //   through the same per-harness UsageReading strategy, persists observations + inits the home
    //   salt, then reads — so a machine with no daemon is never permanently all-unknown. Default
    //   (no flag) stays a cheap cached read that never calls a provider collector.
    if (ctx.values.refresh === true) {
      if (!ctx.machineQuotaCollectors || !ctx.machineQuotaDirectory) {
        throw new Error('machine-wide quota collector boundary is required');
      }
      const data = await refreshMachineWideQuotaObservations({
        env: ctx.env,
        store: store(ctx) as MachineQuotaStore,
        collectors: ctx.machineQuotaCollectors,
        directory: ctx.machineQuotaDirectory,
      });
      return emitMachineWide(ctx, data);
    }
    if (ctx.machineWideQuotaNotifications) {
      const decisions = await ctx.machineWideQuotaNotifications.readPostures({ refresh: false });
      return emitMachineWide(ctx, {
        schema: 'ccm/machine-quota-status/v1',
        summary: { schema: 'ccm/machine-quota-summary/v1', decisions },
        readings: [],
      });
    }
    if (!ctx.machineQuotaDirectory) throw new Error('machine-wide quota directory is required');
    const data = await readMachineWideQuotaStatus(
      store(ctx) as MachineQuotaStore,
      new Date(),
      ctx.machineQuotaDirectory,
    );
    return emitMachineWide(ctx, data);
  }
  return emit(ctx, await store(ctx, ['filesystem.quota.stat']).status());
}

export async function refresh(ctx: Ctx): Promise<number> {
  if (ctx.values['machine-wide'] !== true) {
    const error = new Error('quota refresh requires --machine-wide') as Error & {
      errKind?: string;
    };
    error.errKind = 'Usage';
    throw error;
  }
  if (ctx.machineWideQuotaNotifications) {
    const boundary = ctx.machineWideQuotaNotifications;
    const decisions = await boundary.readPostures({ refresh: true });
    const subscriptions = await boundary.listSubscriptions();
    const result = await runMachineWideQuotaNotificationCycle({
      decisions,
      subscriptions,
      checkpoint: {
        read: boundary.readCheckpoint,
        publish: boundary.publishCheckpoint,
      },
      inbox: { put: boundary.putInbox },
    });
    return emitMachineWide(ctx, {
      schema: 'ccm/machine-quota-refresh/v1',
      scopes: decisions.map((decision) => ({
        scope_digest: decision.scope_digest,
        target: decision.target,
        status: 'refreshed',
      })),
      deltas: result.notifications.map((notification) => notification.payload),
      deliveries: result.notifications,
      fanout_complete: true,
      checkpoint_advanced: true,
    });
  }
  const home = discover.resolveHome({
    homeFlag: ctx.values.home as string | undefined,
    env: ctx.env,
  });
  if (!ctx.machineQuotaCoordination) {
    throw new Error('machine-wide quota coordination boundary is required');
  }
  if (!ctx.machineQuotaCollectors) {
    throw new Error('machine-wide quota collector boundary is required');
  }
  if (!ctx.machineQuotaDirectory) throw new Error('machine-wide quota directory is required');
  return emitMachineWide(
    ctx,
    await refreshMachineWideQuota({
      home,
      env: ctx.env,
      store: store(ctx) as MachineQuotaStore,
      collectors: ctx.machineQuotaCollectors,
      coordination: ctx.machineQuotaCoordination,
      directory: ctx.machineQuotaDirectory,
    }),
  );
}

export async function preflight(ctx: Ctx): Promise<number> {
  const request = input(ctx);
  const data =
    request.requested_effect === undefined
      ? await store(ctx).preflight(request)
      : evaluateQuotaLifecycleEffect(request);
  return emit(ctx, data);
}

export async function reserve(ctx: Ctx): Promise<number> {
  return emit(ctx, await store(ctx).reserve(input(ctx)));
}

export async function audit(ctx: Ctx): Promise<number> {
  return emit(ctx, await store(ctx).auditReservation(input(ctx)));
}
