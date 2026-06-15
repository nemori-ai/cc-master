#!/usr/bin/env node
// usage-pacing.js — H8 (ADR-006 解锁的旗舰 node hook)。
//
// 事件：Stop。每当主线 agent 想交还控制权时触发。读本地 usage JSONL（同 scripts/cc-usage.sh
// 的解析 + 5h rolling block + burn-rate 算法，同源同口径），感知是否临近「5h burn-rate 墙」，
// 临界时注入一条 **非阻断** 的 pacing 警告（hookSpecificOutput.additionalContext，hookEventName
// "Stop"）。**绝不 decision:block** —— hook 只感知+提示，怎么 pace 是认知（属 SKILL A，cost-and-
// pacing.md），不在 hook 里替主线做调度决策（红线4：指挥不演奏，引擎不替它思考）。
//
// 红线1 / ADR-006：node/JS only。JSON.parse 读 JSONL，零 spawn（不 spawn python/不靠 bash 算逻辑），
//   零网络，零额外依赖。所有异常 try/catch 兜住 → 任何失败都静默 exit 0（hook 崩会污染 Stop）。
//
// ARMED GATE（armed-hook 纪律的 node 版，本文件最关键的行为修复）：所有 cc-master hook 在本 session
//   「被武装」之前完全休眠 —— armed ⟺ home（CC_MASTER_HOME / CLAUDE_PROJECT_DIR/.claude/cc-master）里
//   存在一个 *.board.json，其 owner.active:true **且** owner.session_id == 本次 stdin 的 session_id
//   （**仅** stdin sid 空 → 非对称降级：匹配任一 active 板保 compaction 边界鲁棒，ADR-007 §2.3；board 未盖
//   session_id（空串）则**保持休眠**——不收养、不武装不相关 session，红线 6；board sid 非空且 ≠ stdin sid 亦不武装）。
//   在此之前 usage-pacing 完全不 gate，
//   读宿主全局 usage 就注入 —— 于是它会在**每一个** session（包括从没跑过 as-master-orchestrator 的）
//   里刷 pacing 提示，污染所有 session。现在 main() 最前面先判 armed，**未武装 → 在读 usage 之前就静默
//   exit 0**。注意：这个 board 读取**只为判 arming**（active + session_id 两个早已 pinned 的 narrow-
//   waist 字段），不读 tasks、不写 board、绝不依赖 board 的 agent-shaped 部分 —— narrow waist 不动。
// 只读 usage JSONL（+ 判 arming 时只读 board 的 active/session_id）—— 绝不写 board。
//
// node-on-PATH（ADR-006 §3.2）：npm/global 安装铁定有 `node`；standalone-binary 安装可能内嵌 node
//   而不暴露到 PATH —— 那种宿主下本脚本（shebang `#!/usr/bin/env node`）根本不会被调起，等同于「该 hook
//   不存在」。这是 Stop 事件上的**优雅降级**（不阻断、不报错），与本 hook「失败必静默」的精神一致；
//   owner 在 ADR-006 接受 npm-install 多数派这条边界。启动开销 ~数十 ms —— Stop 是低频事件（每轮一次，
//   非 per-tool），可承受；故 H8 选 node hook 而非留 bash。

'use strict';

const fs = require('fs');
const path = require('path');

// ── 触发策略阈值（克制，避免每回合刷屏；见文件尾 README 块的完整论证）────────────────────────────
//
// 环境覆写点（与 cc-usage.sh 的 --dir/--now 对偶，供测试注入 fixture + 锚定确定性时间）：
//   CC_MASTER_USAGE_DIR  usage JSONL 根目录（默认 ~/.claude/projects），测试指向 fixture。
//   CC_MASTER_NOW        ISO-8601 覆写「现在」，让 rolling window 与撞墙预测确定可复现。
//   CC_MASTER_5H_BUDGET  （可选）本 5h 窗口的 token 预算上限。给了就走「预测撞墙」分支；
//                        未给则 ceiling 未知（真实约束）→ 退化到「明显临界」启发式，否则静默。
//   CC_MASTER_5H_BURN_FLOOR （可选）无预算时启发式用的绝对 burn 地板（tok/min）。给了就覆写默认。
const USAGE_DIR =
  process.env.CC_MASTER_USAGE_DIR ||
  path.join(process.env.HOME || '', '.claude', 'projects');
// HOME_DIR：armed 判定要扫的 board home（与 bash hooks 同口径：CC_MASTER_HOME 覆写，否则
//   CLAUDE_PROJECT_DIR/.claude/cc-master，再否则 cwd/.claude/cc-master）。测试经 CC_MASTER_HOME 注入。
const HOME_DIR =
  process.env.CC_MASTER_HOME ||
  path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.claude', 'cc-master');
const NOW_OVERRIDE = process.env.CC_MASTER_NOW || '';
const BUDGET_RAW = process.env.CC_MASTER_5H_BUDGET || '';
const BURN_FLOOR_RAW = process.env.CC_MASTER_5H_BURN_FLOOR || '';
// account-authoritative pacing (Finding #37): 优先信 status-line 捕获的账户权威 5h/7d used_percentage
//   (落在 sidecar);只有 sidecar 缺/坏时才降级本地反推。PCT_FLOOR:某窗口 used% 到此即临界(默认 85)。
const RATE_CACHE =
  process.env.CC_MASTER_RATE_CACHE ||
  path.join(process.env.HOME || '', '.claude', '.cc-master-rate-limits.json');
const PCT_FLOOR_RAW = process.env.CC_MASTER_PCT_FLOOR || '';
// account-authoritative UNDERUSE pacing (对偶于撞墙侧): 当账户口径显示 5h 窗口**欠用**（used% 低）且
//   **临近 reset**（窗口快归零、再不烧就白白浪费）且 **7d 总闸有余量**时，注入一条对称的「加速」非阻断提示。
//   三条 env 覆写点（与撞墙侧 CC_MASTER_PCT_FLOOR 对偶；解析失败一律回退默认）：
//     CC_MASTER_UNDERUSE_PCT_CEIL    5h used% 低于此即「欠用」（默认 60）
//     CC_MASTER_UNDERUSE_REMAIN_MIN  距 5h reset 剩余分钟 ≤ 此即「临近 reset」（默认 60）
//     CC_MASTER_SEVEN_DAY_HEADROOM   7d used% 低于此即「总闸有余量」（默认 80；7d 缺失 → 静默，保守取向）
//     CC_MASTER_UNDERUSE_MAX_STALE_MIN  sidecar 新鲜度上限（分钟，默认 15）：captured_at 距今 > 此即陈旧 → 静默
const UNDERUSE_PCT_CEIL_RAW = process.env.CC_MASTER_UNDERUSE_PCT_CEIL || '';
const UNDERUSE_REMAIN_MIN_RAW = process.env.CC_MASTER_UNDERUSE_REMAIN_MIN || '';
const SEVEN_DAY_HEADROOM_RAW = process.env.CC_MASTER_SEVEN_DAY_HEADROOM || '';
const UNDERUSE_MAX_STALE_MIN_RAW = process.env.CC_MASTER_UNDERUSE_MAX_STALE_MIN || '';

// 「明显临界」启发式阈值（ceiling 未知时的保守降级，避免刷屏）：仅当**两条同时成立**才出声 ——
//   (a) 5h 窗口剩余时间 ≤ HEUR_REMAIN_MIN（墙在不远处）；
//   (b) burn_rate ≥ HEUR_BURN_FLOOR（绝对高速燃烧）。
// 没有预算上限时，唯一**诚实可信**的临界信号就是「贴着墙（remain 低）还在高速烧（burn 高）」。
//   注意：曾用过「burn*remain ≥ used」的相对判据，但 burn=used/elapsed、remain≈300-elapsed，代入即
//   等价于 remain≥elapsed —— 与 remain≤60（要求 elapsed≥240）**永远矛盾**，那条在稳态下根本无法
//   触发（self-defeating）。故改用**绝对 burn 地板**：默认设得足够高，正常使用保持静默，只有真高速
//   贴墙才出声。地板可经 CC_MASTER_5H_BURN_FLOOR 覆写。
const HEUR_REMAIN_MIN = 60; // 剩余 ≤ 60 分钟才考虑出声
const HEUR_BURN_FLOOR_DEFAULT = 5000; // 默认绝对 burn 地板（tok/min）—— 保守、避免刷屏
const HEUR_MIN_TOKENS = 1; // burn_rate>0 的最小门（纯 0 直接静默）

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;

function parseIso(s) {
  // 容错 ISO-8601；非法 → null（调用方按缺失处理）。Z → +00:00 让 Date 正确取 UTC。
  if (typeof s !== 'string' || !s) return null;
  const t = Date.parse(s.replace('Z', '+00:00'));
  return Number.isNaN(t) ? null : t;
}

// 解析 usage JSONL，算当前 5h rolling block 的 used_tokens / burn_rate_per_min / window_remaining_min。
// 与 cc-usage.sh **逐行同源**：按 message.id 去重保留 MAX usage（被重写的 assistant 记录带更完整的
// 累计 usage，first-seen 会少报使 pacing 误以为配额还多）；--now 锚点丢弃未来行；5h 块在「>5h idle 间隙」
// 或「自块首消息已满 5h（连续使用跨界）」时切新块；只有仍 contains now 的块才是活动窗口，过期则干净归零。
function computeFiveHour(dir, nowMs) {
  const byId = new Map(); // mid -> { ts, tok }
  let files;
  try {
    files = walkJsonl(dir);
  } catch (_e) {
    return null; // 目录不可读 → 视为无数据
  }
  if (!files.length) return null;

  for (const f of files) {
    let content;
    try {
      content = fs.readFileSync(f, 'utf8');
    } catch (_e) {
      continue; // 单个文件读失败 → 跳过，不让整体崩
    }
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      let o;
      try {
        o = JSON.parse(line);
      } catch (_e) {
        continue; // 损坏行 → 跳过
      }
      if (!o || o.type !== 'assistant') continue;
      const msg = o.message || {};
      const u = msg.usage;
      const mid = msg.id;
      if (!u || !mid) continue;
      const tok =
        (u.input_tokens || 0) +
        (u.output_tokens || 0) +
        (u.cache_creation_input_tokens || 0) +
        (u.cache_read_input_tokens || 0);
      const ts = parseIso(o.timestamp);
      if (ts === null) continue;
      const prev = byId.get(mid);
      if (prev === undefined || tok > prev.tok) byId.set(mid, { ts, tok });
    }
  }

  // --now 锚点：丢弃晚于 now 的行（确定性/历史评估不计尚未发生的 usage）。
  const rows = [];
  for (const { ts, tok } of byId.values()) {
    if (ts <= nowMs) rows.push({ ts, tok });
  }
  if (!rows.length) return { used_tokens: 0, window_remaining_min: 0, burn_rate_per_min: 0 };
  rows.sort((a, b) => a.ts - b.ts);

  // 5h rolling block（ccusage 口径）。
  const blocks = [];
  let cur = [];
  for (const r of rows) {
    if (
      cur.length &&
      (r.ts - cur[cur.length - 1].ts > FIVE_HOURS_MS || r.ts - cur[0].ts >= FIVE_HOURS_MS)
    ) {
      blocks.push(cur);
      cur = [];
    }
    cur.push(r);
  }
  if (cur.length) blocks.push(cur);

  // 只有仍 contains now 的块是活动窗口；最近活动 >5h 前 → 窗口已刷新 → 干净归零（不报 stale，
  // 不报负的 window_remaining_min）。
  let fh = { used_tokens: 0, window_remaining_min: 0, burn_rate_per_min: 0 };
  if (blocks.length) {
    const b = blocks[blocks.length - 1];
    const start = b[0].ts;
    if (nowMs <= start + FIVE_HOURS_MS) {
      const used = b.reduce((s, r) => s + r.tok, 0);
      const elapsedMin = Math.max((nowMs - start) / 60000, 1);
      fh = {
        used_tokens: used,
        window_remaining_min: Math.round((start + FIVE_HOURS_MS - nowMs) / 60000),
        burn_rate_per_min: Math.round(used / elapsedMin),
      };
    }
  }
  return fh;
}

// 递归收集 dir 下所有 *.jsonl（等价 cc-usage.sh 的 glob('**/*.jsonl', recursive=True)）。
function walkJsonl(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (_e) {
      continue; // 子目录不可读 → 跳过
    }
    for (const ent of entries) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile() && ent.name.endsWith('.jsonl')) out.push(full);
    }
  }
  return out;
}

// 决定是否警告 + 文案。返回 string（要注入）或 null（静默）。
function decideWarning(fh) {
  if (!fh) return null;
  const { used_tokens: used, window_remaining_min: remain, burn_rate_per_min: burn } = fh;
  // 窗口已关闭 / 无燃烧 → 没有撞墙之忧 → 静默。
  if (remain <= 0 || burn < HEUR_MIN_TOKENS) return null;

  const budget = parseBudget(BUDGET_RAW);
  if (budget !== null) {
    // ── 有预算上限：预测撞墙 ── 按当前 burn 把剩余窗口跑满，是否在 reset 前越界。
    const projected = used + burn * remain;
    if (projected <= budget) return null; // 预测不越界 → 静默
    const pctNow = Math.round((used / budget) * 100);
    return formatWarning({ used, burn, remain, budget, projected: Math.round(projected), pctNow });
  }

  // ── 无预算上限（ceiling 未知，真实约束）：优雅降级到「明显临界」启发式 ──
  // 仅当 剩余时间已短（贴墙）**且** burn 绝对高（高速燃烧）时才出声，否则静默（避免刷屏）。
  if (remain > HEUR_REMAIN_MIN) return null;
  const burnFloor = parseFloorOr(BURN_FLOOR_RAW, HEUR_BURN_FLOOR_DEFAULT);
  if (burn < burnFloor) return null; // 速率没到地板 → 不算「明显临界」→ 静默
  return formatWarning({ used, burn, remain, budget: null, projected: null, pctNow: null });
}

// ── ACCOUNT-AUTHORITATIVE pacing (Finding #37) ──────────────────────────────────────────────────────
// 账户权威 5h/7d used_percentage(+resets_at)只在 status-line stdin 出现(官方核实:hook/JSONL/CLI 全无),由
// statusline-capture.js 落到 sidecar。撞墙判据优先用它——账户 % 是权威,不像本地反推 window_remaining_min
// 会失真到数量级(Finding #37);并第一次把 7d 纳入(此前 hook 只看 5h、对 7d 全盲,Finding #31)。
function readRateCache(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_e) {
    return null; // 缺/坏 sidecar → 账户口径不可用 → 调用方降级本地反推
  }
}
function pctOf(w) {
  return w && typeof w.used_percentage === 'number' ? w.used_percentage : null;
}
function parsePctFloor(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 85; // 默认 85%:账户某窗口用量到 85% 即临界
}
// 返回 {valid, warn}:valid=false ⟺ 账户口径不可用(缺/坏/空)→ 调用方 fallback 本地反推;
// valid=true 时 warn 是文案(到墙)或 null(账户有效但未到墙 → 权威静默,不再反推)。
function decideAccountWarning(acct, nowSec, floor) {
  if (!acct || typeof acct !== 'object') return { valid: false, warn: null };
  const p5 = pctOf(acct.five_hour);
  const p7 = pctOf(acct.seven_day);
  if (p5 === null && p7 === null) return { valid: false, warn: null }; // 空/无效 → fallback
  const f = acct.five_hour;
  // 5h 仅在窗口仍有效(resets_at 在未来,或无 resets_at)时参与判墙;已过 reset 的 stale 5h 不参与,
  // 但 7d 不依赖 5h 的 resets_at,仍权威。
  const fhValid = p5 !== null && (typeof f.resets_at !== 'number' || f.resets_at > nowSec);
  const hits = [];
  if (fhValid && p5 >= floor) hits.push(`5h ${p5}%`);
  if (p7 !== null && p7 >= floor) hits.push(`7d ${p7}%`);
  if (!hits.length) return { valid: true, warn: null }; // 账户有效但未到墙 → 权威静默
  const warn =
    `[cc-master pacing] 账户配额临界(权威口径,来自 status-line 捕获):` +
    hits.join(' / ') +
    ` 已达/超过 ${floor}% 阈值。pace 杠杆(怎么 pace 是你的认知判断,见 orchestrating-to-completion / ` +
    `cost-and-pacing):① 把后续节点降到更便宜的模型档;② 降并发 WIP、暂缓新派工;③ defer 高 float 的非临界` +
    `任务到窗口 reset 后。这是非阻断提示,不替你决策。`;
  return { valid: true, warn };
}

// ── ACCOUNT-AUTHORITATIVE UNDERUSE pacing（对偶于 decideAccountWarning 的「欠用→加速」侧）──────────────
// 撞墙侧问「快烧到墙了，要不要减速」；欠用侧对称地问「窗口快 reset 了却还没怎么用，要不要在它白白浪费前加速」。
// 三条判据 AND（缺一静默——保守，不无端催加速）：
//   ① underused：5h used% < UNDERUSE_PCT_CEIL（默认 60）—— 当前窗口确实欠用。
//   ② nearReset：5h.resets_at 有效（数字）且 (resets_at - nowSec)/60 ≤ UNDERUSE_REMAIN_MIN（默认 60）——
//      窗口快归零；resets_at 缺/已过 → 静默（窗口何时刷新未知/已刷新，催加速无意义）。
//   ③ sevenDayOK：7d used% < SEVEN_DAY_HEADROOM（默认 80）—— 总闸有余量才敢催加速。**7d 信号缺失
//      （null/缺）→ 静默**（用户拍板的保守取向：总闸状态未知就别开闸——不能在 7d 也许快满时催 5h 加速）。
//   ④ fresh：sidecar 的 captured_at 距今 ≤ UNDERUSE_MAX_STALE_MIN（默认 15min）。captured_at 缺/陈旧 → 静默。
//      **为何只欠用侧需要这道闸、撞墙侧不需要（不对称）**：sidecar 由 status-line 捕获，主线 idle 等后台时
//      status-line 不刷新 → captured_at 不更新，而后台 agent 仍在烧配额 → 账户真实 5h used% 已上涨，但 sidecar
//      里的 p5 仍停在旧的偏低值（stale-low p5）。在**欠用侧**，stale-low p5 让本函数误判「还很闲」→ 临 reset
//      误催加速 → 多烧（危险方向）；在**撞墙侧**（decideAccountWarning），stale-low p5 只会让 used%≥floor 的
//      判墙**少报一次警**（stale-low = 漏报减速 = 安全方向，最坏只是没及时刹车、不会主动多烧）。故新鲜度闸只在
//      催加速这个「越陈越危险」的方向上加，撞墙侧无此要求（红线4 精神：宁可少催加速，不可据陈值乱催）。
// 返回 {warn}（要注入的文案）或 {warn:null}（静默）。撞墙(used%≥85)与欠用(used%<60)区间天然互斥，
//   且本函数仅在 decideAccountWarning 判定「账户有效但未到墙」时才被主流程调用 → 同一 Stop 绝不双发。
function decideAccountUnderuse(acct, nowSec) {
  if (!acct || typeof acct !== 'object') return { warn: null };
  const f = acct.five_hour;
  const p5 = pctOf(f);
  const p7 = pctOf(acct.seven_day);
  // ① underused（5h used% < ceil）。5h 信号缺失 → 无从判欠用 → 静默。
  const ceil = parseUnderusePctCeil(UNDERUSE_PCT_CEIL_RAW);
  if (p5 === null || p5 >= ceil) return { warn: null };
  // ② nearReset（resets_at 有效且距 reset 剩余 ≤ remainMin）。resets_at 缺/非数/已过 → 静默。
  if (!f || typeof f.resets_at !== 'number' || f.resets_at <= nowSec) return { warn: null };
  const remainMin = (f.resets_at - nowSec) / 60;
  const remainCeil = parseUnderuseRemainMin(UNDERUSE_REMAIN_MIN_RAW);
  if (remainMin > remainCeil) return { warn: null };
  // ③ sevenDayOK（7d used% < headroom）。**7d 缺失 → 静默**（保守：总闸未知不开闸）。
  const headroom = parseSevenDayHeadroom(SEVEN_DAY_HEADROOM_RAW);
  if (p7 === null || p7 >= headroom) return { warn: null };
  // ④ fresh（sidecar 新鲜度闸，见函数头注释的不对称论证）。captured_at 缺失（非数字）或距今 >
  //    maxStaleMin → stale-low p5 不可信 → 静默，绝不据陈值催加速。
  const maxStaleMin = parseUnderuseMaxStale(UNDERUSE_MAX_STALE_MIN_RAW);
  if (typeof acct.captured_at !== 'number' || nowSec - acct.captured_at > maxStaleMin * 60) {
    return { warn: null };
  }
  const warn =
    `[cc-master pacing] 账户配额欠用(权威口径,来自 status-line 捕获):5h 仅用 ${p5}%、` +
    `窗口约 ${Math.round(remainMin)} min 后 reset(7d 总闸余量充足,仅 ${p7}%)。当前窗口的配额若不用` +
    `将随 reset 白白蒸发——可考虑加速以充分利用。加速杠杆(怎么加速是你的认知判断,见 ` +
    `orchestrating-to-completion / cost-and-pacing 的加速侧 lever):① 把临界路径节点升到更强的模型档以提质提速;` +
    `② 提并发 WIP、把已就绪的高 float 任务提前派发;③ 把原计划 defer 到下一窗口的就绪工作拉进本窗口。` +
    `注意:加速须先过 7d 总闸(别把 5h 余量烧成 7d 透支);且这不是制造 busywork——没有真正就绪的活就别硬凑。` +
    `这是非阻断提示,不替你决策。`;
  return { warn };
}

function parseBudget(raw) {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null; // 非正/非数 → 当未给（降级到启发式）
}

function parseFloorOr(raw, fallback) {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback; // 非正/非数 → 回退默认地板
}

// 欠用侧三个阈值的解析（与撞墙侧 parsePctFloor 同形态：非正/非数/缺 → 回退默认）。
function parseUnderusePctCeil(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 60; // 默认 60%:5h used% 低于此即欠用
}
function parseUnderuseRemainMin(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 60; // 默认 60min:距 5h reset ≤ 此即临近 reset
}
function parseSevenDayHeadroom(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 80; // 默认 80%:7d used% 低于此即总闸有余量
}
function parseUnderuseMaxStale(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 15; // 默认 15min:sidecar captured_at 距今超过此即陈旧 → 静默
}

function formatWarning({ used, burn, remain, budget, projected, pctNow }) {
  const head =
    budget !== null
      ? `[cc-master pacing] 5h 配额预测撞墙：当前已用 ${used} tok（占预算 ${budget} 的 ${pctNow}%），` +
        `burn ≈ ${burn} tok/min，窗口剩 ${remain} min；按此速率窗口结束前将达 ~${projected} tok，越过 ${budget} 上限。`
      : `[cc-master pacing] 5h 配额临界：当前已用 ${used} tok，burn ≈ ${burn} tok/min，窗口仅剩 ${remain} min ` +
        `且 burn 已过临界地板（未设 CC_MASTER_5H_BUDGET，按「贴墙 + 高速绝对 burn」判定为明显临界）。`;
  const levers =
    `pace 杠杆（怎么 pace 是你的认知判断，见 orchestrating-to-completion / cost-and-pacing）：` +
    `① 把后续节点降到更便宜的模型档（downgrade model）；② 降并发 WIP、暂缓新派工；` +
    `③ defer 高 float 的非临界路径任务到窗口 reset 后。这是非阻断提示，不替你决策。`;
  return `${head} ${levers}`;
}

// ── ARMED GATE（node 版 board_matches）─────────────────────────────────────────────────────────────
// isArmed(homeDir, sid) → 本 session 是否被武装：homeDir 里存在一个 *.board.json 满足
//   owner.active === true 且 (stdin sid 空 → 降级：任一 active 板；否则 owner.session_id === sid)。降级是
//   **非对称**的 —— 仅 stdin sid 空时触发（ADR-007 §2.3，owning session 跨 compaction 重锚）。board 的
//   owner.session_id 为空串（bootstrap 在缺 sid 的 stdin 上建板、或迁移/手改板的异常）时**保持休眠**：它对
//   任何非空 stdin sid 都不字面相等 → false → DORMANT（fail-safe）。对称收养空 board sid 曾试过（CODEX12）并
//   回退（CODEX14）：会武装任意不相关 session，重新引入红线 6 要防的跨会话污染。合法续跑因 resume/compaction
//   保留 session_id、板带原 session_id 故照常匹配；异常 blank 板由显式 re-arm 认领。board sid 非空且 ≠ stdin
//   sid 当然也不匹配（红线 6）。→ ADR-007。
// 只读 owner.active / owner.session_id 两个 narrow-waist pinned 字段（不读 tasks、不写 board）。
// 任何读/解析失败都按「该板不匹配」处理（try/catch 兜住），整体绝不抛 —— 失败 → 视为未武装 → 静默。
// 注意：用 JSON.parse 取结构化字段，不靠 grep/正则去 board 里捞 —— node hook 的既定做法（红线1 允许）。
function isArmed(homeDir, sid) {
  let entries;
  try {
    entries = fs.readdirSync(homeDir, { withFileTypes: true });
  } catch (_e) {
    return false; // home 不存在/不可读 → 没有任何板 → 未武装
  }
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.endsWith('.board.json')) continue;
    let board;
    try {
      board = JSON.parse(fs.readFileSync(path.join(homeDir, ent.name), 'utf8'));
    } catch (_e) {
      continue; // 坏板 → 跳过
    }
    const owner = (board && board.owner) || {};
    if (owner.active !== true) continue; // 必须 active
    if (!sid) return true; // 降级：stdin sid 空 → 任一 active 板即武装（compaction 边界鲁棒，ADR-007 §2.3）
    // board 未盖 session_id（""/null/undefined）→ 字面 !== 非空 sid → 不武装（休眠，fail-safe）。
    // 对称收养空 board sid 曾试过（CODEX12）并已回退（CODEX14）：它会武装任意不相关 session，重新引入红线 6
    // 要防的跨会话污染。合法续跑因 resume/compaction 保留 session_id、板带原 session_id 故照常精确匹配；异常
    // 的 blank 板由显式 re-arm（重跑 as-master-orchestrator → bootstrap 重盖 session_id）认领。→ ADR-007。
    if (owner.session_id === sid) return true; // session-scoped 精确匹配（board sid 必须非空且 == stdin sid）
  }
  return false;
}

// ── 主流程：全程 try/catch，任何异常 → 静默 exit 0 ──────────────────────────────────────────────
function main() {
  // 读 stdin，取 session_id —— armed gate 要用它做 session-scoped 判定。
  let stdin = '';
  try {
    stdin = fs.readFileSync(0, 'utf8');
  } catch (_e) {
    stdin = '';
  }
  let sid = '';
  let stopHookActive = false;
  try {
    const o = JSON.parse(stdin || '{}');
    if (o && typeof o.session_id === 'string') sid = o.session_id;
    // stop_hook_active:true ⟺ Claude Code 因「上一次 Stop hook 续了对话 → agent 再次尝试 Stop」而
    // **重入**本 hook。同一 stdin 口径解析，零新依赖（红线1：node/JS only）。
    if (o && o.stop_hook_active === true) stopHookActive = true;
  } catch (_e) {
    /* ignore — 非法 stdin 不致命；sid 留空 → 走降级 arming 判定 */
  }

  // ── STOP RE-ENTRY GUARD：stop_hook_active:true → 立即静默 exit 0（在任何 usage 计算/注入之前）。──
  // 不加这道闸，usage 仍超预算时本 hook 会在**每一次** Stop 重注同一 pacing 警告——effect 等同
  // 「session 永远停不下来」的循环（虽不 decision:block，但实质卡死），违背「never blocks」契约。
  // 有了它，警告对每个**真正的新 Stop**最多出现一次，re-entry 一律静默（不破坏 unarmed→silent）。
  if (stopHookActive) return;

  // ── ARMED GATE：本 session 未被武装（home 无匹配的 active 板）→ 在读 usage 之前就静默 exit 0。──
  // 这是本 hook 最关键的行为修复：不武装就不读宿主全局 usage、不注入 —— 不再污染无关 session。
  if (!isArmed(HOME_DIR, sid)) return;

  const nowMs = NOW_OVERRIDE ? parseIso(NOW_OVERRIDE) : Date.now();
  if (nowMs === null) return; // --now 非法 → 静默（不猜）

  // account-authoritative override (Finding #37): 优先用 status-line 捕获的账户权威 5h/7d used_percentage
  // 判墙(脱钩会失真到数量级的本地反推 window_remaining_min),并纳入 7d。账户口径权威——可用就以它为准(到墙
  // 警告/没到就静默),只有 sidecar 缺/坏时才降级本地反推(approx)。
  const floor = parsePctFloor(PCT_FLOOR_RAW);
  const acct = readRateCache(RATE_CACHE);
  const nowSec = Math.floor(nowMs / 1000);
  const a = decideAccountWarning(acct, nowSec, floor);
  let warning;
  if (a.valid) {
    // 账户口径权威。撞墙优先：到墙就只发减速提示（a.warn 非空）；没到墙再问欠用 → 可能发对称的加速提示。
    // 撞墙(used%≥85)与欠用(used%<60)区间天然互斥，account 分支里同一 Stop 绝不同发两条。
    if (a.warn) warning = a.warn;
    else warning = decideAccountUnderuse(acct, nowSec).warn;
  } else {
    // 账户不可用 → 本地反推 fallback(approx)：维持现状只做撞墙判定。**本地反推路径禁欠用提示**——反推的
    // reset 倒计时会失真到数量级（Finding #37），据此催加速会乱催，故此路径不出欠用提示。
    const fh = computeFiveHour(USAGE_DIR, nowMs);
    warning = decideWarning(fh);
  }
  if (!warning) return; // 余量充足 / 无数据 / 降级判定不临界 → 静默 exit 0

  // 非阻断注入：仅 additionalContext，hookEventName "Stop"。绝不 decision:block。
  const payload = {
    hookSpecificOutput: {
      hookEventName: 'Stop',
      additionalContext: warning,
    },
  };
  process.stdout.write(JSON.stringify(payload) + '\n');
}

try {
  main();
} catch (_e) {
  // 兜底：任何未预期异常都不得污染 Stop —— 静默成功退出。
}
process.exit(0);
