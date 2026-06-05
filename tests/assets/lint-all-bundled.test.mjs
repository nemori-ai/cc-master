import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LINTER = join(ROOT, 'skills/authoring-workflows/scripts/validate-workflow.mjs');
const dirs = ['skills/authoring-workflows/assets/templates', 'skills/authoring-workflows/assets/examples'];

for (const d of dirs) {
  let files = [];
  try { files = readdirSync(join(ROOT, d)).filter((f) => f.endsWith('.js')); } catch { /* dir not yet created */ }
  for (const f of files) {
    test(`bundled ${d}/${f} passes the linter`, () => {
      execFileSync('node', [LINTER, join(ROOT, d, f)]); // throws on non-zero exit
    });
  }
}
