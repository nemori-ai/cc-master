// probe.test.ts — harness 可执行探测适配器（probe.ts）契约门。
//
// probeExecutable 是 RuntimeEnvironment/PathResolver 可执行发现契约的 CLI 边界适配器：注入 env、
//   进程 cwd/platform 由 composition 边界捕获。本门钉住三件事：
//     ① 注入 env 时绝不暗读 process.env（PATH 用 presence 而非 truthiness·空 PATH ≠ 回落进程 PATH）；
//     ② 相对 PATH 命中回报绝对路径、symlink 命中回报 lexical 路径（非 realpath）；
//     ③ 非可执行文件 / 目录被拒。
//   深层纯契约矩阵在 @ccm/engine 的 runtime-env.test.ts；本门只证适配器保真。

import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, test } from 'node:test';
import { probeExecutable } from '../src/harnesses/probe.js';

let TMPDIRS: string[] = [];
function mkTmp(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  TMPDIRS.push(root);
  return root;
}

afterEach(() => {
  for (const root of TMPDIRS) rmSync(root, { recursive: true, force: true });
  TMPDIRS = [];
});

if (process.env.CCM_PROBE_LIFECYCLE_FORCE_FAILURE === '1') {
  test('probe lifecycle failure fixture', () => {
    mkTmp('ccm-probe-failure-');
    assert.fail('intentional probe lifecycle failure');
  });
}

function mkExec(p: string): void {
  writeFileSync(p, '#!/bin/sh\nexit 0\n');
  chmodSync(p, 0o755);
}

// ① 注入空 PATH 绝不回落 process.env.PATH（安全拒绝·非静默搜 cwd/进程 PATH）。
test('probeExecutable: injected empty PATH does not fall back to process.env.PATH', () => {
  const r = probeExecutable('node', { PATH: '' });
  assert.equal(r.available, false, 'empty injected PATH must find nothing');
  assert.equal(r.path, null);
});

// ① 注入 env 缺 PATH 键同样不回落（presence 语义）。
test('probeExecutable: injected env without PATH key finds nothing (no process.env leak)', () => {
  const r = probeExecutable('node', { HOME: '/tmp/nowhere' });
  assert.equal(r.available, false);
  assert.equal(r.path, null);
});

// ② 相对 PATH 命中 → 绝对路径。
test('probeExecutable: relative PATH entry returns an absolute hit', () => {
  const root = mkTmp('ccm-probe-rel-');
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  mkExec(join(bin, 'tool-x'));
  const r = probeExecutable('tool-x', { PATH: relative(process.cwd(), bin) });
  assert.equal(r.available, true);
  assert.equal(r.path, join(bin, 'tool-x'));
});

// ② symlink 命中 → 回报 lexical 符号链接路径（保持既有 harness 语义）。
test('probeExecutable: symlink hit reports the lexical symlink path', () => {
  const root = mkTmp('ccm-probe-link-');
  mkdirSync(join(root, 'versions'), { recursive: true });
  mkdirSync(join(root, 'bin'), { recursive: true });
  const target = join(root, 'versions', 'tool-real');
  const link = join(root, 'bin', 'tool-y');
  mkExec(target);
  symlinkSync(target, link);
  const r = probeExecutable('tool-y', { PATH: join(root, 'bin') });
  assert.equal(r.available, true);
  assert.equal(r.path, link, 'lexical symlink path, not realpath');
});

// ③ 非可执行文件 / 目录 → 拒。
test('probeExecutable: non-executable file and directory are rejected', () => {
  const root = mkTmp('ccm-probe-reject-');
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'tool-noexec'), '#!/bin/sh\n');
  mkdirSync(join(bin, 'tool-dir'), { recursive: true });
  assert.equal(probeExecutable('tool-noexec', { PATH: bin }).available, false);
  assert.equal(probeExecutable('tool-dir', { PATH: bin }).available, false);
});
