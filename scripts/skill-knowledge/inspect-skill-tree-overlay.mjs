#!/usr/bin/env node
/**
 * CJS↔ESM bridge: inspect a skill tree for compiler-owned overlays via the
 * unique skill-overlay grammar implementation. Never duplicate overlay regex
 * into provider-guidance-attestation.cjs.
 *
 * Usage:
 *   node scripts/skill-knowledge/inspect-skill-tree-overlay.mjs --root <abs>
 *   node scripts/skill-knowledge/inspect-skill-tree-overlay.mjs --root <abs> --assert-clean
 */
import path from 'node:path';
import {
  SkillOverlayError,
  assertSkillTreeHasNoCompilerOwnedOverlay,
  inspectSkillTreeCompilerOwnedOverlay,
} from './compile/skill-overlay.mjs';

function parseArgv(argv) {
  const values = Object.create(null);
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new SkillOverlayError('SKG-OVERLAY-ARGV', `unexpected positional ${token}`);
    }
    if (token === '--assert-clean') {
      flags.add(token);
      continue;
    }
    if (index + 1 >= argv.length || argv[index + 1].startsWith('--')) {
      throw new SkillOverlayError('SKG-OVERLAY-ARGV', `missing value for ${token}`);
    }
    values[token] = argv[index + 1];
    index += 1;
  }
  return { values, flags };
}

try {
  const { values, flags } = parseArgv(process.argv.slice(2));
  if (!values['--root']) {
    throw new SkillOverlayError('SKG-OVERLAY-ARGV', 'missing required --root');
  }
  const root = path.resolve(values['--root']);
  const result = flags.has('--assert-clean')
    ? assertSkillTreeHasNoCompilerOwnedOverlay(root)
    : inspectSkillTreeCompilerOwnedOverlay(root);
  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
} catch (error) {
  const payload = {
    ok: false,
    code: error?.code ?? 'SKG-OVERLAY-INSPECT',
    message: error instanceof Error ? error.message : String(error),
    witness: error?.witness ?? null,
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = 1;
}
