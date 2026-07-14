import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMPLEMENTATION_PATH = join(HERE, 'support', 'quota-effect-guard-implementation.ts');
const REGISTRY_PATH = join(HERE, 'fixtures', 'quota-effect-hard-deny-v1', 'registry.json');

const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')) as {
  effect_classes: string[];
};
const effectClass = process.argv[2];
assert.ok(effectClass, 'usage: quota-effect-hard-deny.mutation.ts <effect-class>');
assert.ok(
  registry.effect_classes.includes(effectClass),
  `unknown quota effect class: ${effectClass}`,
);

const original = readFileSync(IMPLEMENTATION_PATH, 'utf8');
const escaped = effectClass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const block = new RegExp(
  `\\s*// GUARD-CLASS:${escaped}:START[\\s\\S]*?// GUARD-CLASS:${escaped}:END\\n?`,
);
assert.match(original, block, `missing implementation guard block for ${effectClass}`);
const mutated = original.replace(block, '\n');
assert.notEqual(mutated, original);

let child: ReturnType<typeof spawnSync> | undefined;
try {
  writeFileSync(IMPLEMENTATION_PATH, mutated, 'utf8');
  child = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--test', 'test/quota-effect-hard-deny.test.ts'],
    {
      cwd: join(HERE, '..'),
      encoding: 'utf8',
    },
  );
} finally {
  writeFileSync(IMPLEMENTATION_PATH, original, 'utf8');
}

assert.equal(
  readFileSync(IMPLEMENTATION_PATH, 'utf8'),
  original,
  'guard implementation restore failed',
);
assert.ok(child);
const output = `${child.stdout ?? ''}\n${child.stderr ?? ''}`;
assert.notEqual(
  child.status,
  0,
  `guard deletion falsely stayed GREEN for ${effectClass}\n${output}`,
);
assert.match(
  output,
  /API registry\/guard implementation mismatch|effect classes registry\/guard mismatch/,
);
process.stdout.write(`EXPECTED_RED ${effectClass}\n`);
