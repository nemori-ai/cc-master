// handler-capability.test.ts — capability 声明 / 查询 / 双向斜错优雅降级契约门（issue #167 DDL capability
//   versioning MVP）。
//
// 覆盖：
//   · 声明：`ccm capability list --json` 出结构化清单（schema + ccm_version + capabilities[{id,name,version}]）。
//   · 查询：`ccm capability check <id>` 支持 → exit 0；未声明 → exit VALIDATION + 明确提示。
//   · 新 plugin + 旧 ccm：plugin 想要的 id 不在清单里（模拟未来版本 / 未知能力）→ 非零 + 提示升级 → 降级。
//   · 旧 plugin + 新 ccm：清单是既有能力的超集（append-only），旧 id 仍在 → 向后兼容不崩。
//   · SSOT 不可变：buildManifest 返回可变副本，改它不污染 frozen 清单。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BOARD_INIT_STRUCTURED_PATH_CAPABILITY,
  buildManifest,
  CAPABILITIES,
  CAPABILITY_MANIFEST_SCHEMA,
  capabilityIds,
  GOAL_CONTRACT_CAPABILITY,
  GOAL_DEADLINE_CAPABILITY,
  isCapabilitySupported,
} from '../src/capability-manifest.js';
import type { Ctx } from '../src/handlers/_common.js';
import * as capability from '../src/handlers/capability.js';
import * as io from '../src/io.js';

const EXIT = io.EXIT;

interface TestCtx extends Ctx {
  outBuf: string[];
  errBuf: string[];
}

function mkCtx({
  positionals = [],
  json = false,
}: {
  positionals?: string[];
  json?: boolean;
} = {}): TestCtx {
  const outBuf: string[] = [];
  const errBuf: string[] = [];
  return {
    values: {},
    positionals,
    flags: {
      json,
      dryRun: false,
      force: false,
      yes: false,
      quiet: false,
      verbose: false,
      color: false,
    },
    sid: 'sid-cap',
    env: {},
    out: (s: string) => outBuf.push(s),
    err: (s: string) => errBuf.push(s),
    outBuf,
    errBuf,
  };
}

// ── 声明（declaration）──────────────────────────────────────────────────────────────────────────────
test('capability list --json declares a structured manifest with schema, ccm_version, versioned entries', () => {
  const ctx = mkCtx({ json: true });
  const code = capability.list(ctx);
  assert.equal(code, EXIT.OK);

  const payload = JSON.parse(ctx.outBuf.join(''));
  assert.equal(payload.ok, true);
  const m = payload.data;
  assert.equal(m.schema, CAPABILITY_MANIFEST_SCHEMA);
  assert.equal(typeof m.ccm_version, 'string');
  assert.ok(m.ccm_version.length > 0, 'ccm_version populated');
  assert.ok(Array.isArray(m.capabilities), 'capabilities is an array');
  for (const entry of m.capabilities) {
    assert.equal(typeof entry.id, 'string');
    assert.equal(typeof entry.name, 'string');
    assert.equal(typeof entry.version, 'number');
  }
  // DDL 能力已声明（issue #167）——这正是取代脆弱「探测 goal deadline 子命令」的协商基础。
  const ids = m.capabilities.map((c: { id: string }) => c.id);
  assert.ok(ids.includes(GOAL_DEADLINE_CAPABILITY), 'goal-deadline capability declared');
});

test('capability list (human) lists every advertised id', () => {
  const ctx = mkCtx();
  const code = capability.list(ctx);
  assert.equal(code, EXIT.OK);
  const out = ctx.outBuf.join('\n');
  for (const id of capabilityIds()) assert.ok(out.includes(id), `human list mentions ${id}`);
});

// ── 查询（query）───────────────────────────────────────────────────────────────────────────────────
test('capability check <supported id> returns OK for the DDL + legacy capabilities', () => {
  for (const id of [
    GOAL_DEADLINE_CAPABILITY,
    GOAL_CONTRACT_CAPABILITY,
    BOARD_INIT_STRUCTURED_PATH_CAPABILITY,
  ]) {
    const ctx = mkCtx({ positionals: [id], json: true });
    const code = capability.check(ctx);
    assert.equal(code, EXIT.OK, `${id} supported`);
    const payload = JSON.parse(ctx.outBuf.join(''));
    assert.equal(payload.ok, true);
    assert.equal(payload.data.supported, true);
    assert.equal(payload.data.capability, id);
  }
});

// ── 新 plugin + 旧 ccm：想要的能力这个 ccm 没有 → 非零 + 明确提示 → 调用方降级 ────────────────────────────
test('new-plugin-old-ccm skew: check for a capability this ccm does not advertise degrades with a clear hint', () => {
  // 模拟新 plugin 想要 goal-deadline/v2（本 ccm 只声明 v1）——即「较新的 plugin + 较旧的 ccm」。
  const ctx = mkCtx({ positionals: ['goal-deadline/v2'], json: true });
  const code = capability.check(ctx);
  assert.equal(code, EXIT.VALIDATION, 'unsupported capability → non-zero so shell caller degrades');

  const payload = JSON.parse(ctx.errBuf.join(''));
  assert.equal(payload.ok, false);
  assert.equal(payload.exit, EXIT.VALIDATION);
  assert.match(payload.error, /unsupported capability: goal-deadline\/v2/);
  // 明确提示：既报当前 ccm 声明了什么，也告诉调用方「升级 ccm 或优雅降级」。
  assert.match(payload.error, /upgrade ccm/i);
  assert.ok(
    payload.error.includes(GOAL_DEADLINE_CAPABILITY),
    'hint names what this ccm does advertise',
  );
});

test('new-plugin-old-ccm skew: check for a wholly unknown future capability degrades (human)', () => {
  const ctx = mkCtx({ positionals: ['some-future-feature/v1'] });
  const code = capability.check(ctx);
  assert.equal(code, EXIT.VALIDATION);
  assert.match(ctx.errBuf.join(''), /unsupported capability: some-future-feature\/v1/);
});

test('capability check with empty id degrades rather than crashing', () => {
  const ctx = mkCtx({ positionals: [] });
  const code = capability.check(ctx);
  assert.equal(code, EXIT.VALIDATION);
  assert.match(ctx.errBuf.join(''), /unsupported capability/);
});

// ── 旧 plugin + 新 ccm：清单是超集（append-only），旧 id 仍在 → 向后兼容 ───────────────────────────────
test('old-plugin-new-ccm skew: the manifest is an append-only superset that keeps every legacy id', () => {
  // 一个只认识旧 id 的旧 plugin 查询本（较新的）ccm——旧 id 必须仍被声明、check 仍 OK。
  for (const legacyId of [BOARD_INIT_STRUCTURED_PATH_CAPABILITY, GOAL_CONTRACT_CAPABILITY]) {
    assert.ok(isCapabilitySupported(legacyId), `${legacyId} still advertised (backward compat)`);
    const ctx = mkCtx({ positionals: [legacyId] });
    assert.equal(capability.check(ctx), EXIT.OK, `old plugin's ${legacyId} query still succeeds`);
  }
  // arming 握手用的两个能力排在清单最前（append-only 顺序稳定，新能力只追加到末尾）。
  const ids = capabilityIds();
  assert.equal(ids[0], BOARD_INIT_STRUCTURED_PATH_CAPABILITY);
  assert.equal(ids[1], GOAL_CONTRACT_CAPABILITY);
});

// ── SSOT 不可变 + helper 契约 ──────────────────────────────────────────────────────────────────────
test('buildManifest returns a fresh mutable copy without clobbering the frozen SSOT', () => {
  const a = buildManifest('9.9.9');
  a.capabilities.push({ id: 'mutant/v1', name: 'mutant', version: 1 });
  const firstBefore = a.capabilities[0];
  assert.ok(firstBefore);
  firstBefore.version = 999;
  // 再次构造应完全干净——证明返回的是副本、frozen 清单没被污染。
  const b = buildManifest('9.9.9');
  assert.equal(b.capabilities.length, CAPABILITIES.length);
  assert.equal(
    b.capabilities.some((c) => c.id === 'mutant/v1'),
    false,
  );
  const firstAfter = b.capabilities[0];
  assert.ok(firstAfter);
  assert.equal(firstAfter.version, 1);
  assert.equal(isCapabilitySupported('mutant/v1'), false);
});

test('capability ids are unique and each carries a name + integer version', () => {
  const ids = capabilityIds();
  assert.equal(new Set(ids).size, ids.length, 'ids unique');
  for (const c of CAPABILITIES) {
    assert.ok(c.name.length > 0);
    assert.ok(Number.isInteger(c.version) && c.version >= 1);
  }
});
