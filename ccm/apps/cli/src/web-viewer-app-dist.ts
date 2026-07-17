import * as crypto from 'node:crypto';
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

// Marker file written into a materialized dir recording the content-hash of the
// bundled asset map it was materialized from. It gates in-version cache
// invalidation: the on-disk dir is sharded by version number only, so a rebuilt
// frontend under an unchanged version would otherwise be permanently shadowed by
// the stale same-version cache (#178).
const BUILD_ID_MARKER = '.ccm-app-dist-build-id';

/**
 * Deterministic content-hash of the bundled asset map. Same version + same build
 * => same id; a rebuilt frontend under an unchanged version number yields a new
 * id, which is exactly what lets us detect and invalidate a stale same-version
 * materialized cache (#178). Hashing the base64 payloads is equivalent to hashing
 * the decoded file contents.
 */
export function bundledBuildId(files?: Record<string, string>): string {
  const map = files ?? bundledFiles();
  const hash = crypto.createHash('sha256');
  for (const [rel, data] of Object.entries(map).sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(rel);
    hash.update('\0');
    hash.update(data);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function buildIdMarkerPath(dir: string): string {
  return path.join(dir, BUILD_ID_MARKER);
}

function readMaterializedBuildId(dir: string): string | null {
  try {
    return fs.readFileSync(buildIdMarkerPath(dir), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

// True only when we hold real bundled base64 whose build id differs from the
// marker written into an already-materialized dir. Without bundled assets
// (dev / stub build) there is nothing to compare against, so we never invalidate
// an existing cache — it may be the only copy of the assets.
function materializedIsStale(dir: string): boolean {
  const files = bundledFiles();
  if (!bundled() || Object.keys(files).length === 0) return false;
  return readMaterializedBuildId(dir) !== bundledBuildId(files);
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
  const files = bundledFiles();

  if (!bundled() || Object.keys(files).length === 0) {
    // No bundled base64 to compare against (dev / stub): keep an existing
    // materialized cache (a prior real install) or fall back to dev candidates.
    if (hasIndexHtml(target)) return target;
    return resolveDevAppDistDir();
  }

  const buildId = bundledBuildId(files);
  if (hasIndexHtml(target) && readMaterializedBuildId(target) === buildId) {
    // Fast path: already materialized from this exact build — do not rewrite.
    return target;
  }

  // Fresh dir OR a same-version cache built from a different frontend (#178):
  // wipe first so orphaned hashed assets from the stale build cannot linger, then
  // re-materialize from the bundled base64.
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  for (const [rel, encoded] of Object.entries(files)) {
    const outPath = path.join(target, rel);
    fs.mkdirSync(path.dirname(outPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(outPath, Buffer.from(encoded, 'base64'), { mode: 0o644 });
  }
  if (!hasIndexHtml(target)) return null;
  // Commit marker last: a crash mid-write leaves no marker, so the next run treats
  // the partial dir as stale and re-materializes.
  fs.writeFileSync(buildIdMarkerPath(target), buildId, { mode: 0o644 });
  gcOldAppDistVersions(home, ver);
  return target;
}

export function resolveAppDistDir(home?: string): string | null {
  if (home) {
    const materialized = materializedAppDistDir(home);
    if (hasIndexHtml(materialized) && !materializedIsStale(materialized)) {
      return materialized;
    }
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
