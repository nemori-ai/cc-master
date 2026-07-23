import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SOURCE_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Paths required for skill-knowledge compile / check mutations.
 * design_docs schemas are needed so committed validator fingerprint checks pass.
 */
const DEFAULT_COPY_PATHS = Object.freeze([
  'plugin',
  'scripts',
  'design_docs/skill-knowledge-graph',
]);

const SKIP_NAMES = new Set([
  'node_modules',
  '.git',
  '.turbo',
  'coverage',
  '.cache',
]);

/**
 * Copy a minimal-but-complete skill-knowledge fixture repo.
 * Preserves symlink nodes (verbatimSymlinks) and skips huge/ignored dirs.
 */
export function copyMinimalSkillKnowledgeRepo(destRoot, { paths = DEFAULT_COPY_PATHS } = {}) {
  fs.mkdirSync(destRoot, { recursive: true });
  for (const rel of paths) {
    const from = path.join(SOURCE_REPO, rel);
    if (!fs.existsSync(from)) {
      throw new Error(`skill-knowledge isolated repo missing source path: ${rel}`);
    }
    const to = path.join(destRoot, rel);
    fs.cpSync(from, to, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (src) => !SKIP_NAMES.has(path.basename(src)),
    });
  }
  return destRoot;
}

/**
 * Run `fn` against an isolated mkdtemp repo copy. Finally deletes only the temp
 * tree — never restores checked-in shared paths.
 *
 * `runCli` always invokes the CLI *inside* the copy (not the source-repo absolute path).
 */
export function withIsolatedSkillKnowledgeRepo(fn, options = {}) {
  const tempParent = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-skg-iso-'));
  const repoCopy = path.join(tempParent, 'repo');
  try {
    copyMinimalSkillKnowledgeRepo(repoCopy, options);
    const cliPath = path.join(repoCopy, 'scripts', 'skill-knowledge.mjs');
    const runCli = (args, spawnOptions = {}) =>
      spawnSync(process.execPath, [cliPath, ...args], {
        cwd: spawnOptions.cwd ?? repoCopy,
        encoding: 'utf8',
        env: { ...process.env, ...(spawnOptions.env ?? {}) },
      });
    const result = fn({
      repoRoot: repoCopy,
      cliPath,
      runCli,
      sourceRepo: SOURCE_REPO,
    });
    if (result && typeof result.then === 'function') {
      return result.finally(() => {
        fs.rmSync(tempParent, { recursive: true, force: true });
      });
    }
    fs.rmSync(tempParent, { recursive: true, force: true });
    return result;
  } catch (error) {
    fs.rmSync(tempParent, { recursive: true, force: true });
    throw error;
  }
}

export { SOURCE_REPO, DEFAULT_COPY_PATHS };
