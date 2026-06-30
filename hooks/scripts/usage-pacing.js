#!/usr/bin/env node
// usage-pacing.js — H8 (ADR-006 解锁的旗舰 node hook)。
//
// 事件：Stop。每当主线 agent 想交还控制权时触发。读本地 usage JSONL（同 scripts/cc-usage.sh
// 的解析 + 5h rolling block + burn-rate 算法，同源同口径），感知是否临近「5h burn-rate 墙」，
// 临界时注入一条 **非阻断** 的 pacing 警告（hookSpecificOutput.additionalContext，hookEventName
// "Stop"）。**绝不 decision:block** —— hook 只感知+提示，怎么 pace 是认知（属 SKILL A，cost-and-
// pacing.md），不在 hook 里替主线做调度决策（红线4：指挥不演奏，引擎不替它思考）。
//
// LBHOOK（LOADBAL §3.2/3.3 + ADR-016）：除了 pacing 提示，本 hook 在 pacing 决策已得出「该切到下一份配额」
//   （kind==='switch'·5h 临界 + n>1 + 7d 有余量 + 有可切入备号）时，**机械**调 `ccm account switch`（切号执行
//   归 ccm·agent 不做切号决策·设计 §1）+ 切号后注入 `<ambient source="usage-pacing">` 让 agent 调配速/规模。
//   能不能切 / 切哪个 / board.policy 硬闸（deny→exit7）都委托 ccm；hook token-blind（换号在 ccm 子进程·不碰 token）。
//   完整门控 / 红线 / kill-switch（CC_MASTER_AUTOSWITCH）见下方 LBHOOK 常量段。**这不破红线4**：切号是 LOADBAL
//   引擎机械确定性执行（非 hook 替主线做「调度」判断）；agent 仍只收 ambient 信号、自己决定配速——「指挥不演奏」
//   守的是「主线不亲手做单元工作」，机械换号是 token-blind 的资源轮换、与「演奏」正交（设计 §1 四纲）。
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
// A2 T6（号池来源迁移）：本 hook 现在在 armed gate 之后**只读**号池 registry accounts.json（用户级
//   ${CC_MASTER_HOME:-$HOME/.claude/cc-master}/accounts.json），算 pacing 的 effective-N（非 active 且 token
//   未过期的可切入备号数 + 1）并注入「号池有 N 个备号」的粗粒度事实。**红线 2**：accounts.json 与 board 正交
//   （它是独立的用户级 registry，本 hook 既不读 board 的 num_account 也不写它——来源已从 board 迁到 accounts.json）。
//   **红线 1**：纯 JSON.parse、零 spawn、零网络。**红线 6**：读 registry / 注入号池事实**全在 armed gate 之后**，
//   未武装一律静默。无 registry / 空池 / 坏 JSON → effective-N=1（天然单账号，与旧 --num_account 缺省一致，设计稿 §F）。
//
// P4 收口（ADR-014/015·plan §10-P4）：**走廊 verdict 计算**已收口进 ccm 引擎（`usage/pacing.ts` 的
//   `pacingAdvice` 是双侧走廊数学的 SSOT）。本 hook 武装后**优先 shell 调 `ccm usage advise --json`**
//   （进程边界·spawnSync·与 board-lint.js 同模式），把它的 verdict 映射成本 skill 词汇的非阻断提示。
//   **优雅降级**：`ccm` 不在 PATH / 调用失败 / 非法 JSON / 形状不符 → **回退到本 hook 既有的本地计算路径**
//   （account-authoritative sidecar + 本地反推），绝不直接丢失提示能力。ccm present 时以其 verdict 为准。
//   红线1：spawn 一个二进制是允许的 shell 操作（非 import 引擎·非 python3）。红线6：shell 调 ccm 全在
//   armed gate 之后（与读 usage/registry 同精神）。红线3：ccm 出 verdict、A 决策——映射出的提示仍只软告知。
//   `CCM_BIN`（绝对路径可执行）是 dev/test/自定义安装的覆写口；缺则用 PATH 上的 `ccm`（生产）。
//
// node-on-PATH（ADR-006 §3.2）：npm/global 安装铁定有 `node`；standalone-binary 安装可能内嵌 node
//   而不暴露到 PATH —— 那种宿主下本脚本（shebang `#!/usr/bin/env node`）根本不会被调起，等同于「该 hook
//   不存在」。这是 Stop 事件上的**优雅降级**（不阻断、不报错），与本 hook「失败必静默」的精神一致；
//   owner 在 ADR-006 接受 npm-install 多数派这条边界。启动开销 ~数十 ms —— Stop 是低频事件（每轮一次，
//   非 per-tool），可承受；故 H8 选 node hook 而非留 bash。

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
// ★home 解析 + 武装闸 isArmed 收口到共享 hook-common（node SSOT·取代本文件旧内联副本）。
//   ambient/advisory 是 ADR-018 标签包装器（§13·closed set·source 必填·strength 只给 advisory）。
const { claudeConfigDir, resolveHome, ambient, advisory, runHook } = require('./hook-common.js');

// ── ADR-018 标签力度映射（§13/P4：力度配 stakes）──────────────────────────────────────────────────
// pacing 注入**绝大多数落 advisory**（ADR-018 §2.2 例子 + §3.1 活体印证：agent 把 pacing 当判断输入、推理
//   其前提后自己拍——故是喂判断的 advisory 而非 system-bound directive；hook 永不能真 block dispatch·红线4）。
//   各 warning 路径标注 kind，PACING_STRENGTH 把 kind 映射成 weak|strong（ambient 恒低·不在此表）：
//     hard_stop  7d 硬总闸·暂停 dispatch + surface 用户：跨窗口不可逆消耗，stakes 最高 → strong（对齐 ADR-018 §2.2「7d 逼顶」例 = strong）
//     throttle   5h 临界减速：临界侧、风险中高 → strong（认真权衡减速·P4 高风险→strong）
//     switch     n>1 切到下一份配额：机会信号·可逆·低 stakes → weak（类比欠用加速）
//     underuse   欠用加速：低风险·可合理忽略（手头无活就随它蒸发）→ weak（对齐 ADR-018 §2.2「欠用加速」例 = weak）
const PACING_STRENGTH = { hard_stop: 'strong', throttle: 'strong', switch: 'weak', underuse: 'weak' };
function pacingStrengthOf(kind) {
  return PACING_STRENGTH[kind] || 'weak'; // 未知 kind → 最低够用（weak·P2）
}

// ── 触发策略阈值（克制，避免每回合刷屏；见文件尾 README 块的完整论证）────────────────────────────
//
// 环境覆写点（与 cc-usage.sh 的 --dir/--now 对偶，供测试注入 fixture + 锚定确定性时间）：
//   CC_MASTER_USAGE_DIR  usage JSONL 根目录（默认 <claudeConfigDir>/projects·跟随 CLAUDE_CONFIG_DIR），测试指向 fixture。
//   CC_MASTER_NOW        ISO-8601 覆写「现在」，让 rolling window 与撞墙预测确定可复现。
//   CC_MASTER_5H_BUDGET  （可选）本 5h 窗口的 token 预算上限。给了就走「预测撞墙」分支；
//                        未给则 ceiling 未知（真实约束）→ 退化到「明显临界」启发式，否则静默。
//   CC_MASTER_5H_BURN_FLOOR （可选）无预算时启发式用的绝对 burn 地板（tok/min）。给了就覆写默认。
const USAGE_DIR =
  process.env.CC_MASTER_USAGE_DIR ||
  path.join(claudeConfigDir(), 'projects');
// HOME_DIR：armed 判定要扫的 board home **根**（hook-common.resolveHome 同口径：CC_MASTER_HOME 覆写，
//   否则 $HOME/.claude/cc-master·全局）。isArmed 内部走 <home>/boards/ 扫板。测试经 CC_MASTER_HOME 注入。
const HOME_DIR = resolveHome();
// ACCOUNTS_FILE（A2 T6）：号池 registry accounts.json 的固定路径（home **根**·非 boards/ 子目录）。
//   effective-N 与「号池有几个备号」注入从这里读，**不再**从 board top-level num_account / --num_account
//   来（A2 砍 --num_account）。路径用户级（CC_MASTER_HOME 覆写，否则 $HOME/.claude/cc-master）——与
//   accounts-lib.js defaultRegistryPath() 同口径。home 收口为全局后，它与 HOME_DIR 同根（accounts.json 本就
//   是跨编排 / 跨 repo 的用户级资源·有意全局·不动）。CC_MASTER_ACCOUNTS_FILE 是测试注入点（直接指向 fixture
//   文件，绕开目录解析）。
// F3（codex）：home **走同一个 canonical 解析**（HOME_DIR = hook-common.resolveHome()）——不再用裸
//   `process.env.HOME || ''`。旧写法在 HOME 未设 + CC_MASTER_HOME 未设时塌成 cwd 相对的
//   `.claude/cc-master/accounts.json`，而 arming 走 resolveHome()→os.homedir() 的全局 home：两者静默分叉
//   → 号池读不到 → effective-N 被误算成 1、丢号池建议。改为 path.join(HOME_DIR, …) 与 arming 同根，杜绝分叉。
const ACCOUNTS_FILE =
  process.env.CC_MASTER_ACCOUNTS_FILE ||
  path.join(HOME_DIR, 'accounts.json');
const NOW_OVERRIDE = process.env.CC_MASTER_NOW || '';
const BUDGET_RAW = process.env.CC_MASTER_5H_BUDGET || '';
const BURN_FLOOR_RAW = process.env.CC_MASTER_5H_BURN_FLOOR || '';
// account-authoritative pacing (Finding #37): 优先信 status-line 捕获的账户权威 5h/7d used_percentage
//   (落在 sidecar);只有 sidecar 缺/坏时才降级本地反推。PCT_FLOOR:某窗口 used% 到此即临界(默认 85)。
const RATE_CACHE =
  process.env.CC_MASTER_RATE_CACHE ||
  path.join(claudeConfigDir(), '.cc-master-rate-limits.json');
const PCT_FLOOR_RAW = process.env.CC_MASTER_PCT_FLOOR || '';
// 7d≥85% dispatch 闸 (need ②): 7d 是跨窗口加速硬总闸(ADR-010 §2.2/§2.6)。当账户权威 7d used% 达此闸(默认 85)
//   时,撞墙提示从泛泛「减速」**升级措辞**为点名 dispatch 闸——「本回合起暂停 dispatch 新节点、把『是否续耗
//   7d 配额』作为 blocked_on:"user" 决策 surface 给用户」。它仍只是软提示(hook 永不能真 block dispatch,红线4)——
//   真正的暂停由 orchestrator 在决策程序 dispatch 节点执行(心智轨,见 SKILL.md / pacing-and-estimation.md)。**只在账户
//   口径生效**:本地反推算不出 7d used%(无分母),反推路径不触发此闸(与加速侧反推禁用同精神)。env 覆写测试注入。
const SEVEN_DAY_DISPATCH_GATE_RAW = process.env.CC_MASTER_SEVEN_DAY_DISPATCH_GATE || '';
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
// num_account (need ①): how many quotas can be SERIALLY consumed (真实可序列消费的 n 份配额).
//   **A2 T6 来源迁移**：不再读 board top-level num_account / --num_account（已砍），改从号池 registry
//   accounts.json 算 effective-N = 非 active 且 token 未过期的可切入备号数 + 1(当前在用号)；无 registry /
//   空池 / 坏 JSON → 1(天然单账号，行为与 --num_account 缺省一致)。env CC_MASTER_NUM_ACCOUNT 仍作**测试
//   注入兜底**（registry 不可用或显式覆写时用），与其它 CC_MASTER_* 覆写点对偶；解析失败 / 缺失 / 非正整数 → null。
const NUM_ACCOUNT_RAW = process.env.CC_MASTER_NUM_ACCOUNT || '';
// CCM_BIN（P4 收口）：走廊 verdict 优先 shell 调 `ccm usage advise --json` 算（引擎 pacing.ts SSOT）。
//   CCM_BIN 是 dev/test/自定义安装的覆写口（绝对路径可执行）；缺则用 PATH 上的 `ccm`（生产）。指向不存在
//   的路径即可强制走本地降级路径（测试用·与 board-lint.js 同口径）。
const CCM_BIN = process.env.CCM_BIN || 'ccm';
// RATE_CACHE 路径要透传给 ccm（advise 也读同一 sidecar）——下面 RATE_CACHE 已定义；HOME_DIR 透传作 --home。

// ── LBHOOK（自主换号·LOADBAL §3.2/3.3 + ADR-016）：pacing 判定「该切到下一份配额」时机械调 ccm account switch ─────
// 设计 SSOT：design_docs/plans/2026-06-29-loadbal-account-namespace-design.md §3.2/3.3 + adrs/ADR-016。
// 触发（WHEN·hook 侧只做 token-blind 的水位/失衡触发，**切哪个号 + 能不能切 + policy 都委托 ccm**）：当 pacing
//   决策已得出 kind==='switch'（= 5h 配额临界 + n>1 可序列配额 + 7d 总闸有余量 + 有可切入备号——LOADBAL §3.2 ①
//   水位触发，已由 ccmWarning〔ccm usage advise verdict accelerate + switch_account lever〕/ decideAccountWarning
//   〔本地权威路径〕产出）时，**机械**调 `ccm account switch`，而非只把「换号 lever」advisory 给 agent。
//   **hook 机械触发执行·agent 不做切号决策**（设计 §1）；agent 只收切号后的 ambient 事实、据此调配速/规模。
// ccm account switch 内部自 gate（不在 hook 重复）：重读最新 registry → 选最优切入号 → **board.policy 机制硬闸**
//   （`autonomous_account_switch==deny` → 拒+exit7·ADR-016 §2.2）→ 池全员逼顶 exit3（幂等:无可切入号即 no-op）→
//   覆写官方三存储（全或无 + trap）。**token-blind**：换号在 ccm 子进程，hook 只透传 `--board`/`--home`、只读
//   ccm 非密 JSON 输出（{email,switched}）——绝不碰任何 token（红线·设计 §A.1）。
// **绝不自授权**（ADR-016 §2.5 重映射到新语义）：participate 由 board.policy 控（用户所有）；hook 只「在 policy=allow
//   时切」——它自己 policy-blind（红线2 不读 policy），靠把 `--board` 透传给 ccm、由 ccm 读 policy 硬闸兜底
//   （deny→exit7）。hook **绝不**传 `--user-authorized`（那是 `ccm policy set` 的自授权信号·翻 policy 才用）。
// 红线：① 红线1/ADR-006——spawn ccm 是 ADR-014 进程边界（与 adviseViaCcm 同模式·非新依赖）；② 红线2——只透传
//   board 路径给 ccm，hook 不读 policy/不碰窄腰外字段；③ 红线6——换号在 armed gate 之后（body 内·harness 已武装）；
//   ④ ship-anywhere——ccm 缺（ENOENT）则优雅降级回「只 advisory」既有行为，绝不 block。
//
// CC_MASTER_AUTOSWITCH（kill-switch）：默认**开**（=机械换号·对齐设计「hook 机械执行」+ board.policy 作 SSOT 控制面）；
//   设 '0' 强制**关**（退回纯 advisory 既有行为·dogfood / 应急用）。**rollout 默认开/关是编排者的判类决策**——见报告。
const AUTOSWITCH_ON = process.env.CC_MASTER_AUTOSWITCH !== '0';
// 换号冷却（幂等·防每回合切）：切号成功后 cooldown 秒内不再自动切——堵「切号后 statusline 未刷新、sidecar 仍是切出号
//   高 used% → 下一 Stop 又触发 kind:'switch' → 全池抖动」。默认 1800s（30min·对齐引擎 CCM_SELECT_MIN_SWITCH_INTERVAL_SEC
//   滞回口径）。冷却时间戳落 SWITCH_STATE_FILE（hook 自管 sidecar·非 board·与「状态写 sidecar」纪律一致）。
const SWITCH_COOLDOWN_RAW = process.env.CC_MASTER_SWITCH_COOLDOWN_SEC || '';
const SWITCH_STATE_FILE =
  process.env.CC_MASTER_SWITCH_STATE || path.join(HOME_DIR, '.cc-master-switch.json');

// ── ③ PostToolBatch 中途采样（hooks-enhancements-v2 §1）─────────────────────────────────────────────
// 把配速感知从「轮末（Stop）才知」前移到「回合中途（PostToolBatch）也查」。节流 sidecar（hook-owned·非 board·
//   语义同换号冷却 sidecar：transient + home-global·与配额窗口绑定·跨编排）记 { last_inject_at, last_band,
//   window_resets_at }。CC_MASTER_PACING_SAMPLE_STATE 覆写（测试注入）。
const PACING_SAMPLE_FILE =
  process.env.CC_MASTER_PACING_SAMPLE_STATE || path.join(HOME_DIR, '.cc-master-pacing-sample.json');
// 中途采样冷却（秒·同带持续临界时距上次中途注入满此才再注·比 Stop 稀，因 Stop 每轮已兜底）。缺/空 → 默认
//   15min；显式 '0' → 0（关冷却·honor）；非数/负 → 默认。先判空串（Number('')===0 footgun·同 switchCooldownSec）。
const PACING_SAMPLE_COOLDOWN_RAW = process.env.CC_MASTER_PACING_SAMPLE_COOLDOWN_SEC || '';
// ccm account switch 子进程超时（含 refresh 的网络 POST）：默认 30s。换号被 cooldown + kind:'switch' 双门控、罕见
//   （5h 水位约每几小时一次），阻塞 Stop 数秒可承受（设计 §3.2）。CC_MASTER_SWITCH_TIMEOUT_MS 覆写（测试注入）。
const SWITCH_TIMEOUT_MS = (() => {
  const n = Number(process.env.CC_MASTER_SWITCH_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 30000;
})();

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
// 7d dispatch 闸阈值(need ②):非正/非数/缺 → 回退默认 85（与撞墙 floor 同值,7d≥85% 即升级措辞到「暂停 dispatch」）。
function parseSevenDayDispatchGate(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 85;
}
// 返回 {valid, warn}:valid=false ⟺ 账户口径不可用(缺/坏/空)→ 调用方 fallback 本地反推;
// valid=true 时 warn 是文案(到墙)或 null(账户有效但未到墙 → 权威静默,不再反推)。
// num_account 缩放（need ①，撞墙侧的 Q1 连带修正）：撞当前账号 5h 墙(85%)时——
//   n=1 → 这是该账号要烧穿、回落减速（原行为）；
//   n>1 → 当前账号 5h 烧满只是「切到下一份配额」的触发信号、**不是减速信号**（切了有新的满配额 5h 窗，
//         理想是把这份烧满后顺势用下一份，而非在还有余配额时减速空耗）。故 5h 命中时按 n 分叉措辞。
//   **7d 墙不随 n 变**：7d 是跨窗口的总闸（n 是 5h 内的并行/序列度，正交）——7d 命中永远是减速框架，
//   无论几份配额（别把 5h 余量烧成 7d 透支）。
// 7d≥85% dispatch 闸（need ②）：7d 是跨窗口加速硬总闸——当 7d used% 达 dispatchGate（默认 85）时,7d 那条提示从
//   泛泛「减速」**升级措辞**为点名 dispatch 闸:「暂停 dispatch 新节点、把『是否续耗 7d 配额』作 blocked_on:"user"
//   surface 给用户」。这升级只换 **7d 那条** 的措辞强度(5h 撞墙仍是降档/降WIP/defer);7d 命中即触发,与 n 正交。
//   仍只软提示(红线4:hook 永不能真 block dispatch);真正的暂停由 orchestrator 在决策程序 dispatch 节点执行。
function decideAccountWarning(acct, nowSec, floor, n, dispatchGate) {
  if (!acct || typeof acct !== 'object') return { valid: false, warn: null };
  const p5 = pctOf(acct.five_hour);
  const p7 = pctOf(acct.seven_day);
  if (p5 === null && p7 === null) return { valid: false, warn: null }; // 空/无效 → fallback
  const f = acct.five_hour;
  const nAcct = Number.isInteger(n) && n >= 1 ? n : 1;
  const gate = Number.isFinite(dispatchGate) && dispatchGate > 0 ? dispatchGate : 85;
  // 5h 仅在窗口仍有效(resets_at 在未来,或无 resets_at)时参与判墙;已过 reset 的 stale 5h 不参与,
  // 但 7d 不依赖 5h 的 resets_at,仍权威。
  const fhValid = p5 !== null && (typeof f.resets_at !== 'number' || f.resets_at > nowSec);
  const fhHit = fhValid && p5 >= floor;
  const sdHit = p7 !== null && p7 >= floor;
  // 7d 信号是否确认存在（Finding 2 修复，多账号交互的深层 edge）：sidecar 有 5h% 但**缺** seven_day.used_percentage
  //   时 p7===null。「切到下一份配额(n>1)」分支必须**只在 7d 信号确认存在且确有余量**时才走——7d 未知时不能
  //   假设它有余量、不能鼓励切号/续耗（切号刷新的是 5h，7d 是跨号累计的总闸；7d 也许早已逼顶，盲目切号续耗会
  //   把未知的 7d 透支）。p7===null（7d 缺）→ sdKnown=false → 退回保守减速措辞，不 claim 7d 有余量、不鼓励切号。
  const sdKnown = p7 !== null;
  // 7d dispatch 闸独立判定（Finding 3 修复）：dispatch 闸是 ADR-010 的**硬边界**（7d≥gate→暂停 dispatch），
  //   绝不能被可配置的 warning `floor` 架空。早先 sdHit=p7>=floor、提前-return 守卫只看 fhHit/sdHit——
  //   用户把 CC_MASTER_PCT_FLOOR 抬过 gate（如 floor=90、gate=85）时，7d=87% → sdHit=false → 提前 return →
  //   7d≥85% dispatch 闸根本不 fire（硬边界被软 floor 架空）。故 sdGateHit 从 `p7 >= gate` **独立**判，
  //   并纳入下面的提前-return 守卫 + warn 逻辑：无论 warning floor 多高，硬 7d dispatch 闸都能 fire。
  const sdGateHit = p7 !== null && p7 >= gate;
  if (!fhHit && !sdHit && !sdGateHit) return { valid: true, warn: null }; // 账户有效且未到任何墙/闸 → 权威静默
  const hits = [];
  if (fhHit) hits.push(`5h ${p5}%`);
  // 7d 命中 warning floor 或 dispatch 闸任一即列入 hits（floor>gate 时 sdHit 可能为 false 但 sdGateHit 为 true）。
  if (sdHit || sdGateHit) hits.push(`7d ${p7}%`);
  const slowdownLevers =
    `pace 杠杆(怎么 pace 是你的认知判断,见 orchestrating-to-completion / pacing-and-estimation):` +
    `① 把后续节点降到更便宜的模型档;② 降并发 WIP、暂缓新派工;③ defer 高 float 的非临界任务到窗口 reset 后。`;
  // 7d≥dispatchGate：dispatch 闸升级段(need ②)。点名「暂停 dispatch 新节点、surface 用户确认」,比泛泛减速重。
  //   附带提及:握多份配额(n>1)时「切到下一份配额(切账号刷新 7d)」是用户的一个可能响应——但切换本身不在此实现。
  //   **从 sdGateHit（p7>=gate，独立于 floor）判**，不再 `sdHit &&`——否则 floor>gate 时 sdHit=false 会让硬闸
  //   被软 floor 架空（Finding 3）。
  const sdDispatchGate = sdGateHit;
  let warn;
  let kind; // ADR-018 strength 映射用：hard_stop|switch|throttle（见 PACING_STRENGTH）
  if (sdDispatchGate) {
    // 7d 达 dispatch 闸:最硬措辞(无论 5h 是否也撞墙、无论 n)。7d 是跨窗口不可逆消耗边界 → 暂停派发 + surface 用户。
    const fhNote = fhHit ? `(5h 也已 ${p5}%)` : '';
    const switchNote =
      nAcct > 1
        ? `你声明了 ${nAcct} 份可序列消费的配额——「切到下一份配额(切账号会刷新 7d 窗)」是用户可选的一个响应,` +
          `与「暂停续耗」并列由用户拍;切换动作本身不由 hook/本提示执行。`
        : '';
    warn =
      `[cc-master pacing] 7d 配额硬总闸(权威口径,来自 status-line 捕获):7d 已用 ${p7}%(≥${gate}%)${fhNote}。` +
      `按 ADR-010,7d 是加速硬总闸——**本回合起暂停 dispatch 新节点**,把「是否继续消耗 7d 配额」作为一个 ` +
      `blocked_on:"user" 决策 surface 给用户,等用户确认后再续派发。在飞任务可继续跑完、可端点验收,但不要再派新活。` +
      `${switchNote}这是非阻断提示,真正的暂停由你(orchestrator)在决策程序的 dispatch 节点执行,不替你决策。`;
    kind = 'hard_stop'; // 7d 硬总闸 → advisory strong（stakes 最高·跨窗口不可逆）
  } else if (fhHit && nAcct > 1 && sdKnown && !sdHit) {
    // n>1 且只有 5h 撞墙、且 7d 信号**确认存在**并仍有余量(p7 已知 < floor、未达 dispatch 闸)：这是「切下一份
    //   配额」信号,不减速。**Finding 2**:加 sdKnown(p7!==null)守卫——7d 缺失时绝不走这条,以免在 7d 未知时假设
    //   有余量、鼓励切号续耗（切号刷新 5h 不刷 7d，7d 也许早逼顶）。7d 缺 → 落到下面 else 的保守减速措辞。
    warn =
      `[cc-master pacing] 账户 5h 配额临界(权威口径,来自 status-line 捕获):${hits.join(' / ')} ` +
      `已达/超过 ${floor}% 阈值。你声明了 ${nAcct} 份可序列消费的配额且 7d 总闸仍有余量(7d 仅 ${p7}%)——当前账号这份 ` +
      `5h 烧满是**切到下一份配额**的触发信号,不是减速信号:理想是把这份烧满后顺势用下一份满配额的 5h 窗,` +
      `而非在总配额还有余时减速空耗。切换/续派由你的认知判断;这是非阻断提示,不替你决策。`;
    kind = 'switch'; // n>1 切下一份配额 → advisory weak（机会信号·可逆·低 stakes）
  } else {
    // 保守减速分支，三种情形落这里：① n=1（回落减速）；② 7d 撞墙但未达 dispatch 闸（floor≤p7<gate,罕见——
    //   floor 默认即 gate）；③ **n>1 + 5h 撞墙但 7d 信号缺失（p7===null → !sdKnown）**（Finding 2）——7d 未知
    //   时不假设有余量、不鼓励切号，退回保守减速措辞。
    const nNote = nAcct > 1 && sdHit ? `(7d 是跨窗口总闸,与 ${nAcct} 份配额正交——总闸吃紧仍须减速)` : '';
    warn =
      `[cc-master pacing] 账户配额临界(权威口径,来自 status-line 捕获):${hits.join(' / ')} ` +
      `已达/超过 ${floor}% 阈值${nNote}。${slowdownLevers}这是非阻断提示,不替你决策。`;
    kind = 'throttle'; // 临界减速 → advisory strong（应认真权衡减速）
  }
  return { valid: true, warn, kind };
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
function decideAccountUnderuse(acct, nowSec, n) {
  if (!acct || typeof acct !== 'object') return { warn: null };
  const f = acct.five_hour;
  const p5 = pctOf(f);
  const p7 = pctOf(acct.seven_day);
  // ① underused（5h used% < effective_ceil）。5h 信号缺失 → 无从判欠用 → 静默。
  // num_account 缩放（need ①，§方案 A）：n 份可序列消费的配额并行 → 单账号该以 ~n 倍速烧，同一剩余时间下
  //   「欠用」判定线该更高。把欠用 ceil 抬成 effective_ceil = min(95, ceil × n)（封顶 95，避免误判「满了」）：
  //   n=1 → 60（原行为）；n≥2 → 基本「临 reset 还没烧满就催加速」。这是把用户「n 倍速」直觉翻译成当前信号
  //   物理上撑得住的形态（账户口径无绝对 token 分母 → 算不出 tok/min 精确速率，只能缩放无量纲的 used% 节奏，
  //   见 pacing-and-estimation.md 诚实天花板）。**撞墙侧不随 n 变**（见 decideAccountWarning 头注）。
  const nAcct = Number.isInteger(n) && n >= 1 ? n : 1;
  const ceil = Math.min(95, parseUnderusePctCeil(UNDERUSE_PCT_CEIL_RAW) * nAcct);
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
  const nAcctNote =
    nAcct > 1
      ? `(按 ${nAcct} 份可序列消费的配额理想节奏,此刻本该烧得更多——欠用判定线已据此抬高)`
      : '';
  const warn =
    `[cc-master pacing] 账户配额欠用(权威口径,来自 status-line 捕获):5h 仅用 ${p5}%${nAcctNote}、` +
    `窗口约 ${Math.round(remainMin)} min 后 reset(7d 总闸余量充足,仅 ${p7}%)。当前窗口的配额若不用` +
    `将随 reset 白白蒸发——可考虑加速以充分利用。加速杠杆(怎么加速是你的认知判断,见 ` +
    `orchestrating-to-completion / pacing-and-estimation 的加速侧 lever):① 把临界路径节点升到更强的模型档以提质提速;` +
    `② 提并发 WIP、把已就绪的高 float 任务提前派发;③ 把原计划 defer 到下一窗口的就绪工作拉进本窗口。` +
    `注意:加速须先过 7d 总闸(别把 5h 余量烧成 7d 透支);且这不是制造 busywork——没有真正就绪的活就别硬凑。` +
    `这是非阻断提示,不替你决策。`;
  return { warn, kind: 'underuse' }; // 欠用加速 → advisory weak（低风险·可合理忽略）
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
    `pace 杠杆（怎么 pace 是你的认知判断，见 orchestrating-to-completion / pacing-and-estimation）：` +
    `① 把后续节点降到更便宜的模型档（downgrade model）；② 降并发 WIP、暂缓新派工；` +
    `③ defer 高 float 的非临界路径任务到窗口 reset 后。这是非阻断提示，不替你决策。`;
  return `${head} ${levers}`;
}

// ── ARMED GATE ──────────────────────────────────────────────────────────────────────────────────
// isArmed(homeDir, sid) 现由 hook-common 提供（node SSOT），且武装闸已收口进 runHook harness（arm:'isArmed'·
//   phase-1b）——本文件不再直接调 isArmed，由 harness 在 body 之前统一武装。
//   语义与本文件旧内联副本字字相同（ADR-007 dormant-until-armed）：扫 <home>/boards/ 找 owner.active===true
//   且（stdin sid 空 → 非对称降级匹配任一 active 板；否则 owner.session_id===sid·空 board sid 保持休眠
//   fail-safe）的板。只读 narrow-waist owner.active/session_id，任何读/解析失败按未武装静默。

// ── 号池 registry（A2 T6：effective-N + 号池注入的来源，替代 board num_account / --num_account）──────────
// A2 砍了 --num_account：pacing 的「有效 N」不再从 board top-level num_account 来，改从号池 registry
//   accounts.json 算。来源迁移的两条不变式：① accounts.json 与 board **正交**（红线 2：它非 board、不碰
//   narrow waist——只读一份用户级 registry 文件，不读/不写任何 board 字段）；② 优雅降级——无 registry /
//   空池 / 坏 JSON → effective-N=1（天然单账号，行为与 --num_account 缺省完全一致，设计稿 §F）。
//
// 内联**最小 registry 读取**而非 require accounts-lib.js：hook 必须永不崩 + self-contain。跨目录
//   require('../../skills/account-management/scripts/accounts-lib.js') 虽随 plugin 同分发可解析，但是个
//   脆耦合（lib 重构 / standalone-binary 布局差异会让 hook 静默失效）；hook 只需「读 + 数」这一小撮逻辑，
//   内联十几行换来零跨目录耦合 + 红线 1 干净（纯 JSON.parse、零 spawn）。语义与 accounts-lib.js
//   loadRegistry / token 过期判定保持一致（设计稿 §A.3 token_expires_at + §B.4 token_expired 候选过滤）。

// readRegistryAccounts(file) → 号池 accounts map（object）或 null（无文件 / 坏 JSON / 任何读失败）。
//   纯只读、JSON.parse、零 spawn。文件不存在（ENOENT）= null（天然单账号，不报错）。坏 JSON / 非对象
//   = null（保守降级单账号，绝不让 pacing 因 registry 坏而崩——失败必静默是本 hook 的总纪律）。
function readRegistryAccounts(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (_e) {
    return null; // ENOENT / 权限 / IO → 无号池 → 降级单账号
  }
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (_e) {
    return null; // 坏 JSON → 降级单账号（hook 不修 registry、不报错）
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const accounts = obj.accounts;
  if (!accounts || typeof accounts !== 'object' || Array.isArray(accounts)) return null;
  return accounts;
}

// poolStatus(accounts, nowMs) → { backups, switchable, effectiveN }。accounts = registry 的 accounts map
//   （readRegistryAccounts 的返回）或 null。语义（设计稿 §F）：
//     backups   = 号池里**非当前 active** 的号数（不含正在用的那一份）。
//     switchable = backups 里 **可切入** 的号数 —— 必须同时满足：① `switchable !== false`（未被显式标
//                  `switchable:false` 的残缺号，与 select-account.js / account-add.sh 的 switchable 语义同口径：
//                  仅显式写 `false`（如只有 access token、无 refresh token 的残缺 blob）才排除，缺省/未设 =
//                  视作可切）；② **token 未过期**（token_expires_at < now 的排除——切进去认证失败，与
//                  select-account.js B.4 的 token_expired 候选过滤同口径；缺 token_expires_at = 不判过期、计入）。
//                  `switchable:false` 号与过期号一样**计入 backups、不计入 switchable**（存在但不可切）。
//     effectiveN = switchable + 1（+1 = 当前在用的这一份）。null / 空池 → effectiveN=1（单账号）。
//   token 过期判定用严格 ISO 字典序字符串比较即可（定宽 + Z → 字典序==时间序，accounts-lib §A.3 时间纪律），
//   但为稳健（容忍非定宽手写值）这里用 Date.parse 解析比较；解析失败 = 不判过期（计入，乐观——选号侧再纠正）。
function poolStatus(accounts, nowMs) {
  if (!accounts || typeof accounts !== 'object') {
    return { backups: 0, switchable: 0, effectiveN: 1 };
  }
  let backups = 0;
  let switchable = 0;
  for (const entry of Object.values(accounts)) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.active === true) continue; // 当前在用号不算备号
    backups += 1;
    // 显式 switchable:false（残缺号·只有 access、无 refresh）→ select-account.js 会排除它 → 不是真容量 lever，
    //   不计 switchable（计入 backups·与过期号同处理）。只排 === false（显式不可切）；缺省/未设 = 视作可切。
    if (entry.switchable === false) continue; // 显式残缺号 → 选号算法排除 → 不计 switchable
    // token 过期判定：有 token_expires_at 且能解析且 < now → 过期 → 不可切入（不计 switchable）。
    const exp = parseIso(entry.token_expires_at);
    if (exp !== null && exp < nowMs) continue; // token 已过期 → 切进去认证失败 → 排除
    switchable += 1;
  }
  return { backups, switchable, effectiveN: switchable + 1 };
}

// readNumAccount(file, nowMs) → pacing 的有效 N（≥1）或 null（调用方 || 1 降级）。env CC_MASTER_NUM_ACCOUNT
//   优先（测试注入 / 显式覆写，与其它 CC_MASTER_* 覆写点对偶）；否则从 registry 算 poolStatus().effectiveN。
//   registry 不可用（null）→ effectiveN=1。**绝不碰 board**（红线 2：来源已迁到正交的 accounts.json）。
function readNumAccount(file, nowMs) {
  const env = parseNumAccount(NUM_ACCOUNT_RAW);
  if (env !== null) return env; // env 覆写优先（测试 / 显式）
  const accounts = readRegistryAccounts(file);
  return poolStatus(accounts, nowMs).effectiveN;
}
// parseNumAccount(v) → 正整数（≥1）或 null（缺失/非正整数/非数字 → 调用方降级 1）。接受数字或数字字符串。
function parseNumAccount(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

// ── ccm usage advise 收口（P4·走廊 verdict 的 SSOT 路径）────────────────────────────────────────────
// adviseViaCcm(homeDir, rateCache, effN) → advise data 对象 | null。
//   spawnSync `ccm usage advise --json [--effective-n N]`，透传 CC_MASTER_HOME / CC_MASTER_RATE_CACHE
//   让 ccm 读到与 hook 同一份 sidecar / registry。形态：{ ok:true, data:{ verdict, reason, levers[],
//   hard_stop_7d, window_5h_pct, window_7d_pct, effective_n, switch_candidate, confidence, source,
//   available } }。任何失败（ENOENT / 信号 / 坏 JSON / 形状不符 / available:false）→ null（调用方降级本地）。
//   注意：ccm advise 用真实 Date.now()（无 --now 覆写）——欠用侧的「临近 reset」判定依赖 sidecar 里的
//   epoch resets_at 与真实当下比对，故 ccm 路径的时间口径权威；本地 fallback 才吃 CC_MASTER_NOW。
function adviseViaCcm(homeDir, rateCache, effN) {
  const args = ['usage', 'advise', '--json', '--home', homeDir];
  if (Number.isInteger(effN) && effN >= 1) args.push('--effective-n', String(effN));
  const env = Object.assign({}, process.env, { CC_MASTER_HOME: homeDir });
  if (rateCache) env.CC_MASTER_RATE_CACHE = rateCache;
  let r;
  try {
    r = spawnSync(CCM_BIN, args, { encoding: 'utf8', timeout: 15000, env });
  } catch (_e) {
    return null; // spawn 本身抛（极少）→ 降级本地
  }
  if (!r || r.error || r.signal) return null; // ENOENT（ccm 不在 PATH）/ 被信号杀 → 降级本地
  const stdout = typeof r.stdout === 'string' ? r.stdout : '';
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (_e) {
    return null; // 非有效 JSON → 降级本地
  }
  const data = parsed && typeof parsed === 'object' ? parsed.data : null;
  if (!data || typeof data !== 'object' || typeof data.verdict !== 'string') return null; // 形状不符
  // available:false（账户信号不可得）→ ccm 给不出权威走廊判定 → 降级本地反推（hook 既有撞墙启发式仍有价值）。
  if (data.available !== true) return null;
  return data;
}

// ccmWarning(data, pool) → 把 ccm advise verdict 映射成 { warn, kind }（warn=文案 / kind=ADR-018 strength 用·
//   见 PACING_STRENGTH），或 null（hold·静默）。词汇与本地路径（decideAccountWarning / decideAccountUnderuse）
//   对齐，让 ccm 路径与 fallback 路径的注入嗓音 + 标签力度一致：
//   hard_stop → 「暂停 dispatch 新节点」+ blocked_on:"user" + surface 用户 + 硬总闸（kind hard_stop·strong）；
//   throttle → 「降到更便宜的模型档」减速 levers（临界·kind throttle·strong）；
//   accelerate(切号) → 「切到下一份配额」（kind switch·weak）；accelerate(欠用) → 「欠用」+「加速」（kind underuse·weak）；
//   hold → 静默。号池粗粒度事实由调用方在尾部统一附加（ambient）。
function ccmWarning(data, n) {
  const p5 = typeof data.window_5h_pct === 'number' ? data.window_5h_pct : null;
  const p7 = typeof data.window_7d_pct === 'number' ? data.window_7d_pct : null;
  const levers = Array.isArray(data.levers) ? data.levers : [];
  // effective_n 以 ccm 返回的为权威（它从 registry / --effective-n 算）；ccm 缺该字段才回退本地 numAccount。
  const nAcct =
    Number.isInteger(data.effective_n) && data.effective_n >= 1
      ? data.effective_n
      : Number.isInteger(n) && n >= 1
        ? n
        : 1;
  if (data.verdict === 'hard_stop') {
    // 7d 硬总闸：最硬措辞（点名暂停 dispatch + blocked_on:user + surface 用户 + 硬总闸·ADR-010 §2.2）。
    const fhNote = p5 !== null && p5 >= 90 ? `(5h 也已 ${p5}%)` : '';
    const switchNote =
      nAcct > 1
        ? `你声明了 ${nAcct} 份可序列消费的配额——「切到下一份配额(切账号会刷新 7d 窗)」是用户可选的一个响应,` +
          `与「暂停续耗」并列由用户拍;切换动作本身不由 hook/本提示执行。`
        : '';
    return {
      warn:
        `[cc-master pacing] 7d 配额硬总闸(权威口径,来自 status-line 捕获):7d 已用 ${p7}%${fhNote}。` +
        `按 ADR-010,7d 是加速硬总闸——**本回合起暂停 dispatch 新节点**,把「是否继续消耗 7d 配额」作为一个 ` +
        `blocked_on:"user" 决策 surface 给用户,等用户确认后再续派发。在飞任务可继续跑完、可端点验收,但不要再派新活。` +
        `${switchNote}这是非阻断提示,真正的暂停由你(orchestrator)在决策程序的 dispatch 节点执行,不替你决策。`,
      kind: 'hard_stop',
    };
  }
  if (data.verdict === 'throttle') {
    const slowdownLevers =
      `pace 杠杆(怎么 pace 是你的认知判断,见 orchestrating-to-completion / pacing-and-estimation):` +
      `① 把后续节点降到更便宜的模型档;② 降并发 WIP、暂缓新派工;③ defer 高 float 的非临界任务到窗口 reset 后。`;
    return {
      warn:
        `[cc-master pacing] 账户配额临界(权威口径,来自 status-line 捕获):5h ${p5}% ` +
        `已达/超过走廊上界。${slowdownLevers}这是非阻断提示,不替你决策。`,
      kind: 'throttle',
    };
  }
  if (data.verdict === 'accelerate') {
    // ccm 在 n>1 且 5h 临界 + 7d 有余量时给 switch_account lever（「切到下一份配额」）；否则是欠用加速。
    const wantsSwitch = levers.includes('switch_account');
    if (wantsSwitch) {
      return {
        warn:
          `[cc-master pacing] 账户 5h 配额临界(权威口径,来自 status-line 捕获):5h ${p5}% 已达/超过阈值。` +
          `你声明了 ${nAcct} 份可序列消费的配额且 7d 总闸仍有余量(7d 仅 ${p7}%)——当前账号这份 ` +
          `5h 烧满是**切到下一份配额**的触发信号,不是减速信号:理想是把这份烧满后顺势用下一份满配额的 5h 窗,` +
          `而非在总配额还有余时减速空耗。切换/续派由你的认知判断;这是非阻断提示,不替你决策。`,
        kind: 'switch',
      };
    }
    // 欠用侧加速。
    const nAcctNote =
      nAcct > 1
        ? `(按 ${nAcct} 份可序列消费的配额理想节奏,此刻本该烧得更多——欠用判定线已据此抬高)`
        : '';
    return {
      warn:
        `[cc-master pacing] 账户配额欠用(权威口径,来自 status-line 捕获):5h 仅用 ${p5}%${nAcctNote}、` +
        `窗口临近 reset(7d 总闸余量充足,仅 ${p7}%)。当前窗口的配额若不用将随 reset 白白蒸发——` +
        `可考虑加速以充分利用。加速杠杆(怎么加速是你的认知判断,见 orchestrating-to-completion / pacing-and-estimation ` +
        `的加速侧 lever):① 把临界路径节点升到更强的模型档以提质提速;② 提并发 WIP、把已就绪的高 float 任务提前派发;` +
        `③ 把原计划 defer 到下一窗口的就绪工作拉进本窗口。注意:加速须先过 7d 总闸(别把 5h 余量烧成 7d 透支);` +
        `且这不是制造 busywork——没有真正就绪的活就别硬凑。这是非阻断提示,不替你决策。`,
      kind: 'underuse',
    };
  }
  return null; // hold → 走廊内 → 静默
}

// ── LBHOOK helpers：换号冷却 sidecar + 机械调 ccm account switch（token-blind·失败必降级）──────────────────
// switchCooldownSec() → 冷却秒数。缺/空（unset）→ 默认 1800；显式 '0' → 0（关冷却·honor）；非数/负 → 默认。
//   **必须先判空串**：Number('') === 0（JS footgun·同 parseBudget 的 `if (!raw)` 模式），否则 unset 会塌成 0 = 永不冷却。
function switchCooldownSec() {
  if (!SWITCH_COOLDOWN_RAW) return 1800; // unset → 默认 30min
  const n = Number(SWITCH_COOLDOWN_RAW);
  return Number.isFinite(n) && n >= 0 ? n : 1800; // 显式 0 honor；垃圾 → 默认
}
// switchCooldownRemainingSec(file, nowMs, cooldownSec) → 距冷却结束的剩余秒（>0 = 仍在冷却·不再自动切）。
//   读 hook 自管 sidecar { last_switch_at_ms }。缺/坏/无字段 → 0（不冷却·允许切）。纯只读、fail-silent。
function switchCooldownRemainingSec(file, nowMs, cooldownSec) {
  let obj;
  try {
    obj = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_e) {
    return 0; // 无 sidecar / 坏 JSON → 不冷却
  }
  const at = obj && typeof obj.last_switch_at_ms === 'number' ? obj.last_switch_at_ms : null;
  if (at === null) return 0;
  const remain = cooldownSec - (nowMs - at) / 1000;
  return remain > 0 ? remain : 0;
}
// recordSwitchAt(file, nowMs) → 切号成功后落冷却时间戳（hook sidecar·非 board·非密只有时间戳）。fail-silent
//   （写失败只是下次可能提前再切·非致命；绝不为它 throw 污染 Stop）。
function recordSwitchAt(file, nowMs) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ last_switch_at_ms: nowMs })}\n`);
  } catch (_e) {
    /* fail-silent */
  }
}
// parseSwitchJson(stdout) → ccm account switch 的 jsonOk data（{ email, switched, … }）或 null。
//   switch 的 stdout 是「人类成功行 + 一行 jsonOk」混排（ctx.out 两条都到 stdout）→ 整体非合法 JSON，故**逐行**
//   扫描首个能 JSON.parse 的对象，解包 .data（jsonOk = {ok:true,data:{…}}·io.ts）。非密（只取 email/switched）。
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
// attemptCcmSwitch(boardPath, homeDir, rateCache) → { outcome, email }。机械调 `ccm account switch --json
//   --home <home> --board <boardPath>`（透传 CC_MASTER_HOME / CC_MASTER_RATE_CACHE 让 ccm 读同一 registry /
//   切出快照 sidecar）。**token-blind**：换号在 ccm 子进程·hook 只读非密 JSON。退出码 → outcome 映射
//   （account.ts SWITCH_EXIT）：0+switched → 'switched'；7 → 'denied'（board.policy=deny 硬闸）；3 → 'exhausted'
//   （全池逼顶·无可切入号）；ENOENT/spawn 抛/error → 'absent'（ccm 不在·优雅降级）；其余（含 0 但未确认 switched·
//   如 stub 空输出 / 信号）→ 'failed'。任何分支都不 throw（调用方据 outcome 决定注入·绝不污染 Stop）。
function attemptCcmSwitch(boardPath, homeDir, rateCache) {
  const args = ['account', 'switch', '--json', '--home', homeDir, '--board', boardPath];
  const env = Object.assign({}, process.env, { CC_MASTER_HOME: homeDir });
  if (rateCache) env.CC_MASTER_RATE_CACHE = rateCache;
  let r;
  try {
    r = spawnSync(CCM_BIN, args, { encoding: 'utf8', timeout: SWITCH_TIMEOUT_MS, env });
  } catch (_e) {
    return { outcome: 'absent', email: null }; // spawn 本身抛（极少）→ 视为 ccm 不在
  }
  if (!r || r.error) return { outcome: 'absent', email: null }; // ENOENT（ccm 不在 PATH）→ 优雅降级
  if (r.signal) return { outcome: 'failed', email: null }; // 被信号杀（如超时）→ 未确认切号
  const code = typeof r.status === 'number' ? r.status : 1;
  const data = parseSwitchJson(r.stdout);
  const email = data && typeof data.email === 'string' ? data.email : null;
  const switched = !!(data && data.switched === true);
  if (code === 0 && switched) return { outcome: 'switched', email };
  if (code === 0) return { outcome: 'failed', email }; // exit 0 但未确认 switched → 不当成功（保守）
  if (code === 7) return { outcome: 'denied', email }; // board.policy 机制硬闸 deny（ADR-016 §2.2）
  if (code === 3) return { outcome: 'exhausted', email }; // 全池逼顶·无可切入号
  return { outcome: 'failed', email }; // 1/4/其它 → 换号未干净完成
}

// ── ③ PostToolBatch 中途采样 helpers（band / 节流 sidecar / 轻路径 body）────────────────────────────────
// 中途采样比 Stop 高频得多（一回合多次大 fan-out）。裸采样 = 通知风暴 + 「狼来了」稀释（违 ADR-018 P2）。必须
//   节流：注入 ⟺（A 跨阈值升档）OR（B 距上次中途注入满冷却且仍在临界带以上）。先做廉价本地预闸（readRateCache
//   算 band·零 spawn），只在该注入时才 spawn `ccm usage advise`。**中途只报临界侧（throttle/hard_stop）不报
//   underuse**（欠用是慢信号·轮末 Stop 报足够·中途催加速无额外价值且增噪）。**不含 autoswitch**（换号留 Stop-only·
//   §1.5：换号是带网络 POST 的重操作·放高频 PostToolBatch 会卡批解析后流程）。

// pacingSampleCooldownSec() → 冷却秒（unset → 900=15min；显式 0 honor；垃圾 → 默认）。先判空串（footgun）。
function pacingSampleCooldownSec() {
  if (!PACING_SAMPLE_COOLDOWN_RAW) return 900; // unset → 默认 15min
  const n = Number(PACING_SAMPLE_COOLDOWN_RAW);
  return Number.isFinite(n) && n >= 0 ? n : 900; // 显式 0 honor；垃圾 → 默认
}

// bandOf(acct, floor, gate) → 'normal' | 'throttle' | 'hard_stop' | null。从账户权威 sidecar 算「带」（廉价
//   本地预闸·零 spawn）。p7≥gate（默认 85）→ hard_stop（7d 跨窗口硬总闸·最高）；p5≥floor（默认 85·窗口仍有效）
//   → throttle；否则 normal。账户口径不可用（缺/坏/空/无 5h+7d 信号）→ null（中途采样宁可漏报不刷屏·与 Stop
//   「失败必静默」同纪律·中途不走本地反推 computeFiveHour——反推 remain 会失真到数量级·据此中途催减速也不可信）。
function bandOf(acct, nowSec, floor, gate) {
  if (!acct || typeof acct !== 'object') return null;
  const p5 = pctOf(acct.five_hour);
  const p7 = pctOf(acct.seven_day);
  if (p5 === null && p7 === null) return null; // 账户信号不可用 → 中途静默
  const f = acct.five_hour;
  const fhValid = p5 !== null && (typeof f.resets_at !== 'number' || f.resets_at > nowSec);
  if (p7 !== null && p7 >= gate) return 'hard_stop'; // 7d 硬总闸（跨窗口·最高带）
  if (fhValid && p5 >= floor) return 'throttle'; // 5h 临界（窗口仍有效）
  return 'normal';
}
// bandRank(b) → 数值序（normal<throttle<hard_stop）供「严格升档」比较。未知 → -1。
function bandRank(b) {
  return b === 'hard_stop' ? 2 : b === 'throttle' ? 1 : b === 'normal' ? 0 : -1;
}
// readSampleState(file) → { last_inject_at, last_band, window_resets_at } 或 {}（缺/坏 → 空·首次按未注入）。
function readSampleState(file) {
  try {
    const o = JSON.parse(fs.readFileSync(file, 'utf8'));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch (_e) {
    return {};
  }
}
// writeSampleState(file, state) → 落节流状态（fail-silent·写失败只是下次可能提前再注·非致命·绝不 throw 污染批）。
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
  if (band === null) return; // 账户信号不可用 → 中途静默（宁可漏报不刷屏）

  // ── 窗口重置：5h resets_at 翻新（新窗口）→ 清 last_band 记忆（band 从 normal 重新计，否则跨窗口残留压制升档）──
  const state = readSampleState(PACING_SAMPLE_FILE);
  const f = acct.five_hour;
  const curResetsAt = f && typeof f.resets_at === 'number' ? f.resets_at : null;
  let lastBand = typeof state.last_band === 'string' ? state.last_band : 'normal';
  let lastInjectAt = typeof state.last_inject_at === 'number' ? state.last_inject_at : 0;
  const prevResetsAt =
    typeof state.window_resets_at === 'number' ? state.window_resets_at : null;
  if (curResetsAt !== null && prevResetsAt !== null && curResetsAt !== prevResetsAt) {
    lastBand = 'normal'; // 新窗口 → 清 band 记忆
    lastInjectAt = 0; // 新窗口 → 清冷却（首次升档不被旧冷却压制）
  }

  // ── 节流判据：注入 ⟺（A 跨阈值升档·band 严格高于 last_band）OR（B 距上次中途注入满冷却且仍在临界带以上）──
  // 中途只报临界侧（throttle/hard_stop）。normal 带永不出声（也据此刷新 band 记忆以便下次升档可被检出）。
  const isCritical = band === 'throttle' || band === 'hard_stop';
  const escalated = bandRank(band) > bandRank(lastBand); // A·跨阈值升档
  const cooldownSec = pacingSampleCooldownSec();
  const cooledDown = nowSec - lastInjectAt >= cooldownSec; // B·满冷却
  const shouldInject = isCritical && (escalated || cooledDown);

  if (!shouldInject) {
    // 不注入：仍刷新 band / window 记忆（让下次升档检测准确·非临界带也要记 band·否则升档无基线）。
    writeSampleState(PACING_SAMPLE_FILE, {
      last_inject_at: lastInjectAt,
      last_band: band,
      window_resets_at: curResetsAt,
    });
    return;
  }

  // ── 该注入了：才（可选）spawn `ccm usage advise` 取权威 verdict 文案（ccm spawn 被绑定到实际注入·罕见）──
  // num_account（effective-N）：与 Stop 路径同源（registry·零 spawn）。
  const numAccount = readNumAccount(ACCOUNTS_FILE, nowMs) || 1;
  let warning = null;
  let kind = band; // 默认用本地算的 band 当 kind（throttle/hard_stop·PACING_STRENGTH 都 strong）
  const ccmAdvice = adviseViaCcm(HOME_DIR, RATE_CACHE, numAccount);
  if (ccmAdvice) {
    const r = ccmWarning(ccmAdvice, numAccount); // ccm verdict → 文案 + kind
    // 中途只报临界侧：ccm 的 underuse/switch（accelerate 侧）→ 中途丢弃（不报欠用加速·§1.4 方向性）。
    if (r && (r.kind === 'throttle' || r.kind === 'hard_stop')) {
      warning = r.warn;
      kind = r.kind;
    }
  }
  if (!warning) {
    // ccm 不可用 / 给的是非临界 verdict → 用本地账户权威路径出临界文案（decideAccountWarning·只取临界侧）。
    const a = decideAccountWarning(acct, nowSec, floor, numAccount, gate);
    if (a.valid && a.warn && (a.kind === 'throttle' || a.kind === 'hard_stop')) {
      warning = a.warn;
      kind = a.kind;
    }
  }
  if (!warning) {
    // 极少：band 判临界但 decideAccountWarning 未出临界文案（floor/gate 口径细微差）→ 刷记忆后静默（不硬编文案）。
    writeSampleState(PACING_SAMPLE_FILE, {
      last_inject_at: lastInjectAt,
      last_band: band,
      window_resets_at: curResetsAt,
    });
    return;
  }

  // ── 落节流状态（注入这一刻·刷 last_inject_at + band + window）+ 拼中途语境 advisory ─────────────────────
  writeSampleState(PACING_SAMPLE_FILE, {
    last_inject_at: nowSec,
    last_band: band,
    window_resets_at: curResetsAt,
  });
  const midPrefix =
    '[回合中途采样] 以下是回合中途的提前预警（非轮末 Stop）——便于你在本回合后续派发前就调整配速；' +
    '非阻断提示，不替你决策。';
  const strength = pacingStrengthOf(kind); // throttle/hard_stop → strong
  return {
    additionalContext: advisory('usage-pacing', strength, `${midPrefix} ${warning}`),
  };
}

// ── body：plumbing（stdin/home/isArmed 武装/fail-silent/exit 0）由 hook-common.runHook 提供（phase-1b）；
//   body 只剩 usage-pacing 独有的「读 usage / 走廊 verdict / 拼 pacing advisory + 号池 ambient」。
//   · stop_hook_active 重入闸放 preGate（须比武装更早静默）；· armed gate 由 harness arm:'isArmed' 统一做。
//   · 输出经 harness { additionalContext } 形态（JSON.stringify+'\n'·event 'Stop'）——与原 main 末尾的
//     `JSON.stringify(payload)+'\n'` 字节等价；本 body 返回 { additionalContext: blocks.join('\n') }。
//   · sid 由 harness 经 ctx 传入（armed gate 已在 harness 内据它判定）；HOME_DIR / 各 env override 仍用模块级
//     常量（HOME_DIR === ctx.homeDir === resolveHome()，同值，arming 与计算一致）。
//   ★多事件（hooks-enhancements-v2 ③）：本文件同时挂 Stop + PostToolBatch。下面 dispatchBody 据 hook_event_name
//     分流——Stop → stopBody（完整路径·含 LBHOOK 换号 + 完整 advisory + underuse + 号池 ambient）；PostToolBatch →
//     sampleBody（中途采样轻路径·只报临界侧·不换号·节流）。
function stopBody(ctx) {
  const sid = ctx.sid;

  const nowMs = NOW_OVERRIDE ? parseIso(NOW_OVERRIDE) : Date.now();
  if (nowMs === null) return; // --now 非法 → 静默（不猜）

  // num_account（need ①）：**A2 T6 来源迁移**——从号池 registry accounts.json 算 effective-N（非 active 且
  //   token 未过期的可切入备号数 + 1），不再读 board top-level num_account（已砍 --num_account）。env 覆写优先
  //   （测试）；无 registry / 空池 / 坏 JSON → 1（天然单账号）。读 accounts.json 是正交于 board 的只读（红线 2）、
  //   纯 JSON.parse 零 spawn（红线 1）、在 armed gate 之后（红线 6）。同时拿号池粗粒度事实供下面注入。
  const accounts = readRegistryAccounts(ACCOUNTS_FILE);
  const pool = poolStatus(accounts, nowMs);
  const numAccount = readNumAccount(ACCOUNTS_FILE, nowMs) || 1;

  // ── P4 收口：走廊 verdict 优先经 ccm 引擎（pacing.ts SSOT）算 ──────────────────────────────────────
  // adviseViaCcm shell 调 `ccm usage advise --json`（透传 home / rate-cache / effective-n）。ccm present
  //   且给出权威走廊判定（available:true）→ **以 ccm verdict 为准**（hard_stop/throttle/accelerate → 映射成
  //   本 skill 词汇的提示;hold → 静默）。ccm 不可用（ENOENT / 失败 / 坏 JSON / available:false）→ ccmAdvice
  //   为 null → 落到下面既有的本地计算路径（account-authoritative sidecar + 本地反推），绝不丢失提示能力。
  let warning;  // pacing warning 主体文案（字符串）或空（静默）
  let kind;     // ADR-018 strength 映射用 kind（hard_stop|throttle|switch|underuse）
  const ccmAdvice = adviseViaCcm(HOME_DIR, RATE_CACHE, numAccount);
  if (ccmAdvice) {
    const r = ccmWarning(ccmAdvice, numAccount); // hold → null（静默）；其余 → { warn, kind }
    if (r) { warning = r.warn; kind = r.kind; }
  } else {
    // ── 本地降级路径（ccm 不可用时）：account-authoritative override (Finding #37) + 本地反推 ──
    // 优先用 status-line 捕获的账户权威 5h/7d used_percentage 判墙(脱钩会失真到数量级的本地反推
    //   window_remaining_min),并纳入 7d。账户口径权威——可用就以它为准(到墙警告/没到就静默),
    //   只有 sidecar 缺/坏时才降级本地反推(approx)。
    const floor = parsePctFloor(PCT_FLOOR_RAW);
    const dispatchGate = parseSevenDayDispatchGate(SEVEN_DAY_DISPATCH_GATE_RAW); // need ②:7d≥此 → 升级到「暂停 dispatch」
    const acct = readRateCache(RATE_CACHE);
    const nowSec = Math.floor(nowMs / 1000);
    const a = decideAccountWarning(acct, nowSec, floor, numAccount, dispatchGate);
    if (a.valid) {
      // 账户口径权威。撞墙优先：到墙就只发减速提示（a.warn 非空）；没到墙再问欠用 → 可能发对称的加速提示。
      // 撞墙(used%≥85)与欠用(used%<60)区间天然互斥，account 分支里同一 Stop 绝不同发两条。
      if (a.warn) { warning = a.warn; kind = a.kind; }
      else {
        const u = decideAccountUnderuse(acct, nowSec, numAccount);
        if (u.warn) { warning = u.warn; kind = u.kind; }
      }
    } else {
      // 账户不可用 → 本地反推 fallback(approx)：维持现状只做撞墙判定。**本地反推路径禁欠用提示**——反推的
      // reset 倒计时会失真到数量级（Finding #37），据此催加速会乱催，故此路径不出欠用提示。
      const fh = computeFiveHour(USAGE_DIR, nowMs);
      warning = decideWarning(fh); // 本地反推只出撞墙减速 → kind throttle
      if (warning) kind = 'throttle';
    }
  }
  if (!warning) return; // 余量充足 / 无数据 / 降级判定不临界 → 静默 exit 0

  // ── LBHOOK：kind==='switch'（5h 配额临界 + n>1 + 7d 有余量 + 有可切入备号）→ 机械调 ccm account switch ──────
  // 这是 LOADBAL §3.2 ① 水位触发已在 pacing 决策里成立的点：与其只把「换号 lever」advisory 给 agent，**hook
  //   机械执行换号**（设计 §1·agent 不做切号决策）。门控（hook 侧·token-blind）：① AUTOSWITCH 未被 kill；
  //   ② 确有可切入备号（pool.switchable≥1·env num_account 这种无真实备号的标量不触发）；③ **目标板唯一**
  //   （ctx.boards 恰 1 块·多块 active 时板上下文歧义 → 保守不自动切、退回 advisory·避免对错板的 policy 切号）；
  //   ④ 不在冷却内（防 statusline 未刷新导致的全池抖动）。能不能切 / 切哪个 / policy 都委托 ccm（见 attemptCcmSwitch）。
  let switchAmbient = null; // 成功换号后的 ambient 文案（替代 advisory 主体·切号已机械完成、agent 只调配速）
  let switchNote = ''; // deny/exhausted 时附到 advisory 尾部的说明（surface 给用户）
  let switchStrength = null; // deny → 升 strong（surface 用户·高 stakes）；否则沿用 kind 的 strength
  if (
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
        recordSwitchAt(SWITCH_STATE_FILE, nowMs); // 落冷却·防下一 Stop 抖动
        const after = poolStatus(readRegistryAccounts(ACCOUNTS_FILE), nowMs); // 切号后号池现状
        switchAmbient =
          `[号池·已自动换号] usage-pacing 在 5h 配额临界(权威口径)机械切到下一份配额` +
          `${res.email ? `(当前 active = ${res.email})` : ''}——配额随新号满血 5h 窗恢复;号池现剩 ` +
          `${after.switchable} 个可切入备号。据此调你的配速 / 派发规模(怎么调是你的认知判断,见 ` +
          `orchestrating-to-completion / pacing-and-estimation);切号本身已机械完成(token-blind·在 ccm 子进程),不需你再操作。`;
      } else if (res.outcome === 'denied') {
        // board.policy.autonomous_account_switch=deny 机制硬闸拦下（ADR-016 §2.2）→ 不自主切·surface 给用户。
        switchNote =
          ` 注:本板 policy.autonomous_account_switch=deny,机制层(ccm)已拒绝自主换号(exit 7)——把「是否换号」作 ` +
          `blocked_on:"user" surface 给用户;经用户 'ccm policy set --autonomous-account-switch=allow --user-authorized' ` +
          `授权后才会自主切(绝不自授权·ADR-016 §2.5)。`;
        switchStrength = 'strong';
      } else if (res.outcome === 'exhausted') {
        // 全池逼顶·无可切入号（ccm exit 3）→ surface 给用户（等 reset 还是别的·用户拍）。
        switchNote =
          ` 注:号池所有可切入备号都已逼顶 / 不可用(ccm exit 3·NONE_ALL_EXHAUSTED)——无可切入号,把「等 reset 还是别的」` +
          `作 blocked_on:"user" surface 给用户。`;
      }
      // failed / absent（ccm 不在 / 未确认切号）→ 无 note·落回既有 advisory（等同未接 LBHOOK 的旧「换号 lever」行为·优雅降级）。
    }
  }

  // ── ADR-018 标签包装 ─────────────────────────────────────────────────────────────────────────────
  // 成功机械换号 → 整条注入降为一块 ambient（切号已完成·只更新世界模型 + 调配速·无 action·§13 池/配额事实归 ambient）。
  // 否则 → pacing warning 主体仍是 advisory（喂判断·strength 按 kind 配 stakes；deny 升 strong·surface 用户）+ 号池 ambient。
  let blocks;
  if (switchAmbient) {
    blocks = [ambient('usage-pacing', switchAmbient)];
  } else {
    const strength = switchStrength || pacingStrengthOf(kind); // kind 缺（极少·防御）→ 默认 weak（P2）
    blocks = [advisory('usage-pacing', strength, warning + switchNote)];
    // ── 号池粗粒度事实注入（A2 T6 §F）→ ambient（§13:池/配额事实归 ambient·塑模型·无 action）──────────────
    // pacing 已出声且号池有可切入备号（switchable≥1）→ 附一块号池**粗粒度事实**，让编排者知道「换号」lever 可用
    //   （LBHOOK 关 / deny / cooldown / 多板等没机械切的路径下，这条仍告知 agent 换号是 surface 给用户的可选项）。
    //   ADR-018 ambient（事实告知·不替决策）；无号池 / 无可切入备号 → 不附。armed gate 之后（红线6）、纯读 accounts.json（红线1/2）。
    if (pool.switchable >= 1) {
      const poolFact =
        `[号池] 你有 ${pool.backups} 个备号(其中 ${pool.switchable} 个 token 未过期、可切入)——` +
        `配额逼顶时「换号」是一个可用的 pacing lever:切到一份恢复更多的配额。换号机制由 ccm account switch 机械执行` +
        `(选号 + 切换 + policy 硬闸都在 ccm·token-blind);切不切的决策 / 配速由你的认知判断,这是事实告知,不替你决策。`;
      blocks.push(ambient('usage-pacing', poolFact));
    }
  }

  // 非阻断注入：仅 additionalContext，hookEventName "Stop"。绝不 decision:block。
  // harness 据 { additionalContext } 套 envelope（JSON.stringify+'\n'·event 'Stop'）——与原手写 payload 字节等价。
  return { additionalContext: blocks.join('\n') };
}

// ── dispatchBody：据 hook_event_name 分流 Stop（完整路径）/ PostToolBatch（中途采样轻路径）──────────────
//   两事件都已过 harness 的 arm:'boards' 武装闸（红线6）+ 下面 preGate 的早退（Stop 重入 / sub-agent）。
//   未知/缺事件 → 保守走 Stop 路径（向后兼容·历史只挂 Stop）。
function dispatchBody(ctx) {
  const ev = ctx.obj && typeof ctx.obj.hook_event_name === 'string' ? ctx.obj.hook_event_name : '';
  if (ev === 'PostToolBatch') return sampleBody(ctx);
  return stopBody(ctx); // Stop（或缺事件名·向后兼容）
}

// runHook（多事件·hooks-enhancements-v2 ③）：本文件同时登记到 hooks.json 的 Stop + PostToolBatch 两个数组。
//   · event 为函数 → envelope 的 hookEventName 与实际触发事件一致（Stop / PostToolBatch）。
//   · arm:'boards'（armed gate 统一在 harness·未武装静默·红线6）——额外把匹配 active 板放进 ctx.boards 供
//     Stop 路径 LBHOOK 透传 --board（中途采样不换号·不依赖它）。
//   · preGate（武装之前的早退·两事件各自的最早静默点）：
//       ① Stop 重入闸：stop_hook_active:true ⟺ Claude Code 因「上次 Stop hook 续了对话 → 再次 Stop」重入 →
//          立即静默（否则 usage 仍超预算时每次 Stop 重注同一警告·等同 session 停不下来·违 never-blocks）。
//       ② PostToolBatch sub-agent 闸（红线4）：PostToolBatch 在 sub-agent 上下文也触发·stdin 带顶层 agent_id
//          （主线缺席）→ 静默早退（指挥专属 pacing 绝不泄漏给 leaf worker·与 posttool-batch.js 同口径）。
//   全程 try/catch + exit 0 由 harness 保证（hook 崩绝不污染 Stop / 批解析）。
runHook({
  event: (ctx) =>
    ctx.obj && ctx.obj.hook_event_name === 'PostToolBatch' ? 'PostToolBatch' : 'Stop',
  arm: 'boards',
  preGate(ctx) {
    const o = ctx.obj || {};
    // ① Stop 重入闸（只在 Stop 事件相关·stop_hook_active 仅 Stop 带）。
    if (o.stop_hook_active === true) return true;
    // ② PostToolBatch sub-agent 闸：只认带引号的字符串 agent_id（"agent_id":null / 缺 → 主线 → 不早退）。
    if (typeof o.agent_id === 'string' && o.agent_id) return true;
    return false;
  },
  body: dispatchBody,
});
