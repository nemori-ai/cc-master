// registry.ts — ccm 命令 SSOT（noun → verb → spec·cli-design §3 / 契约 §三 registry.js）。
//
// 这是整个 CLI 命令面的**单一真相源**：每个 (noun, verb) 一条 spec，喂三个消费者——
//   ① router（P5.3）：noun/verb 切分 → REGISTRY[noun][verb] 取 spec → parseArgs(rest, spec.options) → 校验 → 派 handler。
//   ② help（P5.x）：summary / positionals / options / examples 直接渲染 `--help`。
//   ③ 反漂移门（WRITABLE_FIELDS_COVERED·本文件）：枚举 registry 覆盖的 FIELDS dotpath，断言 schema 加字段不漏配 flag。
//
// flag 全集**严格抄 help 草稿（2026-06-24-ccm-help-text-draft.md，已按 FIELDS 全量校正）**——不手敲、不臆造。
//   options 的 enum 取自 board-model.ENUMS（零漂移）；field/transform 指明该 flag 写进哪个 FIELDS dotpath、怎么转换：
//     · field:'<dotpath>'      —— 该 flag 直接映射到 FIELDS 的某字段（buildFields 据此组装 mutation 入参）。
//     · transform:'duration'   —— io.parseDuration（"3h"→{value,unit}），用于 --estimate / --ship-every。
//     · transform:'csv'        —— 拆逗号成数组，用于 --deps / --members / --refs。
//     · transform:'ref'        —— 拆 "kind:ref" 成 {kind, ref}（multiple → references[]），用于 --ref / --add-ref。
//     · transform:'kv'         —— --set <path>=<val>（收集成 applySet 操作列表）。
//     · transform:'json'       —— --set-json <path>=<json>（收集成 applySetJson 操作列表）。
//
// 红线1 / ADR-006：node/JS only，零 npm 依赖、纯 stdlib（只 import 引擎 ENUMS）。
// 武装闸豁免：纯声明库（无 hook 入口，只被 CLI / router import）——见 AGENTS.md §3 红线6 / §12 grep 门豁免。
//
// T2a port 注：原 CJS 源（registry.js）的 require('./board-model.js') 改成从 `@ccm/engine` import ENUMS；
//   module.exports 换成命名导出。REGISTRY 字面量 / 别名 / 反漂移逻辑逐字保持。

import { ENUMS } from '@ccm/engine';

const E = ENUMS;

// ── spec 类型（registry SSOT 的形状；help / router 消费此形）─────────────────────────────────────
export interface OptionSpec {
  type: 'string' | 'boolean';
  enum?: readonly string[];
  // openEnum:true —— enum 仅作 help 建议值，router 不硬拒未知值（开放枚举·QA #2）。对应 board-model
  //   OPEN_ENUMS（taskType / refKind）：未知值合法、由 lint 出 warn（FMT-TYPE）而非 flag 层 fail。
  //   不设（默认闭集）= router validateEnums 硬拒未知值（executor / role / status 等闭合枚举）。
  openEnum?: boolean;
  transform?: 'duration' | 'csv' | 'ref' | 'kv' | 'json' | 'input';
  required?: boolean;
  multiple?: boolean;
  field?: string;
  desc?: string;
}
export interface Positional {
  name: string;
  required: boolean;
}
export interface VerbSpec {
  summary: string;
  read: boolean;
  positionals: Positional[];
  options: Record<string, OptionSpec>;
  examples: string[];
  handler: string;
}
export type NounSpec = Record<string, VerbSpec>;
export type Registry = Record<string, NounSpec>;

// ── REGISTRY：noun → verb → spec。read:true 的 verb 用 runRead，read:false 用 runWrite（_common.js）。──
export const REGISTRY: Registry = {
  // ════════════════════ board ════════════════════════════════════════════════════════════════════
  board: {
    show: {
      summary: '打印整板 / 摘要（goal·owner·任务统计·lint 是否净）',
      read: true,
      positionals: [],
      options: {
        json: { type: 'boolean', desc: '打印完整 board JSON（否则人类摘要）' },
      },
      examples: ['ccm board show', 'ccm board show --json'],
      handler: 'board.show',
    },
    lint: {
      summary: '校验整板（FMT / GRAPH / BIZ 全规则）；有 hard error → 退出 3',
      read: true,
      positionals: [],
      options: {
        json: { type: 'boolean', desc: '以 JSON 出 violations（否则人类报告）' },
        raw: {
          type: 'boolean',
          desc: '直读 --board 指定文件的原始字节喂 lint（绕过 discover 的 JSON 预校验）——坏 JSON 也能 lint 成 FMT-JSON 错而非 exit 5（hook 用·须配 --board）',
        },
      },
      examples: ['ccm lint', 'ccm board lint --json', 'ccm board lint --board <path> --raw --json'],
      handler: 'board.lint',
    },
    graph: {
      summary: 'DAG 全量分析：拓扑 / 环 / readySet / 临界路径 / makespan',
      read: true,
      positionals: [],
      options: {
        json: { type: 'boolean', desc: '结构化输出（否则人类树视图）' },
      },
      examples: ['ccm board graph', 'ccm board graph --json'],
      handler: 'board.graph',
    },
    'critical-path': {
      summary: '临界路径链 + makespan + 时长来源档',
      read: true,
      positionals: [],
      options: {
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm board critical-path', 'ccm board critical-path --json'],
      handler: 'board.criticalPath',
    },
    next: {
      summary: 'readySet——现在能派发什么（别名 ccm next）',
      read: true,
      positionals: [],
      options: {
        json: { type: 'boolean', desc: '结构化输出（否则人类表格）' },
      },
      examples: ['ccm next', 'ccm board next --json'],
      handler: 'board.next',
    },
    init: {
      summary: '从 template 建一块 board.json（非 arming·§7）',
      read: false,
      positionals: [],
      options: {
        goal: { type: 'string', field: 'goal', desc: '初始 goal（默认空串）' },
      },
      examples: ['ccm board init --goal "试验性编排"'],
      handler: 'board.init',
    },
    update: {
      summary: '改板级配置：goal / wip-limit / git',
      read: false,
      positionals: [],
      options: {
        goal: { type: 'string', field: 'goal', desc: '重定 goal' },
        'wip-limit': {
          type: 'string',
          field: 'scheduling.wip_limit',
          desc: 'scheduling.wip_limit（并发软上限）',
        },
        'owner-wip': {
          type: 'string',
          field: 'scheduling.owner_wip_limit',
          desc: 'scheduling.owner_wip_limit',
        },
        branch: { type: 'string', field: 'git.branch', desc: 'git.branch' },
        worktree: { type: 'string', field: 'git.worktree', desc: 'git.worktree' },
      },
      examples: [
        'ccm board update --goal "v0.10.0 收尾"',
        'ccm board update --wip-limit 4 --branch board-v2-redesign',
      ],
      handler: 'board.update',
    },
  },

  // ════════════════════ task ═════════════════════════════════════════════════════════════════════
  task: {
    add: {
      summary: '新建一个 task 节点（写入即校验）',
      read: false,
      positionals: [{ name: 'id', required: true }],
      options: {
        title: { type: 'string', field: 'title', desc: '卡片标题' },
        description: { type: 'string', field: 'description', desc: '详细描述' },
        type: {
          type: 'string',
          field: 'type',
          enum: E.taskType,
          openEnum: true,
          desc: '任务类型（开放·未知值 warn）',
        },
        executor: { type: 'string', field: 'executor', enum: E.executor, desc: '执行者类型' },
        handle: { type: 'string', field: 'handle', desc: '后台句柄（subagent/workflow 必给）' },
        deps: { type: 'string', field: 'deps', transform: 'csv', desc: '依赖（逗号分隔）' },
        parent: { type: 'string', field: 'parent', desc: '归属 owner 节点（嵌套 depth=1）' },
        estimate: {
          type: 'string',
          field: 'estimate',
          transform: 'duration',
          desc: '估时 3h/90m/2d/1w',
        },
        ref: {
          type: 'string',
          field: 'references',
          transform: 'ref',
          multiple: true,
          desc: '引用 kind:ref（可重复）',
        },
        accept: {
          type: 'string',
          field: 'acceptance',
          transform: 'input',
          desc: '验收：一句话 DoD 或 @file',
        },
        role: { type: 'string', field: 'role', enum: E.role, desc: '调度角色（默认 normal）' },
        justification: { type: 'string', field: 'justification', desc: '决策理由' },
        status: {
          type: 'string',
          field: 'status',
          enum: E.status,
          desc: '初始 status（默认 ready）',
        },
        verified: { type: 'boolean', field: 'verified', desc: '标记已验收' },
        artifact: { type: 'string', field: 'artifact', desc: '产物链接' },
        'wip-limit': { type: 'string', field: 'wip_limit', desc: '本 task WIP 覆写（👁）' },
        set: {
          type: 'string',
          transform: 'kv',
          multiple: true,
          desc: '通用设任意 ✎ 标量（path=val）',
        },
        'set-json': {
          type: 'string',
          transform: 'json',
          multiple: true,
          desc: '通用设任意 ✎ 对象/数组（path=json）',
        },
        log: { type: 'string', desc: '同时追一条 log' },
      },
      examples: [
        'ccm task add T7 --type development --deps T1 --estimate 3h',
        'ccm task add EXT3 --executor external --ref issue:https://github.com/o/r/issues/9',
      ],
      handler: 'task.add',
    },
    show: {
      summary: '单任务详情',
      read: true,
      positionals: [{ name: 'id', required: true }],
      options: {
        json: { type: 'boolean', desc: '完整 task JSON（否则人类卡片）' },
      },
      examples: ['ccm task show T7', 'ccm task show T7 --json'],
      handler: 'task.show',
    },
    list: {
      summary: '列出任务（可过滤）',
      read: true,
      positionals: [],
      options: {
        status: { type: 'string', enum: E.status, multiple: true, desc: '只列某 status（可重复）' },
        executor: { type: 'string', enum: E.executor, desc: '只列某 executor' },
        type: { type: 'string', enum: E.taskType, openEnum: true, desc: '只列某 type' },
        parent: { type: 'string', desc: '只列某 owner 的子节点' },
        json: { type: 'boolean', desc: 'JSON 数组' },
      },
      examples: ['ccm task ls --status ready', 'ccm task ls --executor subagent --json'],
      handler: 'task.list',
    },
    update: {
      summary: '改字段 / 增删依赖',
      read: false,
      positionals: [{ name: 'id', required: true }],
      options: {
        title: { type: 'string', field: 'title', desc: '卡片标题' },
        description: { type: 'string', field: 'description', desc: '详细描述' },
        type: {
          type: 'string',
          field: 'type',
          enum: E.taskType,
          openEnum: true,
          desc: '任务类型（开放·未知值 warn）',
        },
        executor: { type: 'string', field: 'executor', enum: E.executor, desc: '执行者类型' },
        handle: { type: 'string', field: 'handle', desc: '后台句柄' },
        estimate: {
          type: 'string',
          field: 'estimate',
          transform: 'duration',
          desc: '估时 3h/90m/2d/1w',
        },
        role: { type: 'string', field: 'role', enum: E.role, desc: '调度角色' },
        justification: { type: 'string', field: 'justification', desc: '决策理由' },
        artifact: { type: 'string', field: 'artifact', desc: '产物链接' },
        verified: { type: 'boolean', field: 'verified', desc: '标记已验收' },
        'wip-limit': { type: 'string', field: 'wip_limit', desc: '本 task WIP 覆写' },
        accept: {
          type: 'string',
          field: 'acceptance',
          transform: 'input',
          desc: '验收：一句话 DoD 或 @file',
        },
        'add-dep': {
          type: 'string',
          field: 'addDep',
          transform: 'csv',
          multiple: true,
          desc: '增依赖（可重复）',
        },
        'rm-dep': {
          type: 'string',
          field: 'rmDep',
          transform: 'csv',
          multiple: true,
          desc: '删依赖（可重复）',
        },
        'add-ref': {
          type: 'string',
          field: 'addRef',
          transform: 'ref',
          multiple: true,
          desc: '增引用 kind:ref（可重复）',
        },
        'rm-ref': {
          type: 'string',
          field: 'rmRef',
          transform: 'csv',
          multiple: true,
          desc: '删引用（按 ref·可重复）',
        },
        parent: { type: 'string', field: 'parent', desc: '改归属（""=升为顶层）' },
        set: { type: 'string', transform: 'kv', multiple: true, desc: '通用设 ✎ 标量（path=val）' },
        'set-json': {
          type: 'string',
          transform: 'json',
          multiple: true,
          desc: '通用设 ✎ 对象/数组（path=json）',
        },
        log: { type: 'string', desc: '同时追一条 log' },
      },
      examples: [
        'ccm task update T7 --estimate 5h --add-dep T2',
        'ccm task update T7 --rm-dep T2 --verified --artifact /abs/out.md',
      ],
      handler: 'task.update',
    },
    start: {
      summary: '起跑（→ in_flight·盖 started_at）',
      read: false,
      positionals: [{ name: 'id', required: true }],
      options: {
        log: { type: 'string', desc: '同时追一条 log' },
      },
      examples: ['ccm task start T7'],
      handler: 'task.start',
    },
    done: {
      summary: '完成（→ done·盖 finished_at）',
      read: false,
      positionals: [{ name: 'id', required: true }],
      options: {
        artifact: { type: 'string', field: 'artifact', desc: '产物链接（绝对路径 / URL）' },
        verified: { type: 'boolean', field: 'verified', desc: '标记已端点验收' },
        log: { type: 'string', desc: '同时追一条 log' },
      },
      examples: ['ccm task done T7 --artifact /abs/out.md --verified'],
      handler: 'task.done',
    },
    block: {
      summary: '阻塞（→ blocked·设 blocked_on）',
      read: false,
      positionals: [{ name: 'id', required: true }],
      options: {
        on: { type: 'string', required: true, desc: '阻塞源：user 或某 task id' },
        decision: {
          type: 'string',
          transform: 'input',
          desc: '--on user 时必给 decision_package（@file 或 -）',
        },
        log: { type: 'string', desc: '同时追一条 log' },
      },
      examples: [
        'ccm task block T7 --on T2',
        'ccm task block T9 --on user --decision @/abs/decision.json',
      ],
      handler: 'task.block',
    },
    'set-status': {
      summary: '通用状态转移',
      read: false,
      positionals: [
        { name: 'id', required: true },
        { name: 'status', required: true },
      ],
      options: {},
      examples: ['ccm task set-status T7 escalated', 'ccm task set-status T7 done --force'],
      handler: 'task.setStatus',
    },
    rm: {
      summary: '删除一个 task（破坏性·非 TTY 须 --yes）',
      read: false,
      positionals: [{ name: 'id', required: true }],
      options: {},
      examples: ['ccm task rm T7 --yes'],
      handler: 'task.rm',
    },
  },

  // ════════════════════ log ══════════════════════════════════════════════════════════════════════
  log: {
    add: {
      summary: '追加一条审计条目（只增不改不删）',
      read: false,
      positionals: [{ name: 'summary', required: true }],
      options: {
        kind: { type: 'string', field: 'kind', enum: E.logKind, desc: 'log 类别' },
        task: { type: 'string', field: 'task', desc: '关联的 task id' },
        detail: { type: 'string', field: 'detail', desc: '详情（长文）' },
        ref: {
          type: 'string',
          field: 'refs',
          transform: 'csv',
          multiple: true,
          desc: '关联引用（可重复）',
        },
      },
      examples: [
        'ccm log add "派发 T7 给 subagent" --kind dispatch --task T7',
        'ccm log add "改用方案 B" --kind decision --detail "理由:..."',
      ],
      handler: 'log.add',
    },
    list: {
      summary: '打印审计流',
      read: true,
      positionals: [],
      options: {
        kind: { type: 'string', enum: E.logKind, desc: '只列某类' },
        task: { type: 'string', desc: '只列关联某 task 的' },
        json: { type: 'boolean', desc: 'JSON 数组' },
      },
      examples: ['ccm log list --task T7', 'ccm log list --kind decision --json'],
      handler: 'log.list',
    },
  },

  // ════════════════════ jc（judgment_calls）══════════════════════════════════════════════════════
  jc: {
    add: {
      summary: '记一条自决台账',
      read: false,
      positionals: [{ name: 'summary', required: true }],
      options: {
        category: { type: 'string', field: 'category', enum: E.jcCategory, desc: '自决类别' },
        severity: { type: 'string', field: 'severity', enum: E.jcSeverity, desc: '严重度' },
        decision: { type: 'string', field: 'decision', desc: '做了什么决定' },
        rationale: { type: 'string', field: 'rationale', desc: '为什么这么决' },
        impact: { type: 'string', field: 'impact', desc: '影响面 / 反转代价' },
        refs: {
          type: 'string',
          field: 'refs',
          transform: 'csv',
          multiple: true,
          desc: '佐证引用（可重复）',
        },
        'task-ref': { type: 'string', field: 'task_ref', desc: '关联 task' },
        set: { type: 'string', transform: 'kv', multiple: true, desc: '通用设 ✎ 标量（path=val）' },
        'set-json': {
          type: 'string',
          transform: 'json',
          multiple: true,
          desc: '通用设 ✎ 对象/数组（path=json）',
        },
      },
      examples: ['ccm jc add "选 ICU MessageFormat" --category architecture --severity high'],
      handler: 'jc.add',
    },
    list: {
      summary: '列出自决台账',
      read: true,
      positionals: [],
      options: {
        status: { type: 'string', enum: E.jcStatus, desc: '只列某 status' },
        severity: { type: 'string', enum: E.jcSeverity, desc: '只列某 severity' },
        json: { type: 'boolean', desc: 'JSON 数组' },
      },
      examples: ['ccm jc list --status pending_review', 'ccm jc list --severity critical --json'],
      handler: 'jc.list',
    },
    show: {
      summary: '单条自决详情',
      read: true,
      positionals: [{ name: 'id', required: true }],
      options: {
        json: { type: 'boolean', desc: '完整 jc JSON' },
      },
      examples: ['ccm jc show J1'],
      handler: 'jc.show',
    },
    resolve: {
      summary: '复盘裁决一条自决（upheld / overturned）',
      read: false,
      positionals: [{ name: 'id', required: true }],
      options: {
        status: {
          type: 'string',
          field: 'status',
          enum: ['upheld', 'overturned'],
          required: true,
          desc: 'upheld（维持）| overturned（推翻）',
        },
        note: { type: 'string', field: 'note', desc: '裁决理由（存 resolution_note）' },
      },
      examples: ['ccm jc resolve J1 --status upheld --note "事后看是对的"'],
      handler: 'jc.resolve',
    },
  },

  // ════════════════════ cadence ══════════════════════════════════════════════════════════════════
  cadence: {
    update: {
      summary: '设 / 改节奏配置（target = {ship_every, min_unit}）',
      read: false,
      positionals: [],
      options: {
        'ship-every': {
          type: 'string',
          field: 'cadence.target.ship_every',
          transform: 'duration',
          desc: 'target.ship_every（如 3h）',
        },
        'min-unit': {
          type: 'string',
          field: 'cadence.target.min_unit',
          desc: 'target.min_unit（如 "1 PR"）',
        },
        set: { type: 'string', transform: 'kv', multiple: true, desc: '通用设 ✎ 标量（path=val）' },
        'set-json': {
          type: 'string',
          transform: 'json',
          multiple: true,
          desc: '通用设 ✎ 对象/数组（path=json）',
        },
      },
      examples: ['ccm cadence update --ship-every 3h --min-unit "1 PR"'],
      handler: 'cadence.update',
    },
    open: {
      summary: '开一个 iteration',
      read: false,
      positionals: [{ name: 'iter-id', required: true }],
      options: {
        goal: { type: 'string', field: 'goal', desc: '本 iteration 目标' },
        deadline: { type: 'string', field: 'deadline', desc: '截止时刻（严格 ISO-8601 UTC）' },
        members: {
          type: 'string',
          field: 'members',
          transform: 'csv',
          desc: '纳入本 iteration 的 task（逗号分隔）',
        },
        set: { type: 'string', transform: 'kv', multiple: true, desc: '通用设 ✎ 标量（path=val）' },
        'set-json': {
          type: 'string',
          transform: 'json',
          multiple: true,
          desc: '通用设 ✎ 对象/数组（path=json）',
        },
      },
      examples: [
        'ccm cadence open I1 --goal "ship 框架+翻译切片" --deadline 2026-06-05T14:00:00Z --members T0,T1',
      ],
      handler: 'cadence.open',
    },
    ship: {
      summary: '收口一个 iteration（成员须全 done+verified）',
      read: false,
      positionals: [{ name: 'iter-id', required: true }],
      options: {},
      examples: ['ccm cadence ship I1'],
      handler: 'cadence.ship',
    },
    status: {
      summary: '当前节奏 + 各 iteration 状态',
      read: true,
      positionals: [],
      options: {
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm cadence status'],
      handler: 'cadence.status',
    },
  },

  // ════════════════════ watchdog（ADR-011）═══════════════════════════════════════════════════════
  watchdog: {
    arm: {
      summary: '武装自我唤醒 watchdog',
      read: false,
      positionals: [],
      options: {
        'fire-at': {
          type: 'string',
          field: 'fireAt',
          required: true,
          desc: '触发时刻（严格 ISO-8601 UTC）',
        },
        mechanism: {
          type: 'string',
          field: 'mechanism',
          enum: E.watchdogMechanism,
          required: true,
          desc: 'cron|loop|monitor|shell（降级链）',
        },
        'job-id': { type: 'string', field: 'jobId', desc: '外部调度句柄（便于 disarm 清理）' },
        checklist: { type: 'string', field: 'checklist', desc: '唤醒后该检查什么' },
      },
      examples: [
        'ccm watchdog arm --fire-at 2026-06-24T12:00:00Z --mechanism cron --checklist "查后台 3 个 subagent"',
      ],
      handler: 'watchdog.arm',
    },
    disarm: {
      summary: '退役 watchdog（删整对象·不留残骸）',
      read: false,
      positionals: [],
      options: {},
      examples: ['ccm watchdog disarm'],
      handler: 'watchdog.disarm',
    },
    status: {
      summary: '当前 watchdog 状态',
      read: true,
      positionals: [],
      options: {
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm watchdog status'],
      handler: 'watchdog.status',
    },
  },

  // ════════════════════ baseline ═════════════════════════════════════════════════════════════════
  baseline: {
    snapshot: {
      summary: 'EVM plan-baseline 快照（写 board.baseline；已存在则 exit 3）',
      read: false,
      positionals: [],
      options: {
        t0: { type: 'string', desc: 'EVM 零时刻（严格 ISO-8601 UTC；默认 now）' },
        note: { type: 'string', desc: '备注（快照说明）' },
        'dry-run': { type: 'boolean', desc: '试跑不落盘' },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: [
        'ccm baseline snapshot',
        'ccm baseline snapshot --t0 2026-06-25T08:00:00Z --note "sprint 1 start"',
      ],
      handler: 'baseline.snapshot',
    },
    show: {
      summary: '只读当前 baseline 段（无 baseline 也 exit 0）',
      read: true,
      positionals: [],
      options: {
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm baseline show', 'ccm baseline show --json'],
      handler: 'baseline.show',
    },
    reset: {
      summary: 're-baseline：旧快照进 history[]（只增不删）+ 建新（非 TTY 须 --yes）',
      read: false,
      positionals: [],
      options: {
        t0: { type: 'string', desc: '新基线 EVM 零时刻（严格 ISO-8601 UTC；默认 now）' },
        note: { type: 'string', desc: '重新 baseline 理由' },
        yes: { type: 'boolean', desc: '非 TTY 确认（破坏性操作）' },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm baseline reset --note "mid-sprint re-estimate" --yes'],
      handler: 'baseline.reset',
    },
  },

  // ════════════════════ policy ══════════════════════════════════════════════════════════════════════
  policy: {
    show: {
      summary: '只读 board.policy + effective 有效值（缺省 autonomous_account_switch=allow）',
      read: true,
      positionals: [],
      options: {
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm policy show', 'ccm policy show --json'],
      handler: 'policy.show',
    },
    set: {
      summary:
        '设 board.policy.autonomous_account_switch（allow|deny）；非 TTY 须 --user-authorized',
      read: false,
      positionals: [],
      options: {
        'autonomous-account-switch': {
          type: 'string',
          enum: E.accountSwitchPolicy,
          required: true,
          desc: 'allow（允许自主换号）| deny（禁止自主换号）',
        },
        'user-authorized': { type: 'boolean', desc: '非 TTY 时显式授权（破坏性授权操作）' },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: [
        'ccm policy show',
        'ccm policy set --autonomous-account-switch=deny --user-authorized',
      ],
      handler: 'policy.set',
    },
  },

  // ════════════════════ peers（COORD 多 orchestrator 感知·只读跨板）════════════════════════════════════
  //   感知通道（设计稿 §3.2）：扫 home/boards/ 全体 active+心跳新鲜板 → 花名册（goal/workload/priority/liveness），
  //   喂价值感知的独立自我配速（不必协商即可合理让路 / 认领 slack）。**纯只读跨板**——零写、不抢 board-lock、
  //   不需要 active board（自身可无板·号池/感知是用户级跨板）。token-blind：花名册无任何 secret。
  peers: {
    list: {
      summary:
        '跨板只读花名册：全体 active+心跳新鲜 orchestrator 的 goal/workload/priority/liveness（COORD 感知通道）',
      read: true,
      positionals: [],
      options: {
        'freshness-sec': {
          type: 'string',
          desc: '心跳判活窗口秒（默认 600=10min·与 bootstrap resume 同口径）',
        },
        json: { type: 'boolean', desc: '结构化花名册（否则人类表格）' },
      },
      examples: ['ccm peers', 'ccm peers --json', 'ccm peers --freshness-sec 300 --json'],
      handler: 'peers.list',
    },
  },

  // ════════════════════ usage（只读 advisory·ADR-015）═══════════════════════════════════════════════
  //   配额侧只读 analysis namespace（纯只读·零写·不抢 board-lock）。enum 为 CLI-local 呈现枚举（scope /
  //   accounts / group-by）——非 board-model 概念，故同 `jc resolve` 的 ['upheld','overturned'] 字面量先例。
  usage: {
    show: {
      summary: '当前号 + 全备号 5h/7d used%/resets_at（备号=registry 生命周期快照·只读）',
      read: true,
      positionals: [],
      options: {
        accounts: {
          type: 'string',
          enum: ['all', 'current'],
          desc: '列哪些账号：all（含备号·默认）| current（仅当前号）',
        },
        'effective-n': { type: 'string', desc: '号池有效配额份数覆写（默认从 registry 算）' },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm usage show', 'ccm usage show --accounts current --json'],
      handler: 'usage.show',
    },
    advise: {
      summary: '双侧走廊 verdict（throttle|accelerate|hold|hard_stop）+ lever + switch_candidate',
      read: true,
      positionals: [],
      options: {
        'effective-n': { type: 'string', desc: '号池有效配额份数覆写（默认从 registry 算）' },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm usage advise', 'ccm usage advise --effective-n 3 --json'],
      handler: 'usage.advise',
    },
    'task-cost': {
      summary: '单/聚合任务 token（读 board observability·shell=N/A·coverage_pct·--group-by）',
      read: true,
      positionals: [{ name: 'task-id', required: false }],
      options: {
        'group-by': {
          type: 'string',
          enum: ['task', 'executor', 'type', 'tier'],
          desc: '聚合维度（无 task-id 时·默认 task）',
        },
        scope: {
          type: 'string',
          enum: ['home', 'this-repo', 'this-board'],
          desc: '历史语料范围（默认 this-board 读本板 observability）',
        },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm usage task-cost T7', 'ccm usage task-cost --group-by executor --json'],
      handler: 'usage.taskCost',
    },
    'burn-rate': {
      summary: '配额%-burn-rate（Δused%/Δtime·账户权威·5h+7d·window-elapsed·%/h）',
      read: true,
      positionals: [],
      options: {
        'as-of': { type: 'string', desc: 'as-of 时刻（ISO-8601 UTC·backtest 用·默认 now）' },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm usage burn-rate', 'ccm usage burn-rate --json'],
      handler: 'usage.burnRate',
    },
    runway: {
      summary: '配额% runway（剩余走廊 ÷ burn → 距触顶 vs 距 reset·偿付力 headroom）',
      read: true,
      positionals: [],
      options: {
        'as-of': { type: 'string', desc: 'as-of 时刻（ISO-8601 UTC·backtest 用·默认 now）' },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm usage runway', 'ccm usage runway --json'],
      handler: 'usage.runway',
    },
  },

  // ════════════════════ estimate（只读 advisory·ADR-015）════════════════════════════════════════════
  //   工作侧只读 analysis namespace（消费 @ccm/engine OR/ML 算法层·纯只读·零写·不抢 board-lock）。
  //   p95=5% 硬墙永不取 max/不到 100%（引擎 conformal/MC 分位口径保证）。
  estimate: {
    show: {
      summary: 'estimate 字段 + EWMA 校准覆写 + conformal 区间（快速瞥）',
      read: true,
      positionals: [{ name: 'task-id', required: false }],
      options: {
        scope: {
          type: 'string',
          enum: ['home', 'this-repo', 'this-board'],
          desc: '历史语料范围（默认 home·跨板多层收缩）',
        },
        'as-of': { type: 'string', desc: 'as-of 时刻（ISO-8601 UTC·backtest 用·默认 now）' },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm estimate show T7', 'ccm estimate show --scope this-repo --json'],
      handler: 'estimate.show',
    },
    forecast: {
      summary: '双通道 MC（估算-DAG + 吞吐）→ P50/P80/P95 ETA + makespan + CI/CRI/SSI',
      read: true,
      positionals: [],
      options: {
        mode: {
          type: 'string',
          enum: ['estimate', 'throughput', 'both'],
          desc: '通道（默认 both·coverage<50% 吞吐主导）',
        },
        scope: {
          type: 'string',
          enum: ['home', 'this-repo', 'this-board'],
          desc: '历史语料范围（默认 home）',
        },
        'as-of': { type: 'string', desc: 'as-of 时刻（ISO-8601 UTC·backtest 用·默认 now）' },
        'effective-n': { type: 'string', desc: '号池有效配额份数覆写' },
        runs: { type: 'string', desc: 'MC trials（默认 2000）' },
        seed: { type: 'string', desc: 'PRNG 种子（复现·默认 42）' },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: [
        'ccm estimate forecast',
        'ccm estimate forecast --mode both --runs 5000 --seed 42 --json',
      ],
      handler: 'estimate.forecast',
    },
    evm: {
      summary: 'EVM + Earned Schedule（PV/EV/AC → CPI/EAC + SPI(t)·消费 board.baseline）',
      read: true,
      positionals: [],
      options: {
        'as-of': { type: 'string', desc: 'as-of 时刻（ISO-8601 UTC·默认 now）' },
        'ac-source': {
          type: 'string',
          enum: ['duration', 'token'],
          desc: 'AC 口径（duration 实测小时·默认 | token 遥测）',
        },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm estimate evm', 'ccm estimate evm --ac-source token --json'],
      handler: 'estimate.evm',
    },
    velocity: {
      summary: '历史吞吐 + burn-down/up（P50/P80）+ SLE（cycle-time P85/P95）',
      read: true,
      positionals: [],
      options: {
        scope: {
          type: 'string',
          enum: ['home', 'this-repo', 'this-board'],
          desc: '历史语料范围（默认 home）',
        },
        window: { type: 'string', desc: '窗口天数（默认 7）' },
        'as-of': { type: 'string', desc: 'as-of 时刻（ISO-8601 UTC·默认 now）' },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm estimate velocity', 'ccm estimate velocity --window 14 --json'],
      handler: 'estimate.velocity',
    },
    risk: {
      summary: '综合风险（CI/CRI/SSI + WIP-aging SLE + CCPM buffer_health）',
      read: true,
      positionals: [],
      options: {
        scope: {
          type: 'string',
          enum: ['home', 'this-repo', 'this-board'],
          desc: '历史语料范围（默认 home）',
        },
        seed: { type: 'string', desc: 'PRNG 种子（复现·默认 42）' },
        runs: { type: 'string', desc: 'MC trials（默认 2000）' },
        'as-of': { type: 'string', desc: 'as-of 时刻（ISO-8601 UTC·默认 now）' },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm estimate risk', 'ccm estimate risk --scope this-repo --json'],
      handler: 'estimate.risk',
    },
    'cost-to-complete': {
      summary:
        '%-cost-to-complete（剩余工作 × 每单位配额%增量·throughput-MC·偿付力）+ token 辅助 sizing',
      read: true,
      positionals: [],
      options: {
        scope: {
          type: 'string',
          enum: ['home', 'this-repo', 'this-board'],
          desc: '历史语料范围（默认 home·跨板多层收缩）',
        },
        'as-of': { type: 'string', desc: 'as-of 时刻（ISO-8601 UTC·backtest 用·默认 now）' },
        runs: { type: 'string', desc: 'MC trials（默认 2000）' },
        seed: { type: 'string', desc: 'PRNG 种子（复现·默认 42）' },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: [
        'ccm estimate cost-to-complete',
        'ccm estimate cost-to-complete --scope this-repo --seed 42 --json',
      ],
      handler: 'estimate.costToComplete',
    },
  },

  // ════════════════════ account（换号号池 CRUD·Phase 2a·token-blind）═══════════════════════════════════
  //   号池备号 OAuth token 的录入 / 删除 / 刷新 / 列号——**非 board 操作**（不抢 board-lock·自管 accounts.json
  //   registry + vault）。token 全程经引擎安全层（keychain argv / file 0600 vault / 探测只回布尔），绝不进
  //   stdout/log/registry 明文。vault-kind enum 是 CLI-local 字面量（非 board-model 概念·同 usage accounts 先例）。
  account: {
    add: {
      summary: '录入当前登录号的完整 OAuth blob 进 vault + accounts.json（身份 guard·token-blind）',
      read: false,
      positionals: [{ name: 'email', required: true }],
      options: {
        'vault-kind': {
          type: 'string',
          enum: ['keychain', 'file'],
          desc: 'vault 形态（默认 mac=keychain·非 mac=file 明文 floor）',
        },
        'vault-file': { type: 'string', desc: 'file vault 路径（默认 <home>/accounts.env）' },
        'keychain-service': { type: 'string', desc: 'keychain service（默认 cc-master-oauth）' },
        expires: { type: 'string', desc: 'token_expires_at（严格 ISO·默认 now+365d）' },
        registry: { type: 'string', desc: 'accounts.json 路径（默认 <home>/accounts.json）' },
        json: { type: 'boolean', desc: '结构化输出（非密·绝不含 token）' },
      },
      examples: ['ccm account add me@x.com', 'ccm account add me@x.com --vault-kind file'],
      handler: 'account.add',
    },
    refresh: {
      summary: '重捕获当前登录号 blob 并 upsert（= add 幂等·更新 token_refreshed_at）',
      read: false,
      positionals: [{ name: 'email', required: true }],
      options: {
        'vault-kind': { type: 'string', enum: ['keychain', 'file'], desc: 'vault 形态' },
        'vault-file': { type: 'string', desc: 'file vault 路径' },
        'keychain-service': { type: 'string', desc: 'keychain service' },
        expires: { type: 'string', desc: 'token_expires_at（严格 ISO·默认 now+365d）' },
        registry: { type: 'string', desc: 'accounts.json 路径' },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm account refresh me@x.com'],
      handler: 'account.refresh',
    },
    delete: {
      summary: '从号池删一个备号（vault token + registry entry·破坏性·非 TTY 须 --yes）',
      read: false,
      positionals: [{ name: 'email', required: true }],
      options: {
        'vault-kind': {
          type: 'string',
          enum: ['keychain', 'file'],
          desc: 'vault 形态（缺省从 registry 推断）',
        },
        'vault-file': { type: 'string', desc: 'file vault 路径' },
        'keychain-service': { type: 'string', desc: 'keychain service' },
        registry: { type: 'string', desc: 'accounts.json 路径' },
        yes: { type: 'boolean', desc: '非 TTY 确认（破坏性）' },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm account delete old@x.com --yes'],
      handler: 'account.deleteAccount',
    },
    list: {
      summary:
        '只读列号池：email · vault 形态 · 到期 · active · switchable · token 状态（绝不取 token 值）',
      read: true,
      positionals: [],
      options: {
        'probe-keychain': {
          type: 'boolean',
          desc: 'security find 探活 keychain 项（不带 -w·只验存在性）',
        },
        registry: { type: 'string', desc: 'accounts.json 路径' },
        json: { type: 'boolean', desc: 'JSON 数组' },
      },
      examples: ['ccm account list', 'ccm account list --probe-keychain --json'],
      handler: 'account.list',
    },
    switch: {
      summary:
        '无重启换号：选最优切入号 → refresh → 覆写官方共享凭证三存储（运行中 claude 惰性重读接管·不重启进程·token-blind）',
      read: false,
      positionals: [],
      options: {
        email: {
          type: 'string',
          desc: '切入号 email（缺省=自动选号 select-account·选最优切入号）',
        },
        account: { type: 'string', desc: '--email 旧别名（同样跳过自动选号）' },
        'vault-kind': {
          type: 'string',
          enum: ['keychain', 'file'],
          desc: 'vault 形态（缺省从 registry 读）',
        },
        'vault-file': {
          type: 'string',
          desc: 'file vault 路径（缺省从 registry / <home>/accounts.env）',
        },
        'keychain-service': {
          type: 'string',
          desc: 'keychain service（缺省从 registry / cc-master-oauth）',
        },
        registry: { type: 'string', desc: 'accounts.json 路径（默认 <home>/accounts.json）' },
        now: { type: 'string', desc: '选号「现在」时刻覆写（严格 ISO·确定性测试用）' },
        json: { type: 'boolean', desc: '结构化输出（非密·绝不含 token）' },
      },
      examples: ['ccm account switch', 'ccm account switch --email next@x.com --board <path>'],
      handler: 'account.switchAccount',
    },
  },
};

// ── ALIASES：热路径顶层捷径（cli-design §3.4·只给最高频两个）。alias → [noun, verb]。──────────────
export const ALIASES: Record<string, [string, string]> = {
  next: ['board', 'next'],
  lint: ['board', 'lint'],
  ls: ['task', 'list'], // task ls 别名（cli-design §3.2，verb 级；router 在 task 域内识别）
  peers: ['peers', 'list'], // `ccm peers` → `ccm peers list`（COORD·设计稿 §9 verb 面就这一个只读）
};

// ── WRITABLE_FIELDS_COVERED：反漂移门用（cli-design §3.5）────────────────────────────────────────
//   遍历 REGISTRY 全部写命令的 options，收集所有 options[].field 的 dotpath 集合，并标记是否存在 --set / --set-json
//   通配逃生口。供 registry.test 断言「每个 writer=agent 经 CLI 的 FIELDS 字段都有 CLI 入口」。
//   返回 { fields:Set<string>, hasSet:boolean, hasSetJson:boolean }。
export function WRITABLE_FIELDS_COVERED(): {
  fields: Set<string>;
  hasSet: boolean;
  hasSetJson: boolean;
} {
  const fields = new Set<string>();
  let hasSet = false;
  let hasSetJson = false;
  // 注（T2a port·noUncheckedIndexedAccess）：键源自 Object.keys，索引必命中——逐处窄断言，不改逻辑。
  for (const noun of Object.keys(REGISTRY)) {
    const nounSpec = REGISTRY[noun] as NounSpec;
    for (const verb of Object.keys(nounSpec)) {
      const spec = nounSpec[verb] as VerbSpec;
      if (spec.read) continue; // 只看写命令
      const opts = spec.options || {};
      for (const flag of Object.keys(opts)) {
        const o = opts[flag] as OptionSpec;
        if (o.transform === 'kv') hasSet = true;
        if (o.transform === 'json') hasSetJson = true;
        if (o.field) fields.add(o.field);
      }
    }
  }
  return { fields, hasSet, hasSetJson };
}
