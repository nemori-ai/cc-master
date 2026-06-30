// statusline-render.test.ts — @ccm/engine·renderStatusline 契约门（self-contained status line·0.10.0）。
//   钉住：单行铁律 / 段优雅省略（null ctx / 缺 rate_limits）/ 10 格进度条 / 三窗口阈值变色 / color 开关。
//   测 build 后的 dist 公开 API barrel（与其余 engine 测试同口径）。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderStatusline } from '../dist/index.mjs';

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';

// 计颜色码出现次数（粗粒度断言某档色被用上）。
function has(s: string, code: string): boolean {
  return s.includes(code);
}
// 去 ANSI（断言纯文本结构 / 数进度条格子）。
function strip(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 故意匹配 ANSI ESC。
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

// ── 单行铁律 ──────────────────────────────────────────────────────────────────────────────────────
test('render: 永远单行（绝无换行）', () => {
  const line = renderStatusline({
    context_window: { used_percentage: 78 },
    rate_limits: { five_hour: { used_percentage: 64 }, seven_day: { used_percentage: 14 } },
    model: { display_name: 'Claude Opus 4.8' },
  });
  assert.ok(!line.includes('\n'), '无换行');
  assert.ok(line.length > 0, '非空');
});

// ── 全段渲染 + 模型前缀简写 ─────────────────────────────────────────────────────────────────────────
test('render: ctx + 5h + 7d 三段齐 + model 前缀去 "Claude "', () => {
  const plain = strip(
    renderStatusline(
      {
        context_window: { used_percentage: 78 },
        rate_limits: { five_hour: { used_percentage: 64 }, seven_day: { used_percentage: 14 } },
        model: { display_name: 'Claude Opus 4.8' },
      },
      { color: false },
    ),
  );
  assert.ok(plain.includes('Opus 4.8'), '前缀简写去 Claude');
  assert.ok(!plain.includes('Claude'), '不含 Claude 前缀');
  assert.ok(plain.includes('ctx '), '有 ctx 段');
  assert.ok(plain.includes('78%'), 'ctx 百分比');
  assert.ok(plain.includes('5h 64%'), '5h 段');
  assert.ok(plain.includes('7d 14%'), '7d 段');
});

// ── null context（首条消息前）→ ctx 段优雅省略 ──────────────────────────────────────────────────────
test('render: context_window.used_percentage=null → 省略 ctx 段（5h/7d 仍显）', () => {
  const plain = strip(
    renderStatusline(
      {
        context_window: { used_percentage: null },
        rate_limits: { five_hour: { used_percentage: 95 }, seven_day: { used_percentage: 88 } },
      },
      { color: false },
    ),
  );
  assert.ok(!plain.includes('ctx'), '无 ctx 段');
  assert.ok(plain.includes('5h 95%'), '5h 仍显');
  assert.ok(plain.includes('7d 88%'), '7d 仍显');
});

// ── 缺 rate_limits（非 Pro/Max 或窗口未现）→ 只剩 ctx ───────────────────────────────────────────────
test('render: 缺 rate_limits → 只剩 ctx 段（无 5h/7d）', () => {
  const plain = strip(
    renderStatusline({ context_window: { used_percentage: 50 } }, { color: false }),
  );
  assert.ok(plain.includes('ctx '), '有 ctx');
  assert.ok(!plain.includes('5h'), '无 5h');
  assert.ok(!plain.includes('7d'), '无 7d');
});

test('render: 单窗口存在（只 5h 不 7d）→ 只显 5h', () => {
  const plain = strip(
    renderStatusline({ rate_limits: { five_hour: { used_percentage: 30 } } }, { color: false }),
  );
  assert.ok(plain.includes('5h 30%'), '5h 显');
  assert.ok(!plain.includes('7d'), '无 7d');
});

// ── 全缺 → 空串（不输出） ──────────────────────────────────────────────────────────────────────────
test('render: 全字段缺 / 空对象 → 空串', () => {
  assert.equal(renderStatusline({}), '');
  assert.equal(renderStatusline(null), '');
  assert.equal(renderStatusline({ context_window: { used_percentage: null } }), '');
});

// ── 10 格进度条 ────────────────────────────────────────────────────────────────────────────────────
test('render: 进度条恒 10 格（filled+empty），filled=round(pct/10)', () => {
  const bar = (pct: number): { filled: number; empty: number } => {
    const plain = strip(
      renderStatusline({ context_window: { used_percentage: pct } }, { color: false }),
    );
    const filled = (plain.match(/█/g) || []).length;
    const empty = (plain.match(/░/g) || []).length;
    return { filled, empty };
  };
  assert.deepEqual(bar(0), { filled: 0, empty: 10 });
  assert.deepEqual(bar(78), { filled: 8, empty: 2 }); // round(7.8)=8
  assert.deepEqual(bar(100), { filled: 10, empty: 0 });
  assert.deepEqual(bar(50), { filled: 5, empty: 5 });
});

// ── 阈值变色：context（绿<60·黄60–85·红>85）──────────────────────────────────────────────────────────
test('render: ctx 阈值（绿<60·黄60–85·红>85）', () => {
  assert.ok(has(renderStatusline({ context_window: { used_percentage: 50 } }), GREEN), '50 绿');
  assert.ok(
    has(renderStatusline({ context_window: { used_percentage: 60 } }), YELLOW),
    '60 黄（含下界）',
  );
  assert.ok(
    has(renderStatusline({ context_window: { used_percentage: 85 } }), YELLOW),
    '85 黄（含上界）',
  );
  assert.ok(has(renderStatusline({ context_window: { used_percentage: 86 } }), RED), '86 红');
});

// ── 阈值变色：5h（绿<70·黄70–90·红>90）─────────────────────────────────────────────────────────────
test('render: 5h 阈值（绿<70·黄70–90·红>90）', () => {
  const r = (p: number) => renderStatusline({ rate_limits: { five_hour: { used_percentage: p } } });
  assert.ok(has(r(64), GREEN), '64 绿');
  assert.ok(has(r(70), YELLOW), '70 黄');
  assert.ok(has(r(90), YELLOW), '90 黄');
  assert.ok(has(r(95), RED), '95 红');
});

// ── 阈值变色：7d（绿<70·黄70–85·红>85）─────────────────────────────────────────────────────────────
test('render: 7d 阈值（绿<70·黄70–85·红>85）', () => {
  const r = (p: number) => renderStatusline({ rate_limits: { seven_day: { used_percentage: p } } });
  assert.ok(has(r(14), GREEN), '14 绿');
  assert.ok(has(r(70), YELLOW), '70 黄');
  assert.ok(has(r(85), YELLOW), '85 黄');
  assert.ok(has(r(86), RED), '86 红');
});

// ── color:false → 纯文本（无 ANSI ESC）──────────────────────────────────────────────────────────────
test('render: color:false → 无任何 ANSI 转义', () => {
  const line = renderStatusline(
    {
      context_window: { used_percentage: 90 },
      rate_limits: { five_hour: { used_percentage: 50 } },
    },
    { color: false },
  );
  assert.ok(!line.includes('\x1b'), '无 ESC');
  assert.ok(line.includes('ctx '), '仍有结构');
});

// ── 默认上色（color 省略 → true）────────────────────────────────────────────────────────────────────
test('render: 默认 color（不传 opts）→ 带 ANSI', () => {
  const line = renderStatusline({ context_window: { used_percentage: 90 } });
  assert.ok(line.includes('\x1b'), '默认带色');
});

// ── 鲁棒：坏 / 越界输入不抛 ─────────────────────────────────────────────────────────────────────────
test('render: 非数值 / 越界 used_percentage 优雅处理（不抛）', () => {
  assert.equal(renderStatusline({ context_window: { used_percentage: 'x' } }), ''); // 非数值省略
  assert.equal(renderStatusline({ context_window: { used_percentage: -5 } }), ''); // 负数省略
  const over = strip(
    renderStatusline({ context_window: { used_percentage: 140 } }, { color: false }),
  );
  assert.deepEqual((over.match(/█/g) || []).length, 10); // 夹到 100 → 满格
});
