#!/usr/bin/env node
/**
 * Internal: compile one host into a controlled candidate host root.
 * Not a public CLI surface — sync-host-surface invokes this after staging is filled.
 *
 * Usage:
 *   node scripts/skill-knowledge/compile-candidate-host.mjs \
 *     --repo-root <abs> --host <host> --candidate-root <abs>
 */
import path from 'node:path';
import { runCompile } from './compile.mjs';

function parseArgs(argv) {
  const values = Object.create(null);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      throw new Error(`unexpected positional ${token}`);
    }
    if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
      throw new Error(`missing value for ${token}`);
    }
    values[token] = argv[i + 1];
    i += 1;
  }
  for (const flag of ['--repo-root', '--host', '--candidate-root']) {
    if (!values[flag]) throw new Error(`missing ${flag}`);
  }
  return values;
}

const values = parseArgs(process.argv.slice(2));
const result = runCompile({
  repoRoot: path.resolve(values['--repo-root']),
  host: values['--host'],
  candidateHostRoot: path.resolve(values['--candidate-root']),
  check: false,
});
process.stdout.write(`${JSON.stringify(result.body)}\n`);
process.exit(result.exitCode);
