import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
