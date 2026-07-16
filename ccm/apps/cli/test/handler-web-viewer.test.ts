import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import * as webViewer from '../src/handlers/web-viewer.js';
import { readVersion } from '../src/help.js';
import * as io from '../src/io.js';
import { run } from '../src/router.js';
import {
  __resetWebViewerAppDistTestHooks,
  __setWebViewerAppDistTestHooks,
} from '../src/web-viewer-app-dist.js';

const EXIT = io.EXIT;
const SID = 'wv-test-session';

let TMPDIRS: string[] = [];

afterEach(() => {
  webViewer.__resetWebViewerTestHooks();
  __resetWebViewerAppDistTestHooks();
  for (const d of TMPDIRS) rmSync(d, { recursive: true, force: true });
  TMPDIRS = [];
});

function mkTmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  TMPDIRS.push(d);
  return d;
}

function mkHome(): string {
  const home = join(mkTmp('ccm-web-viewer-'), '.cc_master');
  mkdirSync(join(home, 'boards'), { recursive: true });
  return home;
}

function seedBoard(
  home: string,
  {
    file = '20260708T120000Z-1.board.json',
    goal = 'Ship viewer lifecycle',
    sid = SID,
    tasks = [],
    extras = {},
  }: {
    file?: string;
    goal?: string;
    sid?: string;
    tasks?: Array<Record<string, unknown>>;
    extras?: Record<string, unknown>;
  } = {},
): string {
  const boardPath = join(home, 'boards', file);
  const board = {
    schema: 'cc-master/v2',
    meta: { template_version: 3 },
    goal,
    owner: { active: true, session_id: sid, heartbeat: '2026-07-08T12:00:00Z' },
    git: { worktree: '', branch: '' },
    scheduling: { wip_limit: 4 },
    tasks,
    log: [],
    ...extras,
  };
  writeFileSync(boardPath, `${JSON.stringify(board, null, 2)}\n`, 'utf8');
  return boardPath;
}

function invoke(args: string[], home: string): { code: number; stdout: string; stderr: string } {
  const outBuf: string[] = [];
  const errBuf: string[] = [];
  const code = run(args, {
    env: {
      HOME: join(home, '..'),
      CC_MASTER_HOME: home,
      CC_MASTER_HARNESS: 'claude-code',
      CLAUDE_CODE_SESSION_ID: SID,
    },
    out: (s: string) => outBuf.push(s),
    err: (s: string) => errBuf.push(s),
  });
  assert.equal(typeof code, 'number', 'web-viewer handlers are sync except serve');
  return { code: code as number, stdout: outBuf.join('\n'), stderr: errBuf.join('\n') };
}

function json(stdout: string): any {
  return JSON.parse(stdout);
}

function httpJson(args: {
  port: number;
  path: string;
  token?: string;
  method?: string;
}): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: args.port,
        path: args.path,
        method: args.method || 'GET',
        headers: args.token ? { Authorization: `Bearer ${args.token}` } : {},
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => {
          resolve({ status: res.statusCode || 0, body: body ? JSON.parse(body) : null });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function httpText(args: {
  port: number;
  path: string;
  token?: string;
  method?: string;
}): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: args.port,
        path: args.path,
        method: args.method || 'GET',
        headers: args.token ? { Authorization: `Bearer ${args.token}` } : {},
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => {
          resolve({ status: res.statusCode || 0, body, headers: res.headers });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('router exposes web-viewer namespace and status --json reports stopped without a service', () => {
  const home = mkHome();
  const r = invoke(['web-viewer', 'status', '--json'], home);
  assert.equal(r.code, EXIT.OK);
  const parsed = json(r.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.running, false);
  assert.equal(parsed.service, null);
});

// ── `ccm viewer` namespace alias (NOUN_ALIASES → web-viewer) ─────────────────────────────────────
test('ccm viewer <verb> is equivalent to ccm web-viewer <verb> for every verb', () => {
  const home = mkHome();
  const alias = invoke(['viewer', 'status', '--json'], home);
  const real = invoke(['web-viewer', 'status', '--json'], home);
  assert.equal(alias.code, real.code);
  assert.deepEqual(json(alias.stdout), json(real.stdout));
});

test('bare ccm viewer behaves identically to bare ccm web-viewer (missing-command usage error)', () => {
  const home = mkHome();
  const alias = invoke(['viewer'], home);
  const real = invoke(['web-viewer'], home);
  assert.equal(alias.code, real.code);
  // 错误提示走 err()（usage 层未走 --json 壳），直接对齐 stderr 文案。
  assert.equal(alias.stderr, real.stderr);
});

test('start creates a home-scoped service, records initial selection, and reuses a healthy instance', () => {
  const home = mkHome();
  const boardPath = seedBoard(home, { goal: 'Viewer Goal' });
  let spawnCount = 0;
  webViewer.__setWebViewerTestHooks({
    now: () => new Date('2026-07-08T12:01:02Z'),
    randomToken: () => 'raw-token-one',
    spawnService: ({ statePath, token }) => {
      spawnCount += 1;
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      writeFileSync(
        statePath,
        `${JSON.stringify({ ...state, pid: 43210, port: 51234, base_url: 'http://127.0.0.1:51234' }, null, 2)}\n`,
        'utf8',
      );
      assert.equal(token, 'raw-token-one');
      return { pid: 43210 };
    },
    isPidAlive: (pid) => pid === 43210,
    healthCheck: (service) => ({
      ok: service.pid === 43210,
      body: {
        schema: 'ccm/web-viewer-health/v1',
        id: service.id,
        pid: 43210,
        started_at: '2026-07-08T12:01:02Z',
      },
    }),
  });

  const first = invoke(['web-viewer', 'start', '--goal', 'viewer goal', '--json'], home);
  assert.equal(first.code, EXIT.OK, first.stderr);
  const firstJson = json(first.stdout);
  assert.equal(firstJson.ok, true);
  assert.equal(firstJson.reused, false);
  assert.equal(firstJson.service.home, home);
  assert.equal(firstJson.service.initial_board_path, boardPath);
  assert.equal(firstJson.service.current_selection.goal, 'Viewer Goal');
  assert.equal(firstJson.service.scope.home, home);
  assert.equal(
    firstJson.service.url,
    'http://127.0.0.1:51234/?token=<redacted>&board=20260708T120000Z-1.board.json',
  );
  assert.equal(
    firstJson.open_url,
    'http://127.0.0.1:51234/?token=raw-token-one&board=20260708T120000Z-1.board.json',
  );
  assert.equal(spawnCount, 1);

  const second = invoke(['web-viewer', 'start', '--json'], home);
  assert.equal(second.code, EXIT.OK, second.stderr);
  const secondJson = json(second.stdout);
  assert.equal(secondJson.reused, true);
  assert.equal(secondJson.service.id, firstJson.service.id);
  assert.equal(spawnCount, 1, 'healthy home-scoped service is reused');
});

test('healthy reuse applies a new board/goal selection without creating a new service', () => {
  const home = mkHome();
  const firstBoard = seedBoard(home, {
    file: '20260708T120000Z-a.board.json',
    goal: 'Alpha Goal',
  });
  const secondBoard = seedBoard(home, {
    file: '20260708T120000Z-b.board.json',
    goal: 'Beta Goal',
  });
  let spawnCount = 0;
  webViewer.__setWebViewerTestHooks({
    now: () => new Date('2026-07-08T12:01:02Z'),
    randomToken: () => 'switch-token',
    spawnService: ({ statePath }) => {
      spawnCount += 1;
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      writeFileSync(
        statePath,
        `${JSON.stringify({ ...state, pid: 24680, port: 51235, base_url: 'http://127.0.0.1:51235' }, null, 2)}\n`,
        'utf8',
      );
      return { pid: 24680 };
    },
    isPidAlive: (pid) => pid === 24680,
    healthCheck: (service) => ({
      ok: true,
      body: {
        schema: 'ccm/web-viewer-health/v1',
        id: service.id,
        pid: 24680,
        started_at: service.server.started_at,
      },
    }),
    openUrl: () => ({ opened: false, reason: 'no gui' }),
  });

  const first = invoke(['web-viewer', 'start', '--board', firstBoard, '--json'], home);
  assert.equal(first.code, EXIT.OK, first.stderr);
  const firstJson = json(first.stdout);

  const reused = invoke(['web-viewer', 'start', '--board', secondBoard, '--json'], home);
  assert.equal(reused.code, EXIT.OK, reused.stderr);
  const reusedJson = json(reused.stdout);
  assert.equal(reusedJson.reused, true);
  assert.equal(reusedJson.service.id, firstJson.service.id);
  assert.equal(reusedJson.service.current_selection.board_path, secondBoard);
  assert.equal(
    reusedJson.open_url,
    'http://127.0.0.1:51235/?token=switch-token&board=20260708T120000Z-b.board.json',
  );
  assert.ok(!reused.stdout.includes('switch-token"'), 'raw token only appears in open_url value');
  assert.equal(spawnCount, 1, 'selection switch reuses the home-scoped service');

  const state = JSON.parse(readFileSync(reusedJson.service.state_path, 'utf8'));
  assert.equal(state.current_selection.board_path, secondBoard);
  assert.equal(state.initial_board_path, firstBoard, 'initial launch board remains stable');

  const opened = invoke(['web-viewer', 'open', '--goal', 'alpha goal', '--json'], home);
  assert.equal(opened.code, EXIT.OK, opened.stderr);
  const openedJson = json(opened.stdout);
  assert.equal(openedJson.service.id, firstJson.service.id);
  assert.equal(openedJson.service.current_selection.board_path, firstBoard);
  assert.equal(
    openedJson.open_url,
    'http://127.0.0.1:51235/?token=switch-token&board=20260708T120000Z-a.board.json',
  );
  assert.equal(
    JSON.parse(readFileSync(reusedJson.service.state_path, 'utf8')).current_selection.board_path,
    firstBoard,
  );
});

test('authoritative state publish fault preserves the complete prior revision and token secrecy', () => {
  const home = mkHome();
  const firstBoard = seedBoard(home, {
    file: '20260708T120000Z-durable-a.board.json',
    goal: 'Durable state A',
  });
  const secondBoard = seedBoard(home, {
    file: '20260708T120000Z-durable-b.board.json',
    goal: 'Durable state B',
  });
  const secretToken = 'state-durability-secret-token';
  webViewer.__setWebViewerTestHooks({
    now: () => new Date('2026-07-08T12:01:02Z'),
    randomToken: () => secretToken,
    spawnService: ({ statePath }) => {
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      writeFileSync(
        statePath,
        `${JSON.stringify({ ...state, pid: 24681, port: 51236, base_url: 'http://127.0.0.1:51236' }, null, 2)}\n`,
        'utf8',
      );
      return { pid: 24681 };
    },
    isPidAlive: (pid) => pid === 24681,
    healthCheck: (service) => ({
      ok: true,
      body: {
        schema: 'ccm/web-viewer-health/v1',
        id: service.id,
        pid: 24681,
        started_at: service.server.started_at,
      },
    }),
  });

  const started = invoke(['web-viewer', 'start', '--board', firstBoard, '--json'], home);
  assert.equal(started.code, EXIT.OK, started.stderr);
  const service = json(started.stdout).service;
  const before = readFileSync(service.state_path, 'utf8');
  assert.equal(JSON.parse(before).current_selection.board_path, firstBoard);
  assert.ok(!before.includes(secretToken), 'authoritative state never stores the raw token');
  assert.equal(statSync(service.state_path).mode & 0o777, 0o600, 'state is owner-only');
  assert.equal(statSync(service.token_file).mode & 0o777, 0o600, 'token file stays owner-only');

  const checkpoints: string[] = [];
  webViewer.__setWebViewerTestHooks({
    isPidAlive: (pid) => pid === 24681,
    healthCheck: (candidate) => ({
      ok: true,
      body: {
        schema: 'ccm/web-viewer-health/v1',
        id: candidate.id,
        pid: 24681,
        started_at: candidate.server.started_at,
      },
    }),
    durableWriteFault: (checkpoint) => {
      checkpoints.push(checkpoint);
      if (checkpoint === 'data-written') {
        throw Object.assign(new Error('injected state publish fault'), { code: 'EIO' });
      }
    },
  });

  const failed = invoke(['web-viewer', 'start', '--board', secondBoard, '--json'], home);
  assert.equal(failed.code, EXIT.ERROR, failed.stderr);
  assert.ok(checkpoints.includes('data-written'), 'web-viewer reached the durable publish seam');
  assert.ok(!failed.stderr.includes(secretToken), 'fault reporting never exposes the raw token');

  const after = readFileSync(service.state_path, 'utf8');
  assert.equal(
    after,
    before,
    'failed publish leaves the prior authoritative revision byte-complete',
  );
  assert.equal(JSON.parse(after).current_selection.board_path, firstBoard);
  assert.equal(
    readFileSync(service.token_file, 'utf8'),
    secretToken,
    'token remains in its 0600 file',
  );
});

test('start cleans stale state before creating a replacement service', () => {
  const home = mkHome();
  seedBoard(home);
  webViewer.__setWebViewerTestHooks({
    randomToken: () => 'fresh-token',
    isPidAlive: (pid) => pid === 222,
    spawnService: ({ statePath }) => {
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      writeFileSync(
        statePath,
        `${JSON.stringify({ ...state, pid: 222, port: 52000, base_url: 'http://127.0.0.1:52000' }, null, 2)}\n`,
        'utf8',
      );
      return { pid: 222 };
    },
    healthCheck: (service) => ({
      ok: true,
      body: {
        schema: 'ccm/web-viewer-health/v1',
        id: service.id,
        pid: 222,
        started_at: service.server.started_at,
      },
    }),
  });

  const first = invoke(['web-viewer', 'start', '--json'], home);
  assert.equal(first.code, EXIT.OK);
  const statePath = json(first.stdout).service.state_path;
  const stale = JSON.parse(readFileSync(statePath, 'utf8'));
  writeFileSync(statePath, `${JSON.stringify({ ...stale, pid: 999999 }, null, 2)}\n`, 'utf8');

  const second = invoke(['web-viewer', 'start', '--json'], home);
  assert.equal(second.code, EXIT.OK, second.stderr);
  const service = json(second.stdout).service;
  assert.equal(service.pid, 222);
  assert.equal(service.stale, false);
  assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).pid, 222);
});

test('status redacts raw tokens and marks stale services', () => {
  const home = mkHome();
  seedBoard(home);
  webViewer.__setWebViewerTestHooks({
    randomToken: () => 'secret-token',
    isPidAlive: (pid) => pid === 777,
    spawnService: ({ statePath }) => {
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      writeFileSync(
        statePath,
        `${JSON.stringify({ ...state, pid: 777, port: 53000, base_url: 'http://127.0.0.1:53000' }, null, 2)}\n`,
        'utf8',
      );
      return { pid: 777 };
    },
    healthCheck: (service) => ({
      ok: service.pid === 777,
      body: {
        schema: 'ccm/web-viewer-health/v1',
        id: service.id,
        pid: 777,
        started_at: service.server.started_at,
      },
    }),
  });

  assert.equal(invoke(['web-viewer', 'start', '--json'], home).code, EXIT.OK);
  webViewer.__setWebViewerTestHooks({
    isPidAlive: () => false,
    healthCheck: () => ({ ok: false }),
  });
  const status = invoke(['web-viewer', 'status', '--json'], home);
  assert.equal(status.code, EXIT.OK);
  assert.ok(!status.stdout.includes('secret-token'), 'status does not leak token');
  assert.equal(json(status.stdout).service.stale, true);
});

test('status exposes binary_match and running/installed ccm versions', () => {
  const home = mkHome();
  seedBoard(home);
  webViewer.__setWebViewerTestHooks({
    randomToken: () => 'version-token',
    isPidAlive: (pid) => pid === 778,
    spawnService: ({ statePath }) => {
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      writeFileSync(
        statePath,
        `${JSON.stringify(
          {
            ...state,
            pid: 778,
            port: 53001,
            base_url: 'http://127.0.0.1:53001',
            server: { ...state.server, ccm_version: '0.0.1' },
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      return { pid: 778 };
    },
    healthCheck: (service) => ({
      ok: true,
      body: {
        schema: 'ccm/web-viewer-health/v1',
        id: service.id,
        pid: 778,
        started_at: service.server.started_at,
      },
    }),
  });

  assert.equal(invoke(['web-viewer', 'start', '--json'], home).code, EXIT.OK);
  const status = invoke(['web-viewer', 'status', '--json'], home);
  const parsed = json(status.stdout);
  assert.equal(parsed.running, true);
  assert.equal(parsed.binary_match, false);
  assert.equal(parsed.running_ccm_version, '0.0.1');
  assert.equal(parsed.installed_ccm_version, readVersion());
  assert.equal(parsed.service.binary_match, false);
});

test('status tolerates malformed state files as invalid entries', () => {
  const home = mkHome();
  const dir = join(home, 'services', 'web-viewer', 'instances');
  mkdirSync(dir, { recursive: true });
  const badState = join(dir, 'wv_bad.json');
  writeFileSync(badState, '{ bad json', 'utf8');

  const status = invoke(['web-viewer', 'status', 'wv_bad', '--json'], home);
  assert.equal(status.code, EXIT.OK);
  assert.equal(json(status.stdout).running, false);
  assert.equal(json(status.stdout).service.health, 'invalid');
  assert.equal(json(status.stdout).service.state_path, badState);
});

test('open --no-start reports no service, while open degrades to printing URL when opener declines', () => {
  const home = mkHome();
  seedBoard(home);
  const missing = invoke(['web-viewer', 'open', '--no-start', '--json'], home);
  assert.equal(missing.code, EXIT.OK);
  assert.equal(json(missing.stdout).opened, false);
  assert.equal(json(missing.stdout).service, null);

  webViewer.__setWebViewerTestHooks({
    randomToken: () => 'open-token',
    spawnService: ({ statePath }) => {
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      writeFileSync(
        statePath,
        `${JSON.stringify({ ...state, pid: 123, port: 54000, base_url: 'http://127.0.0.1:54000' }, null, 2)}\n`,
        'utf8',
      );
      return { pid: 123 };
    },
    isPidAlive: (pid) => pid === 123,
    healthCheck: (service) => ({
      ok: true,
      body: {
        schema: 'ccm/web-viewer-health/v1',
        id: service.id,
        pid: 123,
        started_at: service.server.started_at,
      },
    }),
    openUrl: () => ({ opened: false, reason: 'no gui' }),
  });
  const opened = invoke(['web-viewer', 'open', '--json'], home);
  assert.equal(opened.code, EXIT.OK, opened.stderr);
  const parsed = json(opened.stdout);
  assert.equal(parsed.opened, false);
  assert.equal(parsed.open_error, 'no gui');
  assert.equal(parsed.open_url, 'http://127.0.0.1:54000/?token=open-token');
});

test('stop removes stale state and restart creates a new token', () => {
  const home = mkHome();
  seedBoard(home);
  let token = 'token-a';
  webViewer.__setWebViewerTestHooks({
    randomToken: () => token,
    isPidAlive: (pid) => pid === 321 || pid === 654,
    spawnService: ({ statePath }) => {
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      writeFileSync(
        statePath,
        `${JSON.stringify({ ...state, pid: token === 'token-a' ? 321 : 654, port: 55000, base_url: 'http://127.0.0.1:55000' }, null, 2)}\n`,
        'utf8',
      );
      return { pid: token === 'token-a' ? 321 : 654 };
    },
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

  const started = invoke(['web-viewer', 'start', '--json'], home);
  const statePath = json(started.stdout).service.state_path;
  assert.ok(existsSync(statePath));

  const stopped = invoke(['web-viewer', 'stop', '--json'], home);
  assert.equal(stopped.code, EXIT.OK);
  assert.equal(json(stopped.stdout).stopped, true);
  assert.ok(!existsSync(statePath), 'stop cleans stale state');

  assert.equal(invoke(['web-viewer', 'start', '--json'], home).code, EXIT.OK);
  token = 'token-b';
  const restarted = invoke(['web-viewer', 'restart', '--json'], home);
  assert.equal(restarted.code, EXIT.OK, restarted.stderr);
  const parsed = json(restarted.stdout);
  assert.equal(parsed.previous.token_sha256.startsWith('sha256:'), true);
  assert.notEqual(parsed.open_url, 'http://127.0.0.1:55000/?token=token-a');
  assert.equal(parsed.open_url, 'http://127.0.0.1:55000/?token=token-b');
});

test('start rejects non-localhost host and boards outside the selected home', () => {
  const home = mkHome();
  const other = mkHome();
  const outsideBoard = seedBoard(other);

  const badHost = invoke(['web-viewer', 'start', '--host', '0.0.0.0', '--json'], home);
  assert.equal(badHost.code, EXIT.VALIDATION);

  const badBoard = invoke(['web-viewer', 'start', '--board', outsideBoard, '--json'], home);
  assert.equal(badBoard.code, EXIT.NOT_FOUND);
  assert.match(badBoard.stderr, /outside.*home boards|ok":false/);
});

test('serve exposes built Vite viewer app, app-shaped JSON APIs, and writes no board JSON', async () => {
  const home = mkHome();
  const boardPath = seedBoard(home, {
    extras: {
      goal_contract: {
        schema: 'ccm/goal-contract/v1',
        revision: 3,
        assurance: 'confirmed',
        brief: { ref: 'design_docs/spec.md', sha256: 'sha256:brief' },
        updated_at: '2026-07-08T11:58:00Z',
      },
      owner: {
        active: true,
        session_id: SID,
        harness: 'claude-code',
        heartbeat: '2026-07-08T12:00:00Z',
      },
    },
    tasks: [
      { id: 'A', title: 'Design viewer shell', status: 'done', deps: [], verified: true },
      { id: 'B', title: 'Wire DAG read model', status: 'in_flight', deps: ['A'] },
      { id: 'C', title: 'Polish browser layout', status: 'ready', deps: ['A'] },
      {
        id: 'D',
        title: 'User decision',
        status: 'blocked',
        type: 'decision',
        executor: 'codex',
        handle: 'run_test_detail',
        blocked_on: 'user',
        deps: ['B', 'C'],
        parent: 'B',
        estimate: { effort: 'S' },
        acceptance: ['decision captured'],
        artifact: { path: 'design_docs/plans/web-viewer.md' },
        verified: false,
        created_at: '2026-07-08T12:00:00Z',
        started_at: '2026-07-08T12:02:00Z',
        updated_at: '2026-07-08T12:03:00Z',
        decision_package: { question: 'approve launch' },
        planning: {
          schema: 'ccm/task-planning/v1',
          assessed_at: '2026-07-08T12:01:00Z',
          assessor: 'master',
          dimensions: {
            reasoning: 'multi-step',
            uncertainty: 'medium',
            risk: 'high',
            scope: 'cross-module',
            context: 'large',
            coordination: 'multi-boundary',
            reversibility: 'costly',
          },
          estimate_confidence: 'high',
          quality: { effect_floor: 'T1' },
          budget: { posture: 'ample', max_attempts: 3 },
          capabilities: {
            required: [{ id: 'code-review' }],
            preferred: [{ id: 'architecture' }],
            forbidden: [{ id: 'account-mutation' }],
          },
        },
        routing: {
          schema: 'ccm/agent-routing/v1',
          mode: 'cross-harness',
          policy: {
            objective: 'balanced',
            constraints: {
              effect_floor: 'T1',
              quota_unknown: 'ineligible',
              cross_harness_quota_admission: 'ample-only',
            },
            candidates: [
            {
              id: 'claude-native',
              adapter: 'claude-code',
              harness: 'claude-code',
              provider: 'anthropic',
              surface: 'host-native',
              model: 'fable-5',
              effort: 'high',
              requires: [
                'capability-match',
                'effect-floor',
                'permission-compatible',
                'account-mutation-forbidden',
              ],
              capabilities: ['architecture', 'code-review'],
              effect_floors_met: ['O', 'T1'],
              permission: { profile: 'read-only', denies: ['account-mutation'] },
              account_mutation: 'forbidden',
            },
            {
              id: 'codex-cli',
              adapter: 'codex',
              harness: 'codex',
              provider: 'openai',
              surface: 'cli-headless',
              model: 'gpt-5.6-sol',
              effort: 'high',
              requires: [
                'capability-match',
                'effect-floor',
                'permission-compatible',
                'account-mutation-forbidden',
              ],
              capabilities: ['code-review'],
              effect_floors_met: ['T1'],
              permission: { profile: 'read-only', denies: ['account-mutation'] },
              account_mutation: 'forbidden',
            },
            {
              id: 'cursor-ide',
              adapter: 'cursor-ide',
              harness: 'cursor',
              provider: 'cursor',
              surface: 'host-native',
              model: 'grok-4.5',
              effort: 'high',
              requires: [
                'capability-match',
                'effect-floor',
                'permission-compatible',
                'account-mutation-forbidden',
              ],
              capabilities: ['code-review'],
              effect_floors_met: ['T1', 'T2'],
              permission: { profile: 'read-only', denies: ['account-mutation'] },
              account_mutation: 'forbidden',
            },
            {
              id: 'cursor-agent',
              adapter: 'cursor-agent',
              harness: 'cursor',
              provider: 'cursor',
              surface: 'cli-headless',
              model: 'grok-4.5',
              effort: 'high',
              requires: [
                'capability-match',
                'effect-floor',
                'permission-compatible',
                'account-mutation-forbidden',
              ],
              capabilities: ['code-review'],
              effect_floors_met: ['T1', 'T2'],
              permission: { profile: 'read-only', denies: ['account-mutation'] },
              account_mutation: 'forbidden',
            },
            {
              id: 'cursor-malformed',
              adapter: 'cursor-agent',
              harness: 'cursor',
              provider: 'cursor',
              surface: 'future-surface',
              model: 'grok-4.5',
              effort: 'high',
              requires: [],
              capabilities: [],
              effect_floors_met: ['T2'],
              permission: { profile: 'read-only', denies: ['account-mutation'] },
              account_mutation: 'forbidden',
            },
            ],
            chains: { ample: ['codex-cli', 'cursor-agent'], tight: ['cursor-agent'] },
            fallback: {
              on: ['quota-tight'],
              never_on: [
                'policy-blocked',
                'permission-blocked',
                'security-blocked',
                'workspace-mismatch',
                'task-blocked',
                'acceptance-failed',
              ],
              exhaustion: 'fail-closed',
              same_harness: 'explicit-candidate-only',
            },
          },
          selected: {
            candidate_id: 'codex-cli',
            chain: 'ample',
            selected_at: '2026-07-08T12:02:00Z',
            evidence: {
              observed_at: '2026-07-08T12:01:00Z',
              valid_until: '2026-07-08T12:03:00Z',
              qualification_results: [
                { predicate: 'capability-match', status: 'pass' },
                { predicate: 'effect-floor', status: 'pass' },
                { predicate: 'permission-compatible', status: 'pass' },
                { predicate: 'account-mutation-forbidden', status: 'pass' },
              ],
              identity_fingerprint: 'must-not-leak',
              credential: 'must-not-leak',
            },
            reason_codes: ['quality-floor-met', 'quota-healthy'],
          },
          attempts: [
            {
              id: 'attempt-1',
              candidate_id: 'codex-cli',
              state: 'running',
              created_at: '2026-07-08T12:01:30Z',
              started_at: '2026-07-08T12:02:00Z',
              handle: 'sensitive-runtime-handle',
              selection_snapshot: { identity_fingerprint: 'must-not-leak' },
            },
            {
              id: 'attempt-2',
              candidate_id: 'codex-cli',
              state: 'terminal',
              created_at: '2026-07-08T12:03:00Z',
              terminal: {
                class: 'succeeded',
                observed_at: '2026-07-08T12:04:00Z',
              },
              failure_class: 'legacy-must-not-override',
              failed_at: '2026-07-08T12:05:00Z',
            },
            {
              id: 'attempt-3',
              candidate_id: 'codex-cli',
              state: 'failed',
              started_at: '2026-07-08T12:06:00Z',
              failure_class: 'startup_failed',
              failed_at: '2026-07-08T12:07:00Z',
            },
          ],
        },
        password: 'password-must-not-leak',
        api_key: 'api-key-must-not-leak',
        private_key: 'private-key-must-not-leak',
        account_id: 'account-must-not-leak',
        session_id: 'session-must-not-leak',
        email: 'email-must-not-leak@example.test',
        bearer: 'bearer-must-not-leak',
        private_payload: { nested_unknown: 'nested-must-not-leak' },
      },
    ],
  });
  const secondBoardPath = seedBoard(home, {
    file: '20260708T120000Z-2.board.json',
    goal: 'Second viewer board',
    tasks: [{ id: 'X', title: 'Other board task', status: 'ready', deps: [] }],
  });
  const before = readFileSync(boardPath, 'utf8');
  const secondBefore = readFileSync(secondBoardPath, 'utf8');
  const root = join(home, 'services', 'web-viewer');
  const statePath = join(root, 'instances', 'wv_route.json');
  const tokenPath = join(root, 'tokens', 'wv_route.token');
  mkdirSync(join(root, 'instances'), { recursive: true });
  mkdirSync(join(root, 'tokens'), { recursive: true });
  writeFileSync(tokenPath, 'route-token', 'utf8');
  writeFileSync(
    statePath,
    `${JSON.stringify(
      {
        schema: 'ccm/web-viewer-service/v1',
        id: 'wv_route',
        pid: 0,
        state_path: statePath,
        token_file: tokenPath,
        token_sha256: 'sha256:test',
        home,
        initial_board_path: boardPath,
        current_selection: { board_path: boardPath, goal: 'Ship viewer lifecycle' },
        scope: { home, session_id: SID },
        host: '127.0.0.1',
        port: 0,
        base_url: 'http://127.0.0.1:0',
        url: 'http://127.0.0.1:0/?token=<redacted>',
        server: { started_at: '2026-07-08T12:01:02Z', ccm_version: '0.16.0' },
        log_path: join(root, 'logs', 'wv_route.log'),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  let ready!: () => void;
  const readyPromise = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const servePromise = webViewer.serve({
    values: { state: statePath },
    positionals: [],
    flags: {
      json: false,
      dryRun: false,
      force: false,
      yes: false,
      quiet: false,
      verbose: false,
      color: false,
    },
    sid: SID,
    env: { CC_MASTER_HOME: home },
    out: () => ready(),
    err: () => {},
  });
  await readyPromise;
  const runtimeState = JSON.parse(readFileSync(statePath, 'utf8'));
  const port = runtimeState.port;

  try {
    const forbidden = await httpJson({ port, path: '/status-report.json' });
    assert.equal(forbidden.status, 403);

    const html = await httpText({ port, path: '/?token=route-token' });
    assert.equal(html.status, 200);
    assert.match(String(html.headers['content-type']), /text\/html/);
    assert.match(html.body, /<div id="root"><\/div>/);
    assert.match(html.body, /type="module"[^>]+src="\.\/assets\//);
    assert.match(html.body, /rel="stylesheet"[^>]+href="\.\/assets\//);
    assert.doesNotMatch(html.body, /MISSION CONTROL/);
    assert.doesNotMatch(html.body, /https?:\/\//);
    assert.doesNotMatch(html.body, /^\s*\{/);

    const scriptPath = html.body.match(/src="\.([^"]+\.js)"/)?.[1];
    const stylePath = html.body.match(/href="\.([^"]+\.css)"/)?.[1];
    assert.ok(scriptPath, 'Vite HTML includes local JS asset');
    assert.ok(stylePath, 'Vite HTML includes local CSS asset');

    const unauthAsset = await httpText({ port, path: scriptPath });
    assert.equal(unauthAsset.status, 403);
    const script = await httpText({ port, path: scriptPath, token: 'route-token' });
    assert.equal(script.status, 200);
    assert.match(String(script.headers['content-type']), /javascript/);
    const style = await httpText({ port, path: stylePath, token: 'route-token' });
    assert.equal(style.status, 200);
    assert.match(String(style.headers['content-type']), /text\/css/);
    const assetEscape = await httpJson({
      port,
      path: '/assets/../index.html',
      token: 'route-token',
    });
    assert.equal(assetEscape.status, 404);

    const boards = await httpJson({
      port,
      path: '/boards.json',
      token: 'route-token',
    });
    assert.equal(boards.status, 200);
    assert.equal(boards.body.schema, 'ccm/web-viewer-boards/v1');
    assert.equal(boards.body.current_board_id, '20260708T120000Z-1');
    assert.deepEqual(
      boards.body.boards.map(
        (board: { id: string; filename: string; goal: string; selected?: boolean }) => ({
          id: board.id,
          filename: board.filename,
          goal: board.goal,
          selected: board.selected === true,
        }),
      ),
      [
        {
          id: '20260708T120000Z-1',
          filename: '20260708T120000Z-1.board.json',
          goal: 'Ship viewer lifecycle',
          selected: true,
        },
        {
          id: '20260708T120000Z-2',
          filename: '20260708T120000Z-2.board.json',
          goal: 'Second viewer board',
          selected: false,
        },
      ],
    );
    // Board-switcher card summary (additive): every roster row carries the per-board
    // aggregates the mega dropdown renders (status buckets / done / awaiting counts).
    for (const board of boards.body.boards as Array<Record<string, unknown>>) {
      assert.equal(typeof board.task_count, 'number');
      assert.ok(
        board.status_counts && typeof board.status_counts === 'object',
        'boards.json row carries status_counts',
      );
      assert.equal(typeof board.done_count, 'number');
      assert.equal(typeof board.awaiting_count, 'number');
    }

    const switchedBoards = await httpJson({
      port,
      path: '/boards.json?board=20260708T120000Z-2.board.json',
      token: 'route-token',
    });
    assert.equal(switchedBoards.status, 200);
    assert.equal(switchedBoards.body.current_board_id, '20260708T120000Z-2');
    assert.deepEqual(
      switchedBoards.body.boards.map((board: { id: string; selected?: boolean }) => ({
        id: board.id,
        selected: board.selected === true,
      })),
      [
        { id: '20260708T120000Z-1', selected: false },
        { id: '20260708T120000Z-2', selected: true },
      ],
    );

    const viewModel = await httpJson({
      port,
      path: '/view-model.json?board=20260708T120000Z-1.board.json',
      token: 'route-token',
    });
    assert.equal(viewModel.status, 200);
    assert.equal(viewModel.body.schema, 'ccm/web-viewer-view-model/v1');
    assert.equal(viewModel.body.board.id, '20260708T120000Z-1');
    assert.equal(viewModel.body.board.filename, '20260708T120000Z-1.board.json');
    assert.equal(viewModel.body.board.goal, 'Ship viewer lifecycle');
    assert.deepEqual(viewModel.body.mission, {
      kind: 'goal-contract',
      summary: 'Ship viewer lifecycle',
      assurance: 'confirmed',
      revision: 3,
      updated_at: '2026-07-08T11:58:00Z',
      brief: { present: true, ref: 'design_docs/spec.md' },
      pending: false,
    });
    assert.equal(viewModel.body.freshness.state, 'live');
    assert.equal(viewModel.body.graph.family, 'task-dag');
    assert.deepEqual(
      viewModel.body.graph.nodes.map((node: { id: string; rank?: string }) => ({
        id: node.id,
        rank: node.rank,
      })),
      [
        { id: 'A', rank: 'R0' },
        { id: 'B', rank: 'R1' },
        { id: 'C', rank: 'R1' },
        { id: 'D', rank: 'R2' },
      ],
    );
    assert.deepEqual(viewModel.body.graph.ranks, [
      { id: 'R0', label: 'R0', node_ids: ['A'] },
      { id: 'R1', label: 'R1', node_ids: ['B', 'C'] },
      { id: 'R2', label: 'R2', node_ids: ['D'] },
    ]);
    assert.deepEqual(viewModel.body.graph.ready_set, ['C']);
    assert.deepEqual(viewModel.body.ready_set, ['C']);
    assert.deepEqual(viewModel.body.summary.readySet, ['C']);
    assert.equal(viewModel.body.delivery.mode, 'legacy');
    assert.equal(viewModel.body.delivery.edges.length, 4);
    assert.ok(
      viewModel.body.delivery.edges.every(
        (edge: { qualification?: { basis?: string } }) => edge.qualification?.basis === 'legacy',
      ),
      'viewer dep edges carry the engine-derived qualification read model',
    );
    assert.deepEqual(
      viewModel.body.graph.edges
        .filter((e: { type: string }) => e.type === 'dep')
        .map(
          (e: {
            id: string;
            source: string;
            target: string;
            from: string;
            to: string;
            type: string;
          }) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            from: e.from,
            to: e.to,
            type: e.type,
          }),
        ),
      [
        { id: 'A->B', source: 'A', target: 'B', from: 'A', to: 'B', type: 'dep' },
        { id: 'A->C', source: 'A', target: 'C', from: 'A', to: 'C', type: 'dep' },
        { id: 'B->D', source: 'B', target: 'D', from: 'B', to: 'D', type: 'dep' },
        { id: 'C->D', source: 'C', target: 'D', from: 'C', to: 'D', type: 'dep' },
      ],
    );
    assert.equal(viewModel.body.defaults.selected_task_id, 'D');
    const routedNode = viewModel.body.graph.nodes.find((node: { id: string }) => node.id === 'D');
    assert.deepEqual(
      {
        route_outcome: routedNode.route_outcome,
        harness: routedNode.harness,
        surface: routedNode.surface,
        surface_label: routedNode.surface_label,
        model: routedNode.model,
        role_grades: routedNode.role_grades,
      },
      {
        route_outcome: 'other-harness-cli',
        harness: 'codex',
        surface: 'cli-headless',
        surface_label: 'Codex CLI',
        model: 'gpt-5.6-sol',
        role_grades: ['T1'],
      },
    );
    const compactD = viewModel.body.tasks.find((candidate: { id: string }) => candidate.id === 'D');
    assert.equal(compactD.execution.planning.quality.effect_floor, 'T1');
    assert.equal(compactD.execution.route.outcome, 'other-harness-cli');
    assert.equal(compactD.execution.route.selected.model, 'gpt-5.6-sol');
    assert.equal(compactD.execution.route.candidates[2].surface_label, 'Cursor IDE');
    assert.equal(compactD.execution.route.candidates[3].surface_label, 'Cursor Agent');
    assert.equal(compactD.execution.route.candidates[4].surface_label, 'Unknown surface');
    assert.deepEqual(compactD.execution.attempts, [
      {
        id: 'attempt-1',
        candidate_id: 'codex-cli',
        state: 'running',
        started_at: '2026-07-08T12:01:30Z',
      },
      {
        id: 'attempt-2',
        candidate_id: 'codex-cli',
        state: 'terminal',
        started_at: '2026-07-08T12:03:00Z',
        terminal_at: '2026-07-08T12:04:00Z',
        terminal_class: 'succeeded',
      },
      {
        id: 'attempt-3',
        candidate_id: 'codex-cli',
        state: 'failed',
        started_at: '2026-07-08T12:06:00Z',
        terminal_at: '2026-07-08T12:07:00Z',
        terminal_class: 'startup_failed',
      },
    ]);
    assert.equal(
      viewModel.body.status.buckets.find((b: { id: string }) => b.id === 'ready').count,
      1,
    );

    const task = await httpJson({
      port,
      path: '/task.json?board=20260708T120000Z-1.board.json&task=D',
      token: 'route-token',
    });
    assert.equal(task.status, 200);
    assert.equal(task.body.schema, 'ccm/web-viewer-task/v1');
    assert.equal(task.body.task.id, 'D');
    assert.equal(task.body.task.status, 'blocked');
    assert.equal(task.body.board.filename, '20260708T120000Z-1.board.json');
    assert.equal(task.body.task.type, 'decision');
    assert.equal(task.body.task.executor, 'codex');
    assert.equal(task.body.task.handle, 'run_test_detail');
    assert.equal(task.body.task.parent, 'B');
    assert.deepEqual(task.body.task.deps, ['B', 'C']);
    assert.deepEqual(task.body.task.estimate, { effort: 'S' });
    assert.deepEqual(task.body.task.acceptance, ['decision captured']);
    assert.deepEqual(task.body.task.artifact, { path: 'design_docs/plans/web-viewer.md' });
    assert.equal(task.body.task.verified, false);
    assert.equal(task.body.task.created_at, '2026-07-08T12:00:00Z');
    assert.equal(task.body.task.started_at, '2026-07-08T12:02:00Z');
    assert.equal(task.body.task.updated_at, '2026-07-08T12:03:00Z');
    assert.deepEqual(task.body.task.decision_package, { question: 'approve launch' });
    assert.equal(task.body.raw_task, undefined);
    assert.equal(task.body.task.execution.route.outcome, 'other-harness-cli');
    const safeDetail = JSON.stringify(task.body);
    assert.doesNotMatch(safeDetail, /must-not-leak/);
    assert.doesNotMatch(
      safeDetail,
      /identity_fingerprint|selection_snapshot|credential|password|api_key|private_key|account_id|session_id|email|bearer|nested_unknown/,
    );
    assert.deepEqual(task.body.task.parents, ['B', 'C']);
    assert.deepEqual(
      task.body.dependencies.map((dep: { id: string }) => dep.id),
      ['B', 'C'],
    );
    assert.deepEqual(task.body.dependents, []);
    assert.ok(task.body.task.summary.includes('User decision'));

    const missingTask = await httpJson({
      port,
      path: '/task.json?board=20260708T120000Z-1.board.json&task=NOPE',
      token: 'route-token',
    });
    assert.equal(missingTask.status, 404);
    assert.equal(missingTask.body.schema, 'ccm/web-viewer-task/v1');

    const switched = await httpJson({
      port,
      path: '/view-model.json?board=20260708T120000Z-2.board.json',
      token: 'route-token',
    });
    assert.equal(switched.status, 200);
    assert.equal(switched.body.board.goal, 'Second viewer board');
    assert.deepEqual(switched.body.mission, {
      kind: 'legacy',
      summary: 'Second viewer board',
      pending: false,
    });
    assert.equal(switched.body.graph.nodes[0].id, 'X');

    const badBoard = await httpJson({
      port,
      path: '/status-report.json?board=../escape.board.json',
      token: 'route-token',
    });
    assert.equal(badBoard.status, 404);

    const ok = await httpJson({
      port,
      path: '/status-report.json?board=20260708T120000Z-1.board.json&max_age=30s',
      token: 'route-token',
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.schema, 'ccm/status-report/v1');
    assert.equal(ok.body.ok, true);
    assert.equal(ok.body.report.board.file, '20260708T120000Z-1.board.json');
    assert.ok(
      existsSync(
        join(home, 'reports', 'status-report', 'boards', '20260708T120000Z-1.status-report.json'),
      ),
    );
    // Client contract (App.tsx boardHash fast path): the boards roster and the status
    // report move independently of the selected board's bytes, so the client must keep
    // committing them even when view-model.json's rev.boardHash is unchanged. Assert the
    // server-side halves: /boards.json re-enumerates on every request (a board seeded
    // after start appears without the selected board changing), and
    // /status-report.json?refresh=1 re-stamps the artifact.
    seedBoard(home, {
      file: '20260708T120000Z-3.board.json',
      goal: 'Third board seeded mid-flight',
      extras: {
        goal_contract: {
          schema: 'ccm/goal-contract/v1',
          revision: 1,
          assurance: 'asserted',
          updated_at: '2026-07-08T12:04:00Z',
        },
      },
      tasks: [{ id: 'Z', title: 'Late arrival', status: 'ready', deps: [] }],
    });
    const asserted = await httpJson({
      port,
      path: '/view-model.json?board=20260708T120000Z-3.board.json',
      token: 'route-token',
    });
    assert.equal(asserted.status, 200);
    assert.equal(asserted.body.mission.assurance, 'asserted');
    assert.equal(asserted.body.mission.pending, false);
    const rosterAfterSeed = await httpJson({ port, path: '/boards.json', token: 'route-token' });
    assert.equal(rosterAfterSeed.status, 200);
    assert.deepEqual(
      rosterAfterSeed.body.boards.map((board: { id: string }) => board.id).sort(),
      ['20260708T120000Z-1', '20260708T120000Z-2', '20260708T120000Z-3'],
      'boards.json reflects a board added while the service is live',
    );
    assert.equal(rosterAfterSeed.body.current_board_id, '20260708T120000Z-1');
    assert.equal(
      readFileSync(boardPath, 'utf8'),
      before,
      'roster growth leaves the selected board byte-identical (client hash unchanged)',
    );

    const refreshed = await httpJson({
      port,
      path: '/status-report.json?board=20260708T120000Z-1.board.json&refresh=1',
      token: 'route-token',
    });
    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.body.ok, true);
    assert.ok(refreshed.body.artifact?.created_at, 'refresh=1 returns a stamped artifact');
    assert.ok(
      Date.parse(refreshed.body.artifact.created_at) >= Date.parse(ok.body.artifact.created_at),
      'refresh=1 re-stamps created_at at or after the cached artifact',
    );

    assert.equal(
      readFileSync(boardPath, 'utf8'),
      before,
      'status-report route leaves board byte-identical',
    );
    assert.equal(
      readFileSync(secondBoardPath, 'utf8'),
      secondBefore,
      'board switching leaves alternate board byte-identical',
    );
  } finally {
    await httpJson({ port, path: '/_ccm/shutdown', token: 'route-token', method: 'POST' }).catch(
      () => {},
    );
  }
  assert.equal(await servePromise, EXIT.OK);
});

test('serve uses home materialized app-dist without relying on process cwd', async () => {
  const home = mkHome();
  const html =
    '<!doctype html><html><head></head><body><div id="root"></div><script type="module" src="./assets/app.js"></script></body></html>';
  __setWebViewerAppDistTestHooks({
    bundled: true,
    version: readVersion(),
    files: {
      'index.html': Buffer.from(html, 'utf8').toString('base64'),
      'assets/app.js': Buffer.from('export {}', 'utf8').toString('base64'),
    },
  });

  const root = join(home, 'services', 'web-viewer');
  const statePath = join(root, 'instances', 'wv_materialized.json');
  const tokenPath = join(root, 'tokens', 'wv_materialized.token');
  mkdirSync(join(root, 'instances'), { recursive: true });
  mkdirSync(join(root, 'tokens'), { recursive: true });
  writeFileSync(tokenPath, 'materialized-token', 'utf8');
  writeFileSync(
    statePath,
    `${JSON.stringify(
      {
        schema: 'ccm/web-viewer-service/v1',
        id: 'wv_materialized',
        pid: 0,
        state_path: statePath,
        token_file: tokenPath,
        token_sha256: 'sha256:test',
        home,
        initial_board_path: null,
        current_selection: null,
        scope: { home, session_id: SID },
        host: '127.0.0.1',
        port: 0,
        base_url: 'http://127.0.0.1:0',
        url: 'http://127.0.0.1:0/?token=<redacted>',
        server: { started_at: '2026-07-09T12:00:00Z', ccm_version: readVersion() },
        log_path: join(root, 'logs', 'wv_materialized.log'),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  let ready!: () => void;
  const readyPromise = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const prevCwd = process.cwd();
  process.chdir(tmpdir());
  const servePromise = webViewer.serve({
    values: { state: statePath },
    positionals: [],
    flags: {
      json: false,
      dryRun: false,
      force: false,
      yes: false,
      quiet: false,
      verbose: false,
      color: false,
    },
    sid: SID,
    env: { CC_MASTER_HOME: home },
    out: () => ready(),
    err: () => {},
  });
  await readyPromise;
  const runtimeState = JSON.parse(readFileSync(statePath, 'utf8'));
  const port = runtimeState.port;

  try {
    const page = await httpText({ port, path: '/?token=materialized-token' });
    assert.equal(page.status, 200);
    assert.match(String(page.headers['content-type']), /text\/html/);
    assert.match(page.body, /<div id="root"><\/div>/);
    assert.ok(port > 0, 'serve binds an OS-assigned ephemeral port when state.port is 0');
    assert.notEqual(port, 5173, 'must not default to a fixed dev-server port');
  } finally {
    process.chdir(prevCwd);
    await httpJson({
      port,
      path: '/_ccm/shutdown',
      token: 'materialized-token',
      method: 'POST',
    }).catch(() => {});
  }
  assert.equal(await servePromise, EXIT.OK);
});

test('serve returns 503 when web-viewer assets are unavailable', async () => {
  const home = mkHome();
  __setWebViewerAppDistTestHooks({ bundled: false, files: {}, disableDevCandidates: true });

  const root = join(home, 'services', 'web-viewer');
  const statePath = join(root, 'instances', 'wv_missing.json');
  const tokenPath = join(root, 'tokens', 'wv_missing.token');
  mkdirSync(join(root, 'instances'), { recursive: true });
  mkdirSync(join(root, 'tokens'), { recursive: true });
  writeFileSync(tokenPath, 'missing-token', 'utf8');
  writeFileSync(
    statePath,
    `${JSON.stringify(
      {
        schema: 'ccm/web-viewer-service/v1',
        id: 'wv_missing',
        pid: 0,
        state_path: statePath,
        token_file: tokenPath,
        token_sha256: 'sha256:test',
        home,
        initial_board_path: null,
        current_selection: null,
        scope: { home, session_id: SID },
        host: '127.0.0.1',
        port: 0,
        base_url: 'http://127.0.0.1:0',
        url: 'http://127.0.0.1:0/?token=<redacted>',
        server: { started_at: '2026-07-09T12:00:00Z', ccm_version: readVersion() },
        log_path: join(root, 'logs', 'wv_missing.log'),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  let ready!: () => void;
  const readyPromise = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const prevCwd = process.cwd();
  process.chdir(tmpdir());
  const servePromise = webViewer.serve({
    values: { state: statePath },
    positionals: [],
    flags: {
      json: false,
      dryRun: false,
      force: false,
      yes: false,
      quiet: false,
      verbose: false,
      color: false,
    },
    sid: SID,
    env: { CC_MASTER_HOME: home },
    out: () => ready(),
    err: () => {},
  });
  await readyPromise;
  const runtimeState = JSON.parse(readFileSync(statePath, 'utf8'));
  const port = runtimeState.port;

  try {
    const page = await httpJson({ port, path: '/?token=missing-token' });
    assert.equal(page.status, 503);
    assert.match(String(page.body.error), /app dist is missing/i);
  } finally {
    process.chdir(prevCwd);
    await httpJson({ port, path: '/_ccm/shutdown', token: 'missing-token', method: 'POST' }).catch(
      () => {},
    );
  }
  assert.equal(await servePromise, EXIT.OK);
});

test('serve exposes additive insights block, decisions.json sidecars, and compact provenance fields', async () => {
  const home = mkHome();
  const hours = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString();
  const boardPath = seedBoard(home, {
    tasks: [
      {
        id: 'root',
        title: 'Root task',
        status: 'done',
        verified: true,
        deps: [],
        artifact: 'out/root.md',
        started_at: hours(4),
        finished_at: hours(3.5),
        justification: 'gates the whole release',
        dep_pins: { plan: 'sha256:abc' },
        hitl_rounds: 2,
        notes: 'root note',
        tags: ['infra', 'release'],
        role: 'lead',
        references: ['design_docs/root.md'],
      },
      { id: 'mid', title: 'Mid task', status: 'in_flight', deps: ['root'], started_at: hours(2) },
      {
        id: 'gate',
        title: 'Gate task',
        status: 'blocked',
        blocked_on: 'user',
        deps: ['root'],
        started_at: hours(3),
      },
      { id: 'join', title: 'Join task', status: 'ready', deps: ['mid', 'gate'] },
      { id: 'leaf', title: 'Leaf task', status: 'ready', deps: ['join'] },
    ],
  });
  seedBoard(home, {
    file: '20260708T120000Z-2.board.json',
    goal: 'Second insights board',
    tasks: [{ id: 'X', title: 'Other board task', status: 'ready', deps: [] }],
  });

  // discuss sidecars in the board home: two rounds for `gate` on THIS board, one same-node
  // sidecar under ANOTHER board stem (must not bleed), one non-matching junk file, and one
  // stem-prefixed file whose shape yields no node id (skipped, never throws).
  const boardsDir = join(home, 'boards');
  const stem = '20260708T120000Z-1';
  writeFileSync(
    join(boardsDir, `${stem}--gate--20260708T100000Z.decision.md`),
    '---\nnode_id: gate\nresolved_at: 2026-07-08T10:00:00Z\nask_type: decision\n---\n\n## TL;DR\nPicked option A\n',
    'utf8',
  );
  writeFileSync(
    join(boardsDir, `${stem}--gate--20260708T110000Z.decision.md`),
    '---\nnode_id: gate\nresolved_at: 2026-07-08T11:00:00Z\nask_type: advice\n---\n\n## TL;DR\nRevisited after new data\n',
    'utf8',
  );
  writeFileSync(
    join(boardsDir, '20260708T120000Z-2--gate--20260708T090000Z.decision.md'),
    '---\nnode_id: gate\nresolved_at: 2026-07-08T09:00:00Z\nask_type: decision\n---\n\n## TL;DR\nOther board conclusion\n',
    'utf8',
  );
  writeFileSync(join(boardsDir, 'garbage.decision.md'), 'not a sidecar at all', 'utf8');
  writeFileSync(join(boardsDir, `${stem}--broken.decision.md`), 'no frontmatter here', 'utf8');

  const root = join(home, 'services', 'web-viewer');
  const statePath = join(root, 'instances', 'wv_insights.json');
  const tokenPath = join(root, 'tokens', 'wv_insights.token');
  mkdirSync(join(root, 'instances'), { recursive: true });
  mkdirSync(join(root, 'tokens'), { recursive: true });
  writeFileSync(tokenPath, 'insights-token', 'utf8');
  writeFileSync(
    statePath,
    `${JSON.stringify(
      {
        schema: 'ccm/web-viewer-service/v1',
        id: 'wv_insights',
        pid: 0,
        state_path: statePath,
        token_file: tokenPath,
        token_sha256: 'sha256:test',
        home,
        initial_board_path: boardPath,
        current_selection: { board_path: boardPath, goal: 'Ship viewer lifecycle' },
        scope: { home, session_id: SID },
        host: '127.0.0.1',
        port: 0,
        base_url: 'http://127.0.0.1:0',
        url: 'http://127.0.0.1:0/?token=<redacted>',
        server: { started_at: '2026-07-08T12:01:02Z', ccm_version: '0.16.0' },
        log_path: join(root, 'logs', 'wv_insights.log'),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  let ready!: () => void;
  const readyPromise = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const servePromise = webViewer.serve({
    values: { state: statePath },
    positionals: [],
    flags: {
      json: false,
      dryRun: false,
      force: false,
      yes: false,
      quiet: false,
      verbose: false,
      color: false,
    },
    sid: SID,
    env: { CC_MASTER_HOME: home },
    out: () => ready(),
    err: () => {},
  });
  await readyPromise;
  const runtimeState = JSON.parse(readFileSync(statePath, 'utf8'));
  const port = runtimeState.port;

  try {
    // ---- insights block (additive, server-derived analytics) ----
    const viewModel = await httpJson({
      port,
      path: '/view-model.json?board=20260708T120000Z-1.board.json',
      token: 'insights-token',
    });
    assert.equal(viewModel.status, 200);
    assert.equal(viewModel.body.schema, 'ccm/web-viewer-view-model/v1');
    const insights = viewModel.body.insights;
    assert.ok(insights, 'view-model carries an insights block');
    assert.deepEqual(insights.impact, { id: 'root', count: 4 });
    assert.equal(insights.convergence.id, 'join');
    assert.equal(insights.convergence.in_deg, 2);
    // both stallers gate 2 tasks; `gate` has been waiting longer -> elapsed tie-break wins
    assert.equal(insights.bottleneck.id, 'gate');
    assert.equal(insights.bottleneck.impact, 2);
    assert.equal(insights.bottleneck.status, 'blocked');
    assert.ok(insights.bottleneck.elapsed_ms > 2.9 * 3_600_000);
    assert.deepEqual(insights.wip, { count: 1, limit: 4, over: false });
    assert.equal(insights.awaiting.count, 1);
    assert.ok(insights.awaiting.oldest_gate_elapsed_ms > 2.9 * 3_600_000);
    assert.ok(insights.awaiting.oldest_gate_elapsed_ms < 3.1 * 3_600_000);
    assert.ok(insights.age_ms > 3.9 * 3_600_000, 'age from earliest start anchor');
    assert.equal(insights.per_node.root.impact, 4);
    assert.equal(insights.per_node.root.in_deg, 0);
    assert.equal(insights.per_node.join.in_deg, 2);
    assert.equal(insights.per_node.mid.impact, 2);
    assert.equal(insights.per_node.leaf.impact, 0);

    // ---- compactTask whitelist additions surface on view-model tasks + /task.json ----
    const compactRoot = viewModel.body.tasks.find((t: { id: string }) => t.id === 'root');
    assert.equal(compactRoot.justification, 'gates the whole release');
    assert.deepEqual(compactRoot.dep_pins, { plan: 'sha256:abc' });
    assert.equal(compactRoot.hitl_rounds, 2);
    assert.equal(compactRoot.notes, 'root note');
    assert.deepEqual(compactRoot.tags, ['infra', 'release']);
    assert.equal(compactRoot.role, 'lead');
    assert.deepEqual(compactRoot.references, ['design_docs/root.md']);

    const detail = await httpJson({
      port,
      path: '/task.json?board=20260708T120000Z-1.board.json&task=root',
      token: 'insights-token',
    });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.task.justification, 'gates the whole release');
    assert.equal(detail.body.task.hitl_rounds, 2);
    assert.deepEqual(detail.body.task.dep_pins, { plan: 'sha256:abc' });

    // ---- /decisions.json: pinned shape, round grouping, cross-board stem guard ----
    const forbidden = await httpJson({ port, path: '/decisions.json' });
    assert.equal(forbidden.status, 403);

    const decisions = await httpJson({
      port,
      path: '/decisions.json?board=20260708T120000Z-1.board.json',
      token: 'insights-token',
    });
    assert.equal(decisions.status, 200);
    assert.deepEqual(decisions.body, [
      {
        node_id: 'gate',
        file: `${stem}--gate--20260708T100000Z.decision.md`,
        resolved_at: '2026-07-08T10:00:00Z',
        ask_type: 'decision',
        round: 1,
        tldr: 'Picked option A',
      },
      {
        node_id: 'gate',
        file: `${stem}--gate--20260708T110000Z.decision.md`,
        resolved_at: '2026-07-08T11:00:00Z',
        ask_type: 'advice',
        round: 2,
        tldr: 'Revisited after new data',
      },
    ]);

    // the other board sees ONLY its own stem-prefixed sidecar (no bleed either way)
    const otherDecisions = await httpJson({
      port,
      path: '/decisions.json?board=20260708T120000Z-2.board.json',
      token: 'insights-token',
    });
    assert.equal(otherDecisions.status, 200);
    assert.equal(otherDecisions.body.length, 1);
    assert.equal(otherDecisions.body[0].tldr, 'Other board conclusion');
    assert.equal(otherDecisions.body[0].round, 1);

    // missing board -> 404 (aligned with the other board-scoped endpoints)
    const missing = await httpJson({
      port,
      path: '/decisions.json?board=nope.board.json',
      token: 'insights-token',
    });
    assert.equal(missing.status, 404);
  } finally {
    await httpJson({ port, path: '/_ccm/shutdown', token: 'insights-token', method: 'POST' }).catch(
      () => {},
    );
  }
  assert.equal(await servePromise, EXIT.OK);
});

// ---- stage 2: board_extras additive block + /peers.json roster --------------------------

function writeServeState(
  home: string,
  id: string,
  token: string,
  boardPath: string,
): { statePath: string } {
  const root = join(home, 'services', 'web-viewer');
  const statePath = join(root, 'instances', `${id}.json`);
  const tokenPath = join(root, 'tokens', `${id}.token`);
  mkdirSync(join(root, 'instances'), { recursive: true });
  mkdirSync(join(root, 'tokens'), { recursive: true });
  writeFileSync(tokenPath, token, 'utf8');
  writeFileSync(
    statePath,
    `${JSON.stringify(
      {
        schema: 'ccm/web-viewer-service/v1',
        id,
        pid: 0,
        state_path: statePath,
        token_file: tokenPath,
        token_sha256: 'sha256:test',
        home,
        initial_board_path: boardPath,
        current_selection: { board_path: boardPath, goal: 'Ship viewer lifecycle' },
        scope: { home, session_id: SID },
        host: '127.0.0.1',
        port: 0,
        base_url: 'http://127.0.0.1:0',
        url: 'http://127.0.0.1:0/?token=<redacted>',
        server: { started_at: '2026-07-08T12:01:02Z', ccm_version: '0.16.0' },
        log_path: join(root, 'logs', `${id}.log`),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return { statePath };
}

async function startServe(
  statePath: string,
  home: string,
): Promise<{
  port: number;
  servePromise: Promise<number>;
}> {
  let ready!: () => void;
  const readyPromise = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const servePromise = webViewer.serve({
    values: { state: statePath },
    positionals: [],
    flags: {
      json: false,
      dryRun: false,
      force: false,
      yes: false,
      quiet: false,
      verbose: false,
      color: false,
    },
    sid: SID,
    env: { CC_MASTER_HOME: home },
    out: () => ready(),
    err: () => {},
  });
  await readyPromise;
  const runtimeState = JSON.parse(readFileSync(statePath, 'utf8'));
  return { port: runtimeState.port, servePromise };
}

// Strict ISO-8601 UTC without milliseconds (the engine's ISO_UTC_RE shape).
function isoNoMs(msEpoch: number): string {
  return new Date(msEpoch).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function writeBoard(home: string, file: string, board: Record<string, unknown>): string {
  const boardPath = join(home, 'boards', file);
  writeFileSync(boardPath, `${JSON.stringify(board, null, 2)}\n`, 'utf8');
  return boardPath;
}

test('serve exposes additive board_extras block with graceful absence and over-scheduling diagnostics', async () => {
  const home = mkHome();
  const judgmentCalls = [
    {
      id: 'jc-1',
      ts: '2026-07-08T09:00:00Z',
      category: 'architecture',
      severity: 'high',
      status: 'pending_review',
      summary: 'Chose process-boundary shell over in-process import',
    },
    {
      id: 'jc-2',
      ts: '2026-07-08T10:00:00Z',
      category: 'drift',
      severity: 'medium',
      status: 'upheld',
      summary: 'Kept legacy field alias for archived boards',
    },
    {
      id: 'jc-3',
      ts: '2026-07-08T11:00:00Z',
      category: 'other',
      severity: 'low',
      status: 'overturned',
      summary: 'Reverted speculative cache layer',
    },
  ];
  const cadence = {
    target: { ship_every: '24h' },
    iterations: [
      {
        id: 'it-2',
        status: 'open',
        started_at: '2026-07-08T08:00:00Z',
        deadline: '2026-07-09T08:00:00Z',
        goal: 'Ship cutover wave',
        members: ['W1', 'W2'],
      },
      {
        id: 'it-1',
        status: 'shipped',
        started_at: '2026-07-07T08:00:00Z',
        members: ['R1'],
      },
    ],
  };
  const boardWatchdog = {
    armed_at: '2026-07-08T11:00:00Z',
    fire_at: '2027-01-01T00:00:00Z',
    mechanism: 'cron',
    job_id: 'wd-1',
  };
  const taskWatchdog = { mechanism: 'shell', fire_at: '2027-02-01T00:00:00Z' };
  const boardPath = writeBoard(home, '20260708T120000Z-1.board.json', {
    schema: 'cc-master/v2',
    meta: { template_version: 3 },
    goal: 'Extras board',
    owner: { active: true, session_id: SID, heartbeat: '2026-07-08T12:00:00Z' },
    git: { worktree: '', branch: '' },
    scheduling: { wip_limit: 2 },
    judgment_calls: judgmentCalls,
    cadence,
    watchdog: boardWatchdog,
    policy: { autonomous_account_switch: 'deny' },
    coordination: {
      priority: 'high',
      state: { current: { active_tasks: 3, workload: 'cutover' } },
      inbox: [
        { kind: 'pacing_throttle', ts: '2026-07-08T11:30:00Z', note: 'peer claimed headroom' },
      ],
    },
    tasks: [
      {
        id: 'R1',
        title: 'Shipped member',
        status: 'done',
        verified: true,
        artifact: 'out/r1.md',
        deps: [],
      },
      { id: 'W1', title: 'Wave member 1', status: 'in_flight', deps: [] },
      { id: 'W2', title: 'Wave member 2', status: 'in_flight', deps: [], watchdog: taskWatchdog },
      { id: 'W3', title: 'Wave member 3', status: 'in_flight', deps: [] },
    ],
    log: [],
  });
  seedBoard(home, {
    file: '20260708T120000Z-2.board.json',
    goal: 'Plain board without extras',
    tasks: [{ id: 'X', title: 'Plain task', status: 'ready', deps: [] }],
  });
  // Bad-shaped extras must be dropped silently, never surfaced and never a 500.
  writeBoard(home, '20260708T120000Z-3.board.json', {
    schema: 'cc-master/v2',
    goal: 'Bad-shaped extras board',
    owner: { active: true, session_id: SID, heartbeat: '2026-07-08T12:00:00Z' },
    git: { worktree: '', branch: '' },
    judgment_calls: 'oops',
    cadence: ['not', 'an', 'object'],
    watchdog: 'oops',
    policy: 42,
    coordination: null,
    tasks: [{ id: 'Y', title: 'Task', status: 'ready', deps: [] }],
    log: [],
  });

  const { statePath } = writeServeState(home, 'wv_extras', 'extras-token', boardPath);
  const { port, servePromise } = await startServe(statePath, home);

  try {
    const viewModel = await httpJson({
      port,
      path: '/view-model.json?board=20260708T120000Z-1.board.json',
      token: 'extras-token',
    });
    assert.equal(viewModel.status, 200);
    const extras = viewModel.body.board_extras;
    assert.ok(extras, 'view-model carries board_extras when the board has extras');
    assert.deepEqual(extras.judgment_calls, judgmentCalls);
    assert.deepEqual(extras.cadence, cadence);
    assert.deepEqual(extras.watchdog, boardWatchdog);
    assert.deepEqual(extras.policy, { autonomous_account_switch: 'deny' });
    assert.equal(extras.coordination.priority, 'high');
    assert.equal(extras.coordination.inbox.length, 1);
    assert.equal(extras.coordination.inbox[0].kind, 'pacing_throttle');

    // task-level watchdog rides the compactTask whitelist (view-model + /task.json)
    const w2 = viewModel.body.tasks.find((t: { id: string }) => t.id === 'W2');
    assert.deepEqual(w2.watchdog, taskWatchdog);
    const detail = await httpJson({
      port,
      path: '/task.json?board=20260708T120000Z-1.board.json&task=W2',
      token: 'extras-token',
    });
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.body.task.watchdog, taskWatchdog);

    // over-scheduling diagnostics: 3 in_flight vs wip_limit 2
    assert.deepEqual(viewModel.body.diagnostics.over_scheduling, [
      { severity: 'warning', message: 'wip 3 exceeds wip_limit 2' },
    ]);

    // absence tolerance: a board without any extras carries NO board_extras key
    const plain = await httpJson({
      port,
      path: '/view-model.json?board=20260708T120000Z-2.board.json',
      token: 'extras-token',
    });
    assert.equal(plain.status, 200);
    assert.equal('board_extras' in plain.body, false);
    assert.deepEqual(plain.body.diagnostics.over_scheduling, []);

    // bad-shaped extras: dropped silently (no key, no error)
    const bad = await httpJson({
      port,
      path: '/view-model.json?board=20260708T120000Z-3.board.json',
      token: 'extras-token',
    });
    assert.equal(bad.status, 200);
    assert.equal(bad.body.error, undefined);
    assert.equal('board_extras' in bad.body, false);
  } finally {
    await httpJson({ port, path: '/_ccm/shutdown', token: 'extras-token', method: 'POST' }).catch(
      () => {},
    );
  }
  assert.equal(await servePromise, EXIT.OK);
});

test('serve implements peers.json: fresh roster, coordination projection, inbox summary, empty fallback', async () => {
  const home = mkHome();
  const nowMs = Date.now();
  const fresh = isoNoMs(nowMs - 30_000); // 30s old heartbeat -> fresh
  const stale = isoNoMs(nowMs - 3_600_000); // 1h old -> past the 600s freshness window
  const currentPath = writeBoard(home, '20260708T120000Z-1.board.json', {
    schema: 'cc-master/v2',
    goal: 'Current orchestration',
    owner: { active: true, session_id: SID, heartbeat: fresh, harness: 'claude-code' },
    git: { worktree: '', branch: '' },
    coordination: {
      priority: 'normal',
      inbox: [
        { kind: 'pacing_yield', ts: isoNoMs(nowMs - 60_000), note: 'yielding to urgent peer' },
        { kind: 'hitl_turn', ts: isoNoMs(nowMs - 120_000) },
        'not-an-object-entry-is-dropped',
      ],
    },
    tasks: [{ id: 'A', title: 'Current task', status: 'in_flight', deps: [] }],
    log: [],
  });
  writeBoard(home, '20260708T120000Z-2.board.json', {
    schema: 'cc-master/v2',
    goal: 'Peer with coordination',
    owner: { active: true, session_id: 'other-session', heartbeat: fresh, harness: 'claude-code' },
    git: { worktree: '', branch: '' },
    coordination: {
      priority: 'high',
      state: {
        current: { active_tasks: 2, workload: 'migration wave', burn_contribution: 18 },
        planned: { remaining_work: '3 tasks', cost_to_complete_pct: 22 },
      },
    },
    tasks: [],
    log: [],
  });
  writeBoard(home, '20260708T120000Z-3.board.json', {
    schema: 'cc-master/v2',
    goal: 'Peer without coordination',
    owner: { active: true, session_id: 'third-session', heartbeat: fresh },
    git: { worktree: '', branch: '' },
    tasks: [],
    log: [],
  });
  writeBoard(home, '20260708T120000Z-4.board.json', {
    schema: 'cc-master/v2',
    goal: 'Archived board stays out',
    owner: { active: false, session_id: 'done-session', heartbeat: fresh },
    git: { worktree: '', branch: '' },
    tasks: [],
    log: [],
  });
  writeBoard(home, '20260708T120000Z-5.board.json', {
    schema: 'cc-master/v2',
    goal: 'Stale heartbeat stays out',
    owner: { active: true, session_id: 'gone-session', heartbeat: stale },
    git: { worktree: '', branch: '' },
    tasks: [],
    log: [],
  });

  const { statePath } = writeServeState(home, 'wv_peers', 'peers-token', currentPath);
  const { port, servePromise } = await startServe(statePath, home);

  try {
    const forbidden = await httpJson({ port, path: '/peers.json' });
    assert.equal(forbidden.status, 403);

    const payload = await httpJson({ port, path: '/peers.json', token: 'peers-token' });
    assert.equal(payload.status, 200);
    assert.equal(payload.body.schema, 'ccm/web-viewer-peers/v1');
    assert.equal(payload.body.available, true);
    assert.equal(payload.body.current.file, '20260708T120000Z-1.board.json');
    assert.equal(payload.body.count, 2);
    // priority ordering: high peer first, then normal-priority peer without coordination
    assert.deepEqual(
      payload.body.peers.map((p: { board_file: string; priority: string }) => ({
        board_file: p.board_file,
        priority: p.priority,
      })),
      [
        { board_file: '20260708T120000Z-2.board.json', priority: 'high' },
        { board_file: '20260708T120000Z-3.board.json', priority: 'normal' },
      ],
    );
    const coordPeer = payload.body.peers[0];
    assert.equal(coordPeer.goal, 'Peer with coordination');
    assert.equal(coordPeer.active, true);
    assert.deepEqual(coordPeer.current, {
      active_tasks: 2,
      workload: 'migration wave',
      burn_contribution: 18,
    });
    assert.deepEqual(coordPeer.planned, { remaining_work: '3 tasks', cost_to_complete_pct: 22 });
    const plainPeer = payload.body.peers[1];
    assert.equal(plainPeer.goal, 'Peer without coordination');
    assert.equal(plainPeer.current, null);
    assert.equal(plainPeer.planned, null);
    // inbox: current board's coordination.inbox, object entries only
    assert.deepEqual(
      payload.body.inbox.map((n: { kind: string }) => n.kind),
      ['pacing_yield', 'hitl_turn'],
    );
    assert.equal(payload.body.roster.count, 3, 'roster counts every fresh board incl. current');

    // board switch: the roster excludes the newly selected board instead
    const switched = await httpJson({
      port,
      path: '/peers.json?board=20260708T120000Z-2.board.json',
      token: 'peers-token',
    });
    assert.equal(switched.status, 200);
    assert.equal(switched.body.current.file, '20260708T120000Z-2.board.json');
    assert.deepEqual(switched.body.peers.map((p: { board_file: string }) => p.board_file).sort(), [
      '20260708T120000Z-1.board.json',
      '20260708T120000Z-3.board.json',
    ]);
    assert.deepEqual(switched.body.inbox, [], 'peer board has no inbox');

    // unknown board param -> current:null, roster still served (fail-safe, never 500)
    const missing = await httpJson({
      port,
      path: '/peers.json?board=nope.board.json',
      token: 'peers-token',
    });
    assert.equal(missing.status, 200);
    assert.equal(missing.body.available, true);
    assert.equal(missing.body.current, null);
    assert.equal(missing.body.count, 3);
  } finally {
    await httpJson({ port, path: '/_ccm/shutdown', token: 'peers-token', method: 'POST' }).catch(
      () => {},
    );
  }
  assert.equal(await servePromise, EXIT.OK);
});

test('serve peers.json degrades to an empty roster when no board is fresh (single-board home)', async () => {
  const home = mkHome();
  // seedBoard writes a fixed 2026-07-08 heartbeat: active but stale relative to the wall
  // clock -> the roster is empty and the endpoint still answers available:true.
  const boardPath = seedBoard(home, {
    tasks: [{ id: 'A', title: 'Only task', status: 'ready', deps: [] }],
  });
  const { statePath } = writeServeState(home, 'wv_solo', 'solo-token', boardPath);
  const { port, servePromise } = await startServe(statePath, home);
  try {
    const payload = await httpJson({ port, path: '/peers.json', token: 'solo-token' });
    assert.equal(payload.status, 200);
    assert.equal(payload.body.available, true);
    assert.equal(payload.body.current.file, '20260708T120000Z-1.board.json');
    assert.equal(payload.body.count, 0);
    assert.deepEqual(payload.body.peers, []);
    assert.deepEqual(payload.body.inbox, []);
    assert.equal(payload.body.roster.count, 0);
  } finally {
    await httpJson({ port, path: '/_ccm/shutdown', token: 'solo-token', method: 'POST' }).catch(
      () => {},
    );
  }
  assert.equal(await servePromise, EXIT.OK);
});
