// handlers/harness.ts — local supported-harness inventory.

import {
  buildCursorSurfaceInventory,
  type CursorExecutionSurfaceDescriptor,
  inspectCursorExecutionSurfaces,
} from '../harnesses/cursor-surfaces.js';
import {
  type HarnessInstallation,
  inspectKnownHarnesses,
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
    const registry = MachineHarnessRegistry.sweep(ctx.env);
    const snapshot = registry.toJSON();
    const surfaces = inspectCursorExecutionSurfaces(ctx.env);
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
    for (const h of snapshot.harnesses) ctx.out(formatMachineHarnessLine(h, selected.id));
    ctx.out('EXECUTION SURFACES');
    for (const surface of surfaces) ctx.out(formatSurfaceLine(surface));
    return EXIT.OK;
  }

  const harnesses = inspectKnownHarnesses(ctx.env);
  if (ctx.flags.json) {
    ctx.out(
      io.jsonOk({
        current: selected.id,
        installed: harnesses.filter((h) => h.installed).map((h) => h.id),
        harnesses,
      }),
    );
    return EXIT.OK;
  }

  ctx.out('HARNESS INVENTORY');
  for (const h of harnesses) ctx.out(formatHarnessLine(h, selected.id));
  return EXIT.OK;
}

function formatSurfaceLine(surface: CursorExecutionSurfaceDescriptor): string {
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
  const info = selected.inspectInstallation(ctx.env);
  if (ctx.flags.json) {
    ctx.out(io.jsonOk({ current: selected.id, harness: info }));
    return EXIT.OK;
  }
  ctx.out(formatHarnessLine(info, selected.id));
  return EXIT.OK;
}

function formatHarnessLine(h: HarnessInstallation, selectedId: string): string {
  const marks = [
    h.id === selectedId ? 'current' : '',
    h.installed ? 'installed' : 'missing',
    h.active ? 'active-env' : '',
  ].filter(Boolean);
  const cli = h.cli.available ? h.cli.path || h.cli.name : `missing:${h.cli.name}`;
  const dist = h.capabilities.pluginDistribution.supported ? 'plugin=yes' : 'plugin=no';
  const statusline = h.capabilities.externalStatusline.supported
    ? 'statusline=yes'
    : 'statusline=no';
  const account = h.capabilities.accountPool.supported ? 'account=yes' : 'account=no';
  const reason = h.reason ? ` · ${h.reason}` : '';
  return `  ${h.id.padEnd(12)} ${marks.join(',') || '-'} · cli=${cli} · ${dist} ${statusline} ${account}${reason}`;
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
