import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const A = 'skills/orchestrating-to-completion/assets';
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

// ★T4-3b: the lint ENGINE is no longer in-process require'd from cli/src — the whole cli/ is deleted and
//   the lint SSOT is @ccm/engine, reached via the `ccm` binary (ADR-014 process boundary). The engine's
//   own 82 tests cover lint LOGIC; this content test keeps only the CONTENT-LAYER assertion the engine
//   package can't make — "the canonical SHIPPED assets (template/example) are valid v2 and lint clean".
//   We reach lint through `ccm board lint --board <file> --raw --json` (run-tests sets CCM_BIN to the
//   dev-bin shim; standalone it falls back to PATH `ccm`). Returns {errors,warnings} projected from
//   ccm violations (level:'hard'→error / 'warn'→warning). Throws if ccm is unavailable (gap surfaces
//   loudly rather than silently passing — gate-green ≠ passed).
const CCM_BIN = process.env.CCM_BIN || 'ccm';
function lintAsset(relPath) {
  const file = join(ROOT, relPath);
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

test('board.template.json is the empty skeleton with the pinned schema + empty goal', () => {
  const b = read(`${A}/board.template.json`);
  assert.equal(b.schema, 'cc-master/v2');
  assert.equal(b.goal, '');            // bootstrap leaves goal empty; agent fills it
  assert.equal(b.owner.active, true);
  assert.deepEqual(b.tasks, []);
  assert.ok('git' in b && 'log' in b);
});

test('board.template.json carries meta.template_version (integer ≥ 1) — agent-shaped, NOT the pinned waist', () => {
  const b = read(`${A}/board.template.json`);
  // meta.template_version is an agent-shaped namespace field (red line 2: never the
  // hook-read narrow waist `schema`). It lets the timeline gate the real-time axis on
  // "this-release-or-later" boards. Lock it into the content contract to prevent regression.
  assert.ok(b.meta && typeof b.meta === 'object', 'board.template.json must carry a top-level meta object');
  assert.ok(Number.isInteger(b.meta.template_version), 'meta.template_version must be an integer');
  assert.ok(b.meta.template_version >= 1, 'meta.template_version must be ≥ 1');
});

test('board.template.json aggregates WIP control under scheduling (v2) — num_account retired', () => {
  const b = read(`${A}/board.template.json`);
  // v2 (ADR-013): WIP control aggregated into the `scheduling` module (was flat top-level wip_limit);
  // posttool-batch reads scheduling.wip_limit (v1 top-level fallback). num_account is RETIRED — usage-pacing
  // no longer reads the board (effective-N comes from accounts.json registry, A2 T6), so the template drops it.
  assert.ok(b.scheduling && typeof b.scheduling === 'object', 'template carries a scheduling object');
  assert.ok(Number.isInteger(b.scheduling.wip_limit), 'scheduling.wip_limit is an integer');
  assert.ok(!('num_account' in b), 'num_account is retired (no longer shipped in the template)');
  assert.ok(!('wip_limit' in b), 'flat top-level wip_limit is gone (moved under scheduling)');
});

test('board.example.json is a valid worked board with ≥1 task carrying id/status/deps', () => {
  const b = read(`${A}/board.example.json`);
  assert.equal(b.schema, 'cc-master/v2');
  assert.ok(b.tasks.length >= 1);
  for (const t of b.tasks) { assert.ok(t.id && t.status); assert.ok(Array.isArray(t.deps)); }
});

test('board.example.json demonstrates a per-task observability edge — agent-shaped telemetry, NOT the pinned waist', () => {
  const b = read(`${A}/board.example.json`);
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
  // RED LINE 2: observability is agent-shaped, never the hook-read narrow waist. The template (the
  // bootstrap-seeded skeleton, tasks:[]) carries NO observability — it is filled per-node at runtime.
  const tmpl = read(`${A}/board.template.json`);
  assert.deepEqual(tmpl.tasks, [], 'template ships empty tasks[] — observability is filled per-node at runtime, never seeded');
});

// ── v2 内容契约：模板 + 示例都 lint 零 error；示例展示 v2 新模块 ────────────────────────────────────
test('board.template.json + board.example.json lint with ZERO hard errors (canonical assets are valid v2)', () => {
  const tmpl = lintAsset(`${A}/board.template.json`);
  assert.equal(tmpl.errors.length, 0, `template hard errors: ${JSON.stringify(tmpl.errors)}`);
  assert.equal(tmpl.warnings.length, 0, `template should also be warning-clean: ${JSON.stringify(tmpl.warnings)}`);
  const ex = lintAsset(`${A}/board.example.json`);
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
  const b = read(`${A}/board.example.json`);
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
