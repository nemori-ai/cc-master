// handler-statusline.test.ts — statusline noun handler + router 接线契约门（self-contained status line·0.10.0）。
//   经 run()（真路由）端到端验证：① install/uninstall 写临时 settings.json（备份/恢复/opt-out）；
//   ② 无感知自动安装（任意非-statusline 命令首次跑 → 立 status line·marker 守·幂等·opt-out 不再覆盖）；
//   ③ `ccm statusline`（无 verb）默认 verb → render（读注入 stdin·渲染单行 + 落 sidecar）。
//   全程临时 CLAUDE_CONFIG_DIR（绝不碰真实 ~/.claude）。

import assert from 'node:assert/strict';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { run } from '../src/router.js';

let DIRS: string[] = [];
function mkdir(): string {
  const d = mkdtempSync(join(tmpdir(), 'ccm-hsl-'));
  DIRS.push(d);
  return d;
}
afterEach(() => {
  for (const d of DIRS) rmSync(d, { recursive: true, force: true });
  DIRS = [];
});

// 跑 run()，注入临时 env（CLAUDE_CONFIG_DIR=dir·HOME=dir）+ 捕获 out/err。stdinFd 可注入（render 用）。
function runCcm(
  argv: string[],
  dir: string,
  { extraEnv = {}, stdinFd }: { extraEnv?: Record<string, string>; stdinFd?: number } = {},
): { code: number; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const env: Record<string, string | undefined> = {
    CLAUDE_CONFIG_DIR: dir,
    HOME: dir,
    ...extraEnv,
  };
  const o = ((s: string) => out.push(s)) as ((s: string) => void) & {
    _stream?: NodeJS.WriteStream;
  };
  const code = run(argv, {
    out: o,
    err: (s: string) => err.push(s),
    env,
    stdin: stdinFd !== undefined ? { fd: stdinFd } : undefined,
  }) as number;
  return { code, out, err };
}

function exists(p: string): boolean {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
}
function settings(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
}

// ── install / uninstall via run() ─────────────────────────────────────────────────────────────────
test('run statusline install/uninstall：备份→覆写→恢复 + opt-out', () => {
  const dir = mkdir();
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({ statusLine: { type: 'command', command: 'mine' } }),
  );
  const ins = runCcm(['statusline', 'install'], dir);
  assert.equal(ins.code, 0);
  const sl = settings(dir).statusLine as { command: string };
  assert.match(sl.command, /statusline$/, '命令以 statusline 结尾');

  const un = runCcm(['statusline', 'uninstall'], dir);
  assert.equal(un.code, 0);
  assert.deepEqual(settings(dir).statusLine, { type: 'command', command: 'mine' }, '恢复原值');
  assert.ok(exists(join(dir, '.cc-master-statusline-optout')), 'opt-out 落');
});

test('run statusline install --json：结构化输出', () => {
  const dir = mkdir();
  const r = runCcm(['statusline', 'install', '--json'], dir);
  assert.equal(r.code, 0);
  const parsed = JSON.parse(r.out.join('\n'));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.action, 'installed');
});

// ── 无感知自动安装（任意非-statusline 命令触发）────────────────────────────────────────────────────
test('auto-install：跑普通命令（--version）首次即立 status line', () => {
  const dir = mkdir();
  assert.ok(!exists(join(dir, 'settings.json')), '前置：无 settings');
  runCcm(['--version'], dir);
  assert.ok(exists(join(dir, 'settings.json')), 'settings 自动建');
  const sl = settings(dir).statusLine as { command: string };
  assert.match(sl.command, /statusline$/, '装的是 ccm statusline');
});

test('auto-install：幂等（第二次不重复改）+ opt-out 后不再覆盖', () => {
  const dir = mkdir();
  runCcm(['--version'], dir); // 首装
  const after1 = readFileSync(join(dir, 'settings.json'), 'utf8');
  runCcm(['board', 'show'], dir); // 第二条命令（board show 会因无板报错·但 auto-install 路径已先跑）
  const after2 = readFileSync(join(dir, 'settings.json'), 'utf8');
  assert.equal(after1, after2, '第二次命令不再改 settings（marker 守）');

  // uninstall → opt-out；再跑普通命令不应重装。
  runCcm(['statusline', 'uninstall'], dir);
  const afterUninstall = readFileSync(join(dir, 'settings.json'), 'utf8');
  runCcm(['--version'], dir);
  assert.equal(
    readFileSync(join(dir, 'settings.json'), 'utf8'),
    afterUninstall,
    'opt-out 后普通命令不再重装',
  );
});

test('auto-install：kill-switch（CC_MASTER_NO_AUTOINSTALL）→ 普通命令也不装', () => {
  const dir = mkdir();
  runCcm(['--version'], dir, { extraEnv: { CC_MASTER_NO_AUTOINSTALL: '1' } });
  assert.ok(!exists(join(dir, 'settings.json')), 'kill-switch 下不建 settings');
});

test('statusline 子命令本身绝不触发 auto-install', () => {
  const dir = mkdir();
  // 喂一个含 rate_limits 的 stdin 给 render；断言不建 settings.json（只该写 sidecar）。
  const cache = join(dir, 'rate.json');
  const inFile = join(dir, 'in.json');
  writeFileSync(inFile, JSON.stringify({ context_window: { used_percentage: 42 } }));
  const fd = openSync(inFile, 'r');
  try {
    const r = runCcm(['statusline'], dir, {
      extraEnv: { CC_MASTER_RATE_CACHE: cache },
      stdinFd: fd,
    });
    assert.equal(r.code, 0);
    // 默认 verb=render：输出单行（含 ctx 42%）。
    const line = r.out.join('');
    assert.ok(line.includes('42%'), 'render 出 ctx 42%');
    assert.ok(!line.includes('\n'), '单行');
  } finally {
    closeSync(fd);
  }
  assert.ok(!exists(join(dir, 'settings.json')), 'statusline 自身不 auto-install');
});

// ── 默认 verb 路由：bare `ccm statusline` ≡ `ccm statusline render`（读注入 stdin·落 sidecar）──────────
test('default verb：`ccm statusline`（无 verb）→ render，并落 sidecar', () => {
  const dir = mkdir();
  const cache = join(dir, 'rate.json');
  const inFile = join(dir, 'in.json');
  writeFileSync(
    inFile,
    JSON.stringify({
      context_window: { used_percentage: 78 },
      rate_limits: { five_hour: { used_percentage: 64 }, seven_day: { used_percentage: 14 } },
    }),
  );
  const fd = openSync(inFile, 'r');
  try {
    const r = runCcm(['statusline'], dir, {
      extraEnv: { CC_MASTER_RATE_CACHE: cache, CC_MASTER_NOW: '2026-06-30T00:00:00Z' },
      stdinFd: fd,
    });
    assert.equal(r.code, 0);
    assert.ok(r.out.join('').includes('5h'), 'render 出 5h 段');
  } finally {
    closeSync(fd);
  }
  // sidecar 落了（render 顺带捕获）。
  assert.ok(exists(cache), 'sidecar 落');
  const sc = JSON.parse(readFileSync(cache, 'utf8'));
  assert.equal(sc.five_hour.used_percentage, 64);
});
