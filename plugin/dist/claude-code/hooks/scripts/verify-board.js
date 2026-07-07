#!/usr/bin/env node
'use strict';
// verify-board.js — Stop hook，goal-hook 本体·v2 node 收编（ADR-013 §2.4）。cc-master 最关键的安全 hook。
//
// 职责：读 Stop 事件 stdin JSON，筛出**本 session 的 active 板**（owner.active:true 且 owner.session_id==sid），
//   判断要不要放 agent 停。Stop hook 不能软推——只能 block（decision:block）或 allow（exit 0）。故它依
//   board 的 status 枚举分布（绝不读对话 / 不重建 deps 图）来 gate，并对每个**不同的完成态**强制一次 self-check
//   握手才放行。握手态与防死锁保险丝活在本 hook 自有的 sidecar 文件里——board 仍是 agent 的单一真相源、此处永不写 board。
//
// ★v2 收编：取代 v1 verify-board.sh 里 owner_region / tasks_region / pending_user_decisions / rollup_violations
//   / wakeup_* 一长串脆弱 awk 深度扫描——node 的 JSON.parse 直接、正确地读 owner 子对象、遍历 top-level
//   tasks[] 数 status（归档板嵌套 active:true、task-local log[] 里的 status 天然不再冒充顶层 task；CODEX7 /
//   Case J/Q/R/V/W/X5 类盲区由数据模型解析根除）。武装闸复用 hook-common。
//
// ★v2 字段映射：watchdog 记录从 v1 board 根 `wakeup` 改名为 `board.watchdog`（armed_at/fire_at/mechanism/
//   job_id/checklist）。为兼容旧板，watchdog 缺失时降级 fallback 读 `wakeup`。hook schema-agnostic：不校验
//   schema 字符串，v2 新字段一律 silent-on-unknown。
//
// 决策表（对本 session 的 active 板）：
//   无匹配 active 板          → allow（dormant）
//   空（0 task）              → block（DAG 从未填充）
//   有 ready / uncertain      → block（有可推进的活 / 产出待验）+ 重置握手
//   else（全 in_flight/blocked/done/failed/escalated/stale）→ fingerprint-keyed self-check 握手
// 握手键：status 多重集的指纹。若当前完成态已握手过（fp 不变）→ allow（别再问）；只有**变了的**完成态才
//   重新强制 self-check。这阻止同一 board 态在漫长后台等待里被反复 self-check。
// 保险丝：每次 block bump block_streak；>= FUSE 强制 allow；每次 allow 清 sidecar。
//
// ★ADR-014 解耦（T4-3b 完成态）：rollup 检测（owner done 而子未 done）**经进程边界 shell 调全局 `ccm` 二进制**
//   （`ccm board lint --board <path> --json` → 取 `violations[].rule==='GRAPH-ROLLUP'` 定位违规 owner），
//   再据其 owner 集从已解析 board 重建「owner X is done but child Y is C」每条 part（保持 handshake 措辞同今）。
//   GRAPH-ROLLUP 是 warn（exit 0），故据 `violations` 数组判定、绝不靠退出码（1a 契约）。
//   · 调用约定：`CCM_BIN`（绝对路径可执行）是 dev/test/自定义安装覆写口；生产 `ccm` 在 PATH。
//   · 优雅降级：ccm 不可用（ENOENT / 非有效 JSON / 形状不符）→ **跳过 rollup part 不 crash**，其余 Stop gate
//     逻辑（self-check 握手 / pending-user / watchdog）照走。**ccm 是 rollup 检测的唯一路径**——3b 已删整个
//     cli/，不再有 require board-model fallback：ccm 失败即省略这一条软提示（rollup 是 SOFT 提醒非硬 block）。
//   注：verify-board 处理的是**可解析**板（listMatchingBoards 已跳过坏板），故不需 --raw。
//
// 红线1/ADR-006：node/JS only，纯 stdlib（fs/path/child_process），spawn `ccm` 二进制 + JSON 是 ADR-014 许可的
//   进程边界访问（非 import 引擎、非调 jq/python/awk），零网络、零 npm 依赖。
// 红线6：dormant-until-armed——未武装一律静默（空 stdout、RC 0、不 block），绝不在未武装路径上 block Stop。
//   rollup 循环仍只在武装闸内（listMatchingBoards 已筛本 session 匹配板），spawn ccm 只发生在已武装路径。
// 红线2：只读 narrow-waist（owner.active/session_id 判武装 + tasks[].status/parent 数完成态 + watchdog 软读），不写 board。
// 兜底：全程 try/catch，异常静默放行 exit 0——hook 崩绝不把 agent 永久卡在 Stop。

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { listMatchingBoards, directive, advisory, runHook } = require('./hook-common.js');

// CCM_BIN：dev/test/自定义安装的覆写口（绝对路径可执行）；缺则用 PATH 上的 `ccm`（生产）。
const CCM_BIN = process.env.CCM_BIN || 'ccm';

// rollupOwnersViaCcm(boardPath) → Set<ownerId> | null。
//   spawnSync ccm board lint --board <path> --json → parse stdout JSON → 取 GRAPH-ROLLUP violations 的 task（=owner id）。
//   GRAPH-ROLLUP 是 warn（exit 0），不据退出码判——只扫 violations[].rule（1a 契约）。spawn 失败 / 非有效
//   JSON / 形状不符 → null（让调用方走 fallback 的内联 rollup 循环）。空违规 → 空 Set（一致 / 无 rollup 问题）。
// PARITY: rule-verify-board-rollup-check
function rollupOwnersViaCcm(boardPath) {
  let r;
  try {
    r = spawnSync(CCM_BIN, ['board', 'lint', '--board', boardPath, '--json'], {
      encoding: 'utf8',
      timeout: 15000,
    });
  } catch (_e) {
    return null;
  }
  if (!r || r.error || r.signal) return null;            // ENOENT / 被信号杀 → fallback
  const stdout = typeof r.stdout === 'string' ? r.stdout : '';
  let parsed;
  try { parsed = JSON.parse(stdout); } catch (_e) { return null; } // 非有效 JSON → fallback
  const data = parsed && typeof parsed === 'object' ? parsed.data : null;
  if (!data || typeof data !== 'object' || !Array.isArray(data.violations)) return null; // 形状不符 → fallback
  const owners = new Set();
  for (const v of data.violations) {
    if (v && v.rule === 'GRAPH-ROLLUP' && typeof v.task === 'string' && v.task !== '') owners.add(v.task);
  }
  return owners;
}

// PARITY: rule-verify-board-fuse
const FUSE = 5;
// ISO-8601-UTC 严格定宽（与 board-model.js 同口径）。定宽 + Z 后缀的串按字典序即时间序。
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

// ── POSIX cksum CRC-32（与 v1 bash `cksum` 字节级等价）─────────────────────────────────────────────
// v1 status_fingerprint 用 `cksum`（POSIX CRC：多项式 0x04C11DB7，MSB-first，末尾追加长度），与 node
// zlib.crc32（IEEE 802.3）不同。测试套用 bash `cksum` 算期望指纹再 seed 进 sidecar，故 node 必须复现同一
// 算法字节级等价，否则 seeded-fp 永远对不上 → 握手 dedup 全失效。下面是 POSIX cksum 的纯 stdlib 实现。
const CKSUM_TAB = (function () {
  const t = new Uint32Array(256);
  const POLY = 0x04C11DB7;
  for (let n = 0; n < 256; n++) {
    let c = (n << 24) >>> 0;
    for (let k = 0; k < 8; k++) {
      c = (c & 0x80000000) ? (((c << 1) ^ POLY) >>> 0) : ((c << 1) >>> 0);
    }
    t[n] = c >>> 0;
  }
  return t;
})();
function posixCksum(str) {
  const buf = Buffer.from(String(str), 'utf8');
  let crc = 0;
  for (let i = 0; i < buf.length; i++) {
    crc = (((crc << 8) >>> 0) ^ CKSUM_TAB[((crc >>> 24) ^ buf[i]) & 0xff]) >>> 0;
  }
  let len = buf.length;        // 末尾追加字节长度（每字节 LSB-first 喂入），与 cksum 完全一致
  while (len > 0) {
    crc = (((crc << 8) >>> 0) ^ CKSUM_TAB[((crc >>> 24) ^ (len & 0xff)) & 0xff]) >>> 0;
    len = Math.floor(len / 256);
  }
  return (~crc) >>> 0;
}

// ── watchdog 软读（v2 board.watchdog，降级 fallback board.wakeup）──────────────────────────────────
// watchdogRecord(board) → 该 board 的 watchdog 对象（v2 board.watchdog 优先，缺则 fallback v1 board.wakeup）；
//   非对象（string/null/缺）→ null（graceful-degrade，与 wip_limit 同——无 watchdog）。
function watchdogRecord(board) {
  if (!board || typeof board !== 'object') return null;
  let wd = board.watchdog;
  if (wd === undefined) wd = board.wakeup;     // v1 旧板兼容：watchdog 缺 → 降级读 wakeup
  if (!wd || typeof wd !== 'object' || Array.isArray(wd)) return null;
  return wd;
}
// watchdogFireAt(board) → watchdog 对象里的 fire_at 字符串值（""，若无 watchdog 对象或无 fire_at 字符串）。
function watchdogFireAt(board) {
  const wd = watchdogRecord(board);
  if (!wd) return '';
  return (typeof wd.fire_at === 'string') ? wd.fire_at : '';
}
// watchdogArmed(board, nowIso) → 该 board 是否带一个仍应被当作 ARMED 的 watchdog（即 NOT stale·簇#2 self-heal）。
//   ARMED = watchdog 对象 ∧ fire_at（缺/非严格 ISO-8601-UTC → graceful-degrade 当 armed；或合法且仍在未来 >= now）。
//   唯一判「not armed」的：对象 + 合法 fire_at + 已过 now 这一三元组——该响而未响、任务仍 in_flight 即静默失败信号，
//   提醒须再响（self-heal）。graceful-degrade 是红线2（watchdog 是软读 / agent-shaped、非 pinned waist）。
function watchdogArmed(board, nowIso) {
  const wd = watchdogRecord(board);
  if (!wd) return false;                        // 无 watchdog 对象 → not armed
  const fa = (typeof wd.fire_at === 'string') ? wd.fire_at : '';
  if (!fa) return true;                         // 对象但无 fire_at → graceful-degrade → armed
  if (!ISO_RE.test(fa)) return true;            // fire_at 非严格 ISO → graceful-degrade → armed
  if (fa < nowIso) return false;                // 合法 fire_at 已过去 → STALE → not armed
  return true;                                  // 合法 fire_at 仍在未来 → armed
}

// nowIsoUtc() → 当前时刻的严格 ISO-8601-UTC（YYYY-MM-DDTHH:MM:SSZ），与 v1 `date -u +...` 同形（无毫秒）。
function nowIsoUtc() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// ── sidecar 读写 ──────────────────────────────────────────────────────────────────────────────────
// sidecar 单行 "<block_streak> <last_handshook_fp>"。last_handshook_fp 是上次强制 self-check 的完成态
//   指纹（"-" = 尚无）。sid 空 → 降级用稳定的 .nosession sidecar，保险丝照常生效。
function sidecarPath(homeDir, sid) {
  const name = sid ? `.${sid}.stopcheck` : '.nosession.stopcheck';
  return path.join(homeDir, name);
}
function readSidecar(scPath) {
  let blockStreak = 0;
  let lastFp = '-';
  try {
    const raw = fs.readFileSync(scPath, 'utf8');
    const firstLine = raw.split('\n')[0] || '';
    const parts = firstLine.split(/\s+/).filter((x) => x !== '');
    if (parts.length >= 1) {
      const bs = parts[0];
      blockStreak = /^[0-9]+$/.test(bs) ? parseInt(bs, 10) : 0;   // 非数字 → 0（与 v1 `case` 同）
    }
    if (parts.length >= 2 && parts[1] !== '') lastFp = parts[1];
  } catch (_e) { /* 无 sidecar / 读不出 → 默认 0 "-" */ }
  return { blockStreak, lastFp };
}
// writeSidecar — 原子写（tmp + rename），并发 Stop 绝不读到撕裂的 sidecar（与 v1 tmp+mv 同纪律）。
function writeSidecar(scPath, line) {
  const tmp = `${scPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, line);
  fs.renameSync(tmp, scPath);
}
function clearSidecar(scPath) {
  try { fs.unlinkSync(scPath); } catch (_e) { /* 不存在即可 */ }
}

// ── JSON 转义（block reason 注入 JSON 字符串字面量）─────────────────────────────────────────────────
function jsonStr(s) { return JSON.stringify(String(s)); }

// ── body：plumbing（stdin/home/fail-silent/exit 0）由 hook-common.runHook 提供（phase-1b）；verify-board
//   用 arm:'custom' 而非 'boards'——因为「无匹配 active 板」时它不是纯静默，而是 allow()=clearSidecar（清保险丝
//   状态·真实副作用），必须 body 内自处理（harness 的 boards 空列表早退是纯静默、会吞掉这个 clearSidecar）。
//   输出：Stop hook 只能 block（decision:block）或 allow（静默 exit 0），故 body 全程直接 process.stdout.write
//   自控 envelope（decision/reason/fuse 三态·与原逐字相同），返回 null 告诉 harness「我已自写、别再套」。
function body(ctx) {
  const sid = ctx.sid;
  const HOME_DIR = ctx.homeDir;
  const SIDECAR = sidecarPath(HOME_DIR, sid);

  let { blockStreak, lastFp } = readSidecar(SIDECAR);

  // ── 武装闸 + 板扫描：本 session 的 active 板（listMatchingBoards == board_matches 武装闸）。
  //   按文件名排序 = 与 v1 shell glob `*.board.json` 同序（确定性·指纹按板序折叠 fire_at）。
  const matched = listMatchingBoards(HOME_DIR, sid)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const now = nowIsoUtc();
  let emptyActive = false;       // 任一匹配板 0 task
  let actionable = false;        // 任一匹配板有 ready / uncertain task
  let watchdogNeeded = false;    // 任一匹配板有 in_flight task 但无 armed watchdog

  for (const { board } of matched) {
    // top-level task 数组（JSON.parse 让嵌套 log[] 里的 status 天然不冒充顶层 task）。
    const tasks = Array.isArray(board.tasks) ? board.tasks : [];
    const realTasks = tasks.filter((t) => t && typeof t === 'object' && !Array.isArray(t) &&
                                          typeof t.id === 'string' && t.id !== '');
    if (realTasks.length === 0) emptyActive = true;   // 0 个真 task（有 id 的顶层对象）→ 空板
    let hasInFlight = false;
    for (const t of realTasks) {
      if (t.status === 'ready' || t.status === 'uncertain') actionable = true;
      if (t.status === 'in_flight') hasInFlight = true;
    }
    // watchdog（ADR-011 + 簇#2 self-heal）：本板有 in_flight task 但无 armed watchdog → 后台任务可能静默失败、
    //   无人回来 recon。软读（graceful-degrade）：只有下面的完成态握手据此出声；actionable/空板更早 block 到不了这里。
    if (hasInFlight && !watchdogArmed(board, now)) watchdogNeeded = true;
  }

  // ── 完成态指纹（与 v1 status_fingerprint 字节级等价）─────────────────────────────────────────────
  // 构造 cksum 输入：首行 "watchdog_needed:<0|1>\n"，再按板序对每块匹配板：fire_at 非空时 "fire_at:<值>\n"，
  //   然后每个 task 的 id/status/blocked_on/parent（值为字符串者）按**该 task 对象内 key 出现序**输出
  //   `"<key>":"<value>"\n`（复现 v1 `grep -oE` 在紧凑 board 上的 source-order 匹配）。
  // PARENT 维（D3/ADR-012）+ WATCHDOG 维（Finding #56）+ FIRE_AT 维（簇#2）全折入——与 v1 同：子 status 翻转
  //   改 owner 子图指纹 / 进入「需 watchdog」重强握手 / 旧 hook 写的 stale .stopcheck 升级后绝不撞新指纹。
  function statusFingerprint() {
    const lines = [];
    lines.push(`watchdog_needed:${watchdogNeeded ? 1 : 0}`);
    for (const { board } of matched) {
      const fa = watchdogFireAt(board);
      if (fa) lines.push(`fire_at:${fa}`);
      const tasks = Array.isArray(board.tasks) ? board.tasks : [];
      for (const t of tasks) {
        if (!t || typeof t !== 'object' || Array.isArray(t)) continue;
        if (typeof t.id !== 'string' || t.id === '') continue;   // 仅顶层真 task（与 region 扫描同口径）
        // 按 key 出现序发射 id/status/blocked_on/parent 中**值为字符串**者（v1 grep `"[^"]*"` 仅匹配字符串值）。
        for (const key of Object.keys(t)) {
          if (key !== 'id' && key !== 'status' && key !== 'blocked_on' && key !== 'parent') continue;
          const v = t[key];
          if (typeof v !== 'string') continue;
          lines.push(`"${key}":"${v}"`);
        }
      }
    }
    const input = lines.map((l) => l + '\n').join('');
    return String(posixCksum(input));
  }

  // ── 决策动作 ───────────────────────────────────────────────────────────────────────────────────
  // emitBlock — bump streak、保险丝检查、写 sidecar、打印 decision 或强制 allow。
  //
  // ADR-018 标签（§13）：
  //   · 真 block（decision:block）的 reason 是**系统硬闸**——Stop hook 把 agent 挡在 Stop 上、必须遵从才能停
  //     → `<directive source="verify-board">`，内含 why（每条 block reason 文案已自带「为什么停不得」的理由·P5）。
  //     这正是 ADR-018 §2.2 给的 verify-board 收口闸真实例子（罕见的 directive）。pending-user / watchdog / rollup
  //     提醒是这同一条 block reason 的内部条款（都各自带 why），随其归入同一 directive、不另拆标签（保 reason 单字段）。
  //   · fuse 跳闸**不是闸**（它在 RELEASE·放 agent 停）——只告知「连续 block N 次已释放，去检查卡住的 ready
  //     task」，决策归 agent（去不去查是它的判断）→ `<advisory strength="strong">`（高 stakes:可能真卡死，应认真响应）。
  // PARITY: rule-verify-board-tag-protocol
  function emitBlock(reason) {
    blockStreak += 1;
    if (blockStreak >= FUSE) {
      // 保险丝跳闸：强制 allow + 警告，清 sidecar（streak 归零）。
      const warn = `cc-master: fuse tripped — blocked ${blockStreak} times in a row. Releasing the stop. ` +
        'If you are stuck, check the board for a `ready` task that cannot actually proceed (mark it `blocked`/`escalated`) before continuing.';
      const wrappedWarn = advisory('verify-board', 'strong', warn);
      clearSidecar(SIDECAR);
      process.stdout.write(`{"reason":${jsonStr(wrappedWarn)}}\n`);   // 无 decision:block → 非 block；agent 停 + 显警告
      return;
    }
    writeSidecar(SIDECAR, `${blockStreak} ${lastFp}\n`);
    const wrappedReason = directive('verify-board', reason);
    process.stdout.write(`{"decision":"block","reason":${jsonStr(wrappedReason)}}\n`);
  }
  // allow → 清 sidecar（streak → 0）。
  function allow() { clearSidecar(SIDECAR); }
  // allowHandshookFp — allow，但 KEEP 握手指纹，让同一完成态在后续每次 Stop 都放行（已 self-check 过）。
  //   streak 归 0；只有变了的指纹（或写 "-" 的 actionable）才重强 self-check。
  function allowHandshookFp() { writeSidecar(SIDECAR, `0 ${lastFp}\n`); }

  // 无匹配 active 板 → dormant → allow。
  if (matched.length === 0) { allow(); return; }

  // 空 active 板 → bootstrap 从未填充 → block。
  if (emptyActive) {
    emitBlock('cc-master: an active board in your home has no tasks. Decompose the goal into a dependency DAG and write tasks[] into it (or archive it with /cc-master:stop) before ending.');
    return;
  }

  // 有可推进的活（ready/uncertain）→ block。这不是完成态握手，故不带指纹：把 lastFp 重置为 "-"，让下一个
  //   完成态必须重新 self-check。
  if (actionable) {
    lastFp = '-';
    emitBlock('cc-master: this board still has a `ready` or `uncertain` task. A `ready` task can proceed now; an `uncertain` one has output awaiting verification. Resolve it (or mark it `blocked`/`escalated`) before stopping.');
    return;
  }

  // 完成态（全 in_flight/blocked/done/failed/escalated/stale）→ fingerprint-keyed 握手。
  //   若这个完成态已握手过（fp 不变）→ allow（别再问）；只有变了的完成态才重强 self-check。
  const fpNow = statusFingerprint();
  if (lastFp === fpNow) {
    allowHandshookFp();   // 此完成态指纹已握手 → allow + KEEP fp
    return;
  }
  // 新（或变了的）完成态 → 记下要握手的指纹，再 block。
  lastFp = fpNow;
  let handshakeReason = "cc-master: before you stop, self-check against this board's `goal`. " +
    '(1) Is every point that needs the user surfaced / marked `blocked_on:"user"`? ' +
    '(2) Against the **original goal**, is every to-do actually done — including any NOT yet listed on the board? ' +
    'If something is missing, add it to `tasks[]` and keep going; only stop once the goal is truly met.';

  // H3：若任一匹配板有 task 停在 user 上（status blocked 且 blocked_on:"user"），把这些开放决策点名进握手，
  //   让 agent 不能在一个未回答的决策上静默退出。收集每个的人类标签（title，否则 id），按板序、文件序。
  // 口径：要求 status==="blocked" 且 blocked_on==="user"——已回答（status:done 仍带 stale blocked_on:user）排除（Case X6）。
  const pendingLabels = [];
  for (const { board } of matched) {
    const tasks = Array.isArray(board.tasks) ? board.tasks : [];
    for (const t of tasks) {
      if (!t || typeof t !== 'object' || Array.isArray(t)) continue;
      if (t.status !== 'blocked') continue;
      if (t.blocked_on !== 'user') continue;
      let lbl = (typeof t.title === 'string' && t.title !== '') ? t.title : '';
      if (!lbl) lbl = (typeof t.id === 'string' && t.id !== '') ? t.id : '';
      if (lbl) pendingLabels.push(lbl);
    }
  }
  if (pendingLabels.length) {
    const joined = pendingLabels.join('; ');
    handshakeReason += ` Unanswered user decisions still on this board: ${joined}. ` +
      "Confirm each is genuinely still pending (or resolve it) before you stop — don't silently exit on an open user decision.";
  }

  // Watchdog 提醒（ADR-011）：board 处完成态但仍有 in_flight 后台 task 且无 armed watchdog。harness 在被
  //   追踪 task 的 COMPLETION 上自动重唤起，但挂死 / 静默死 / 从未派发的 task 不发 completion 事件——没人回来。
  //   停前 arm 一个 watchdog wakeup（CronCreate one-shot / ScheduleWakeup / Monitor / background-shell `until`
  //   floor）+ 把要 recon 的写进 board 的 `watchdog.checklist`。软读：已 armed 的 watchdog 静默此提醒。
  // CEILING = RECON 触发器，非死刑判决（Finding #60）：过期 fire_at 而仍 in_flight 是回来 recon 地面真相的
  //   信号，不是杀掉健康长跑者；措辞须含 "recon, not verdict" + "宽限时间天花板，绝不拿 output-size 停滞当存活信号"。
  if (watchdogNeeded) {
    handshakeReason += ' This board has an in_flight background task but no armed watchdog (the `wakeup` field is missing, or its `fire_at` is already in the past). ' +
      'An expired `fire_at` while a task is still in_flight is a trigger to come back and RECON ground truth — NOT a death verdict: ' +
      'if recon shows it healthy (git moving / output mtime still changing / legitimately blocked on a long silent command like run-tests), ' +
      'extend / re-arm the watchdog and let it run; only a task frozen with no ground-truth change well past a generous ceiling is judged hung. ' +
      'Before you stop, arm a watchdog wakeup (CronCreate one-shot / ScheduleWakeup / Monitor / background-shell `until`) for the in_flight tasks that could fail silently — ' +
      "use a generous time ceiling, never an output-size stall as the liveness signal — and record what to recon when it fires in the board's `wakeup.checklist` — " +
      'otherwise a silently-failing background task leaves no one to come back and look.';
  }

  // Rollup-aware 提醒（D3/path-ii·ADR-012·Q-N1 = SOFT 提醒、非硬 block）：完成态下，若任一 owner task 标
  //   status:"done" 而它含的某个 child（parent 指向它的 task）非 done，owner 子图被 rolled up 不一致——多半是
  //   parent 错标 done 而 child 仍在飞，会静默漏掉整个子图。仅收集本 session 匹配（=武装）板（红线6：循环在
  //   武装闸内，未武装 session 到不了这里）。graceful-degrade：旧板无 parent 边 → 零违规、此段静默跳过。
  //   扁平 set 运算（depth=1·parent 是单值指针）：建 (id→status)，再对每个有 parent 且 parent 为 done owner、
  //   自身非 done 的 child 报违规。镜像 board-graph-core rollupConsistency。
  //   ★T4-3b 解耦：检测「哪些 owner rollup 不一致」经 ccm（rollupOwnersViaCcm 取 GRAPH-ROLLUP violations
  //   的 owner 集）；据该集从已解析 board 重建每条 part（措辞同今）。ccm 不可用 → 跳过本板 rollup part
  //   （其余 Stop gate 照走·优雅降级）。3b 已删 cli/，无 require board-model fallback——rollup 是 SOFT 提醒
  //   （非硬 block），ccm 缺一次只少一条软提示，self-check 握手仍照常 block。
  const rollupParts = [];
  for (const { path: boardPath, board } of matched) {
    const tasks = Array.isArray(board.tasks) ? board.tasks : [];
    const realTasks = [];
    for (const t of tasks) {
      if (!t || typeof t !== 'object' || Array.isArray(t)) continue;
      if (typeof t.id !== 'string' || t.id === '') continue;
      realTasks.push(t);
    }
    // ccm 定位违规 owner 集。done 语义 = status==='done'（与引擎 isDoneStatus 字字一致·无需 require）。
    const flaggedOwners = rollupOwnersViaCcm(boardPath);
    if (flaggedOwners === null) continue;                       // ccm 不可用 → 跳过本板 rollup part（优雅降级）
    for (const t of realTasks) {
      const pa = (typeof t.parent === 'string') ? t.parent : '';
      if (!pa || !flaggedOwners.has(pa)) continue;             // 非 ccm 标记的违规 owner 的子 → 跳过
      const cst = (typeof t.status === 'string') ? t.status : '';
      if (cst === 'done') continue;                            // child 已 done → 一致（同引擎 doneStatus）
      rollupParts.push('owner ' + pa + ' is `done` but child ' + t.id + ' is `' + cst + '`');
    }
  }
  if (rollupParts.length) {
    const joined = rollupParts.join('; ');
    handshakeReason += ` Rollup inconsistency on this board (${joined}): ` +
      'a parent (owner) node should NOT be `done` while a child under its `parent` is still unfinished — ' +
      "a done parent means全子 done ∧ the parent's own端点验收 passed. " +
      'Either the parent was错标 done while a child is in flight (un-done the parent and finish the child), ' +
      "or the child finished and just needs its status updated. Don't stop on a rolled-up-inconsistent owner sub-graph.";
  }

  emitBlock(handshakeReason);
  return null; // body 已自写 envelope（emitBlock）；harness 不再套（fail-silent + exit 0 由 harness 兜）。
}

// runHook：arm:'custom'（body 自判武装 + 自处理无匹配板的 clearSidecar）。全程 try/catch + exit 0 由 harness
//   保证——异常静默放行（hook 崩绝不把 agent 永久卡在 Stop）。bootstrap-board.sh 仍是唯一豁免的 ARM 动作。
runHook({ event: 'Stop', arm: 'custom', body });
