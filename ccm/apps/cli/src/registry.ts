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
        type: { type: 'string', enum: E.taskType, desc: '只列某 type' },
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
        type: { type: 'string', field: 'type', enum: E.taskType, desc: '任务类型' },
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
};

// ── ALIASES：热路径顶层捷径（cli-design §3.4·只给最高频两个）。alias → [noun, verb]。──────────────
export const ALIASES: Record<string, [string, string]> = {
  next: ['board', 'next'],
  lint: ['board', 'lint'],
  ls: ['task', 'list'], // task ls 别名（cli-design §3.2，verb 级；router 在 task 域内识别）
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
