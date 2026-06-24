'use strict';
// handlers/cadence.js — cadence noun handler（节奏 / iteration 收口·cli-design §3 namespace cadence）。
//
// 照 handlers/log.js 的范式（每 verb 一个 handler(ctx)→exitCode；写 verb 用 _common.runWrite，
//   读 verb 用 runRead；buildFields 把 parsed flags 按 registry field/transform 映射）。本 noun 四 verb：
//     · update —— 设 / 改 target={ship_every,min_unit}（runWrite + mutations.cadenceUpdate）。
//     · open   —— 开一个 iteration（runWrite + mutations.cadenceOpen；自动盖 started_at、status=open）。
//     · ship   —— 收口 iteration（runWrite + mutations.cadenceShip）。BIZ-CADENCE-SHIPPED 是 lint 硬门：
//                 成员未全 done+verified → runWrite 的 lint 步 return VALIDATION（不在本 handler 校验，符合预期）。
//     · status —— 当前节奏 + 各 iteration 状态（runRead）。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖、纯 stdlib。CommonJS。
// 武装闸豁免：纯 handler 模块（无 hook 入口，只被 router 经 registry.handler 调）——见 AGENTS.md §3 / §12。
//
// flag → mutation 入参映射纪律：registry 用 FIELDS dotpath（如 'cadence.target.ship_every'），buildFields
//   忠实把整条 dotpath 当 key 搬进 fields；本 handler 负责把 dotpath 改名成 mutation 期望的驼峰键
//   （shipEvery / minUnit）。mutation / discover 的 throw **不在 handler 内 catch**——冒泡给 router 按 .errKind 映射退出码。

const mutations = require('../mutations.js');
const render = require('../render.js');
const { REGISTRY } = require('../registry.js');
const { runWrite, runRead, buildFields } = require('./_common.js');

// 把 buildFields 收集的 sets / setJsons 操作列表依次套到 board 上（通用 --set / --set-json 逃生口）。
//   applySet / applySetJson 命中 🔒 load-bearing path 会 throw .errKind='Validation'（冒泡给 router → exit 3）。
function applySets(board, sets, setJsons) {
  let b = board;
  for (const op of sets || []) b = mutations.applySet(b, op.path, op.value);
  for (const op of setJsons || []) b = mutations.applySetJson(b, op.path, op.value);
  return b;
}

// ── cadence update ──────────────────────────────────────────────────────────────────────────────
// flags（registry）：--ship-every（field cadence.target.ship_every·transform duration）/ --min-unit
//   （field cadence.target.min_unit）/ --set / --set-json。把 dotpath 改名成 {shipEvery, minUnit} 喂 cadenceUpdate。
function update(ctx) {
  const spec = REGISTRY.cadence.update;
  return runWrite(ctx, {
    mutate: (board) => {
      const { fields, sets, setJsons } = buildFields(ctx.values, spec, { stdin: ctx.stdin });
      const args = {
        shipEvery: fields['cadence.target.ship_every'],
        minUnit: fields['cadence.target.min_unit'],
      };
      let next = mutations.cadenceUpdate(board, args);
      next = applySets(next, sets, setJsons);
      return next;
    },
    render: (next, c, { dryRun }) => {
      const cadence = (next && next.cadence) || {};
      if (c.flags.json) return render.jsonString(cadence);
      const prefix = dryRun ? '[dry-run] 将更新节奏配置: ' : '节奏配置已更新: ';
      return prefix + renderTargetLine(cadence.target);
    },
  });
}

// ── cadence open ────────────────────────────────────────────────────────────────────────────────
// positional：iter-id（router 已校验非空）。flags：--goal / --deadline / --members（csv）/ --set / --set-json。
//   goal / deadline / members 是 iteration-local 字段（非 board.goal）——直接喂 cadenceOpen(board, iterId, args)。
function open(ctx) {
  const spec = REGISTRY.cadence.open;
  return runWrite(ctx, {
    mutate: (board) => {
      const { fields, sets, setJsons } = buildFields(ctx.values, spec, { stdin: ctx.stdin });
      const iterId = ctx.positionals[0];
      const args = {
        goal: fields.goal,
        deadline: fields.deadline,
        members: fields.members,
      };
      let next = mutations.cadenceOpen(board, iterId, args);
      next = applySets(next, sets, setJsons);
      return next;
    },
    render: (next, c, { dryRun }) => {
      const iter = findIter(next, ctx.positionals[0]);
      if (c.flags.json) return render.jsonString(iter || null);
      const prefix = dryRun ? '[dry-run] 将开启 iteration: ' : 'iteration 已开启: ';
      return prefix + renderIterLine(iter);
    },
  });
}

// ── cadence ship ────────────────────────────────────────────────────────────────────────────────
// positional：iter-id。mutations.cadenceShip 机械置 status=shipped；成员完整性（全 done+verified）
//   由 runWrite 的 lint 步（BIZ-CADENCE-SHIPPED hard）在落盘前挡 → return VALIDATION（exit 3·符合预期）。
//   iteration 不存在 → cadenceShip throw .errKind='NotFound'（冒泡给 router → exit 5）。
function ship(ctx) {
  return runWrite(ctx, {
    mutate: (board) => mutations.cadenceShip(board, ctx.positionals[0], { force: ctx.flags && ctx.flags.force }),
    render: (next, c, { dryRun }) => {
      const iter = findIter(next, ctx.positionals[0]);
      if (c.flags.json) return render.jsonString(iter || null);
      const prefix = dryRun ? '[dry-run] 将收口 iteration: ' : 'iteration 已收口: ';
      return prefix + renderIterLine(iter);
    },
  });
}

// ── cadence status ──────────────────────────────────────────────────────────────────────────────
// 读 verb：render.js 无专属 cadence renderer（它只产字符串、不算节奏）——故 human 形态在此 handler 内拼字符串
//   （goal/target 一行 + 每 iteration 一行），json 形态用 render.jsonString 裹整个 cadence 对象（形状稳定）。
function status(ctx) {
  return runRead(ctx, {
    compute: (board) => (board && board.cadence) || {},
    render: (cadence, c) => {
      if (c.flags.json) return render.jsonString(cadence);
      return renderStatusHuman(cadence);
    },
  });
}

// ── 本地 human 渲染小工具（render.js 不含 cadence renderer·见 status 注释）─────────────────────────
function renderTargetLine(target) {
  const t = (target && typeof target === 'object') ? target : {};
  const se = formatShipEvery(t.ship_every);
  const mu = t.min_unit !== undefined && t.min_unit !== null && t.min_unit !== '' ? t.min_unit : '-';
  return `ship_every=${se} min_unit=${mu}`;
}

// ship_every 既可能是 {value,unit}（经 --ship-every duration transform）也可能是字符串（手搓 / --set）。
function formatShipEvery(se) {
  if (se === undefined || se === null || se === '') return '-';
  if (typeof se === 'object' && se.value !== undefined) return `${se.value}${se.unit || ''}`;
  return String(se);
}

function findIter(board, iterId) {
  const iters = board && board.cadence && Array.isArray(board.cadence.iterations) ? board.cadence.iterations : [];
  return iters.find((it) => it && it.id === iterId);
}

function renderIterLine(iter) {
  if (!iter || typeof iter !== 'object') return '(无此 iteration)';
  const members = Array.isArray(iter.members) && iter.members.length ? iter.members.join(', ') : '-';
  const goal = iter.goal !== undefined && iter.goal !== null && iter.goal !== '' ? iter.goal : '';
  return `${iter.id} [${iter.status || '?'}]${goal ? ' ' + goal : ''} (members: ${members})`;
}

function renderStatusHuman(cadence) {
  const c = (cadence && typeof cadence === 'object') ? cadence : {};
  const lines = [];
  lines.push('target: ' + renderTargetLine(c.target));
  const iters = Array.isArray(c.iterations) ? c.iterations : [];
  if (iters.length === 0) {
    lines.push('iterations: (无)');
  } else {
    lines.push(`iterations (${iters.length}):`);
    for (const it of iters) lines.push('  ' + renderIterLine(it));
  }
  return lines.join('\n');
}

module.exports = { update, open, ship, status };
