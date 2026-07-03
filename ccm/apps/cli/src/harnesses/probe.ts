import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Env, HarnessCliProbe } from './types.js';

export function probeExecutable(name: string, env: Env): HarnessCliProbe {
  const pathHit = findExecutable(name, env);
  return { name, path: pathHit, available: pathHit != null };
}

function findExecutable(name: string, env: Env): string | null {
  if (!name) return null;
  if (name.includes('/') || name.includes('\\')) return isExecutable(name) ? path.resolve(name) : null;

  const pathEnv = env.PATH || process.env.PATH || '';
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  const exts =
    process.platform === 'win32'
      ? (env.PATHEXT || process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
          .split(';')
          .filter(Boolean)
      : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, `${name}${ext}`);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

function isExecutable(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
