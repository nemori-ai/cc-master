'use strict';
// handlers/log.js — reference handler（最简·作范式·cli-design §3 namespace log）。
//
// 这是 6 个 noun handler 里**最简的一个**，后续 5 个（board/task/jc/cadence/watchdog）照抄它的范式：
//   · 每 verb 导出一个 handler(ctx) → exitCode。
//   · 写 verb 用 _common.runWrite（resolve / mutate / render 三回调）；读 verb 用 _common.runRead（resolve / compute / render）。
//   · buildFields(ctx.values, spec) 把 parsed flags 按 registry 的 field/transform 映射成 mutation 入参。
//   · handler **直接 require leaf 模块**（mutations / render / registry），不经 ctx 注入（契约 §三 ctx 形态）。
//   · mutation / discover 的 throw **不在 handler 内 catch**——冒泡给 router 按 .errKind 映射退出码。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖、纯 stdlib。CommonJS。
// 武装闸豁免：纯 handler 模块（无 hook 入口，只被 router 经 registry.handler 调）——见 AGENTS.md §3 / §12。

const mutations = require('../mutations.js');
const render = require('../render.js');
const { REGISTRY } = require('../registry.js');
const { runWrite, runRead, buildFields } = require('./_common.js');

// ── log add ───────────────────────────────────────────────────────────────────────────────────────
// summary 是必填 positional（router 已校验非空）；flags：--kind / --task / --detail / --ref（refs[]）+ --log（无关此 verb）。
//   buildFields 把 kind/task/detail/refs（field 同名）+ refs（csv transform）组装好，喂 mutations.appendLog。
function add(ctx) {
  const spec = REGISTRY.log.add;
  return runWrite(ctx, {
    mutate: (board) => {
      const { fields } = buildFields(ctx.values, spec, { stdin: ctx.stdin });
      const args = {
        summary: ctx.positionals[0],
        kind: fields.kind,
        task: fields.task,
        detail: fields.detail,
        refs: fields.refs,
      };
      return mutations.appendLog(board, args);
    },
    render: (next, c, { dryRun }) => {
      if (c.flags.json) return render.renderLogList(next.log || [], { json: true });
      const entry = (next.log || [])[(next.log || []).length - 1];
      const prefix = dryRun ? '[dry-run] 将追加 log: ' : 'log 已追加: ';
      const summary = entry ? entry.summary : '';
      return prefix + summary;
    },
  });
}

// ── log list ────────────────────────────────────────────────────────────────────────────────────
// 读 verb：compute = 按 --kind / --task 过滤 board.log；render = renderLogList（human 表格 / --json 数组）。
function list(ctx) {
  return runRead(ctx, {
    compute: (board) => {
      const entries = Array.isArray(board.log) ? board.log : [];
      const fKind = ctx.values && ctx.values.kind;
      const fTask = ctx.values && ctx.values.task;
      return entries.filter((e) => {
        if (fKind && e.kind !== fKind) return false;
        if (fTask && e.task !== fTask) return false;
        return true;
      });
    },
    render: (entries, c) => render.renderLogList(entries, { json: !!c.flags.json, color: c.flags.color }),
  });
}

module.exports = { add, list };
