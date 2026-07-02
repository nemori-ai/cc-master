import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// board.example.json 已从分发的 skill assets 搬进 tests/fixtures/（hooks ⊥ skill scripts/assets 解耦：
// bootstrap 不再引用任何 skill asset·board.template.json 已删·骨架改由 `ccm board init` 建）。它是本
// content 测试的 worked-board fixture + references/board.md 的示例来源。
const FIXTURES = 'tests/fixtures';
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

// ★T4-3b: the lint ENGINE is no longer in-process require'd from cli/src — the whole cli/ is deleted and
//   the lint SSOT is @ccm/engine, reached via the `ccm` binary (ADR-014 process boundary). The engine's
//   own tests cover lint LOGIC; this content test keeps only the CONTENT-LAYER assertion the engine
//   package can't make — "the canonical board shapes (the ccm-init skeleton / the worked example) are
//   valid v2 and lint clean". We reach lint through `ccm board lint --board <file> --raw --json`
//   (run-tests sets CCM_BIN to the dev-bin shim; standalone it falls back to PATH `ccm`). Returns
//   {errors,warnings} projected from ccm violations (level:'hard'→error / 'warn'→warning). Throws if
//   ccm is unavailable (gap surfaces loudly rather than silently passing — gate-green ≠ passed).
const CCM_BIN = process.env.CCM_BIN || 'ccm';
function lintFile(file) {
  const r = spawnSync(CCM_BIN, ['board', 'lint', '--board', file, '--raw', '--json'], {
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.ok(!r.error, `ccm lint must be invokable (CCM_BIN=${CCM_BIN}); error: ${r.error && r.error.message}`);
  let parsed;
  try {
    parsed = JSON.parse(r.stdout || '');
  } catch (_e) {
    assert.fail(`ccm board lint --raw --json must emit valid JSON (got rc ${r.status}, stderr: ${(r.stderr || '').trim()})`);
  }
  const data = parsed && parsed.data;
  assert.ok(data && Array.isArray(data.violations), 'ccm lint JSON must carry data.violations[]');
  return {
    errors: data.violations.filter((v) => v && v.level === 'hard'),
    warnings: data.violations.filter((v) => v && v.level === 'warn'),
  };
}
const lintAsset = (relPath) => lintFile(join(ROOT, relPath));

// initSkeleton() — the FRESH board skeleton is now produced by `ccm board init` (the board-model SSOT
// in @ccm/engine·ADR-014), NOT a shipped skill asset. board.template.json was DELETED: a hook must
// never reach into skills/.../assets, so bootstrap-board.sh builds the empty skeleton via `ccm board
// init` (then stamps owner.session_id itself for arming). This helper runs `ccm board init` into an
// isolated temp home and returns the created board object + its path — the canonical "empty skeleton"
// the content contract used to assert on the template FILE. It is the SSOT for the skeleton shape now.
function initSkeleton() {
  const home = mkdtempSync(join(tmpdir(), 'ccm-init-'));
  const r = spawnSync(CCM_BIN, ['board', 'init'], {
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, CC_MASTER_HOME: home },
  });
  assert.ok(!r.error, `ccm board init must be invokable (CCM_BIN=${CCM_BIN}); error: ${r.error && r.error.message}`);
  const m = (r.stdout || '').match(/\S*\.board\.json/);
  assert.ok(m, `ccm board init must print the created board path (rc ${r.status}, stderr: ${(r.stderr || '').trim()})`);
  return { board: JSON.parse(readFileSync(m[0], 'utf8')), path: m[0] };
}

test('ccm board init produces the empty skeleton with the pinned schema + empty goal', () => {
  const b = initSkeleton().board;
  assert.equal(b.schema, 'cc-master/v2');
  assert.equal(b.goal, '');            // bootstrap leaves goal empty; agent fills it
  assert.equal(b.owner.active, true);
  assert.deepEqual(b.tasks, []);
  assert.ok('git' in b && 'log' in b);
});

test('ccm board init skeleton carries meta.template_version (integer ≥ 1) — agent-shaped, NOT the pinned waist', () => {
  const b = initSkeleton().board;
  // meta.template_version is an agent-shaped namespace field (red line 2: never the
  // hook-read narrow waist `schema`). It lets the timeline gate the real-time axis on
  // "this-release-or-later" boards. Lock it into the content contract to prevent regression.
  assert.ok(b.meta && typeof b.meta === 'object', 'the skeleton must carry a top-level meta object');
  assert.ok(Number.isInteger(b.meta.template_version), 'meta.template_version must be an integer');
  assert.ok(b.meta.template_version >= 1, 'meta.template_version must be ≥ 1');
});

test('ccm board init skeleton aggregates WIP control under scheduling (v2) — num_account retired', () => {
  const b = initSkeleton().board;
  // v2 (ADR-013): WIP control aggregated into the `scheduling` module (was flat top-level wip_limit);
  // posttool-batch reads scheduling.wip_limit (v1 top-level fallback). num_account is RETIRED — usage-pacing
  // no longer reads the board (effective-N comes from accounts.json registry, A2 T6), so the skeleton drops it.
  assert.ok(b.scheduling && typeof b.scheduling === 'object', 'the skeleton carries a scheduling object');
  assert.ok(Number.isInteger(b.scheduling.wip_limit), 'scheduling.wip_limit is an integer');
  assert.ok(!('num_account' in b), 'num_account is retired (no longer seeded)');
  assert.ok(!('wip_limit' in b), 'flat top-level wip_limit is gone (moved under scheduling)');
});

test('board.example.json is a valid worked board with ≥1 task carrying id/status/deps', () => {
  const b = read(`${FIXTURES}/board.example.json`);
  assert.equal(b.schema, 'cc-master/v2');
  assert.ok(b.tasks.length >= 1);
  for (const t of b.tasks) { assert.ok(t.id && t.status); assert.ok(Array.isArray(t.deps)); }
});

test('board.example.json demonstrates a per-task observability edge — agent-shaped telemetry, NOT the pinned waist', () => {
  const b = read(`${FIXTURES}/board.example.json`);
  // observability is an OPTIONAL per-task agent-shaped flexible edge (red line 2): orchestrator copies
  // the completion notification's <usage> block (subagent_tokens/duration_ms/tool_uses) into it when it
  // marks a node done. NO hook reads it — board-lint is silent-on-unknown, so it ships zero hook/lint
  // change. The example must demonstrate one shape so readers (view.html / retrospective) see the schema.
  const withObs = b.tasks.find((t) => t && typeof t.observability === 'object' && t.observability);
  assert.ok(withObs, 'board.example.json must demonstrate ≥1 task carrying an observability object');
  const o = withObs.observability;
  assert.ok(Number.isFinite(o.total_tokens), 'observability.total_tokens must be a number');
  assert.ok(Number.isFinite(o.duration_ms), 'observability.duration_ms must be a number');
  assert.ok(typeof o.source === 'string' && o.source.length > 0, 'observability.source must label the provenance');
  // RED LINE 2: observability is agent-shaped, never the hook-read narrow waist. The bootstrap-seeded
  // skeleton (produced by `ccm board init`, tasks:[]) carries NO observability — it is filled per-node.
  const skel = initSkeleton().board;
  assert.deepEqual(skel.tasks, [], 'ccm board init ships empty tasks[] — observability is filled per-node at runtime, never seeded');
});

// ── v2 内容契约：骨架 + 示例都 lint 零 error；示例展示 v2 新模块 ────────────────────────────────────
test('ccm board init skeleton + board.example.json lint with ZERO hard errors (canonical shapes are valid v2)', () => {
  const skel = lintFile(initSkeleton().path);
  assert.equal(skel.errors.length, 0, `skeleton hard errors: ${JSON.stringify(skel.errors)}`);
  assert.equal(skel.warnings.length, 0, `skeleton should also be warning-clean: ${JSON.stringify(skel.warnings)}`);
  const ex = lintAsset(`${FIXTURES}/board.example.json`);
  assert.equal(ex.errors.length, 0, `example hard errors: ${JSON.stringify(ex.errors)}`);
  // 示例的 warn 现在**只剩一条**「故意」的（GRAPH-CONNECTED cry-wolf 收尾后收紧）：
  //   ① BIZ-TIME-ORDER —— legacy 节点 T2 故意无 finished_at，演示旧板 lint 轻推。
  //   曾经的第二条 GRAPH-CONNECTED 已消除，示例现在是 GRAPH-CONNECTED-clean 的好示范（非靠放宽测试容忍）：
  //     · F1（role=fill-work·故意独立的填闲并行工作）现被 GRAPH-CONNECTED **豁免**——fill-work 从连通性节点集
  //       剔除，纯 fill-work 孤岛不再 warn（cry-wolf 修）。
  //     · D1（awaiting-user 决策门）**不豁免**——按用户设计原则，决策门本应连进主图（是某工作节点的前驱/子/
  //       子图/节点本身），故 D1 已接回主图：wrap-up 节点 M1.c 现 deps 含 D1（PR-split 决策 gate 下游 M1.c），
  //       D1 不再是孤岛。示例板因此**不再触发** GRAPH-CONNECTED。
  const ALLOWED_WARN = new Set(['BIZ-TIME-ORDER']);
  assert.ok(ex.warnings.every((w) => ALLOWED_WARN.has(w.rule)),
    `example warnings should only be the single intentional demo (BIZ-TIME-ORDER); GRAPH-CONNECTED must be gone (F1 exempt + D1 reconnected): ${JSON.stringify(ex.warnings)}`);
  assert.ok(!ex.warnings.some((w) => w.rule === 'GRAPH-CONNECTED'),
    `example must be GRAPH-CONNECTED-clean now (fill-work F1 exempt, awaiting-user D1 wired into main DAG via M1.c): ${JSON.stringify(ex.warnings)}`);
});

test('board.example.json demonstrates the v2 agile modules (executor / cadence / judgment_calls / references)', () => {
  const b = read(`${FIXTURES}/board.example.json`);
  // executor 取代 v1 mechanism（5 值枚举）。
  assert.ok(b.tasks.some((t) => t.executor === 'subagent'), 'example demonstrates executor=subagent (v2, replaces mechanism)');
  assert.ok(!b.tasks.some((t) => 'mechanism' in t), 'no task carries the retired v1 mechanism field');
  // cadence（节奏/timebox 策略层）。
  assert.ok(b.cadence && Array.isArray(b.cadence.iterations) && b.cadence.iterations.length >= 1, 'example carries a cadence iteration');
  // judgment_calls（自决诚实台账）。
  assert.ok(Array.isArray(b.judgment_calls) && b.judgment_calls.length >= 1, 'example carries a judgment_call entry');
  // references（取代 v1 links；ref 绝对路径/URL）。
  const devTask = b.tasks.find((t) => t.type === 'development');
  assert.ok(devTask && Array.isArray(devTask.references) && devTask.references.length >= 1, 'a development task demonstrates references');
});
