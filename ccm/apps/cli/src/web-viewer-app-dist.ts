import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WEB_VIEWER_APP_DIST_BUNDLED,
  WEB_VIEWER_APP_DIST_FILES,
  WEB_VIEWER_APP_DIST_VERSION,
} from './generated/web-viewer-assets.js';
import { readVersion } from './help.js';

export interface AppDistTestHooks {
  bundled?: boolean;
  files?: Record<string, string>;
  version?: string;
  disableDevCandidates?: boolean;
}

let testHooks: AppDistTestHooks = {};

export function __setWebViewerAppDistTestHooks(hooks: AppDistTestHooks): void {
  testHooks = hooks;
}

export function __resetWebViewerAppDistTestHooks(): void {
  testHooks = {};
}

function bundled(): boolean {
  if (testHooks.bundled !== undefined) return testHooks.bundled;
  return WEB_VIEWER_APP_DIST_BUNDLED;
}

function bundledFiles(): Record<string, string> {
  if (testHooks.files) return testHooks.files;
  return WEB_VIEWER_APP_DIST_FILES;
}

function targetVersion(version?: string): string {
  return version || testHooks.version || WEB_VIEWER_APP_DIST_VERSION || readVersion();
}

export function materializedAppDistDir(home: string, version?: string): string {
  return path.join(home, 'services', 'web-viewer', 'app-dist', targetVersion(version));
}

export function hasIndexHtml(dir: string): boolean {
  try {
    return fs.existsSync(path.join(dir, 'index.html'));
  } catch {
    return false;
  }
}

export function devCandidateDirs(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.resolve(here, '../web-viewer/dist'),
    path.resolve(here, '../../web-viewer/dist'),
    path.resolve(process.cwd(), 'ccm/apps/web-viewer/dist'),
    path.resolve(process.cwd(), 'apps/web-viewer/dist'),
  ];
}

export function resolveDevAppDistDir(): string | null {
  if (testHooks.disableDevCandidates) return null;
  for (const candidate of devCandidateDirs()) {
    if (hasIndexHtml(candidate)) return candidate;
  }
  return null;
}

function gcOldAppDistVersions(home: string, keepVersion: string): void {
  const parent = path.join(home, 'services', 'web-viewer', 'app-dist');
  let names: string[] = [];
  try {
    names = fs.readdirSync(parent);
  } catch {
    return;
  }
  for (const name of names) {
    if (name === keepVersion) continue;
    const candidate = path.join(parent, name);
    try {
      fs.rmSync(candidate, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

export function materializeWebViewerAppDist(home: string, version?: string): string | null {
  const ver = targetVersion(version);
  const target = materializedAppDistDir(home, ver);
  if (hasIndexHtml(target)) return target;

  const files = bundledFiles();
  if (!bundled() || Object.keys(files).length === 0) {
    return resolveDevAppDistDir();
  }

  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  for (const [rel, encoded] of Object.entries(files)) {
    const outPath = path.join(target, rel);
    fs.mkdirSync(path.dirname(outPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(outPath, Buffer.from(encoded, 'base64'), { mode: 0o644 });
  }
  if (!hasIndexHtml(target)) return null;
  gcOldAppDistVersions(home, ver);
  return target;
}

export function resolveAppDistDir(home?: string): string | null {
  if (home) {
    const materialized = materializedAppDistDir(home);
    if (hasIndexHtml(materialized)) return materialized;
    const ensured = materializeWebViewerAppDist(home);
    if (ensured) return ensured;
  }
  return resolveDevAppDistDir();
}

export function ensureWebViewerAppDist(home: string): string {
  const dir = materializeWebViewerAppDist(home);
  if (!dir || !hasIndexHtml(dir)) {
    throw new Error(
      'ccm package is missing web-viewer assets; reinstall ccm or rebuild ccm from source',
    );
  }
  return dir;
}
