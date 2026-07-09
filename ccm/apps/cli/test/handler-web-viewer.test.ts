import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import * as webViewer from '../src/handlers/web-viewer.js';
import { readVersion } from '../src/help.js';
import * as io from '../src/io.js';
import { run } from '../src/router.js';

const EXIT = io.EXIT;
const SID = 'wv-test-session';

let TMPDIRS: string[] = [];

afterEach(() => {
  webViewer.__resetWebViewerTestHooks();
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
  }: { file?: string; goal?: string; sid?: string; tasks?: Array<Record<string, unknown>> } = {},
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
    assert.equal(task.body.raw_task.id, 'D');
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
