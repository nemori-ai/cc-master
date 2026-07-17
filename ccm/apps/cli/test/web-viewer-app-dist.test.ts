import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { WEB_VIEWER_APP_DIST_FILES } from '../src/generated/web-viewer-assets.js';
import { readVersion } from '../src/help.js';
import {
  __resetWebViewerAppDistTestHooks,
  __setWebViewerAppDistTestHooks,
  ensureWebViewerAppDist,
  hasIndexHtml,
  materializedAppDistDir,
  materializeWebViewerAppDist,
  resolveAppDistDir,
} from '../src/web-viewer-app-dist.js';

let TMPDIRS: string[] = [];

afterEach(() => {
  __resetWebViewerAppDistTestHooks();
  for (const d of TMPDIRS) rmSync(d, { recursive: true, force: true });
  TMPDIRS = [];
});

function mkHome(): string {
  const root = mkdtempSync(join(tmpdir(), 'ccm-wv-app-dist-'));
  TMPDIRS.push(root);
  return root;
}

test('bundled viewer includes goal and cross-harness execution surfaces', () => {
  const script = Object.entries(WEB_VIEWER_APP_DIST_FILES)
    .filter(([name]) => name.endsWith('.js'))
    .map(([, encoded]) => Buffer.from(encoded, 'base64').toString('utf8'))
    .join('\n');
  assert.match(script, /goal contract/);
  assert.match(script, /cross-harness execution/);
  assert.match(script, /candidate routes/);
  assert.match(script, /Route outcome/);
});

test('materializeWebViewerAppDist writes bundled map to versioned home dir without cwd dist', () => {
  const home = mkHome();
  const html = '<!doctype html><html><body><div id="root"></div></body></html>';
  __setWebViewerAppDistTestHooks({
    bundled: true,
    version: '9.9.9-test',
    files: {
      'index.html': Buffer.from(html, 'utf8').toString('base64'),
      'assets/app.js': Buffer.from('console.log("ok")', 'utf8').toString('base64'),
    },
  });

  const prevCwd = process.cwd();
  try {
    process.chdir(tmpdir());
    const dir = materializeWebViewerAppDist(home, '9.9.9-test');
    assert.ok(dir);
    assert.equal(dir, materializedAppDistDir(home, '9.9.9-test'));
    assert.equal(readFileSync(join(dir!, 'index.html'), 'utf8'), html);
    assert.equal(readFileSync(join(dir!, 'assets', 'app.js'), 'utf8'), 'console.log("ok")');
    assert.equal(resolveAppDistDir(home), dir);
    assert.equal(ensureWebViewerAppDist(home), dir);
  } finally {
    process.chdir(prevCwd);
  }
});

test('resolveAppDistDir prefers materialized home assets over dev candidates', () => {
  const home = mkHome();
  const target = materializedAppDistDir(home, readVersion());
  mkdirSync(join(target, 'assets'), { recursive: true });
  writeFileSync(join(target, 'index.html'), '<html>home</html>', 'utf8');

  __setWebViewerAppDistTestHooks({ bundled: false, files: {} });
  assert.equal(resolveAppDistDir(home), target);
  assert.ok(hasIndexHtml(target));
});

test('ensureWebViewerAppDist throws when bundled assets are unavailable', () => {
  const home = mkHome();
  __setWebViewerAppDistTestHooks({ bundled: false, files: {}, disableDevCandidates: true });
  const prevCwd = process.cwd();
  try {
    process.chdir(tmpdir());
    assert.throws(() => ensureWebViewerAppDist(home), /missing web-viewer assets/);
  } finally {
    process.chdir(prevCwd);
  }
});

test('materialize invalidates a same-version cache when the bundled build changes (#178)', () => {
  const home = mkHome();
  const version = '0.21.0-fixed';

  // First install: an old frontend build under version X.
  __setWebViewerAppDistTestHooks({
    bundled: true,
    version,
    files: {
      'index.html': Buffer.from(
        '<!doctype html><html><body><script src="./assets/index-OLD.js"></script></body></html>',
        'utf8',
      ).toString('base64'),
      'assets/index-OLD.js': Buffer.from('console.log("old")', 'utf8').toString('base64'),
    },
  });
  const first = materializeWebViewerAppDist(home, version);
  assert.ok(first);
  assert.match(readFileSync(join(first!, 'index.html'), 'utf8'), /index-OLD\.js/);

  // Same version number, brand-new frontend build (different hashed asset name) —
  // e.g. a feature merged after the version bump (#178 repro).
  __setWebViewerAppDistTestHooks({
    bundled: true,
    version,
    files: {
      'index.html': Buffer.from(
        '<!doctype html><html><body><script src="./assets/index-NEW.js"></script></body></html>',
        'utf8',
      ).toString('base64'),
      'assets/index-NEW.js': Buffer.from('console.log("new")', 'utf8').toString('base64'),
    },
  });

  // Same versioned target dir — the stale cache must not shadow the new build.
  assert.equal(materializedAppDistDir(home, version), first);
  const second = materializeWebViewerAppDist(home, version);
  assert.equal(second, first, 're-materializes into the same versioned dir');
  assert.match(readFileSync(join(second!, 'index.html'), 'utf8'), /index-NEW\.js/);
  assert.equal(readFileSync(join(second!, 'assets', 'index-NEW.js'), 'utf8'), 'console.log("new")');
  // Orphaned old asset from the stale build is gone after the clean re-materialize.
  assert.ok(!existsSync(join(second!, 'assets', 'index-OLD.js')));
});

test('resolveAppDistDir re-materializes a stale same-version cache instead of shadowing it (#178)', () => {
  const home = mkHome();
  const version = '0.21.0-resolve';
  const prevCwd = process.cwd();
  try {
    process.chdir(tmpdir());
    __setWebViewerAppDistTestHooks({
      bundled: true,
      version,
      disableDevCandidates: true,
      files: {
        'index.html': Buffer.from('<html>OLD-UI</html>', 'utf8').toString('base64'),
        'assets/app-old.js': Buffer.from('old', 'utf8').toString('base64'),
      },
    });
    const first = resolveAppDistDir(home);
    assert.equal(first, materializedAppDistDir(home, version));
    assert.match(readFileSync(join(first!, 'index.html'), 'utf8'), /OLD-UI/);

    __setWebViewerAppDistTestHooks({
      bundled: true,
      version,
      disableDevCandidates: true,
      files: {
        'index.html': Buffer.from('<html>NEW-UI</html>', 'utf8').toString('base64'),
        'assets/app-new.js': Buffer.from('new', 'utf8').toString('base64'),
      },
    });
    const second = resolveAppDistDir(home);
    assert.equal(second, first, 'same versioned dir, refreshed in place');
    assert.match(readFileSync(join(second!, 'index.html'), 'utf8'), /NEW-UI/);
    assert.ok(!existsSync(join(second!, 'assets', 'app-old.js')));
  } finally {
    process.chdir(prevCwd);
  }
});

test('materialize keeps the cache (no rewrite) when the bundled build id is unchanged', () => {
  const home = mkHome();
  const version = '1.2.3-stable';
  const files = {
    'index.html': Buffer.from('<html>stable</html>', 'utf8').toString('base64'),
    'assets/app.js': Buffer.from('stable', 'utf8').toString('base64'),
  };
  __setWebViewerAppDistTestHooks({ bundled: true, version, files });
  const dir = materializeWebViewerAppDist(home, version);
  assert.ok(dir);
  // Sentinel proves the fast path does not wipe/rewrite the dir on an unchanged build.
  const sentinel = join(dir!, 'sentinel.txt');
  writeFileSync(sentinel, 'keep-me', 'utf8');
  const again = materializeWebViewerAppDist(home, version);
  assert.equal(again, dir);
  assert.ok(existsSync(sentinel), 'unchanged build must not wipe/rewrite the cache dir');
});

test('materialize gc removes older app-dist versions best-effort', () => {
  const home = mkHome();
  const oldDir = materializedAppDistDir(home, '0.0.1');
  mkdirSync(oldDir, { recursive: true });
  writeFileSync(join(oldDir, 'index.html'), '<html>old</html>', 'utf8');

  __setWebViewerAppDistTestHooks({
    bundled: true,
    version: '0.0.2',
    files: {
      'index.html': Buffer.from('<html>new</html>', 'utf8').toString('base64'),
    },
  });
  materializeWebViewerAppDist(home, '0.0.2');
  assert.ok(!hasIndexHtml(oldDir));
  assert.ok(hasIndexHtml(materializedAppDistDir(home, '0.0.2')));
});
