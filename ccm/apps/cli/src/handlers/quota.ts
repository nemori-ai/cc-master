import { evaluateQuotaLifecycleEffect } from '@ccm/engine';
import * as discover from '../discover.js';
import * as io from '../io.js';
import {
  type MachineQuotaStore,
  readMachineWideQuotaStatus,
  refreshMachineWideQuota,
} from '../machine-wide-quota.js';
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

export async function status(ctx: Ctx): Promise<number> {
  if (ctx.values['machine-wide'] === true) {
    return emit(ctx, await readMachineWideQuotaStatus(store(ctx) as MachineQuotaStore));
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
  const home = discover.resolveHome({
    homeFlag: ctx.values.home as string | undefined,
    env: ctx.env,
  });
  return emit(
    ctx,
    await refreshMachineWideQuota({
      home,
      env: ctx.env,
      store: store(ctx) as MachineQuotaStore,
      collectors: ctx.machineQuotaCollectors,
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
