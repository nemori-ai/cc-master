import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const specPath = new URL(
  '../../design_docs/2026-07-13-codex-native-attempt-ledger-spec.md',
  import.meta.url,
);
const spec = readFileSync(specPath, 'utf8');

test('frozen native-attempt SSOT distinguishes the implemented ledger from unsupported live dispatch', () => {
  assert.match(
    spec,
    /ledger, dedicated writer, and private evidence authentication (?:surface )?are implemented/i,
  );
  assert.match(spec, /host-native live dispatch\/spawn remains unsupported/i);

  assert.doesNotMatch(spec, /does \*\*not\*\* implement an engine\s+validator, ccm writer/i);
  assert.doesNotMatch(spec, /private evidence\s+channel, and five dedicated CLI verbs do not exist/i);
});

test('frozen native-attempt SSOT exposes the current five writer commands and executable gates', () => {
  const commands = [
    'ccm task native-attempt-create <task-id> --selection @selection.json --attempt @attempt.json --replay-intent <accept-no-launch|require-new-launch> [--json]',
    'ccm task native-attempt-bind <task-id> --attempt-id <id> --evidence-record-ref <owner-ref> [--json]',
    'ccm task native-attempt-cancel <task-id> --attempt-id <id> --request @cancel.json [--acknowledgement-terminal-class <class>] [--json]',
    'ccm task native-attempt-terminal <task-id> --attempt-id <id> --evidence-record-ref <owner-ref> [--requested-task-status <status>] [--json]',
    'ccm task native-attempt-reconcile <task-id> --attempt-id <id> --evidence-record-ref <owner-ref> [--json]',
  ];
  for (const command of commands) assert.ok(spec.includes(command), `missing command: ${command}`);

  assert.match(
    spec,
    /pnpm --filter @ccm\/engine exec node --test test\/native-attempt-contract\.red\.test\.ts/,
  );
  assert.match(
    spec,
    /pnpm --filter ccm exec node --import tsx --test test\/handler-native-attempt\.red\.test\.ts test\/registry\.test\.ts/,
  );
  assert.match(spec, /Both focused commands MUST pass today/);

  assert.doesNotMatch(spec, /Planned ccm verbs are:/);
  assert.doesNotMatch(spec, /They are planned names, not current CLI claims\./);
  assert.doesNotMatch(spec, /Both commands MUST fail today/);
});

test('fenced orphan projection stays subject to ordinary dependency gating', () => {
  assert.match(spec, /fenced orphan[\s\S]{0,240}`ready\|blocked`/i);
  assert.match(spec, /`reconcileGating`/);
  assert.match(spec, /unmet deps[\s\S]{0,120}`blocked`/i);

  assert.doesNotMatch(spec, /may project it back to `ready` only/i);
  assert.doesNotMatch(spec, /\| `ready`, handle absent; a later explicit create is permitted/i);
  assert.doesNotMatch(spec, /return the task to `ready`; it still performs no spawn/i);
});
