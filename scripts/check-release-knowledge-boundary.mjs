#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const RELEASE_HOSTS = Object.freeze([
  'claude-code',
  'codex',
  'cursor',
  'kimi-code',
]);

const FORBIDDEN_MARKDOWN_REFERENCES = Object.freeze([
  'knowledge/atlas.md',
  'knowledge/modules/',
  'plugin/src/knowledge',
]);

export function inspectReleaseKnowledgeBoundary(files) {
  const violations = [];
  for (const file of files) {
    const segments = file.path.split('/');
    if (segments.includes('knowledge')) {
      violations.push(`${file.path}: path component "knowledge" is forbidden`);
    }
    if (!file.path.endsWith('.md')) continue;
    for (const reference of FORBIDDEN_MARKDOWN_REFERENCES) {
      if (file.content.includes(reference)) {
        violations.push(`${file.path}: Markdown points to forbidden ${reference}`);
      }
    }
  }
  return violations;
}

export function scanTrackedReleaseDists(repoRoot) {
  const pathspecs = RELEASE_HOSTS.map((host) => `plugin/dist/${host}`);
  const listed = spawnSync('git', ['ls-files', '-z', '--', ...pathspecs], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (listed.error || listed.status !== 0) {
    throw new Error(
      `git ls-files failed: ${listed.error?.message ?? listed.stderr.trim() ?? listed.status}`,
    );
  }
  const trackedPaths = listed.stdout.split('\0').filter(Boolean);
  const files = trackedPaths.map((relative) => ({
    path: relative,
    content: relative.endsWith('.md')
      ? fs.readFileSync(path.join(repoRoot, relative), 'utf8')
      : '',
  }));
  return {
    tracked_file_count: trackedPaths.length,
    violations: inspectReleaseKnowledgeBoundary(files),
  };
}

function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = scanTrackedReleaseDists(repoRoot);
  if (result.violations.length > 0) {
    for (const violation of result.violations) {
      process.stderr.write(`[release-knowledge-boundary] ${violation}\n`);
    }
    return 1;
  }
  process.stdout.write(
    `[release-knowledge-boundary] OK: ${result.tracked_file_count} tracked files across `
    + `${RELEASE_HOSTS.join(', ')}\n`,
  );
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`[release-knowledge-boundary] ${error.message}\n`);
    process.exitCode = 1;
  }
}
