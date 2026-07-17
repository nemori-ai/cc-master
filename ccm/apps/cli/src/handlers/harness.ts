// handlers/harness.ts — local supported-harness inventory.

import {
  buildCursorSurfaceInventory,
  type CursorExecutionSurfaceDescriptor,
  defaultCursorAgentQuotaReader,
  inspectCursorExecutionSurfaces,
} from '../harnesses/cursor-surfaces.js';
import {
  type HarnessInstallation,
  inspectKnownHarnesses,
  installedSurfaceIds,
  MachineHarnessRegistry,
  resolveHarnessAdapter,
} from '../harnesses/registry.js';
import * as io from '../io.js';
import type { Ctx } from './_common.js';

const EXIT = io.EXIT;

export function list(ctx: Ctx): number {
  const selected = resolveHarnessAdapter({
    env: ctx.env,
    harnessFlag: ctx.values.harness as string | undefined,
  });
  if (ctx.values['machine-wide']) {
    const registry = MachineHarnessRegistry.sweep(ctx.env, { probeHeadlessAuth: true });
    const snapshot = registry.toJSON();
    const surfaces = inspectCursorExecutionSurfaces(ctx.env, {
      readQuota: defaultCursorAgentQuotaReader,
    });
    const surfaceInventory = buildCursorSurfaceInventory(surfaces);
    if (ctx.flags.json) {
      ctx.out(
        io.jsonOk({
          current: selected.id,
          machineWide: true,
          ...snapshot,
          surfaceInventory,
        }),
      );
      return EXIT.OK;
    }
    ctx.out('MACHINE-WIDE HARNESS REGISTRY');
    for (const h of snapshot.harnesses) {
      ctx.out(formatMachineHarnessLine(h, selected.id));
      for (const surface of h.surfaces) ctx.out(formatHarnessSurfaceLine(surface));
    }
    ctx.out('EXECUTION SURFACES');
    for (const surface of surfaces) ctx.out(formatExecutionSurfaceLine(surface));
    return EXIT.OK;
  }

  const harnesses = inspectKnownHarnesses(ctx.env, { probeHeadlessAuth: true });
  if (ctx.flags.json) {
    ctx.out(
      io.jsonOk({
        current: selected.id,
        installed: harnesses.filter((h) => h.installed).map((h) => h.id),
        installedSurfaces: installedSurfaceIds(harnesses),
        harnesses,
      }),
    );
    return EXIT.OK;
  }

  ctx.out('HARNESS INVENTORY');
  for (const h of harnesses) {
    ctx.out(formatHarnessLine(h, selected.id));
    for (const surface of h.surfaces) ctx.out(formatHarnessSurfaceLine(surface));
  }
  return EXIT.OK;
}

function formatExecutionSurfaceLine(surface: CursorExecutionSurfaceDescriptor): string {
  const binary = surface.binary.path || `missing:${surface.binary.name || surface.surface_id}`;
  const model = surface.model.state;
  const quota = surface.quota.state;
  const eligible = surface.eligibility.automatic ? 'eligible' : 'ineligible';
  return `  ${surface.surface_id.padEnd(20)} ${surface.surface_kind} · binary=${binary} · auth=${surface.auth.state} model=${model} quota=${quota} · ${eligible}`;
}

export function current(ctx: Ctx): number {
  const selected = resolveHarnessAdapter({
    env: ctx.env,
    harnessFlag: ctx.values.harness as string | undefined,
  });
  const info = selected.inspectInstallation(ctx.env, { probeHeadlessAuth: true });
  if (ctx.flags.json) {
    ctx.out(io.jsonOk({ current: selected.id, harness: info }));
    return EXIT.OK;
  }
  ctx.out(formatHarnessLine(info, selected.id));
  for (const surface of info.surfaces) ctx.out(formatHarnessSurfaceLine(surface));
  return EXIT.OK;
}

function formatHarnessLine(h: HarnessInstallation, selectedId: string): string {
  const marks = [
    h.id === selectedId ? 'current' : '',
    h.installed ? 'plugin-target=installed' : 'plugin-target=missing',
    h.active ? 'active-env' : '',
  ].filter(Boolean);
  const cli = h.cli.available ? h.cli.path || h.cli.name : `missing:${h.cli.name}`;
  const dist = h.capabilities.pluginDistribution.supported ? 'plugin-dist=yes' : 'plugin-dist=no';
  const statusline = h.capabilities.externalStatusline.supported
    ? 'statusline=yes'
    : 'statusline=no';
  const account = h.capabilities.accountPool.supported ? 'account-pool=yes' : 'account-pool=no';
  const reason = h.reason ? ` · ${h.reason}` : '';
  return `  ${h.id.padEnd(12)} ${marks.join(',') || '-'} · cli=${cli} · ${dist} ${statusline} ${account}${reason}`;
}

function formatHarnessSurfaceLine(surface: HarnessInstallation['surfaces'][number]): string {
  const state = `${surface.installed ? 'installed' : 'missing'}/${surface.available ? 'available' : 'unavailable'}`;
  const binary = surface.binary.available
    ? surface.binary.path || surface.binary.name
    : `missing:${surface.binary.name}`;
  const admission = surface.admission
    ? ` · admission=${surface.admission.schedulable ? 'schedulable' : 'blocked'} sandbox=${surface.admission.sandbox} result=${surface.admission.result_schema} acceptance=${surface.admission.task_acceptance}`
    : '';
  return `    ${surface.id.padEnd(22)} ${surface.kind.padEnd(12)} ${state} · binary=${binary} · auth=${surface.facts.authentication.state} quota=${surface.facts.quota.state} account-mutation=${surface.capabilities.accountMutation.state} autoswitch=${surface.capabilities.accountAutoswitch.state} plugin-dist=${surface.capabilities.pluginDistribution.state}${admission}`;
}

function formatMachineHarnessLine(
  h: HarnessInstallation & {
    sessionStoreRoots: readonly string[];
    usageSource: { kind: string; pollable: boolean; quotaModel: string };
    accountPoolLocation: string | null;
  },
  selectedId: string,
): string {
  const base = formatHarnessLine(h, selectedId);
  const roots = h.sessionStoreRoots.length ? h.sessionStoreRoots.join(',') : '-';
  const usage = `${h.usageSource.kind}/${h.usageSource.quotaModel}/${h.usageSource.pollable ? 'pollable' : 'not-pollable'}`;
  const pool = h.accountPoolLocation || '-';
  return `${base} · sessions=${roots} · usage=${usage} · accountPool=${pool}`;
}
