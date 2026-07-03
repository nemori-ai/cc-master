// handlers/harness.ts — local supported-harness inventory.

import {
  inspectKnownHarnesses,
  resolveHarnessAdapter,
  type HarnessInstallation,
} from '../harnesses/registry.js';
import * as io from '../io.js';
import type { Ctx } from './_common.js';

const EXIT = io.EXIT;

export function list(ctx: Ctx): number {
  const selected = resolveHarnessAdapter({
    env: ctx.env,
    harnessFlag: ctx.values.harness as string | undefined,
  });
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
  const statusline = h.capabilities.externalStatusline.supported ? 'statusline=yes' : 'statusline=no';
  const account = h.capabilities.accountPool.supported ? 'account=yes' : 'account=no';
  const reason = h.reason ? ` · ${h.reason}` : '';
  return `  ${h.id.padEnd(12)} ${marks.join(',') || '-'} · cli=${cli} · ${dist} ${statusline} ${account}${reason}`;
}
