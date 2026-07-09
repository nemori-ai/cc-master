import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import * as monitor from '../src/handlers/monitor.js';
import * as webViewer from '../src/handlers/web-viewer.js';
import { readVersion } from '../src/help.js';
import * as io from '../src/io.js';
import { run } from '../src/router.js';
import {
  __resetWebViewerAppDistTestHooks,
  __setWebViewerAppDistTestHooks,
  materializedAppDistDir,
} from '../src/web-viewer-app-dist.js';

const EXIT = io.EXIT;

let TMPDIRS: string[] = [];

afterEach(() => {
  monitor.__resetMonitorTestHooks();
  webViewer.__resetWebViewerTestHooks();
  __resetWebViewerAppDistTestHooks();
  for (const d of TMPDIRS) rmSync(d, { recursive: true, force: true });
  TMPDIRS = [];
});

function mkHome(): string {
  const root = mkdtempSync(join(tmpdir(), 'ccm-services-'));
  TMPDIRS.push(root);
  const home = join(root, '.cc_master');
  mkdirSync(join(home, 'boards'), { recursive: true });
  return home;
}

function invoke(args: string[], home: string): { code: number; stdout: string; stderr: string } {
  const out: string[] = [];
  const err: string[] = [];
  const code = run(args, {
    env: { HOME: join(home, '..'), CC_MASTER_HOME: home },
    out: (s: string) => out.push(s),
    err: (s: string) => err.push(s),
  });
  assert.equal(typeof code, 'number');
  return { code: code as number, stdout: out.join('\n'), stderr: err.join('\n') };
}

function json(stdout: string): any {
  return JSON.parse(stdout);
}

test('services reconcile on a blank home does not auto-start web-viewer or monitor', () => {
  const home = mkHome();
  const r = invoke(['services', 'reconcile', '--after-binary-replace', '--json'], home);
  assert.equal(r.code, EXIT.OK, r.stderr);
  const data = json(r.stdout).data;
  assert.equal(data.restarted, 0);
  assert.equal(data.skipped, 1, 'blank home only has monitor not-wanted plan; no web-viewer state');
  assert.deepEqual(
    data.services.map((s: { service: string; wanted: boolean; action: string }) => ({
      service: s.service,
      wanted: s.wanted,
      action: s.action,
    })),
    [{ service: 'monitor', wanted: false, action: 'skip' }],
  );
});

test('services reconcile restarts wanted monitor and leaves not-wanted web-viewer stopped', () => {
  const home = mkHome();
  const monitorRoot = join(home, 'services', 'monitor');
  mkdirSync(monitorRoot, { recursive: true });
  writeFileSync(
    join(monitorRoot, 'state.json'),
    `${JSON.stringify(
      {
        schema: 'ccm/monitor-service/v1',
        id: 'monitor',
        pid: 0,
        wanted: true,
        home,
        state_path: join(monitorRoot, 'state.json'),
        pid_path: join(monitorRoot, 'pid'),
        log_path: join(monitorRoot, 'log'),
        interval_sec: 45,
        server: { started_at: '2026-07-09T10:00:00Z', ccm_version: '0.0.1' },
        last_tick_at: null,
        last_error: null,
        tick_count: 0,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  const wvRoot = join(home, 'services', 'web-viewer');
  mkdirSync(join(wvRoot, 'instances'), { recursive: true });
  mkdirSync(join(wvRoot, 'tokens'), { recursive: true });
  writeFileSync(
    join(wvRoot, 'instances', 'wv_stopped.json'),
    `${JSON.stringify(
      {
        schema: 'ccm/web-viewer-service/v1',
        id: 'wv_stopped',
        pid: 0,
        wanted: false,
        home,
        state_path: join(wvRoot, 'instances', 'wv_stopped.json'),
        token_file: join(wvRoot, 'tokens', 'wv_stopped.token'),
        token_sha256: 'sha256:test',
        initial_board_path: null,
        current_selection: null,
        scope: { home, session_id: '' },
        host: '127.0.0.1',
        port: 0,
        base_url: 'http://127.0.0.1:0',
        url: 'http://127.0.0.1:0/?token=<redacted>',
        server: { started_at: '2026-07-09T10:00:00Z', ccm_version: '0.0.1' },
        log_path: join(wvRoot, 'logs', 'wv_stopped.log'),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  let monitorSpawn = 0;
  let webViewerSpawn = 0;
  monitor.__setMonitorTestHooks({
    spawnService: ({ statePath }) => {
      monitorSpawn += 1;
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      writeFileSync(statePath, `${JSON.stringify({ ...state, pid: 4001 }, null, 2)}\n`, 'utf8');
      return { pid: 4001 };
    },
    isPidAlive: (pid) => pid === 4001,
  });
  webViewer.__setWebViewerTestHooks({
    spawnService: () => {
      webViewerSpawn += 1;
      return { pid: 5001 };
    },
    isPidAlive: () => false,
  });

  const r = invoke(['services', 'reconcile', '--after-binary-replace', '--json'], home);
  assert.equal(r.code, EXIT.OK, r.stderr);
  const data = json(r.stdout).data;
  assert.equal(data.restarted, 1);
  assert.equal(monitorSpawn, 1);
  assert.equal(webViewerSpawn, 0, 'not-wanted web-viewer must not be started on reconcile');
  const monitorResult = data.services.find((s: { service: string }) => s.service === 'monitor');
  assert.equal(monitorResult.reason, 'restarted');
});

test('services reconcile restarts wanted web-viewer and reports version drift fields', () => {
  const home = mkHome();
  const wvRoot = join(home, 'services', 'web-viewer');
  mkdirSync(join(wvRoot, 'instances'), { recursive: true });
  mkdirSync(join(wvRoot, 'tokens'), { recursive: true });
  writeFileSync(join(wvRoot, 'tokens', 'wv_wanted.token'), 'token', 'utf8');
  const statePath = join(wvRoot, 'instances', 'wv_wanted.json');
  writeFileSync(
    statePath,
    `${JSON.stringify(
      {
        schema: 'ccm/web-viewer-service/v1',
        id: 'wv_wanted',
        pid: 0,
        wanted: true,
        home,
        state_path: statePath,
        token_file: join(wvRoot, 'tokens', 'wv_wanted.token'),
        token_sha256: 'sha256:test',
        initial_board_path: null,
        current_selection: null,
        scope: { home, session_id: '' },
        host: '127.0.0.1',
        port: 0,
        base_url: 'http://127.0.0.1:0',
        url: 'http://127.0.0.1:0/?token=<redacted>',
        server: { started_at: '2026-07-09T10:00:00Z', ccm_version: '0.0.1' },
        log_path: join(wvRoot, 'logs', 'wv_wanted.log'),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  let spawnCount = 0;
  webViewer.__setWebViewerTestHooks({
    randomToken: () => 'fresh-token',
    spawnService: ({ statePath: nextStatePath }) => {
      spawnCount += 1;
      const state = JSON.parse(readFileSync(nextStatePath, 'utf8'));
      writeFileSync(
        nextStatePath,
        `${JSON.stringify({ ...state, pid: 6001, port: 56001, base_url: 'http://127.0.0.1:56001' }, null, 2)}\n`,
        'utf8',
      );
      return { pid: 6001 };
    },
    isPidAlive: (pid) => pid === 6001,
    healthCheck: (service) => ({
      ok: true,
      body: {
        schema: 'ccm/web-viewer-health/v1',
        id: service.id,
        pid: service.pid,
        started_at: service.server.started_at,
      },
    }),
  });

  const r = invoke(['services', 'reconcile', '--after-binary-replace', '--json'], home);
  assert.equal(r.code, EXIT.OK, r.stderr);
  const web = json(r.stdout).data.services.find((s: { service: string }) => s.service === 'web-viewer');
  assert.equal(web.wanted, true);
  assert.equal(web.binary_match, false);
  assert.equal(web.running_ccm_version, '0.0.1');
  assert.equal(web.installed_ccm_version, readVersion());
  assert.equal(web.reason, 'restarted');
  assert.equal(spawnCount, 1);
});

test('services reconcile materializes web-viewer assets before restarting wanted service', () => {
  const home = mkHome();
  __setWebViewerAppDistTestHooks({
    bundled: true,
    version: readVersion(),
    files: {
      'index.html': Buffer.from('<html><body><div id="root"></div></body></html>', 'utf8').toString(
        'base64',
      ),
    },
  });
  const wvRoot = join(home, 'services', 'web-viewer');
  mkdirSync(join(wvRoot, 'instances'), { recursive: true });
  mkdirSync(join(wvRoot, 'tokens'), { recursive: true });
  writeFileSync(join(wvRoot, 'tokens', 'wv_wanted.token'), 'token', 'utf8');
  const statePath = join(wvRoot, 'instances', 'wv_wanted.json');
  writeFileSync(
    statePath,
    `${JSON.stringify(
      {
        schema: 'ccm/web-viewer-service/v1',
        id: 'wv_wanted',
        pid: 0,
        wanted: true,
        home,
        state_path: statePath,
        token_file: join(wvRoot, 'tokens', 'wv_wanted.token'),
        token_sha256: 'sha256:test',
        initial_board_path: null,
        current_selection: null,
        scope: { home, session_id: '' },
        host: '127.0.0.1',
        port: 0,
        base_url: 'http://127.0.0.1:0',
        url: 'http://127.0.0.1:0/?token=<redacted>',
        server: { started_at: '2026-07-09T10:00:00Z', ccm_version: '0.0.1' },
        log_path: join(wvRoot, 'logs', 'wv_wanted.log'),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  webViewer.__setWebViewerTestHooks({
    randomToken: () => 'fresh-token',
    spawnService: ({ statePath: nextStatePath }) => {
      const state = JSON.parse(readFileSync(nextStatePath, 'utf8'));
      writeFileSync(
        nextStatePath,
        `${JSON.stringify({ ...state, pid: 6001, port: 56001, base_url: 'http://127.0.0.1:56001' }, null, 2)}\n`,
        'utf8',
      );
      return { pid: 6001 };
    },
    isPidAlive: (pid) => pid === 6001,
    healthCheck: (service) => ({
      ok: true,
      body: {
        schema: 'ccm/web-viewer-health/v1',
        id: service.id,
        pid: service.pid,
        started_at: service.server.started_at,
      },
    }),
  });

  const r = invoke(['services', 'reconcile', '--after-binary-replace', '--json'], home);
  assert.equal(r.code, EXIT.OK, r.stderr);
  const web = json(r.stdout).data.services.find((s: { service: string }) => s.service === 'web-viewer');
  assert.equal(web.reason, 'restarted');
  assert.ok(
    existsSync(join(materializedAppDistDir(home), 'index.html')),
    'reconcile ensures versioned app-dist before restart',
  );
});
