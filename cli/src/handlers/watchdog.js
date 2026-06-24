'use strict';
// handlers/watchdog.js — watchdog noun handler（ADR-011 自我唤醒·cli-design §3 namespace watchdog）。
//
// 照 log.js 范式：每 verb 导出一个 handler(ctx) → exitCode。写 verb 用 _common.runWrite，读 verb 用 runRead。
//   · arm    —— runWrite + mutations.watchdogArm（--fire-at/--mechanism/--job-id/--checklist→fireAt/mechanism/jobId/checklist）。
//   · disarm —— runWrite + mutations.watchdogDisarm（幂等·删整对象不留残骸；若原有 job_id 则提示去清外部调度）。
//   · status —— runRead，读 board.watchdog（缺 → 报「未武装」；--json 出结构化）。
//
// flag 全集严格抄 registry.watchdog（不自创）；字段名照 FIELDS（board.watchdog = {armed_at, fire_at, mechanism, job_id, checklist}）。
//   mutation / discover 的 throw 不在 handler 内 catch——冒泡给 router 按 .errKind 映射退出码。handler 内绝不 process.exit。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖、纯 stdlib。CommonJS。
// 武装闸豁免：纯 handler 模块（无 hook 入口，只被 router 经 registry.handler 调）——见 AGENTS.md §3 / §12。

const mutations = require('../mutations.js');
const render = require('../render.js');
const { REGISTRY } = require('../registry.js');
const { runWrite, runRead, buildFields } = require('./_common.js');

// ── watchdog arm ────────────────────────────────────────────────────────────────────────────────
// flags（registry.watchdog.arm）：--fire-at（field fireAt·required）/ --mechanism（field mechanism·enum·required）/
//   --job-id（field jobId）/ --checklist（field checklist）。buildFields 按 field 映射后喂 mutations.watchdogArm。
function arm(ctx) {
  const spec = REGISTRY.watchdog.arm;
  return runWrite(ctx, {
    mutate: (board) => {
      const { fields } = buildFields(ctx.values, spec, { stdin: ctx.stdin });
      const args = {
        fireAt: fields.fireAt,
        mechanism: fields.mechanism,
        jobId: fields.jobId,
        checklist: fields.checklist,
      };
      return mutations.watchdogArm(board, args);
    },
    render: (next, c, { dryRun }) => {
      const wd = next.watchdog || {};
      if (c.flags.json) return renderWatchdog(wd, { json: true });
      const prefix = dryRun ? '[dry-run] 将武装 watchdog: ' : 'watchdog 已武装: ';
      const bits = [`fire_at=${wd.fire_at || ''}`, `mechanism=${wd.mechanism || ''}`];
      if (wd.job_id) bits.push(`job_id=${wd.job_id}`);
      return prefix + bits.join(' · ');
    },
  });
}

// ── watchdog disarm ─────────────────────────────────────────────────────────────────────────────
// 幂等：删整 watchdog 对象（置 null·不留残骸）；无 watchdog 也成功（exit 0·设计稿/help 草稿）。
//   若原有 job_id → 在 human 输出里提示去清外部调度（不阻断·watchdog disarm 删的是板上记录，外部句柄须人/agent 自清）。
function disarm(ctx) {
  // mutate 在 runWrite 内拿到盘上最新 board——在此捕获退役前的 job_id，供 render 出精准清理提示。
  let priorJobId = null;
  return runWrite(ctx, {
    mutate: (board) => {
      priorJobId = (board && board.watchdog && board.watchdog.job_id) || null;
      return mutations.watchdogDisarm(board);
    },
    render: (next, c, { dryRun }) => {
      if (c.flags.json) return renderWatchdog(next.watchdog, { json: true });
      const prefix = dryRun ? '[dry-run] 将退役 watchdog' : 'watchdog 已退役';
      const hint = priorJobId ? `（已删整对象，请去清理外部调度 job-id=${priorJobId}）` : '（已删整对象）';
      return prefix + hint;
    },
  });
}

// ── watchdog status ─────────────────────────────────────────────────────────────────────────────
// 读 verb：compute = 取 board.watchdog；render = renderWatchdog（缺 → 「未武装」；--json 出结构化）。
function status(ctx) {
  return runRead(ctx, {
    compute: (board) => (board && board.watchdog) || null,
    render: (wd, c) => renderWatchdog(wd, { json: !!c.flags.json, color: c.flags.color }),
  });
}

// ── renderWatchdog(wd, {json, color}) → string ────────────────────────────────────────────────────
//   wd 为 null/undefined → 「未武装」（human）/ jsonString(null)（json）。
//   人读：逐字段单列；--json：统一壳 { ok:true, data: wd|null }。
function renderWatchdog(wd, opts) {
  opts = opts || {};
  if (opts.json) return render.jsonString(wd || null);
  if (!wd) return 'watchdog: 未武装';
  const lines = ['watchdog: 已武装'];
  if (wd.armed_at) lines.push(`  armed_at:  ${wd.armed_at}`);
  if (wd.fire_at) lines.push(`  fire_at:   ${wd.fire_at}`);
  if (wd.mechanism) lines.push(`  mechanism: ${wd.mechanism}`);
  if (wd.job_id) lines.push(`  job_id:    ${wd.job_id}`);
  if (wd.checklist) lines.push(`  checklist: ${wd.checklist}`);
  return lines.join('\n');
}

module.exports = { arm, disarm, status };
