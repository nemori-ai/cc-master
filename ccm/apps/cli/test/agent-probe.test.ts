// agent-probe.test.ts — Agent Registry S2 探测适配器（agent-probe.ts）契约门。
//   证：按 handle 类型分级探测、mtime freshness → alive/silent（文件缺 → unknown·启动竞态不判死）、
//   gone 只出自确定性方法（pid kill-0）、拿不到 = unknown（保真·不推导）、
//   以及 reconcileAgentState 的观测降级语义。会话根目录经 env 覆写注入临时 home。

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { probeAgent, reconcileAgentState } from '../src/agent-probe.js';

let TMPDIRS: string[] = [];
function mkTmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  TMPDIRS.push(d);
  return d;
}
afterEach(() => {
  for (const d of TMPDIRS) rmSync(d, { recursive: true, force: true });
  TMPDIRS = [];
});

const NOW = Date.parse('2026-07-16T12:00:00Z');

// ── pid ────────────────────────────────────────────────────────────────────────────────────────
test('pid probe: injected alive/gone/unknown', () => {
  const alive = probeAgent(
    { handleKind: 'pid', handleValue: '123' },
    { pidProbe: () => 'alive', nowMs: NOW },
  );
  assert.deepEqual(alive, { method: 'pid', observed: 'alive' });
  const gone = probeAgent(
    { handleKind: 'pid', handleValue: '123' },
    { pidProbe: () => 'gone', nowMs: NOW },
  );
  assert.deepEqual(gone, { method: 'pid', observed: 'gone' });
});

test('pid probe: non-numeric handle → unknown (never guesses)', () => {
  const r = probeAgent({ handleKind: 'pid', handleValue: 'notapid' }, { nowMs: NOW });
  assert.deepEqual(r, { method: 'pid', observed: 'unknown' });
});

test('pid probe: real live process is alive, killed process is gone', async () => {
  const { spawn } = await import('node:child_process');
  const child = spawn('sleep', ['30'], { detached: true });
  const pid = child.pid as number;
  const alive = probeAgent({ handleKind: 'pid', handleValue: String(pid) }, { nowMs: NOW });
  assert.equal(alive.observed, 'alive');
  process.kill(pid, 'SIGKILL');
  await new Promise((r) => setTimeout(r, 150));
  const gone = probeAgent({ handleKind: 'pid', handleValue: String(pid) }, { nowMs: NOW });
  assert.equal(gone.observed, 'gone');
});

// ── codex session-id ─────────────────────────────────────────────────────────────────────────────
function mkCodexSession(home: string, sid: string, mtimeMs: number): void {
  const dir = join(home, '.codex', 'sessions', '2026', '07', '16');
  mkdirSync(dir, { recursive: true });
  const f = join(dir, `rollout-2026-07-16T12-00-00-${sid}.jsonl`);
  writeFileSync(f, '{}\n');
  utimesSync(f, mtimeMs / 1000, mtimeMs / 1000);
}

test('codex session-id: fresh mtime → alive, stale → silent, missing → unknown (launch-race safe)', () => {
  const home = mkTmp('ccm-probe-cx-');
  mkCodexSession(home, 'sid-fresh', NOW - 60_000); // 1min old
  const fresh = probeAgent(
    { harness: 'codex', handleKind: 'session-id', handleValue: 'sid-fresh' },
    { home, nowMs: NOW },
  );
  assert.deepEqual(fresh, { method: 'session-file-mtime', observed: 'alive' });

  mkCodexSession(home, 'sid-stale', NOW - 3600_000); // 1h old > 300s
  const stale = probeAgent(
    { harness: 'codex', handleKind: 'session-id', handleValue: 'sid-stale' },
    { home, nowMs: NOW },
  );
  assert.equal(stale.observed, 'silent');

  // 文件不存在 ≠ 判死：「从未见过文件」可能是启动竞态（尚未落盘）——unknown 保真，不触发降级。
  const missing = probeAgent(
    { harness: 'codex', handleKind: 'session-id', handleValue: 'sid-nope' },
    { home, nowMs: NOW },
  );
  assert.equal(missing.observed, 'unknown');
});

test('codex session-id: CODEX_HOME env overrides home root', () => {
  const codexHome = mkTmp('ccm-probe-cxenv-');
  const dir = join(codexHome, 'sessions', '2026');
  mkdirSync(dir, { recursive: true });
  const f = join(dir, `rollout-x-envsid.jsonl`);
  writeFileSync(f, '{}\n');
  utimesSync(f, (NOW - 30_000) / 1000, (NOW - 30_000) / 1000);
  const r = probeAgent(
    { harness: 'codex', handleKind: 'session-id', handleValue: 'envsid' },
    { env: { CODEX_HOME: codexHome }, nowMs: NOW },
  );
  assert.deepEqual(r, { method: 'session-file-mtime', observed: 'alive' });
});

// ── claude-code session-id ─────────────────────────────────────────────────────────────────────────
test('claude-code session-id: ~/.claude/projects/<slug>/<sid>.jsonl mtime', () => {
  const home = mkTmp('ccm-probe-cc-');
  const dir = join(home, '.claude', 'projects', '-abs-repo-slug');
  mkdirSync(dir, { recursive: true });
  const f = join(dir, 'ccsid-1.jsonl');
  writeFileSync(f, '{}\n');
  utimesSync(f, (NOW - 30_000) / 1000, (NOW - 30_000) / 1000);
  const r = probeAgent(
    { harness: 'claude-code', handleKind: 'session-id', handleValue: 'ccsid-1' },
    { home, nowMs: NOW },
  );
  assert.deepEqual(r, { method: 'session-file-mtime', observed: 'alive' });
  const missing = probeAgent(
    { harness: 'claude-code', handleKind: 'session-id', handleValue: 'nope' },
    { home, nowMs: NOW },
  );
  assert.equal(missing.observed, 'unknown'); // 文件缺 → unknown（mtime 类方法不判死）
});

test('session-id on harness without session roots → method none, observed unknown (no path guessing)', () => {
  // origin 经 adapter 注册表解析到 generic adapter：无 session 根 → 如实 method=none（不猜路径）。
  for (const harness of ['origin']) {
    const r = probeAgent({ harness, handleKind: 'session-id', handleValue: 'x' }, { nowMs: NOW });
    assert.deepEqual(r, { method: 'none', observed: 'unknown' }, `harness=${harness}`);
  }
});

test('session-id on cursor-agent (adapter alias with session roots) → method session-file-mtime, observed unknown', () => {
  // cursor-agent / cursor-agent-cli 现经 cursor adapter alias 解析：cursor adapter 暴露 session 根
  // （globalStorage），故 probe 取 method=session-file-mtime；无对应 session 文件 → observed=unknown（mtime 类不判死）。
  for (const harness of ['cursor-agent', 'cursor-agent-cli']) {
    const r = probeAgent({ harness, handleKind: 'session-id', handleValue: 'x' }, { nowMs: NOW });
    assert.deepEqual(
      r,
      { method: 'session-file-mtime', observed: 'unknown' },
      `harness=${harness}`,
    );
  }
});

// ── kimi-code session-id：sid 在路径段（session 目录名），文件名恒 wire.jsonl ──────────────────────────
function mkKimiSession(
  home: string,
  sid: string,
  mtimeMs: number,
  opts: { wd?: string; agent?: string } = {},
): string {
  const wd = opts.wd ?? 'wd_repo_deadbeef';
  const agent = opts.agent ?? 'main';
  const dir = join(home, '.kimi-code', 'sessions', wd, sid, 'agents', agent);
  mkdirSync(dir, { recursive: true });
  const f = join(dir, 'wire.jsonl');
  writeFileSync(f, '{"type":"metadata","protocol_version":"1.4"}\n');
  utimesSync(f, mtimeMs / 1000, mtimeMs / 1000);
  // 每个 session 目录旁常伴 state.json（walk 会一并收集 .json）——确保不被误当 transcript。
  const stateF = join(home, '.kimi-code', 'sessions', wd, sid, 'state.json');
  writeFileSync(stateF, '{"workDir":"/repo"}\n');
  return f;
}

test('kimi-code session-id: path-segment sid match (wire.jsonl filename never carries sid) → alive/silent', () => {
  const home = mkTmp('ccm-probe-kimi-');
  mkKimiSession(home, 'session_fresh', NOW - 60_000);
  const fresh = probeAgent(
    { harness: 'kimi-code', handleKind: 'session-id', handleValue: 'session_fresh' },
    { env: { KIMI_CODE_HOME: join(home, '.kimi-code') }, nowMs: NOW },
  );
  assert.deepEqual(fresh, { method: 'session-file-mtime', observed: 'alive' });

  mkKimiSession(home, 'session_stale', NOW - 3600_000);
  const stale = probeAgent(
    { harness: 'kimi-code', handleKind: 'session-id', handleValue: 'session_stale' },
    { env: { KIMI_CODE_HOME: join(home, '.kimi-code') }, nowMs: NOW },
  );
  assert.equal(stale.observed, 'silent');

  // 未见过的 sid（无匹配路径段）→ unknown（启动竞态保护·mtime 类不判死）。
  const missing = probeAgent(
    { harness: 'kimi-code', handleKind: 'session-id', handleValue: 'session_nope' },
    { env: { KIMI_CODE_HOME: join(home, '.kimi-code') }, nowMs: NOW },
  );
  assert.equal(missing.observed, 'unknown');
});

test('kimi-code session-id: default ~/.kimi-code home root (no env override)', () => {
  const home = mkTmp('ccm-probe-kimi-def-');
  mkKimiSession(home, 'session_default', NOW - 30_000);
  const r = probeAgent(
    { harness: 'kimi-code', handleKind: 'session-id', handleValue: 'session_default' },
    { home, nowMs: NOW },
  );
  assert.deepEqual(r, { method: 'session-file-mtime', observed: 'alive' });
});

test('kimi-code session-id: prefers agents/main and does not substring-match a longer sid segment', () => {
  const home = mkTmp('ccm-probe-kimi-main-');
  const kimiHome = join(home, '.kimi-code');
  // 同一 session 下 main + 一个 subagent wire.jsonl：main 陈旧（>300s→silent）、subagent 新鲜——
  //   仍优先 main，故 observed 反映 main 的 silent 而非 subagent 的 alive。
  mkKimiSession(home, 'session_x', NOW - 3600_000, { agent: 'main' });
  mkKimiSession(home, 'session_x', NOW - 10_000, { agent: 'sub-9f' });
  const r = probeAgent(
    { harness: 'kimi-code', handleKind: 'session-id', handleValue: 'session_x' },
    { env: { KIMI_CODE_HOME: kimiHome }, nowMs: NOW },
  );
  assert.equal(
    r.observed,
    'silent',
    'main (120s old) wins over newer subagent → silent, not alive',
  );

  // 段级精确匹配：`session_x` 不得命中路径段 `session_xy` 的 session。
  mkKimiSession(home, 'session_xy', NOW - 30_000);
  const prefix = probeAgent(
    { harness: 'kimi-code', handleKind: 'session-id', handleValue: 'session_x' },
    { env: { KIMI_CODE_HOME: kimiHome }, nowMs: NOW },
  );
  assert.equal(
    prefix.observed,
    'silent',
    'still resolves session_x/main, not the fresher session_xy',
  );
});

// ── seen-before 判死（曾在而消失 = 真死亡证据·finding 2）─────────────────────────────────────────────
test('seen-before: previously alive session file now missing → gone; never-seen stays unknown', () => {
  const home = mkTmp('ccm-probe-seen-');
  // 曾观测 alive（prev 同方法）+ 本次完整扫描确认缺失 → gone。
  const wasAlive = probeAgent(
    {
      harness: 'codex',
      handleKind: 'session-id',
      handleValue: 'sid-vanished',
      prevMethod: 'session-file-mtime',
      prevObserved: 'alive',
    },
    { home, nowMs: NOW },
  );
  assert.deepEqual(wasAlive, { method: 'session-file-mtime', observed: 'gone' });
  // 曾观测 silent 同样算「曾在」→ gone。
  const wasSilent = probeAgent(
    {
      harness: 'codex',
      handleKind: 'session-id',
      handleValue: 'sid-vanished',
      prevMethod: 'session-file-mtime',
      prevObserved: 'silent',
    },
    { home, nowMs: NOW },
  );
  assert.equal(wasSilent.observed, 'gone');
  // 从未见过（无 prev / prev unknown）→ unknown（启动竞态保护不回退）。
  const neverSeen = probeAgent(
    { harness: 'codex', handleKind: 'session-id', handleValue: 'sid-vanished' },
    { home, nowMs: NOW },
  );
  assert.equal(neverSeen.observed, 'unknown');
  const prevUnknown = probeAgent(
    {
      harness: 'codex',
      handleKind: 'session-id',
      handleValue: 'sid-vanished',
      prevMethod: 'session-file-mtime',
      prevObserved: 'unknown',
    },
    { home, nowMs: NOW },
  );
  assert.equal(prevUnknown.observed, 'unknown');
  // prev 是不同方法（pid）→ 不构成本方法的「曾在」→ unknown。
  const prevOtherMethod = probeAgent(
    {
      harness: 'codex',
      handleKind: 'session-id',
      handleValue: 'sid-vanished',
      prevMethod: 'pid',
      prevObserved: 'alive',
    },
    { home, nowMs: NOW },
  );
  assert.equal(prevOtherMethod.observed, 'unknown');
});

test('seen-before applies to transcript-mtime: previously alive transcript deleted → gone', () => {
  const home = mkTmp('ccm-probe-seentr-');
  const ref = join(home, 'gone-later.jsonl');
  const wasAlive = probeAgent(
    {
      type: 'subagent',
      handleKind: 'task-id',
      transcriptRef: ref,
      prevMethod: 'transcript-mtime',
      prevObserved: 'alive',
    },
    { nowMs: NOW },
  );
  assert.deepEqual(wasAlive, { method: 'transcript-mtime', observed: 'gone' });
  // 从未见过 → unknown（不判死·与既有语义一致）。
  const neverSeen = probeAgent(
    { type: 'subagent', handleKind: 'task-id', transcriptRef: ref },
    { nowMs: NOW },
  );
  assert.equal(neverSeen.observed, 'unknown');
});

// ── 文件名边界精确匹配（finding 6：裸 includes 短 sid 误命中他人 session）──────────────────────────────
test('codex session-id: prefix/substring sid must not match another session file', () => {
  const home = mkTmp('ccm-probe-bnd-');
  mkCodexSession(home, 'sid-fresh', NOW - 60_000); // rollout-…-sid-fresh.jsonl（新鲜）
  // 'sid' 是 'sid-fresh' 的前缀子串：裸 includes 会误命中取到假 alive——边界匹配须 unknown。
  const prefix = probeAgent(
    { harness: 'codex', handleKind: 'session-id', handleValue: 'sid' },
    { home, nowMs: NOW },
  );
  assert.equal(prefix.observed, 'unknown', 'prefix sid must not match rollout-…-sid-fresh');
  // 中段子串（'fre'）同样不命中。
  const mid = probeAgent(
    { harness: 'codex', handleKind: 'session-id', handleValue: 'fre' },
    { home, nowMs: NOW },
  );
  assert.equal(mid.observed, 'unknown');
  // 完整 sid 照常命中（rollout-*-<sid>.jsonl 结尾精确段）。
  const exact = probeAgent(
    { harness: 'codex', handleKind: 'session-id', handleValue: 'sid-fresh' },
    { home, nowMs: NOW },
  );
  assert.equal(exact.observed, 'alive');
});

test('codex session-id: bare <sid>.jsonl (no rollout prefix) still matches exactly', () => {
  const home = mkTmp('ccm-probe-bare-');
  const dir = join(home, '.codex', 'sessions');
  mkdirSync(dir, { recursive: true });
  const f = join(dir, 'baresid.jsonl');
  writeFileSync(f, '{}\n');
  utimesSync(f, (NOW - 30_000) / 1000, (NOW - 30_000) / 1000);
  const r = probeAgent(
    { harness: 'codex', handleKind: 'session-id', handleValue: 'baresid' },
    { home, nowMs: NOW },
  );
  assert.deepEqual(r, { method: 'session-file-mtime', observed: 'alive' });
  // 'bare' 前缀不误命中 baresid.jsonl。
  const prefix = probeAgent(
    { harness: 'codex', handleKind: 'session-id', handleValue: 'bare' },
    { home, nowMs: NOW },
  );
  assert.equal(prefix.observed, 'unknown');
});

// ── dirCache memo（finding 9：一次 probe 调用内共享目录遍历）────────────────────────────────────────────
test('dirCache memoizes the directory walk across sids within one probe invocation', () => {
  const home = mkTmp('ccm-probe-memo-');
  mkCodexSession(home, 'sid-a', NOW - 30_000);
  mkCodexSession(home, 'sid-b', NOW - 30_000);
  const dirCache = new Map<string, unknown>();
  const a = probeAgent(
    { harness: 'codex', handleKind: 'session-id', handleValue: 'sid-a' },
    { home, nowMs: NOW, dirCache },
  );
  assert.equal(a.observed, 'alive');
  assert.ok(dirCache.size > 0, 'walk index cached');
  // 删掉整个 sessions 树：第二个 sid 仍从 cache 命中（证明没有重复 readdir）。
  rmSync(join(home, '.codex', 'sessions'), { recursive: true, force: true });
  const b = probeAgent(
    { harness: 'codex', handleKind: 'session-id', handleValue: 'sid-b' },
    { home, nowMs: NOW, dirCache },
  );
  assert.equal(b.observed, 'alive', 'served from memoized walk index');
});

// ── task-id / subagent transcript ──────────────────────────────────────────────────────────────────
test('task-id/subagent: transcript path present → mtime; absent → unknown', () => {
  const home = mkTmp('ccm-probe-tr-');
  const f = join(home, 'transcript.jsonl');
  writeFileSync(f, '{}\n');
  utimesSync(f, (NOW - 30_000) / 1000, (NOW - 30_000) / 1000);
  const r = probeAgent(
    { type: 'subagent', handleKind: 'task-id', handleValue: 'T1', transcriptRef: f },
    { nowMs: NOW },
  );
  assert.deepEqual(r, { method: 'transcript-mtime', observed: 'alive' });
  const noRef = probeAgent(
    { type: 'subagent', handleKind: 'task-id', handleValue: 'T1' },
    { nowMs: NOW },
  );
  assert.deepEqual(noRef, { method: 'none', observed: 'unknown' });
  const missingRef = probeAgent(
    { type: 'subagent', handleKind: 'task-id', transcriptRef: join(home, 'gone.jsonl') },
    { nowMs: NOW },
  );
  assert.equal(missingRef.observed, 'unknown'); // ref 在但文件缺 → unknown（可能尚未写出·不判死）
});

test('no handle → method none, observed unknown', () => {
  assert.deepEqual(probeAgent({ handleKind: 'none' }, { nowMs: NOW }), {
    method: 'none',
    observed: 'unknown',
  });
});

// ── reconcileAgentState ───────────────────────────────────────────────────────────────────────────
test('reconcileAgentState: active states downgrade on observation', () => {
  assert.equal(reconcileAgentState('running', 'gone'), 'orphaned');
  assert.equal(reconcileAgentState('running', 'silent'), 'uncertain');
  assert.equal(reconcileAgentState('running', 'alive'), 'running');
  assert.equal(reconcileAgentState('running', 'unknown'), 'running'); // 保真·不改
  assert.equal(reconcileAgentState('uncertain', 'alive'), 'running'); // 复活
  assert.equal(reconcileAgentState('uncertain', 'gone'), 'orphaned');
  assert.equal(reconcileAgentState('starting', 'alive'), 'running');
});

test('reconcileAgentState: orphaned recovers only on strong (mtime-class) alive evidence', () => {
  // session-file / transcript：sid/路径内容寻址、身份强 → 够格复活。
  assert.equal(reconcileAgentState('orphaned', 'alive', 'session-file-mtime'), 'running');
  assert.equal(reconcileAgentState('orphaned', 'alive', 'transcript-mtime'), 'running');
  // pid kill-0 无法验证进程身份（pid 复用假 alive / EPERM 也判 alive）→ 不作复活证据·棘轮保持。
  assert.equal(reconcileAgentState('orphaned', 'alive', 'pid'), 'orphaned');
  assert.equal(reconcileAgentState('orphaned', 'alive', 'none'), 'orphaned');
  assert.equal(reconcileAgentState('orphaned', 'alive'), 'orphaned'); // 无 method 视为证据不足
  // 非 alive 观测不能证明复活——orphaned 保持。
  assert.equal(reconcileAgentState('orphaned', 'gone', 'pid'), 'orphaned');
  assert.equal(reconcileAgentState('orphaned', 'silent', 'session-file-mtime'), 'orphaned');
  assert.equal(reconcileAgentState('orphaned', 'unknown', 'none'), 'orphaned');
});

test('reconcileAgentState: uncertain + pid alive still recovers (uncertain is not a dead state)', () => {
  assert.equal(reconcileAgentState('uncertain', 'alive', 'pid'), 'running');
  assert.equal(reconcileAgentState('running', 'alive', 'pid'), 'running'); // pid alive 维持 running 照旧
});

test('reconcileAgentState outputs are always legal engine transitions (single SSOT·no parallel truth)', async () => {
  const { AGENT_STATE_MACHINE, isLegalAgentTransition } = await import('@ccm/engine');
  const states = [...Object.keys(AGENT_STATE_MACHINE), 'bogus-state'];
  const observations = ['alive', 'silent', 'gone', 'unknown'];
  const methods = ['pid', 'session-file-mtime', 'transcript-mtime', 'none', undefined];
  for (const state of states) {
    for (const observed of observations) {
      for (const method of methods) {
        const next = reconcileAgentState(state, observed, method);
        assert.ok(
          next === state || isLegalAgentTransition(state, next),
          `reconcile(${state}, ${observed}, ${method}) → ${next} must be a legal transition`,
        );
      }
    }
  }
});

test('reconcileAgentState: terminal is the only true final state (never resurrected)', () => {
  assert.equal(reconcileAgentState('terminal', 'alive'), 'terminal');
  assert.equal(reconcileAgentState('terminal', 'gone'), 'terminal');
});
