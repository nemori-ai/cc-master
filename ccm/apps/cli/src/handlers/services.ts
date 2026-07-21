import * as fs from 'node:fs';
import * as path from 'node:path';
import * as discover from '../discover.js';
import { readVersion } from '../help.js';
import * as io from '../io.js';
import type { Ctx } from './_common.js';
import * as monitor from './monitor.js';
import * as webViewer from './web-viewer.js';

const EXIT = io.EXIT;

interface JsonRecord {
  [key: string]: unknown;
}

interface ServicePlan {
  service: 'monitor' | 'web-viewer';
  id: string;
  state_path: string | null;
  wanted: boolean;
  running: boolean;
  running_ccm_version: string | null;
  installed_ccm_version: string;
  binary_match: boolean | null;
  action: 'restart' | 'skip';
  reason: string;
}

function canonicalHome(ctx: Ctx): string {
  const home = discover.resolveHome({
    homeFlag: ctx.values.home as string | undefined,
    env: ctx.env,
  });
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  try {
    return fs.realpathSync.native(home);
  } catch {
    return path.resolve(home);
  }
}

function isObject(v: unknown): v is JsonRecord {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function readJson(filePath: string): JsonRecord | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isPidAlive(pid: unknown): boolean {
  if (!Number.isInteger(pid) || (pid as number) <= 0) return false;
  try {
    process.kill(pid as number, 0);
    return true;
  } catch {
    return false;
  }
}

function versionOf(state: JsonRecord | null): string | null {
  const server = isObject(state?.server) ? state.server : null;
  return typeof server?.ccm_version === 'string' ? server.ccm_version : null;
}

function monitorPlan(ctx: Ctx, home: string): ServicePlan {
  const statePath = path.join(home, 'services', 'monitor', 'state.json');
  const state = readJson(statePath);
  const running = isPidAlive(state?.pid);
  const runningVersion = versionOf(state);
  const installed = readVersion();
  // Reuse monitor's contract-derived unit location (single source of truth; honors XDG / injected env).
  const wanted = running || state?.wanted === true || monitor.monitorUnitInstalled(ctx.env, home);
  return {
    service: 'monitor',
    id: 'monitor',
    state_path: state ? statePath : null,
    wanted,
    running,
    running_ccm_version: runningVersion,
    installed_ccm_version: installed,
    binary_match: runningVersion ? runningVersion === installed : null,
    action: wanted ? 'restart' : 'skip',
    reason: wanted ? 'wanted' : 'not-wanted',
  };
}

function webViewerPlans(home: string): ServicePlan[] {
  const dir = path.join(home, 'services', 'web-viewer', 'instances');
  let names: string[] = [];
  try {
    names = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
  const installed = readVersion();
  return names.map((name) => {
    const statePath = path.join(dir, name);
    const state = readJson(statePath);
    const running = isPidAlive(state?.pid);
    const runningVersion = versionOf(state);
    const wanted = running || state?.wanted === true;
    const id = typeof state?.id === 'string' ? state.id : path.basename(name, '.json');
    return {
      service: 'web-viewer' as const,
      id,
      state_path: state ? statePath : null,
      wanted,
      running,
      running_ccm_version: runningVersion,
      installed_ccm_version: installed,
      binary_match: runningVersion ? runningVersion === installed : null,
      action: wanted ? 'restart' : 'skip',
      reason: wanted ? 'wanted' : 'not-wanted',
    };
  });
}

function silentCtx(ctx: Ctx, extra: Partial<Ctx>): Ctx {
  return {
    ...ctx,
    ...extra,
    values: { ...ctx.values, ...(extra.values || {}) },
    out: () => {},
    err: () => {},
  };
}

// Re-derive a fresh plan for one service after a restart so the caller can assert the
//   post-condition (the service came back up on the freshly installed binary). Monitor re-reads
//   its single state; web-viewer matches the just-restarted instance by id.
function freshPlanFor(ctx: Ctx, plan: ServicePlan, home: string): ServicePlan | null {
  if (plan.service === 'monitor') return monitorPlan(ctx, home);
  // restart() re-creates the web-viewer instance under the canonical id (not necessarily the id we
  //   restarted), so match that — the same instance probeRunningServiceHealth verified above.
  const canonicalId = webViewer.canonicalServiceId(home);
  return webViewerPlans(home).find((p) => p.id === canonicalId) ?? null;
}

function restartPlan(ctx: Ctx, plan: ServicePlan, home: string): ServicePlan {
  if (plan.action !== 'restart') return plan;
  try {
    if (plan.service === 'monitor') {
      if (!monitor.restartOsServiceIfInstalled(silentCtx(ctx, { values: { home } }))) {
        monitor.restart(silentCtx(ctx, { values: { home } }));
      }
    } else {
      webViewer.ensureAppDistForHome(home);
      webViewer.restart(silentCtx(ctx, { values: { home }, positionals: [plan.id] }));
      const probe = webViewer.probeRunningServiceHealth(home);
      if (!probe.ok) {
        return {
          ...plan,
          action: 'restart',
          reason: `restart-failed: health probe: ${probe.error || 'unhealthy'}`,
        };
      }
    }
    // Post-condition (no-silent-failure): a restart that returned without throwing must have
    //   landed the service on the freshly installed binary. restart()'s internal health-wait
    //   already guarantees liveness on success; here we additionally assert the running version
    //   equals the installed one — otherwise a stale-binary or half-applied restart (the exact
    //   failure a post-binary-replace reconcile exists to catch) would be silently reported as
    //   "restarted".
    const fresh = freshPlanFor(ctx, plan, home);
    if (!fresh || fresh.binary_match !== true) {
      return {
        ...plan,
        action: 'restart',
        reason: `restart-failed: post-check binary_match=${String(fresh?.binary_match ?? null)} running_ccm_version=${String(fresh?.running_ccm_version ?? null)}`,
      };
    }
    return { ...plan, action: 'restart', reason: 'restarted' };
  } catch (e) {
    return {
      ...plan,
      action: 'restart',
      reason: `restart-failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export function reconcile(ctx: Ctx): number {
  const home = canonicalHome(ctx);
  const plans = [monitorPlan(ctx, home), ...webViewerPlans(home)];
  const results = plans.map((plan) => (plan.wanted ? restartPlan(ctx, plan, home) : plan));
  const failed = results.filter((plan) => plan.wanted && plan.reason.startsWith('restart-failed'));
  const data = {
    after_binary_replace: ctx.values['after-binary-replace'] === true,
    home,
    services: results,
    restarted: results.filter((plan) => plan.wanted && plan.reason === 'restarted').length,
    skipped: results.filter((plan) => !plan.wanted).length,
    failed: failed.length,
  };
  ctx.out(
    ctx.flags.json
      ? JSON.stringify({ ok: failed.length === 0, data })
      : `services reconcile: restarted=${data.restarted} skipped=${data.skipped} failed=${data.failed}`,
  );
  // Fail-loud (no-silent-failure): a wanted service that could not be restarted onto the new
  //   binary must surface a nonzero exit — install.sh / `ccm upgrade` gate their warnings on it.
  //   (Previously this returned EXIT.OK unconditionally, making every caller's failure branch dead.)
  return failed.length === 0 ? EXIT.OK : EXIT.ERROR;
}
