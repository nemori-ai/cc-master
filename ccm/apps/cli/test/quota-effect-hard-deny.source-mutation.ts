import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCE_MUTATION_PROBES } from './fixtures/quota-effect-hard-deny-v1/source-mutations.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const HANDLER_PATH = join(
  HERE,
  'fixtures',
  'quota-effect-hard-deny-v1',
  'roots',
  'controlled-quota-handler.ts',
);
const effectClass = process.argv[2];
assert.ok(effectClass, 'usage: quota-effect-hard-deny.source-mutation.ts <effect-class>');
const probe = SOURCE_MUTATION_PROBES.find((candidate) => candidate.effectClass === effectClass);
assert.ok(probe, `unknown quota effect class: ${effectClass}`);

const original = readFileSync(HANDLER_PATH, 'utf8');
const insertionPoint = 'controlled(ctx: Ctx): number {';
assert.match(original, new RegExp(insertionPoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
const ambientProofRoot =
  effectClass === 'ambient-filesystem-io'
    ? mkdtempSync(join(tmpdir(), 'ccm-quota-ambient-source-mutation-'))
    : undefined;
const mutationSource = ambientProofRoot
  ? `require('node:fs').writeFileSync(${JSON.stringify(join(ambientProofRoot, 'effect.txt'))}, 'mutated')`
  : `if (false) { ${probe.source}; }`;
const mutated = original.replace(insertionPoint, `${insertionPoint}\n      ${mutationSource};`);
assert.notEqual(mutated, original);

let child: ReturnType<typeof spawnSync> | undefined;
let ambientEffectObserved = false;
try {
  writeFileSync(HANDLER_PATH, mutated, 'utf8');
  child = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--test', 'test/quota-effect-hard-deny.test.ts'],
    {
      cwd: join(HERE, '..'),
      encoding: 'utf8',
    },
  );
} finally {
  writeFileSync(HANDLER_PATH, original, 'utf8');
  if (ambientProofRoot) {
    ambientEffectObserved = existsSync(join(ambientProofRoot, 'effect.txt'));
    rmSync(ambientProofRoot, { recursive: true, force: true });
  }
}

assert.equal(readFileSync(HANDLER_PATH, 'utf8'), original, 'controlled handler restore failed');
assert.ok(child);
const output = `${child.stdout ?? ''}\n${child.stderr ?? ''}`;
assert.notEqual(
  child.status,
  0,
  `direct ${effectClass} source mutation falsely stayed GREEN\n${output}`,
);
assert.match(
  output,
  new RegExp(`direct ${effectClass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} escape`),
);
if (ambientProofRoot) {
  assert.equal(
    ambientEffectObserved,
    false,
    'source audit must fail before importing and executing the controlled fixture',
  );
}
process.stdout.write(`EXPECTED_RED_SOURCE ${effectClass}\n`);
