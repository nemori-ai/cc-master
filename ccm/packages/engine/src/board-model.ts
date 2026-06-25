// board-model.ts — board v2 数据模型 keystone（单一真相源 SSOT·ADR-013 §2.2 / spec §9）。
//
// 这是整个 board v2 的根 SSOT：把「散落在 lint 内联硬编码 / hook bash 串解析 / viewer 各自约定」里的
//   **声明性事实**——枚举、字段六要素元数据、不变式注册表（id/级别/家族）、status 状态机、跨消费者共享
//   谓词——收口到一处定义。lint / graph / CLI / viewer 全部从这一份派生（把现有「buildGraph 当图 SSOT」
//   的半步，从图算法推广到整个 board 的「什么是合法数据 / 哪些字段 load-bearing / 规则是 hard 还是 warn」）。
//
// 边界（与 board-lint-core / board-graph-core 的分工）：
//   · board-model     = 「数据是什么 + 什么合法」的**声明**（enums / 字段元数据 / 不变式目录 / 状态机 / 谓词）。
//   · board-lint-core = 「校验 + 规范图构建」（buildGraph SSOT + 逐规则实现 + 丰富报错；level 从本文件读）。
//   · board-graph-core= 「图分析」（CPM / float / 并行度，require buildGraph）。
//   本文件**不含图算法**（buildGraph/findCycle 仍在 lint-core，graph-core 复用），只含声明与纯谓词。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖、纯 stdlib（连 fs 都不用——只导出常量与纯函数）。
// 红线2：本文件**只声明、不回写**；真正受红线2 保护的仍只是 🔒 load-bearing 子集（FIELDS 里标注），
//   ✎ flexible 字段仍 agent 自由 + silent-on-unknown。本文件把「哪些是 🔒」显式化，而非隐式只定义一小撮。
//
// T1 port 注：原 CJS 源的 UMD/IIFE 双形态尾（module.exports / globalThis.__ccmBoardModel）已删除，
//   换成正经 ESM 命名导出。逻辑、数值、正则、文案逐字保持（零行为变化）。浏览器形态由 tsdown 的 IIFE
//   产物（globalThis.__ccmEngine）承接。

// ── schema 版本锚（窄腰版本协议；v1→v2 大改·spec §1）──────────────────────────────────────────────
export const SCHEMA_VERSION = 'cc-master/v2';

// ── ENUMS：全部命名枚举一处定义（spec §3.2 / §4 / §2.2）。值为有序数组（可文档化、可 JSON）；
//   膜拜成员判定经内部 Set（isEnumMember）。改任一枚举只此一处，lint/graph/CLI/viewer 全同步。
export const ENUMS = {
  // status：task 状态机的 8 个值（与 STATUS_MACHINE 对齐）。verified 是与 status 正交的布尔，非 status 值。
  status: ['ready', 'in_flight', 'blocked', 'done', 'escalated', 'failed', 'stale', 'uncertain'],
  // executor：执行者类型（取代 v1 mechanism+assignee）。external = 外部第三方（#31）；shell/manual 已被前几类覆盖。
  executor: ['user', 'master-orchestrator', 'subagent', 'workflow', 'external'],
  // taskType：任务类型（**开放可扩展**·见 OPEN_ENUMS；未知值 lint warn 不 fail）。
  taskType: [
    'design',
    'planning',
    'development',
    'development-demo',
    'acceptance',
    'e2e-integration',
    'doc-alignment',
    'pr',
  ],
  // role：调度角色。fill-work = 临界路径等待窗口里的填充工作。
  role: ['normal', 'fill-work'],
  // refKind：references 条目类别（**开放**）。ref 本身 = 绝对路径或 URL（禁相对·FMT-REF）。
  refKind: ['spec', 'plan', 'doc', 'web', 'code', 'issue', 'other'],
  // askType：decision_package 采访姿态。
  askType: ['decision', 'advice', 'solution'],
  // logKind：审计轨迹条目类别。
  logKind: ['dispatch', 'recon', 'verify', 'finding', 'decision', 'replan', 'handoff', 'note'],
  // judgment_calls 三枚举（自决诚实台账·spec §4.2）。
  jcCategory: ['architecture', 'drift', 'spec-impl-misalignment', 'other'],
  jcSeverity: ['low', 'medium', 'high', 'critical'],
  jcStatus: ['pending_review', 'upheld', 'overturned'],
  // cadence iteration 状态（spec §4.3）。
  iterationStatus: ['open', 'shipped'],
  // watchdog 自我唤醒机制（ADR-011 降级链）。
  watchdogMechanism: ['cron', 'loop', 'monitor', 'shell'],
  // acceptance 目标函数 criterion 的 kind / status（spec §4.1）。
  acceptanceKind: ['test', 'metric', 'manual', 'review'],
  acceptanceStatus: ['pending', 'met', 'failed'],
} satisfies Record<string, string[]>;

// 枚举名（ENUMS 的 key）——isEnumMember 的 name 形参类型。
export type EnumName = keyof typeof ENUMS;

// 开放枚举集合：这些枚举允许未知值（lint 出 warn 而非 hard error），为未来扩展留口（spec §3.2）。
export const OPEN_ENUMS = ['taskType', 'refKind'];

// 内部 Set 缓存（快速成员判定）。
const _ENUM_SETS: Record<string, Set<string>> = {};
for (const k of Object.keys(ENUMS)) _ENUM_SETS[k] = new Set(ENUMS[k as EnumName]);

// isEnumMember(name, value) → value 是否是命名枚举 name 的合法成员。
export function isEnumMember(name: string, value: unknown): boolean {
  const s = _ENUM_SETS[name];
  return s ? s.has(value as string) : false;
}

// ── TIERS：三档（narrow-waist 演进·ADR-013 §2.1）。🔒 红线2 真正保护的子集；👁 hook 若有则用、缺则降级；
//   ✎ agent 自由 + silent-on-unknown。
export const TIERS = { LOAD_BEARING: '🔒', OBSERVED: '👁', FLEXIBLE: '✎' };

// 字段六要素元数据。
export interface FieldMeta {
  tier: string;
  type: string;
  default: string;
  readers: string;
  writers: string;
  when: string;
  degrade: string;
}

// ── FIELDS：完整字段元数据（「完整建模」SSOT·每字段六要素：tier·type·default·readers·writers·when·degrade）。
//   default 是**缺省语义**的文字描述（非运行时实际默认值——那由 CLI mutation 应用）。这一份喂：CLI help、
//   viewer 字段说明、文档生成、generic 形状校验的入口。spec §2.2（board）+ §3.1（task）的机器可读镜像。
export const FIELDS = {
  board: {
    schema: {
      tier: '🔒',
      type: 'string("cc-master/v2")',
      default: '必填',
      readers: 'lint + content 契约 + resume 选板',
      writers: 'bootstrap',
      when: '建板',
      degrade: 'hard error(FMT-SCHEMA)',
    },
    meta: {
      tier: '✎',
      type: 'object{template_version:int, created_at?:ISO}',
      default: '{template_version:N}',
      readers: 'viewer timeline 版本门',
      writers: 'bootstrap / agent 经 CLI',
      when: '建板 / 模板升级',
      degrade: 'timeline 当旧板降级走拓扑轴',
    },
    goal: {
      tier: '🔒',
      type: 'string',
      default: '必填(可空串)',
      readers: 'resume 按子串选板 / viewer 顶栏',
      writers: 'agent 经 CLI',
      when: '建板 / 重定目标',
      degrade: 'hard error(FMT-GOAL)',
    },
    owner: {
      tier: '🔒',
      type: 'object{active:bool, session_id:string, heartbeat:ISO}',
      default: '必填',
      readers: '全 hook 武装闸(active/session_id) + bootstrap resume 探测(heartbeat)',
      writers: 'bootstrap + 活 session 每回合 flush heartbeat',
      when: '建板 / 每回合',
      degrade: 'active·session_id 缺→hard;heartbeat 非 ISO→warn(FMT-TIME)',
    },
    git: {
      tier: '🔒',
      type: 'object{worktree?:string, branch?:string}',
      default: '必填(子字段可空)',
      readers: 'viewer 渲染 branch/worktree',
      writers: 'agent 经 CLI / bootstrap',
      when: '建板 / 换 worktree',
      degrade: '对象缺 hard;子字段非 string hard(FMT-GIT)',
    },
    scheduling: {
      tier: '👁',
      type: 'object{wip_limit:int, owner_wip_limit?:int}',
      default: '缺省(对应警告静默关)',
      readers: 'posttool-batch 两级 WIP 软警告',
      writers: 'agent 经 CLI',
      when: '调 WIP cap',
      degrade: '缺→对应警告静默关闭(graceful);非数字→warn(FMT-SCHEDULING)',
    },
    watchdog: {
      tier: '👁',
      type: 'object{armed_at, fire_at, mechanism, job_id, checklist} | null',
      default: '缺省(无 watchdog)',
      readers: 'verify-board 到点/缺失提醒 + 过期 self-heal',
      writers: 'agent 经 CLI(arm / 退役)',
      when: 'arm 自我唤醒 / 退役',
      degrade: '缺→提醒按需注入;退役须删整对象(不留残骸);fire_at 非 ISO→warn',
    },
    tasks: {
      tier: '🔒',
      type: 'array<task>',
      default: '必填([] 合法)',
      readers: 'goal-hook 数状态 / viewer 整图 / resume 重建',
      writers: 'agent 经 CLI',
      when: '拆解 / 推进',
      degrade: '非数组 hard(FMT-TASKS)',
    },
    log: {
      tier: '✎',
      type: 'array<{ts, summary, kind?, task?, detail?, refs?}>(append-only)',
      default: '[]',
      readers: 'viewer activity 流',
      writers: 'agent 经 CLI(只增不改不删)',
      when: '每事件',
      degrade: '空数组合法;坏条目→warn(FMT-LOG)',
    },
    judgment_calls: {
      tier: '👁',
      type: 'array<judgment_call>',
      default: '缺省(无)',
      readers: '回前台 hook 按 severity 告知(high/critical 必显眼)',
      writers: 'agent 经 CLI',
      when: '自决重大事项时',
      degrade: '缺/空→无告警;形状坏→warn(FMT-JUDGMENT-CALLS)',
    },
    cadence: {
      tier: '👁',
      type: 'object{target?, iterations?}',
      default: '缺省(无节奏约束·纯 DAG)',
      readers: 'Stop-block 收口逼 + CLI 拆解校验',
      writers: 'agent 经 CLI',
      when: '定节奏 / 开收 iteration',
      degrade: '缺→无 cadence 牙齿;iteration 形状坏→warn(FMT-CADENCE)',
    },
    baseline: {
      tier: '✎',
      type: 'object{captured_at:ISO, t0:ISO, task_estimates:{<id>:{value:number,unit:string}}, dag_snapshot:{<id>:{deps:[]}}, bac_h:number, history:[{reset_at:ISO, note:string?, bac_h:number, task_estimates_snapshot:{}}]}?',
      default: '缺省(无 baseline)',
      readers: 'estimate evm / baseline show',
      writers: 'baseline snapshot / reset',
      when: 'EVM 基线拍摄时',
      degrade: '缺→无 EVM baseline；形状坏→warn(FMT-BASELINE)',
    },
  },
  task: {
    id: {
      tier: '🔒',
      type: 'string',
      default: '必填(非空唯一)',
      readers: 'viewer 建节点 key / goal-hook 计数 / deps·parent 引用',
      writers: 'agent 经 CLI',
      when: '建 task',
      degrade: 'hard error(FMT-ID / FMT-ID-UNIQUE)',
    },
    status: {
      tier: '🔒',
      type: 'enum:status',
      default: '必填',
      readers: 'goal-hook 路由 / viewer 灯 / readySet',
      writers: 'agent 经 CLI',
      when: '状态转移',
      degrade: 'hard error(FMT-STATUS);非法转移由 STATUS_MACHINE 提示(CLI)',
    },
    deps: {
      tier: '🔒',
      type: 'string[]',
      default: '[]',
      readers: 'graph 拓扑 / readySet / viewer 边',
      writers: 'agent 经 CLI',
      when: '建 task / 重连依赖',
      degrade: '缺 / 非数组 hard(FMT-DEPS);悬挂 / 自环 / 环 hard(GRAPH-*)',
    },
    parent: {
      tier: '🔒',
      type: 'string?',
      default: '缺省=顶层节点',
      readers: 'graph parent 倒排 / rollup / viewer 分组',
      writers: 'agent 经 CLI',
      when: '嵌套子图',
      degrade: '畸形(非空串)hard(FMT-PARENT);悬挂 / 破 depth=1 / 环 hard(GRAPH-PARENT-*)',
    },
    title: {
      tier: '✎',
      type: 'string',
      default: '""',
      readers: 'viewer 卡片标题',
      writers: 'agent 经 CLI',
      when: '建 task',
      degrade: '缺→空标题',
    },
    description: {
      tier: '✎',
      type: 'string?',
      default: '缺省',
      readers: 'viewer 详情栏',
      writers: 'agent 经 CLI',
      when: '建 task',
      degrade: '缺→无描述',
    },
    acceptance: {
      tier: '✎',
      type: 'string | object{criteria:[{desc,kind?,check?,target?,measured?,status}]}',
      default: '缺省(特定 type 必须)',
      readers: 'viewer / done 真语义判定 / CLI',
      writers: 'agent 经 CLI',
      when: '建 dev 类 task',
      degrade: '特定 type 缺→warn(BIZ-ACCEPTANCE-REQUIRED);obj 则 criteria 非空(FMT-ACCEPTANCE)',
    },
    references: {
      tier: '✎',
      type: 'array<{kind, ref, note?}>',
      default: '缺省(特定 type 必须)',
      readers: 'viewer 链接 / executor 上下文',
      writers: 'agent 经 CLI',
      when: '建 dev 类 task',
      degrade: 'ref 相对路径→hard(FMT-REF);type=development 缺 spec/plan→warn(BIZ-DEV-REFS)',
    },
    created_at: {
      tier: '✎',
      type: 'ISO',
      default: '缺省',
      readers: 'viewer timeline',
      writers: 'agent 经 CLI',
      when: '建 task',
      degrade: '非 ISO→warn(FMT-TIME)',
    },
    started_at: {
      tier: '✎',
      type: 'ISO',
      default: '缺省',
      readers: 'viewer timeline / graph 时长(measured)',
      writers: 'agent 经 CLI',
      when: '起跑',
      degrade: '非 ISO→warn(FMT-TIME);in_flight 缺→warn(BIZ-TIME-ORDER)',
    },
    finished_at: {
      tier: '✎',
      type: 'ISO',
      default: '缺省',
      readers: 'viewer timeline / graph 时长(measured)',
      writers: 'agent 经 CLI',
      when: '完成',
      degrade: '非 ISO→warn(FMT-TIME);无 started 而有 finished→warn(BIZ-TIME-ORDER)',
    },
    estimate: {
      tier: '✎',
      type: 'object{value:number, unit:string}',
      default: '缺省',
      readers: 'cadence 拆解校验(estimate vs timebox) / CPM 喂时长降级',
      writers: 'agent 经 CLI',
      when: '估点',
      degrade: '缺→CPM 降级 unit;形状坏→warn(FMT-ESTIMATE)',
    },
    blocked_on: {
      tier: '✎',
      type: '"user" | <task-id>',
      default: '缺省',
      readers: 'viewer 阻塞边 / awaiting-user 判定',
      writers: 'agent 经 CLI',
      when: '阻塞时',
      degrade: '非 user 且非存在 id→warn(FMT-BLOCKED-ON)',
    },
    verified: {
      tier: '✎',
      type: 'bool?',
      default: 'false',
      readers: '端点验收 / done 真语义(P3) / viewer',
      writers: 'agent 经 CLI(端点验收后)',
      when: '验收过',
      degrade: '缺→视为未验',
    },
    executor: {
      tier: '✎',
      type: 'enum:executor',
      default: '缺省',
      readers: 'viewer / 派发 / CLI',
      writers: 'agent 经 CLI',
      when: '派发前',
      degrade: '非法值→hard(FMT-EXECUTOR);subagent/workflow 缺 handle→warn(BIZ-EXECUTOR-HANDLE)',
    },
    type: {
      tier: '✎',
      type: 'enum:taskType(开放)',
      default: '缺省',
      readers: 'viewer / BIZ 条件规则触发',
      writers: 'agent 经 CLI',
      when: '建 task',
      degrade: '未知值→warn(FMT-TYPE·开放枚举)',
    },
    role: {
      tier: '✎',
      type: 'enum:role',
      default: 'normal',
      readers: 'viewer / 调度',
      writers: 'agent 经 CLI',
      when: '标 fill-work 时',
      degrade: '非法值→hard(FMT-ROLE)',
    },
    handle: {
      tier: '✎',
      type: 'string?',
      default: '缺省',
      readers: 'resume 接驳后台句柄 / viewer',
      writers: 'agent 经 CLI',
      when: '派发 subagent/workflow 时',
      degrade: 'executor∈{subagent,workflow} 缺→warn(BIZ-EXECUTOR-HANDLE)',
    },
    justification: {
      tier: '✎',
      type: 'string?',
      default: '缺省',
      readers: 'viewer / 审计',
      writers: 'agent 经 CLI',
      when: '需说明决策时',
      degrade: '缺→无理由记录',
    },
    artifact: {
      tier: '✎',
      type: 'string | object?',
      default: '缺省',
      readers: 'done 真语义(P3) / viewer 产物链接',
      writers: 'agent 经 CLI(产出落盘后)',
      when: '产出落盘后',
      degrade: '缺→done 真语义不满足(BIZ-DONE-VERIFIED·P3 预留)',
    },
    output_schema: {
      tier: '✎',
      type: 'object?(低频)',
      default: '缺省',
      readers: 'workflow 结构化产出契约',
      writers: 'agent 经 CLI',
      when: '需结构化产出时',
      degrade: '缺→无 schema 约束',
    },
    dep_pins: {
      tier: '✎',
      type: 'object?(低频)',
      default: '缺省',
      readers: 'freshness / inputs_hash 钉依赖快照',
      writers: 'agent 经 CLI',
      when: '钉依赖快照时',
      degrade: '缺→无 pin',
    },
    wip_limit: {
      tier: '👁',
      type: 'int?',
      default: '缺省(覆写 owner cap)',
      readers: 'posttool-batch 两级 WIP',
      writers: 'agent 经 CLI',
      when: '覆写 per-owner cap 时',
      degrade: '非数字→warn(FMT-WIP)',
    },
    observability: {
      tier: '✎',
      type: 'object?',
      default: '缺省',
      readers: 'viewer 遥测 / resume',
      writers: 'agent 经 CLI',
      when: '派发后台时',
      degrade: '缺→无遥测',
    },
    hitl_rounds: {
      tier: '✎',
      type: 'int?',
      default: '0',
      readers: 'viewer / HITL 往返计数',
      writers: 'agent 经 CLI',
      when: 'HITL 往返时',
      degrade: '缺→视为 0',
    },
    decision_package: {
      tier: '✎',
      type: 'object?{prepared_at, inputs_hash, freshness, ask_type, context_md, question, what_i_need, why_it_matters, options[{id,label,rationale,tradeoffs}], enter_cmd}',
      default: '缺省(awaiting-user 必须)',
      readers: 'discuss 采访 / viewer 富决策卡',
      writers: 'agent 经 CLI',
      when: '建 awaiting-user 节点时',
      degrade: 'awaiting-user 缺→hard(BIZ-AWAITING);字段不全→warn(BIZ-DECISION-PACKAGE)',
    },
    model: {
      tier: '✎',
      type: 'string?',
      default: '缺省',
      readers: 'estimate tier 分层校准 / #34 档位成本效益',
      writers: 'agent 经 CLI(dispatch/done 时记录)',
      when: '派发或完成时记录模型档',
      degrade: '缺→无 tier 校准',
    },
  },
} satisfies Record<string, Record<string, FieldMeta>>;

// ── status 状态机（spec §6·⚙️实现期定稿）。transitions[from] = 合法转入的 to 列表。
//   注：lint **不**强制转移合法性（spec §5 不变式表无转移规则）——状态机供 CLI mutation 提示 + 文档。
//   verified 与 status 正交（非 status 值）。
export const STATUS_MACHINE = {
  transitions: {
    ready: ['in_flight', 'blocked'], // deps 全 done 可派发 → in_flight;撞阻塞 → blocked
    in_flight: ['done', 'uncertain', 'escalated', 'failed', 'blocked'], // 执行中的各出口
    blocked: ['ready', 'in_flight'], // 解锁 → ready / 直接接力 in_flight
    done: ['stale'], // 上游产物变 → stale 重跑
    uncertain: ['done', 'failed', 'in_flight'], // 做了未验 → 验过 done / 验失败 / 重做
    escalated: ['ready'], // 复盘后重排为 ready(supersede 另建新 task)
    failed: ['ready', 'escalated'], // 重试 / 升级
    stale: ['ready'], // 重跑
  } as Record<string, string[]>,
  // 分类（供 WIP / rollup / 派发判定，一份口径）。
  doneStatus: 'done',
  activeStatuses: ['in_flight'],
};

// isLegalTransition(from, to) — to 是否是 from 的合法后继。from===to 视为合法(幂等重写/no-op)。
export function isLegalTransition(from: string, to: string): boolean {
  if (from === to) return true;
  const outs = STATUS_MACHINE.transitions[from];
  return Array.isArray(outs) && outs.includes(to);
}

// 不变式注册表条目。
export interface Invariant {
  id: string;
  level: 'hard' | 'warn' | 'reserved';
  family: 'FMT' | 'GRAPH' | 'BIZ';
  scope: string;
  summary: string;
}

// ── INVARIANTS：不变式注册表（规则 id / 级别 / 家族 / 作用域 / 摘要 的 SSOT·spec §5）。
//   这是「规则身份 + 是 hard 还是 warn」的唯一定义处——board-lint-core 逐规则实现时从 levelOf(id) 读级别，
//   故「某规则是 hard 还是 warn」零漂移（改级别只此一处）。family：FMT(格式/类型)·GRAPH(图)·BIZ(条件业务规则)。
//   level：hard(确凿坏链路 / 坏数据)·warn(可疑但 graceful-degrade)·reserved(登记在册但 lint 暂不强制·待 ADR)。
export const INVARIANTS: Invariant[] = [
  // ── FMT 格式/类型 ──────────────────────────────────────────────────────────────────────────────
  {
    id: 'FMT-JSON',
    level: 'hard',
    family: 'FMT',
    scope: 'board',
    summary: 'board 是合法 JSON 且顶层为对象',
  },
  {
    id: 'FMT-SCHEMA',
    level: 'hard',
    family: 'FMT',
    scope: 'board',
    summary: 'schema === "cc-master/v2"',
  },
  { id: 'FMT-GOAL', level: 'hard', family: 'FMT', scope: 'board', summary: 'goal 是字符串' },
  {
    id: 'FMT-OWNER',
    level: 'hard',
    family: 'FMT',
    scope: 'board',
    summary: 'owner 对象 + active:bool + session_id:string',
  },
  {
    id: 'FMT-GIT',
    level: 'hard',
    family: 'FMT',
    scope: 'board',
    summary: 'git 对象 + worktree/branch 字符串或缺',
  },
  { id: 'FMT-TASKS', level: 'hard', family: 'FMT', scope: 'board', summary: 'tasks 是数组' },
  {
    id: 'FMT-SCHEDULING',
    level: 'warn',
    family: 'FMT',
    scope: 'board',
    summary: 'scheduling.wip_limit / owner_wip_limit 是数字',
  },
  {
    id: 'FMT-WATCHDOG',
    level: 'warn',
    family: 'FMT',
    scope: 'board',
    summary: 'watchdog.mechanism ∈ enum + fire_at ISO(观察档·graceful)',
  },
  {
    id: 'FMT-META',
    level: 'warn',
    family: 'FMT',
    scope: 'board',
    summary: 'meta.template_version 是整数',
  },
  {
    id: 'FMT-LOG',
    level: 'warn',
    family: 'FMT',
    scope: 'board',
    summary: 'log[] 条目 ts/summary 字符串 + kind ∈ enum',
  },
  {
    id: 'FMT-JUDGMENT-CALLS',
    level: 'warn',
    family: 'FMT',
    scope: 'board',
    summary: 'judgment_calls[] category/severity/status ∈ enum + summary 字符串',
  },
  {
    id: 'FMT-CADENCE',
    level: 'warn',
    family: 'FMT',
    scope: 'cadence',
    summary: 'cadence.iterations[] id/status ∈ enum + 时间 ISO',
  },
  { id: 'FMT-ID', level: 'hard', family: 'FMT', scope: 'task', summary: 'task.id 非空字符串' },
  { id: 'FMT-ID-UNIQUE', level: 'hard', family: 'FMT', scope: 'task', summary: 'task.id 全局唯一' },
  {
    id: 'FMT-STATUS',
    level: 'hard',
    family: 'FMT',
    scope: 'task',
    summary: 'task.status ∈ status 枚举(8)',
  },
  {
    id: 'FMT-DEPS',
    level: 'hard',
    family: 'FMT',
    scope: 'task',
    summary: 'task.deps 必填字符串数组',
  },
  {
    id: 'FMT-PARENT',
    level: 'hard',
    family: 'FMT',
    scope: 'task',
    summary: 'task.parent 非空字符串或缺',
  },
  {
    id: 'FMT-EXECUTOR',
    level: 'hard',
    family: 'FMT',
    scope: 'task',
    summary: 'task.executor ∈ executor 枚举(5)',
  },
  {
    id: 'FMT-ROLE',
    level: 'hard',
    family: 'FMT',
    scope: 'task',
    summary: 'task.role ∈ {normal, fill-work}',
  },
  {
    id: 'FMT-TYPE',
    level: 'warn',
    family: 'FMT',
    scope: 'task',
    summary: 'task.type ∈ taskType 枚举(开放·未知值 warn)',
  },
  {
    id: 'FMT-REF',
    level: 'hard',
    family: 'FMT',
    scope: 'task',
    summary: 'references[].ref 绝对路径或 URL(禁相对)',
  },
  {
    id: 'FMT-REF-KIND',
    level: 'warn',
    family: 'FMT',
    scope: 'task',
    summary: 'references[].kind ∈ refKind 枚举(开放)',
  },
  {
    id: 'FMT-BLOCKED-ON',
    level: 'warn',
    family: 'FMT',
    scope: 'task',
    summary: 'blocked_on = "user" 或存在的 task id',
  },
  { id: 'FMT-WIP', level: 'warn', family: 'FMT', scope: 'task', summary: 'task.wip_limit 是数字' },
  {
    id: 'FMT-TIME',
    level: 'warn',
    family: 'FMT',
    scope: 'task',
    summary: '时间锚为严格 ISO-8601 UTC(YYYY-MM-DDTHH:MM:SSZ)',
  },
  {
    id: 'FMT-ESTIMATE',
    level: 'warn',
    family: 'FMT',
    scope: 'task',
    summary: 'estimate {value:number, unit:string}',
  },
  {
    id: 'FMT-ACCEPTANCE',
    level: 'warn',
    family: 'FMT',
    scope: 'task',
    summary: 'acceptance string 或 {criteria 非空, criterion.status ∈ enum}',
  },
  // ── GRAPH 图(hard·rollup 除外) ──────────────────────────────────────────────────────────────────
  {
    id: 'GRAPH-DANGLING',
    level: 'hard',
    family: 'GRAPH',
    scope: 'graph',
    summary: 'deps 指向存在的 id(无悬挂)',
  },
  {
    id: 'GRAPH-SELFLOOP',
    level: 'hard',
    family: 'GRAPH',
    scope: 'graph',
    summary: 'deps 不含自身(无自环)',
  },
  { id: 'GRAPH-CYCLE', level: 'hard', family: 'GRAPH', scope: 'graph', summary: 'deps 图无有向环' },
  {
    id: 'GRAPH-PARENT-EXISTS',
    level: 'hard',
    family: 'GRAPH',
    scope: 'graph',
    summary: 'parent 指向存在的 owner id',
  },
  {
    id: 'GRAPH-PARENT-DEPTH',
    level: 'hard',
    family: 'GRAPH',
    scope: 'graph',
    summary: '嵌套 depth=1(owner 只含 leaf)',
  },
  {
    id: 'GRAPH-PARENT-CYCLE',
    level: 'hard',
    family: 'GRAPH',
    scope: 'graph',
    summary: 'parent 链无环',
  },
  {
    id: 'GRAPH-ROLLUP',
    level: 'warn',
    family: 'GRAPH',
    scope: 'graph',
    summary: 'done owner ⇒ 子全 done(容瞬态·warn)',
  },
  // ── BIZ 条件业务规则(warn·两条 hard) ────────────────────────────────────────────────────────────
  {
    id: 'BIZ-AWAITING',
    level: 'hard',
    family: 'BIZ',
    scope: 'task',
    summary: 'awaiting-user(blocked_on:user + status∈{blocked,in_flight}) ⇒ decision_package 对象',
  },
  {
    id: 'BIZ-DECISION-PACKAGE',
    level: 'warn',
    family: 'BIZ',
    scope: 'task',
    summary:
      'decision_package 字段完整(context_md/what_i_need/ask_type/inputs_hash/enter_cmd;decision 型 options 非空)',
  },
  {
    id: 'BIZ-DEV-REFS',
    level: 'warn',
    family: 'BIZ',
    scope: 'task',
    summary: 'type=development ⇒ references 含 kind=spec≥1 且 kind=plan≥1',
  },
  {
    id: 'BIZ-ACCEPTANCE-REQUIRED',
    level: 'warn',
    family: 'BIZ',
    scope: 'task',
    summary:
      'type ∈ {development, development-demo, acceptance, e2e-integration} ⇒ acceptance 非空',
  },
  {
    id: 'BIZ-EXECUTOR-HANDLE',
    level: 'warn',
    family: 'BIZ',
    scope: 'task',
    summary: 'executor ∈ {subagent, workflow} ⇒ handle 存在',
  },
  {
    id: 'BIZ-EXTERNAL-ISSUE',
    level: 'warn',
    family: 'BIZ',
    scope: 'task',
    summary: 'executor=external ⇒ references 含 kind=issue≥1',
  },
  {
    id: 'BIZ-TIME-ORDER',
    level: 'warn',
    family: 'BIZ',
    scope: 'task',
    summary: 'created≤started≤finished;in_flight⇒started;done⇒finished',
  },
  {
    id: 'BIZ-CADENCE-SHIPPED',
    level: 'hard',
    family: 'BIZ',
    scope: 'cadence',
    summary: 'iteration.status=shipped ⇒ members 全 done+verified(收口完整性)',
  },
  // ── 预留(登记在册·lint 暂不强制·待 ADR) ──────────────────────────────────────────────────────────
  {
    id: 'BIZ-DONE-VERIFIED',
    level: 'reserved',
    family: 'BIZ',
    scope: 'task',
    summary: 'status=done ⇒ verified ∧ artifact 非空(done 真语义·#32·P3·需 ADR)',
  },
  {
    id: 'FMT-BASELINE',
    level: 'warn',
    family: 'FMT',
    scope: 'board',
    summary: 'baseline.captured_at/t0 须 ISO-8601 UTC、task_estimates/dag_snapshot 形状合法',
  },
  {
    id: 'FMT-MODEL',
    level: 'warn',
    family: 'FMT',
    scope: 'task',
    summary: 'task.model 若存在须为 string',
  },
];

const _INV_BY_ID = new Map(INVARIANTS.map((inv) => [inv.id, inv]));
export function invariant(id: string): Invariant | undefined {
  return _INV_BY_ID.get(id);
}
export function levelOf(id: string): Invariant['level'] | undefined {
  const inv = _INV_BY_ID.get(id);
  return inv ? inv.level : undefined;
}

// ── ISO-8601 UTC（严格定宽，与 lint-core / graph-core 同口径）──────────────────────────────────────
export const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
export function isISOUTC(v: unknown): boolean {
  return typeof v === 'string' && ISO_UTC_RE.test(v);
}

// ── 跨消费者共享谓词（lint 与 graph 一份口径，杜绝两处漂移）───────────────────────────────────────
// task 形状对 lint/graph 是 agent-shaped 自由对象——这里只取实际触碰的字段，其余宽松。
export interface TaskLike {
  id?: unknown;
  status?: unknown;
  deps?: unknown;
  parent?: unknown;
  blocked_on?: unknown;
  verified?: unknown;
  artifact?: unknown;
  [key: string]: unknown;
}

// isAwaitingUser：blocked_on==="user" 且 status ∈ {blocked, in_flight}（webview / discuss / lint 三端对齐）。
export function isAwaitingUser(task: TaskLike | null | undefined): boolean {
  return (
    !!task &&
    task.blocked_on === 'user' &&
    (task.status === 'blocked' || task.status === 'in_flight')
  );
}
// isDoneStatus / isActiveStatus（done 只认 'done'；active = in_flight）。
export function isDoneStatus(s: unknown): boolean {
  return s === STATUS_MACHINE.doneStatus;
}
export function isActiveStatus(s: unknown): boolean {
  return STATUS_MACHINE.activeStatuses.includes(s as string);
}

// acceptance 目标函数对象形状。
export interface AcceptanceObject {
  criteria?: Array<{ status?: unknown; [key: string]: unknown }>;
  [key: string]: unknown;
}

// acceptanceConverged(acceptance) → 目标函数是否收敛。
//   string / 缺省 → null（不可判，轻任务一句话 DoD 无机器可读 criteria）；
//   object → ∀ criteria.status==='met' 且 criteria 非空 才 true（loss=未 met 项·spec §4.1）。
export function acceptanceConverged(acceptance: unknown): boolean | null {
  if (!acceptance || typeof acceptance !== 'object' || Array.isArray(acceptance)) return null;
  const c = (acceptance as AcceptanceObject).criteria;
  if (!Array.isArray(c) || c.length === 0) return false;
  return c.every((cr) => cr && cr.status === 'met');
}

// taskTrulyDone(task) → done 真语义（#32·P3）：status==='done' ∧ verified===true ∧ artifact 非空。
//   注：这是 BIZ-DONE-VERIFIED(reserved) 的语义实现，供 CLI/graph/viewer 用；lint 暂不据此 hard fail。
export function taskTrulyDone(task: TaskLike | null | undefined): boolean {
  if (!task || typeof task !== 'object') return false;
  const hasArtifact = task.artifact !== undefined && task.artifact !== null && task.artifact !== '';
  return task.status === 'done' && task.verified === true && hasArtifact;
}

// isAbsolutePathOrUrl(ref) → references[].ref 合法性（绝对路径 / http(s) URL，禁相对·FMT-REF）。
export function isAbsolutePathOrUrl(ref: unknown): boolean {
  if (typeof ref !== 'string' || ref === '') return false;
  if (/^https?:\/\//.test(ref)) return true; // URL
  if (ref.startsWith('/')) return true; // 绝对路径
  return false; // 相对路径（docs/x、./x、../x）一律禁
}
