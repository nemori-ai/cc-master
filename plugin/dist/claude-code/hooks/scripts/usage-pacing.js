#!/usr/bin/env node
// usage-pacing.js — H8 (ADR-006 解锁的旗舰 node hook)。
//
// 事件：Stop + PostToolBatch。每当主线 agent 想交还控制权（Stop）或一个 tool-batch 落地（PostToolBatch·回合中途
//   采样）时触发，感知账户配额是否临近走廊边界，临界时注入一条 **非阻断** 的 pacing 提示
//   （hookSpecificOutput.additionalContext）。**绝不 decision:block** —— hook 只感知+提示，怎么 pace 是认知（属
//   SKILL A / pacing-and-estimation），不在 hook 里替主线做调度决策（红线4：指挥不演奏，引擎不替它思考）。
//
// ★ADR-024（单侧 verdict + ccm-only 消费）：走廊 verdict 计算**唯一收口进 ccm 引擎**（`usage/pacing` 是 SSOT）。
//   本 hook 武装后 shell 调 `ccm usage advise --json`（进程边界·spawnSync·与 board-lint.js 同模式），把它的
//   verdict 映射成本 skill 词汇的非阻断提示。**新 verdict enum（翻转后）**：`{hold, throttle, switch, stop_5h, stop_7d}`
//   —— 去掉了旧的 `accelerate`（双侧走廊欠用侧加速）与 `hard_stop`。映射：
//     hold    → 走廊内 → 静默。
//     throttle→ 5h 临界减速（降模型档 / 降 WIP / defer）。
//     switch  → 5h 临界 + n>1 + 7d 有余量 → **切到下一份配额**（LBHOOK 机械换号）。
//     stop_5h → 5h 触硬停且无可切备号 / 7d 亦吃紧 → **本窗口烧穿**，引导 agent arm watchdog 守到 `nearest_reset` 回血。
//     stop_7d → 7d 跨窗口不可逆硬总闸 → 暂停 dispatch + surface 用户。
//   消费 `data.strength`（ADR-018 标签强度·weak|strong·ccm 出、hook 直接用）；`stop_*` 带 `data.nearest_reset`
//   （引导 arm wakeup 等 reset）。**优雅降级（ADR-021 后 ccm 已硬前置·此路径退化为纯瞬态兜底）**：`ccm` 不在 PATH /
//   调用失败 / 非法 JSON / 形状不符 / `available:false`（sidecar 缺）→ `adviseViaCcm` 返回 null → **静默 exit 0**
//   （不注入·不再有本地反推 fallback——ADR-024 退役了 computeFiveHour / decideAccountWarning / decideAccountUnderuse
//   等 ~200 行本地计算；ccm 是走廊 verdict 的唯一来源）。
//
// LBHOOK（LOADBAL §3.2/3.3 + ADR-016）：pacing 决策已得出 `switch`（该切到下一份配额）时，本 hook **机械**调
//   `ccm account switch`（切号执行归 ccm·agent 不做切号决策·设计 §1）+ 切号后注入 `<ambient source="usage-pacing">`
//   让 agent 调配速/规模。能不能切 / 切哪个 / board.policy 硬闸（deny→exit7）都委托 ccm；hook token-blind
//   （换号在 ccm 子进程·不碰 token）。kill-switch CC_MASTER_AUTOSWITCH=0 关。
//
// 换号检测 ambient（ADR-024·task 1d）：每 Stop 读 `board.runtime.last_account_switch`（✎ 非窄腰·由 `ccm account
//   switch` 写侧落），若比 hook watermark 新 且非 hook 自己刚触发的自动切（如用户手动 `ccm account switch`）→ 注入
//   `<ambient source="usage-pacing">`「检测到换号(可能手动)·当前 active=X·配额随新号回血」。读 runtime 只为塑世界模型
//   （红线2：只读、不写窄腰·窄腰一字不动）。
//
// 红线1 / ADR-006：node/JS only。JSON.parse 读 sidecar / registry / board，spawn `ccm`（进程边界·非 import 引擎·
//   非 python3），零网络自身逻辑。所有异常 try/catch 兜住 → 任何失败都静默 exit 0（hook 崩会污染 Stop / 批解析）。
//
// ARMED GATE（红线6·dormant-until-armed）：所有 cc-master hook 在本 session「被武装」之前完全休眠。武装 + fail-silent
//   + exit 0 的 plumbing 由 hook-common.runHook harness 提供（arm:'boards'·未武装静默）。armed ⟺ home（CC_MASTER_HOME /
//   $HOME/.cc_master）的 boards/ 里存在 *.board.json，其 owner.active:true 且 owner.session_id == 本次 stdin 的
//   session_id（sid 空 → 降级匹配任一 active 板）。读 board 只为判 arming（active + session_id 两窄腰字段）+ 读
//   runtime.last_account_switch（✎·仅塑模型）—— 绝不写 board、绝不依赖 tasks（红线2 narrow waist 不动）。

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
// ★home 解析 + 标签包装器由共享 hook-common 提供（node SSOT）。ambient/advisory 是 ADR-018 标签包装器（§13·
//   closed set·source 必填·strength 只给 advisory）。runHook 是武装 + fail-silent harness。
const { resolveHome, ambient, advisory, runHook } = require('./hook-common.js');

// ── ADR-018 标签力度映射（§13/P4：力度配 stakes）──────────────────────────────────────────────────
// 优先消费 ccm 返回的 `data.strength`（ccm 出 verdict + strength·hook 直接用）；ccm 缺该字段时按 kind 兜底：
//   stop_7d 7d 硬总闸·暂停 dispatch + surface 用户：跨窗口不可逆消耗，stakes 最高 → strong
//   stop_5h 5h 本窗口烧穿·引导 arm wakeup 等 reset：本窗阻断·中高 → strong
//   throttle 5h 临界减速：临界侧、风险中高 → strong
//   switch   n>1 切到下一份配额：机会信号·可逆·低 stakes → weak
// PARITY: rule-usage-pacing-tag-protocol
const PACING_STRENGTH = { stop_7d: 'strong', stop_5h: 'strong', throttle: 'strong', switch: 'weak' };
function pacingStrengthOf(kind) {
  return PACING_STRENGTH[kind] || 'weak'; // 未知 kind → 最低够用（weak·P2）
}

// ── 环境覆写点 ─────────────────────────────────────────────────────────────────────────────────────
//   CC_MASTER_NOW        ISO-8601 覆写「现在」，让确定性测试可复现（本地路径已退役·此值只影响 sidecar 时间比对）。
//   CC_MASTER_RATE_CACHE 账户权威 5h/7d used_percentage sidecar（status-line 捕获·Finding #37）。中途采样预闸读它；
//                        ccm advise 也读同一份（透传给 ccm）。
//   CC_MASTER_PCT_FLOOR / CC_MASTER_SEVEN_DAY_DISPATCH_GATE  中途采样廉价预闸 bandOf 的阈值（默认 85 / 85）。
//   CC_MASTER_NUM_ACCOUNT  effective-N 测试注入兜底（否则从 registry 算）。
//   CCM_BIN               `ccm` 二进制覆写口（dev/test·绝对路径可执行）；缺则用 PATH 上的 `ccm`（生产）。
const HOME_DIR = resolveHome();
const ACCOUNTS_FILE =
  process.env.CC_MASTER_ACCOUNTS_FILE || path.join(HOME_DIR, 'accounts.json');
const NOW_OVERRIDE = process.env.CC_MASTER_NOW || '';
const RATE_CACHE =
  process.env.CC_MASTER_RATE_CACHE ||
  path.join(HOME_DIR, '.cc-master-rate-limits.json');
const PCT_FLOOR_RAW = process.env.CC_MASTER_PCT_FLOOR || '';
const SEVEN_DAY_DISPATCH_GATE_RAW = process.env.CC_MASTER_SEVEN_DAY_DISPATCH_GATE || '';
const NUM_ACCOUNT_RAW = process.env.CC_MASTER_NUM_ACCOUNT || '';
const CCM_BIN = process.env.CCM_BIN || 'ccm';

// ── LBHOOK（自主换号·LOADBAL §3.2/3.3 + ADR-016）──────────────────────────────────────────────────
// kind==='switch' 时机械调 `ccm account switch`（切号执行 / 选号 / policy 硬闸 deny→exit7 都委托 ccm·hook
//   token-blind·冷却防抖）。CC_MASTER_AUTOSWITCH='0' 关（退回纯 advisory·dogfood / 应急用）。
const AUTOSWITCH_ON = process.env.CC_MASTER_AUTOSWITCH !== '0';
const SWITCH_COOLDOWN_RAW = process.env.CC_MASTER_SWITCH_COOLDOWN_SEC || '';
const SWITCH_STATE_FILE =
  process.env.CC_MASTER_SWITCH_STATE || path.join(HOME_DIR, '.cc-master-switch.json');

// ── ③ PostToolBatch 中途采样（hooks-enhancements-v2 §1）─────────────────────────────────────────────
const PACING_SAMPLE_FILE =
  process.env.CC_MASTER_PACING_SAMPLE_STATE || path.join(HOME_DIR, '.cc-master-pacing-sample.json');
const PACING_SAMPLE_COOLDOWN_RAW = process.env.CC_MASTER_PACING_SAMPLE_COOLDOWN_SEC || '';
// ccm account switch 子进程超时（含 refresh 的网络 POST）：默认 30s。换号被 cooldown + kind:'switch' 双门控、罕见。
const SWITCH_TIMEOUT_MS = (() => {
  const n = Number(process.env.CC_MASTER_SWITCH_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 30000;
})();

function parseIso(s) {
  // 容错 ISO-8601；非法 → null（调用方按缺失处理）。Z → +00:00 让 Date 正确取 UTC。
  if (typeof s !== 'string' || !s) return null;
  const t = Date.parse(s.replace('Z', '+00:00'));
  return Number.isNaN(t) ? null : t;
}

// ── ACCOUNT-AUTHORITATIVE sidecar（Finding #37）：账户权威 5h/7d used_percentage（+resets_at）由 ccm 自带的
//   `ccm statusline` 落到 sidecar。本 hook 只在**中途采样廉价预闸**里读它（零 spawn 判 band，决定要不要 spawn ccm）；
//   真正的走廊 verdict 一律经 ccm advise（它也读这份 sidecar）。────────────────────────────────────────────
function readRateCache(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_e) {
    return null; // 缺/坏 sidecar → 账户口径不可用
  }
}
function pctOf(w) {
  return w && typeof w.used_percentage === 'number' ? w.used_percentage : null;
}
function parsePctFloor(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 85; // 默认 85%:账户某窗口用量到 85% 即临界
}
function parseSevenDayDispatchGate(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 85; // 7d≥此 → 硬总闸带
}

// ── 号池 registry（effective-N + 号池注入的来源·A2 T6）───────────────────────────────────────────────
// readRegistryAccounts(file) → 号池 accounts map（object）或 null（无文件 / 坏 JSON / 任何读失败）。纯只读、
//   JSON.parse、零 spawn。文件不存在（ENOENT）= null（天然单账号）。红线2：accounts.json 与 board 正交。
function readRegistryAccounts(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (_e) {
    return null;
  }
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (_e) {
    return null;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const accounts = obj.accounts;
  if (!accounts || typeof accounts !== 'object' || Array.isArray(accounts)) return null;
  return accounts;
}
// poolStatus(accounts, nowMs) → { backups, switchable, effectiveN }。语义见 A2 T6 §F：backups=非 active 号数；
//   switchable=可切入（switchable!==false 且 token 未过期）数；effectiveN=switchable+1。null/空池 → effectiveN=1。
function poolStatus(accounts, nowMs) {
  if (!accounts || typeof accounts !== 'object') {
    return { backups: 0, switchable: 0, effectiveN: 1 };
  }
  let backups = 0;
  let switchable = 0;
  for (const entry of Object.values(accounts)) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.active === true) continue;
    backups += 1;
    if (entry.switchable === false) continue;
    const exp = parseIso(entry.token_expires_at);
    if (exp !== null && exp < nowMs) continue;
    switchable += 1;
  }
  return { backups, switchable, effectiveN: switchable + 1 };
}
// activeAccountEmail(accounts) → 当前 active 号的 key（email）或 null。用于换号检测 ambient 报「当前 active=X」。
function activeAccountEmail(accounts) {
  if (!accounts || typeof accounts !== 'object') return null;
  for (const [email, entry] of Object.entries(accounts)) {
    if (entry && typeof entry === 'object' && entry.active === true) return email;
  }
  return null;
}
// readNumAccount(file, nowMs) → pacing 的有效 N（≥1）。env CC_MASTER_NUM_ACCOUNT 优先（测试注入）；否则从 registry
//   算 poolStatus().effectiveN。registry 不可用 → 1。绝不碰 board（红线2）。
function readNumAccount(file, nowMs) {
  const env = parseNumAccount(NUM_ACCOUNT_RAW);
  if (env !== null) return env;
  const accounts = readRegistryAccounts(file);
  return poolStatus(accounts, nowMs).effectiveN;
}
function parseNumAccount(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

// ── ccm usage advise 收口（ADR-024·走廊 verdict 的唯一 SSOT 路径）─────────────────────────────────────
// adviseViaCcm(homeDir, rateCache, effN) → advise data 对象 | null。spawnSync `ccm usage advise --json
//   [--effective-n N]`，透传 CC_MASTER_HOME / CC_MASTER_RATE_CACHE 让 ccm 读到与 hook 同一份 sidecar / registry。
//   形态：{ verdict, strength?, reason, levers[], nearest_reset?, stop_dimension?, window_5h_pct, window_7d_pct,
//   effective_n, switch_candidate, confidence, source, available }。任何失败（ENOENT / 信号 / 坏 JSON / 形状不符 /
//   available:false）→ null（静默·ADR-024 后无本地 fallback）。
function adviseViaCcm(homeDir, rateCache, effN) {
  const args = ['usage', 'advise', '--json', '--home', homeDir];
  if (Number.isInteger(effN) && effN >= 1) args.push('--effective-n', String(effN));
  const env = Object.assign({}, process.env, { CC_MASTER_HOME: homeDir });
  if (rateCache) env.CC_MASTER_RATE_CACHE = rateCache;
  let r;
  try {
    r = spawnSync(CCM_BIN, args, { encoding: 'utf8', timeout: 15000, env });
  } catch (_e) {
    return null;
  }
  if (!r || r.error || r.signal) return null; // ENOENT / 被信号杀 → 静默
  const stdout = typeof r.stdout === 'string' ? r.stdout : '';
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (_e) {
    return null;
  }
  const data = parsed && typeof parsed === 'object' ? parsed.data : null;
  if (!data || typeof data !== 'object' || typeof data.verdict !== 'string') return null;
  if (data.available !== true) return null; // sidecar 缺 → 无权威走廊判定 → 静默
  return data;
}

// ccmWarning(data, n) → 把 ccm advise verdict 映射成 { warn, kind, strength }（warn=文案·kind=词汇标签·strength=
//   ccm 出的 ADR-018 力度或 null），或 null（hold·静默）。新单侧 enum（ADR-024）：
//   stop_7d  → 「暂停 dispatch 新节点」+ blocked_on:"user" + surface 用户 + 硬总闸；
//   stop_5h  → 「本窗口烧穿」+ 引导 arm watchdog 守到 nearest_reset 回血；
//   throttle → 「降到更便宜的模型档」减速 levers；
//   switch   → 「切到下一份配额」（LBHOOK 机械换号）；
//   hold     → 静默。号池粗粒度事实由调用方在尾部统一附加（ambient）。
function ccmWarning(data, n) {
  const p5 = typeof data.window_5h_pct === 'number' ? data.window_5h_pct : null;
  const p7 = typeof data.window_7d_pct === 'number' ? data.window_7d_pct : null;
  const nAcct =
    Number.isInteger(data.effective_n) && data.effective_n >= 1
      ? data.effective_n
      : Number.isInteger(n) && n >= 1
        ? n
        : 1;
  const strength =
    data.strength === 'strong' || data.strength === 'weak' ? data.strength : null; // ccm 出·hook 直接用
  const nearest =
    typeof data.nearest_reset === 'string' && data.nearest_reset ? data.nearest_reset : null;
  const v = data.verdict;

  if (v === 'stop_7d') {
    const fhNote = p5 !== null && p5 >= 90 ? `(5h 也已 ${p5}%)` : '';
    return {
      warn:
        `[cc-master pacing] 7d 配额硬总闸(权威口径,来自 status-line 捕获):7d 已用 ${p7}%${fhNote}。` +
        `按 ADR-024,7d 是跨窗口不可逆消耗的硬边界——**本回合起暂停 dispatch 新节点**,把「是否继续消耗 7d 配额」` +
        `作为一个 blocked_on:"user" 决策 surface 给用户,等用户确认后再续派发。在飞任务可继续跑完、可端点验收,` +
        `但不要再派新活。这是非阻断提示,真正的暂停由你(orchestrator)在决策程序的 dispatch 节点执行,不替你决策。`,
      kind: 'stop_7d',
      strength,
    };
  }
  if (v === 'stop_5h') {
    const resetNote = nearest ? `窗口约在 ${nearest} reset。` : '';
    return {
      warn:
        `[cc-master pacing] 5h 配额触硬停(权威口径,来自 status-line 捕获):5h 已用 ${p5}%,且无可切入备号 / 7d 亦吃紧。` +
        `${resetNote}这份 5h 配额本窗口已烧穿——与其空转,建议 **arm 一个 watchdog 自我唤醒**` +
        `(background-shell until 轮询 floor·见 master-orchestrator-guide / authoring-workflows)守到 ` +
        `${nearest || '5h reset'} 后配额回血再续派发;在飞任务可跑完 / 端点验收,不要再派需要大量 5h 配额的新活。` +
        `这是非阻断提示,真正的暂停 / 唤醒由你(orchestrator)执行,不替你决策。`,
      kind: 'stop_5h',
      strength,
    };
  }
  if (v === 'throttle') {
    const slowdownLevers =
      `pace 杠杆(怎么 pace 是你的认知判断,见 master-orchestrator-guide / pacing-and-estimation):` +
      `① 把后续节点降到更便宜的模型档;② 降并发 WIP、暂缓新派工;③ defer 高 float 的非临界任务到窗口 reset 后。`;
    return {
      warn:
        `[cc-master pacing] 账户配额临界(权威口径,来自 status-line 捕获):5h ${p5}% ` +
        `已达/超过走廊上界。${slowdownLevers}这是非阻断提示,不替你决策。`,
      kind: 'throttle',
      strength,
    };
  }
  if (v === 'switch') {
    return {
      warn:
        `[cc-master pacing] 账户 5h 配额临界(权威口径,来自 status-line 捕获):5h ${p5}% 已达/超过阈值。` +
        `你声明了 ${nAcct} 份可序列消费的配额且 7d 总闸仍有余量(7d 仅 ${p7}%)——当前账号这份 ` +
        `5h 烧满是**切到下一份配额**的触发信号,不是减速信号:理想是把这份烧满后顺势用下一份满配额的 5h 窗,` +
        `而非在总配额还有余时减速空耗。配速/续派由你的认知判断;换号在配额墙由 hook 按 board.policy 自主机械执行+事后通知你(policy=deny 或 7d 硬总闸时作为用户决策 surface 给你拍),不由你逐次拍板。这是非阻断提示,不替你决策。`,
      kind: 'switch',
      strength,
    };
  }
  return null; // hold → 走廊内 → 静默
}

// ── LBHOOK helpers：换号冷却 sidecar + 机械调 ccm account switch（token-blind·失败必降级）──────────────────
// switchCooldownSec() → 冷却秒数。缺/空 → 默认 1800；显式 '0' → 0（关冷却）；非数/负 → 默认。必须先判空串
//   （Number('') === 0 footgun），否则 unset 会塌成 0 = 永不冷却。
function switchCooldownSec() {
  if (!SWITCH_COOLDOWN_RAW) return 1800;
  const n = Number(SWITCH_COOLDOWN_RAW);
  return Number.isFinite(n) && n >= 0 ? n : 1800;
}
// readSwitchState(file) → hook 自管 switch sidecar 对象（{ last_switch_at_ms, last_seen_account_switch_ms }）或 {}。
function readSwitchState(file) {
  try {
    const o = JSON.parse(fs.readFileSync(file, 'utf8'));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch (_e) {
    return {};
  }
}
// mergeSwitchState(file, patch) → 读-改-写合并（不 clobber 其它键·last_switch_at_ms 与 last_seen_account_switch_ms
//   互不覆盖）。fail-silent（写失败非致命·绝不 throw 污染 Stop）。
function mergeSwitchState(file, patch) {
  try {
    const cur = readSwitchState(file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(Object.assign(cur, patch))}\n`);
  } catch (_e) {
    /* fail-silent */
  }
}
// switchCooldownRemainingSec(file, nowMs, cooldownSec) → 距冷却结束的剩余秒（>0 = 仍在冷却·不再自动切）。
function switchCooldownRemainingSec(file, nowMs, cooldownSec) {
  const obj = readSwitchState(file);
  const at = typeof obj.last_switch_at_ms === 'number' ? obj.last_switch_at_ms : null;
  if (at === null) return 0;
  const remain = cooldownSec - (nowMs - at) / 1000;
  return remain > 0 ? remain : 0;
}
// parseSwitchJson(stdout) → ccm account switch 的 jsonOk data（{ email, switched, … }）或 null。逐行扫首个能
//   JSON.parse 的对象，解包 .data。非密（只取 email/switched）。
function parseSwitchJson(stdout) {
  if (typeof stdout !== 'string') return null;
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      const o = JSON.parse(t);
      if (o && typeof o === 'object') return o.data && typeof o.data === 'object' ? o.data : o;
    } catch (_e) {
      /* 非 JSON 行 → 跳过 */
    }
  }
  return null;
}
// attemptCcmSwitch(boardPath, homeDir, rateCache) → { outcome, email }。机械调 `ccm account switch --json`。
//   token-blind（换号在 ccm 子进程·hook 只读非密 JSON）。退出码 → outcome：0+switched → 'switched'；7 → 'denied'
//   （board.policy=deny 硬闸）；3 → 'exhausted'（全池逼顶）；ENOENT/spawn 抛/error → 'absent'；其余 → 'failed'。
function attemptCcmSwitch(boardPath, homeDir, rateCache) {
  const args = ['account', 'switch', '--json', '--home', homeDir, '--board', boardPath];
  const env = Object.assign({}, process.env, { CC_MASTER_HOME: homeDir });
  if (rateCache) env.CC_MASTER_RATE_CACHE = rateCache;
  let r;
  try {
    r = spawnSync(CCM_BIN, args, { encoding: 'utf8', timeout: SWITCH_TIMEOUT_MS, env });
  } catch (_e) {
    return { outcome: 'absent', email: null };
  }
  if (!r || r.error) return { outcome: 'absent', email: null };
  if (r.signal) return { outcome: 'failed', email: null };
  const code = typeof r.status === 'number' ? r.status : 1;
  const data = parseSwitchJson(r.stdout);
  const email = data && typeof data.email === 'string' ? data.email : null;
  const switched = !!(data && data.switched === true);
  if (code === 0 && switched) return { outcome: 'switched', email };
  if (code === 0) return { outcome: 'failed', email };
  if (code === 7) return { outcome: 'denied', email };
  if (code === 3) return { outcome: 'exhausted', email };
  return { outcome: 'failed', email };
}

// ── ADR-032 P3：dual-delivery routing（direct inject vs coordination.inbox）────────────────────────────
function isoUtcFromMs(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function validFutureIso(value, nowMs) {
  const t = parseIso(value);
  return t !== null && t > nowMs;
}

function expiresFor(data, nowMs) {
  const nearest = data && typeof data.nearest_reset === 'string' ? data.nearest_reset : '';
  if (validFutureIso(nearest, nowMs)) return nearest;
  return isoUtcFromMs(nowMs + 60 * 60 * 1000);
}

function durableKindFor(kind, strength, switchNote) {
  if (kind === 'stop_5h' || kind === 'stop_7d') return 'pacing_stop';
  if (kind === 'throttle' && strength === 'strong') return 'pacing_throttle';
  if (kind === 'switch' && switchNote) return 'pacing_switch';
  return null;
}

function spawnCoordinationNotify(ctx, spec) {
  if (!ctx.boards || ctx.boards.length !== 1) return false;
  const boardPath = ctx.boards[0].path;
  const payload = JSON.stringify(spec.payload || {});
  let result;
  try {
    result = spawnSync(CCM_BIN, [
      'coordination',
      'notify',
      '--kind',
      spec.kind,
      '--summary',
      spec.summary,
      '--strength',
      spec.strength,
      '--payload',
      payload,
      '--expires',
      spec.expires,
      '--json',
      '--home',
      ctx.homeDir,
      '--board',
      boardPath,
    ], {
      encoding: 'utf8',
      timeout: 10000,
      env: Object.assign({}, process.env, { CC_MASTER_HOME: ctx.homeDir }),
    });
  } catch (_e) {
    return false;
  }
  return !!result && !result.error && !result.signal && result.status === 0;
}

function deliverDurablePacing(ctx, data, kind, strength, summary, switchNote, nowMs) {
  const durableKind = durableKindFor(kind, strength, switchNote);
  if (!durableKind) return false;
  // PARITY: rule-usage-pacing-dual-delivery
  return spawnCoordinationNotify(ctx, {
    kind: durableKind,
    summary,
    strength,
    expires: expiresFor(data, nowMs),
    payload: {
      producer: 'usage-pacing',
      p3_mode: 'single-board usage advise; P4 replaces this producer with pool-aware arbitrate',
      verdict: data && typeof data.verdict === 'string' ? data.verdict : kind,
      route: 'coordination-inbox',
      switch_note: switchNote || '',
      advice: data || {},
    },
  });
}

// ── 换号检测 ambient（ADR-024·task 1d）───────────────────────────────────────────────────────────────
// detectAccountSwitchAmbient(ctx, nowMs, accounts) → ambient 文案（要注入）或 null（无换号 / 已 surface / 是 hook
//   自己刚切）。读 board.runtime.last_account_switch（✎·由 ccm account switch 写侧落·hook 只读塑模型·红线2 不写窄腰），
//   与 switch sidecar watermark 比对：比 last_seen 新且非 hook 自己刚触发的自动切（如用户手动 ccm account switch）
//   → 报「检测到换号(可能手动)」。多板歧义（ctx.boards≠1）→ 不报（板上下文不明·保守）。
function detectAccountSwitchAmbient(ctx, nowMs, accounts) {
  try {
    if (!ctx.boards || ctx.boards.length !== 1) return null;
    const board = ctx.boards[0].board;
    const rt = board && typeof board.runtime === 'object' ? board.runtime : null;
    const tsRaw = rt && typeof rt.last_account_switch === 'string' ? rt.last_account_switch : null;
    if (!tsRaw) return null;
    const tsBoard = parseIso(tsRaw);
    if (tsBoard === null) return null;
    const st = readSwitchState(SWITCH_STATE_FILE);
    const seen =
      typeof st.last_seen_account_switch_ms === 'number' ? st.last_seen_account_switch_ms : 0;
    const ownSwitchMs = typeof st.last_switch_at_ms === 'number' ? st.last_switch_at_ms : 0;
    if (tsBoard <= seen) return null; // 已 surface 过 → 不重复
    // 推进 watermark（无论报不报·避免下轮重复）。
    mergeSwitchState(SWITCH_STATE_FILE, { last_seen_account_switch_ms: tsBoard });
    // hook 自己刚触发的自动切（board ts 与 hook own switch 落在 60s 内）→ switchAmbient 已覆盖·不重复报。
    const SELF_TOL_MS = 60000;
    if (ownSwitchMs > 0 && Math.abs(tsBoard - ownSwitchMs) <= SELF_TOL_MS) return null;
    const activeEmail = activeAccountEmail(accounts);
    return (
      `[号池·检测到换号] board.runtime 显示发生过一次账户切换(可能是手动 ccm account switch,非本 hook 自动切)——` +
      `当前 active = ${activeEmail || '未知'}。切号刷新了 5h 配额窗(投影配额随新号回血);据此重新校准你的配速 / ` +
      `派发规模(见 master-orchestrator-guide / pacing-and-estimation)。这是事实告知,不替你决策。`
    );
  } catch (_e) {
    return null;
  }
}

// ── ③ PostToolBatch 中途采样 helpers（band / 节流 sidecar / 轻路径 body）────────────────────────────────
// 中途采样比 Stop 高频。裸采样 = 通知风暴。必须节流：注入 ⟺（A 跨阈值升档）OR（B 距上次中途注入满冷却且仍临界）。
//   先做廉价本地预闸（readRateCache 算 band·零 spawn），只在该注入时才 spawn `ccm usage advise`。**中途只报临界侧
//   （throttle/stop_5h/stop_7d）**（switch/underuse 不报——欠用是慢信号已退役·switch 换号留 Stop-only）。ccm 不可用
//   → 中途静默（ADR-024 后无本地 fallback）。
function pacingSampleCooldownSec() {
  if (!PACING_SAMPLE_COOLDOWN_RAW) return 900; // unset → 默认 15min
  const n = Number(PACING_SAMPLE_COOLDOWN_RAW);
  return Number.isFinite(n) && n >= 0 ? n : 900;
}
// bandOf(acct, nowSec, floor, gate) → 'normal' | 'throttle' | 'stop_7d' | null。从账户权威 sidecar 算「带」（廉价
//   本地预闸·零 spawn·只判要不要 spawn ccm）。p7≥gate → stop_7d（7d 硬总闸·最高）；p5≥floor（窗口仍有效）→
//   throttle；否则 normal。账户口径不可用（缺/坏/空）→ null（中途宁可漏报不刷屏）。真正的 verdict 仍来自 ccm。
function bandOf(acct, nowSec, floor, gate) {
  if (!acct || typeof acct !== 'object') return null;
  const p5 = pctOf(acct.five_hour);
  const p7 = pctOf(acct.seven_day);
  if (p5 === null && p7 === null) return null;
  const f = acct.five_hour;
  const fhValid = p5 !== null && (typeof f.resets_at !== 'number' || f.resets_at > nowSec);
  if (p7 !== null && p7 >= gate) return 'stop_7d'; // 7d 硬总闸（跨窗口·最高带）
  if (fhValid && p5 >= floor) return 'throttle'; // 5h 临界（窗口仍有效）
  return 'normal';
}
// bandRank(b) → 数值序（normal<throttle<stop_7d）供「严格升档」比较。未知 → -1。
function bandRank(b) {
  return b === 'stop_7d' ? 2 : b === 'throttle' ? 1 : b === 'normal' ? 0 : -1;
}
function readSampleState(file) {
  try {
    const o = JSON.parse(fs.readFileSync(file, 'utf8'));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch (_e) {
    return {};
  }
}
function writeSampleState(file, state) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(state)}\n`);
  } catch (_e) {
    /* fail-silent */
  }
}

// sampleBody(ctx) → PostToolBatch 中途采样轻路径。返回 { additionalContext } 或 falsy（静默）。
function sampleBody(ctx) {
  const nowMs = NOW_OVERRIDE ? parseIso(NOW_OVERRIDE) : Date.now();
  if (nowMs === null) return; // --now 非法 → 静默
  const nowSec = Math.floor(nowMs / 1000);

  // ── 廉价本地预闸：readRateCache 读账户权威 sidecar（零 spawn）→ 算 band ──────────────────────────────
  const acct = readRateCache(RATE_CACHE);
  const floor = parsePctFloor(PCT_FLOOR_RAW);
  const gate = parseSevenDayDispatchGate(SEVEN_DAY_DISPATCH_GATE_RAW);
  const band = bandOf(acct, nowSec, floor, gate);
  if (band === null) return; // 账户信号不可用 → 中途静默

  // ── 窗口重置：5h resets_at 翻新（新窗口）→ 清 last_band / 冷却记忆（否则跨窗口残留压制升档）─────────────
  const state = readSampleState(PACING_SAMPLE_FILE);
  const f = acct.five_hour;
  const curResetsAt = f && typeof f.resets_at === 'number' ? f.resets_at : null;
  let lastBand = typeof state.last_band === 'string' ? state.last_band : 'normal';
  let lastInjectAt = typeof state.last_inject_at === 'number' ? state.last_inject_at : 0;
  const prevResetsAt = typeof state.window_resets_at === 'number' ? state.window_resets_at : null;
  if (curResetsAt !== null && prevResetsAt !== null && curResetsAt !== prevResetsAt) {
    lastBand = 'normal';
    lastInjectAt = 0;
  }

  // ── 节流判据：注入 ⟺（A 跨阈值升档）OR（B 距上次中途注入满冷却且仍在临界带以上）── 中途只报临界侧 ─────────
  const isCritical = band === 'throttle' || band === 'stop_7d';
  const escalated = bandRank(band) > bandRank(lastBand);
  const cooldownSec = pacingSampleCooldownSec();
  const cooledDown = nowSec - lastInjectAt >= cooldownSec;
  const shouldInject = isCritical && (escalated || cooledDown);

  if (!shouldInject) {
    writeSampleState(PACING_SAMPLE_FILE, {
      last_inject_at: lastInjectAt,
      last_band: band,
      window_resets_at: curResetsAt,
    });
    return;
  }

  // ── 该注入了：才 spawn `ccm usage advise` 取权威 verdict 文案（ccm spawn 被绑定到实际注入·罕见）──────────
  const numAccount = readNumAccount(ACCOUNTS_FILE, nowMs) || 1;
  let warning = null;
  let kind = band;
  let strength = null;
  const ccmAdvice = adviseViaCcm(HOME_DIR, RATE_CACHE, numAccount);
  if (ccmAdvice) {
    const r = ccmWarning(ccmAdvice, numAccount);
    // 中途只报临界侧：ccm 的 switch（换号·留 Stop-only）→ 中途丢弃。
    if (r && (r.kind === 'throttle' || r.kind === 'stop_5h' || r.kind === 'stop_7d')) {
      warning = r.warn;
      kind = r.kind;
      strength = r.strength;
    }
  }
  if (!warning) {
    // ccm 不可用 / 给的是非临界 verdict → 中途静默（ADR-024 后无本地 fallback）·刷记忆后退出。
    writeSampleState(PACING_SAMPLE_FILE, {
      last_inject_at: lastInjectAt,
      last_band: band,
      window_resets_at: curResetsAt,
    });
    return;
  }

  writeSampleState(PACING_SAMPLE_FILE, {
    last_inject_at: nowSec,
    last_band: band,
    window_resets_at: curResetsAt,
  });
  const midPrefix =
    '[回合中途采样] 以下是回合中途的提前预警（非轮末 Stop）——便于你在本回合后续派发前就调整配速；' +
    '非阻断提示，不替你决策。';
  const s = strength || pacingStrengthOf(kind);
  // PostToolBatch has no same-event coordination-inbox reader, so keep the direct early warning while
  // also writing decision-grade items into the durable inbox for later ack tracking.
  deliverDurablePacing(ctx, ccmAdvice, kind, s, `${midPrefix} ${warning}`, '', nowMs);
  return {
    additionalContext: advisory('usage-pacing', s, `${midPrefix} ${warning}`),
  };
}

// ── body：plumbing（stdin/home/isArmed 武装/fail-silent/exit 0）由 hook-common.runHook 提供（phase-1b）。
//   dispatchBody 据 hook_event_name 分流——Stop → stopBody（完整路径·含 LBHOOK 换号 + 换号检测 ambient + 号池 ambient）；
//   PostToolBatch → sampleBody（中途采样轻路径·只报临界侧·不换号·节流）。
function stopBody(ctx) {
  const nowMs = NOW_OVERRIDE ? parseIso(NOW_OVERRIDE) : Date.now();
  if (nowMs === null) return; // --now 非法 → 静默

  // 号池现状（正交于 board 的只读·红线2·纯 JSON.parse 零 spawn·armed gate 之后·红线1/6）。
  const accounts = readRegistryAccounts(ACCOUNTS_FILE);
  const pool = poolStatus(accounts, nowMs);
  const numAccount = readNumAccount(ACCOUNTS_FILE, nowMs) || 1;

  // ── ADR-024 收口：走廊 verdict 只经 ccm 引擎（pacing SSOT）。ccm 不可用 → adviseViaCcm null → 无 pacing warning。
  let warning; // pacing warning 主体文案（字符串）或空（静默）
  let kind; // 词汇标签（stop_7d|stop_5h|throttle|switch）
  let verdictStrength; // ccm 出的 ADR-018 力度（或 null）
  const ccmAdvice = adviseViaCcm(HOME_DIR, RATE_CACHE, numAccount);
  if (ccmAdvice) {
    const r = ccmWarning(ccmAdvice, numAccount); // hold → null（静默）；其余 → { warn, kind, strength }
    if (r) {
      warning = r.warn;
      kind = r.kind;
      verdictStrength = r.strength;
    }
  }

  // 换号检测 ambient（task 1d）：读 board.runtime.last_account_switch，非 hook 自己刚切且未 surface → 报。
  const switchDetectAmbient = detectAccountSwitchAmbient(ctx, nowMs, accounts);

  if (!warning && !switchDetectAmbient) return; // 无 pacing warning 且无换号检测 → 静默 exit 0

  // ── LBHOOK：kind==='switch'（5h 配额临界 + n>1 + 7d 有余量 + 有可切入备号）→ 机械调 ccm account switch ──────
  let switchAmbient = null; // 成功换号后的 ambient 文案（替代 advisory 主体）
  let switchNote = ''; // deny/exhausted 时附到 advisory 尾部的说明（surface 给用户）
  let switchStrength = null; // deny → 升 strong（surface 用户）；否则沿用 kind 的 strength
  if (
    warning &&
    AUTOSWITCH_ON &&
    kind === 'switch' &&
    pool.switchable >= 1 &&
    ctx.boards &&
    ctx.boards.length === 1
  ) {
    const boardPath = ctx.boards[0].path;
    const cdRemain = switchCooldownRemainingSec(SWITCH_STATE_FILE, nowMs, switchCooldownSec());
    if (cdRemain <= 0) {
      const res = attemptCcmSwitch(boardPath, HOME_DIR, RATE_CACHE);
      if (res.outcome === 'switched') {
        mergeSwitchState(SWITCH_STATE_FILE, { last_switch_at_ms: nowMs }); // 落冷却·防下一 Stop 抖动
        const after = poolStatus(readRegistryAccounts(ACCOUNTS_FILE), nowMs); // 切号后号池现状
        switchAmbient =
          `[号池·已自动换号] usage-pacing 在 5h 配额临界(权威口径)机械切到下一份配额` +
          `${res.email ? `(当前 active = ${res.email})` : ''}——配额随新号满血 5h 窗恢复;号池现剩 ` +
          `${after.switchable} 个可切入备号。据此调你的配速 / 派发规模(怎么调是你的认知判断,见 ` +
          `master-orchestrator-guide / pacing-and-estimation);切号本身已机械完成(token-blind·在 ccm 子进程),不需你再操作。`;
      } else if (res.outcome === 'denied') {
        switchNote =
          ` 注:本板 policy.autonomous_account_switch=deny,机制层(ccm)已拒绝自主换号(exit 7)——把「是否换号」作 ` +
          `blocked_on:"user" surface 给用户;经用户 'ccm policy set --autonomous-account-switch=allow --user-authorized' ` +
          `授权后才会自主切(绝不自授权·ADR-016 §2.5)。`;
        switchStrength = 'strong';
      } else if (res.outcome === 'exhausted') {
        switchNote =
          ` 注:号池所有可切入备号都已逼顶 / 不可用(ccm exit 3·NONE_ALL_EXHAUSTED)——无可切入号,把「等 reset 还是别的」` +
          `作 blocked_on:"user" surface 给用户。`;
      }
      // failed / absent → 无 note·落回既有 advisory（优雅降级）。
    }
  }

  // ── ADR-018 标签包装 ─────────────────────────────────────────────────────────────────────────────
  const blocks = [];
  if (warning) {
    if (switchAmbient) {
      // 成功机械换号 → pacing 主体降为一块 ambient（切号已完成·只更新世界模型 + 调配速·无 action）。
      blocks.push(ambient('usage-pacing', switchAmbient));
    } else {
      const strength = switchStrength || verdictStrength || pacingStrengthOf(kind);
      const delivered = deliverDurablePacing(
        ctx,
        ccmAdvice,
        kind,
        strength,
        warning + switchNote,
        switchNote,
        nowMs,
      );
      if (!delivered) {
        blocks.push(advisory('usage-pacing', strength, warning + switchNote));
      }
      // 号池粗粒度事实注入（A2 T6 §F）→ ambient（池/配额事实·塑模型·无 action）。当 durable pacing 已写入
      // inbox 时不再重复直喷同一配速事件；仅在 direct fallback 时附带原有池事实。
      if (!delivered && pool.switchable >= 1) {
        const poolFact =
          `[号池] 你有 ${pool.backups} 个备号(其中 ${pool.switchable} 个 token 未过期、可切入)——` +
          `配额逼顶时还有「换号」这层容量:切到一份恢复更多的配额。换号机制由 ccm account switch 机械执行` +
          `(选号 + 切换 + policy 硬闸都在 ccm·token-blind)。分工:配速(档/WIP/defer)由你的认知判断;` +
          `换号在配额墙(5h 临界)时由 hook 按 board.policy 自主机械执行+事后通知你(policy=deny 或 7d 硬总闸时作为用户决策 surface 给你拍),不由你逐次拍板。这是事实告知,不替你决策。`;
        blocks.push(ambient('usage-pacing', poolFact));
      }
    }
  }
  // 换号检测 ambient（无论有没有 pacing warning 都可能要报·独立成块）。
  if (switchDetectAmbient) blocks.push(ambient('usage-pacing', switchDetectAmbient));

  if (blocks.length === 0) return; // 防御：全空 → 静默
  // 非阻断注入：仅 additionalContext，hookEventName "Stop"。绝不 decision:block。
  return { additionalContext: blocks.join('\n') };
}

// ── dispatchBody：据 hook_event_name 分流 Stop（完整路径）/ PostToolBatch（中途采样轻路径）──────────────
function dispatchBody(ctx) {
  const ev = ctx.obj && typeof ctx.obj.hook_event_name === 'string' ? ctx.obj.hook_event_name : '';
  if (ev === 'PostToolBatch') return sampleBody(ctx);
  return stopBody(ctx); // Stop（或缺事件名·向后兼容）
}

// runHook（多事件·hooks-enhancements-v2 ③）：本文件同时登记到 hooks.json 的 Stop + PostToolBatch 两个数组。
//   · event 为函数 → envelope 的 hookEventName 与实际触发事件一致（Stop / PostToolBatch）。
//   · arm:'boards'（armed gate 统一在 harness·未武装静默·红线6）——额外把匹配 active 板放进 ctx.boards 供
//     Stop 路径 LBHOOK 透传 --board + 换号检测读 runtime。
//   · preGate（武装之前的早退）：① Stop 重入闸（stop_hook_active:true → 静默·防 Stop loop）；② PostToolBatch
//     sub-agent 闸（红线4·stdin 带顶层 agent_id → 静默·指挥专属 pacing 不泄漏给 leaf）。
//   全程 try/catch + exit 0 由 harness 保证（hook 崩绝不污染 Stop / 批解析）。
runHook({
  event: (ctx) =>
    ctx.obj && ctx.obj.hook_event_name === 'PostToolBatch' ? 'PostToolBatch' : 'Stop',
  arm: 'boards',
  preGate(ctx) {
    const o = ctx.obj || {};
    if (o.stop_hook_active === true) return true; // ① Stop 重入闸
    if (typeof o.agent_id === 'string' && o.agent_id) return true; // ② PostToolBatch sub-agent 闸
    return false;
  },
  body: dispatchBody,
});
