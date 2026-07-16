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
  capability: {
    check: {
      summary: '检查当前 ccm 是否兑现指定稳定 capability',
      read: true,
      positionals: [{ name: 'capability-id', required: true }],
      options: { json: { type: 'boolean', desc: '结构化输出' } },
      examples: ['ccm capability check goal-contract/v1 --json'],
      handler: 'capability.check',
    },
  },
  // ════════════════════ worker（R0：raw agent-command passthrough + session lifecycle）══════════════
  worker: {
    help: {
      summary: '运行目标 agent command 的真实 --help 并原样返回 stdout/stderr/exit',
      read: true,
      positionals: [],
      options: {
        harness: {
          type: 'string',
          required: true,
          enum: ['codex', 'claude-code', 'cursor-agent'],
          desc: '目标 harness CLI',
        },
      },
      examples: ['ccm worker help --harness codex'],
      handler: 'worker.help',
    },
    run: {
      summary: '原样透传 provider argv/stdin/cwd，并管理一次 session-bound 进程生命周期',
      read: true,
      positionals: [{ name: 'provider-argv...', required: false }],
      options: {
        harness: {
          type: 'string',
          required: true,
          enum: ['codex', 'claude-code', 'cursor-agent'],
          desc: '目标 harness CLI',
        },
        cwd: { type: 'string', required: false, desc: 'child cwd 的绝对路径（默认当前目录）' },
        'timeout-ms': { type: 'string', required: false, desc: '总超时，50..600000 毫秒' },
        'max-output-bytes': {
          type: 'string',
          required: false,
          desc: '每个 output stream 上限，256..1048576 字节',
        },
      },
      examples: [
        'ccm worker run --harness codex --cwd /abs/repo -- "review this repo"',
        'ccm worker run --harness claude-code --cwd /abs/repo -- --print "review this repo"',
        'ccm worker run --harness cursor-agent --cwd /abs/repo -- --print "review this repo"',
      ],
      handler: 'worker.run',
    },
  },
  // ════════════════════ quota（provider-neutral；Codex rule 为 7d-only）═══════════════════════════
  quota: {
    status: {
      summary: '读取本机 quota observation/reservation store 的可用状态',
      read: true,
      positionals: [],
      options: { json: { type: 'boolean', desc: '结构化输出' } },
      examples: ['ccm quota status --json'],
      handler: 'quota.status',
    },
    preflight: {
      summary: '从 owner-only authority store 重验 quota admission，或纯机械求值 lifecycle deny',
      read: true,
      positionals: [],
      options: {
        input: {
          type: 'string',
          required: true,
          desc: 'authority refs 或 lifecycle effect JSON（@file / - / 字面量）',
        },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm quota preflight --input @/abs/admission.json --json'],
      handler: 'quota.preflight',
    },
    reserve: {
      summary: '在 payer+pool aggregation locks 内原子创建 owner-only quota hold',
      read: false,
      positionals: [],
      options: {
        input: {
          type: 'string',
          required: true,
          desc: 'quota reservation request JSON（@file / - / 字面量）',
        },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm quota reserve --input @/abs/reservation.json --json'],
      handler: 'quota.reserve',
    },
    audit: {
      summary: '以 launch/process evidence 审计 reservation；未知证据绝不释放容量',
      read: false,
      positionals: [],
      options: {
        input: {
          type: 'string',
          required: true,
          desc: 'quota audit evidence JSON（@file / - / 字面量）',
        },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm quota audit --input @/abs/audit.json --json'],
      handler: 'quota.audit',
    },
  },
  // ════════════════════ provider ══════════════════════════════════════════════════════════════════
  provider: {
    facts: {
      summary: '读取带官方来源、有效期与未知项的 provider 模型事实快照（零 live probe）',
      read: true,
      positionals: [{ name: 'provider', required: true }],
      options: {
        'as-of': {
          type: 'string',
          desc: '冻结求值时间（严格 UTC；缺省为当前时间）',
        },
        json: { type: 'boolean', desc: '输出 ccm/provider-model-facts/v1 JSON' },
      },
      examples: [
        'ccm provider facts codex --json',
        'ccm provider facts cursor --as-of 2026-07-15T12:00:00Z --json',
      ],
      handler: 'provider.facts',
    },
    inspect: {
      summary: '以冻结 env、只读 Codex 探测与一次受资格门控的执行检查 candidate',
      read: true,
      positionals: [{ name: 'provider', required: true }],
      options: {
        request: {
          type: 'string',
          required: true,
          desc: 'ccm/codex-provider-inspect-request/v1 JSON（@file / 字面量）',
        },
        json: { type: 'boolean', desc: '输出 ccm/codex-provider-inspection/v1 JSON' },
      },
      examples: ['ccm provider inspect codex --request @/abs/request.json --json'],
      handler: 'provider.inspect',
    },
  },
  // ════════════════════ orchestrator / route (C1 shadow-only) ════════════════════════════════════
  orchestrator: {
    context: {
      summary: '从显式本地 cache 构建 frozen orchestrator context（只读、零 probe）',
      read: true,
      positionals: [],
      options: {
        'cached-only': {
          type: 'boolean',
          required: true,
          desc: '强制只读 cache；本命令没有 live fallback',
        },
        snapshot: {
          type: 'string',
          desc: 'ccm/machine-context-cache/v1 JSON（@file / - / 字面量）',
        },
        'agent-visible': {
          type: 'boolean',
          desc: '输出三路 origin 共用的脱敏、限长、shadow-only ambient delivery',
        },
        'as-of': {
          type: 'string',
          required: true,
          desc: '冻结求值时间（严格 UTC）',
        },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: [
        'ccm orchestrator context --cached-only --agent-visible --snapshot @/abs/machine.json --as-of 2026-07-13T03:05:00Z --harness codex --json',
      ],
      handler: 'orchestrator.context',
    },
  },
  route: {
    advise: {
      summary: '对 frozen task + cached context 生成纯 shadow route advice（spawned=false）',
      read: true,
      positionals: [{ name: 'task-id', required: true }],
      options: {
        context: {
          type: 'string',
          required: true,
          desc: 'ccm/orchestrator-context/v1 JSON（@file / - / 字面量）',
        },
        origin: { type: 'string', required: true, desc: 'origin harness id' },
        'as-of': {
          type: 'string',
          required: true,
          desc: '冻结求值时间（严格 UTC）',
        },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: [
        'ccm route advise T7 --context @/abs/context.json --origin codex --as-of 2026-07-13T03:05:00Z --json',
      ],
      handler: 'route.advise',
    },
  },
  // ════════════════════ attempt（cross-harness managed worker 的本地 write-set 预检）══════════════
  attempt: {
    'write-set': {
      summary: '解析隔离 worktree + lease，编译最小本地写集（仅 preflight；尚不启动 worker）',
      read: false,
      positionals: [],
      options: {
        lease: {
          type: 'string',
          required: true,
          transform: 'input',
          desc: 'ccm/worktree-write-lease/v1 JSON：字面量、@file 或 -',
        },
        profile: {
          type: 'string',
          required: true,
          enum: ['codex-managed-workspace', 'claude-managed-workspace'],
          desc: 'managed harness permission mapping（fixture-only）',
        },
        'artifact-root': {
          type: 'string',
          multiple: true,
          desc: '显式声明的 read-write artifact root（可重复；必须在 lease 内）',
        },
        'artifact-root-ro': {
          type: 'string',
          multiple: true,
          desc: '显式声明的 read-only artifact root（可重复；必须在 lease 内）',
        },
        json: { type: 'boolean', desc: '结构化输出 write-set plan' },
      },
      examples: [
        'ccm attempt write-set --lease @lease.json --profile codex-managed-workspace --artifact-root /abs/repo/design_docs/plans --json',
      ],
      handler: 'attempt.writeSet',
    },
  },
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
        'github-issue': {
          type: 'string',
          field: 'source.github_issue.url',
          desc: '以 GitHub issue URL 作为 board 需求来源',
        },
        capabilities: {
          type: 'boolean',
          desc: '只读返回 board init 能力列表（不解析路径、不加锁、不写盘）',
        },
      },
      examples: [
        'ccm board init --goal "试验性编排"',
        'ccm board init --github-issue https://github.com/owner/repo/issues/123',
      ],
      handler: 'board.init',
    },
    update: {
      summary: '改板级配置：goal / wip-limit / git / priority / 顶层 ✎ 字段（--set）',
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
        priority: {
          type: 'string',
          field: 'coordination.priority',
          desc: 'coordination.priority（板级优先级·urgent|high|normal|low|trivial）',
        },
        set: {
          type: 'string',
          transform: 'kv',
          multiple: true,
          desc: '设板级顶层 ✎ 标量（path=val·裸 path 落 board 顶层，🔒 拒；tasks[<id>].path 作用于该 task）',
        },
        'set-json': {
          type: 'string',
          transform: 'json',
          multiple: true,
          desc: '设板级顶层 ✎ 对象/数组（path=json·裸 path 落 board 顶层；tasks[<id>].path 作用于该 task）',
        },
      },
      examples: [
        'ccm board update --goal "v0.10.0 收尾"',
        'ccm board update --wip-limit 4 --branch board-v2-redesign',
        'ccm board update --priority high',
        'ccm board update --set notes="收尾备注"',
      ],
      handler: 'board.update',
    },
    archive: {
      summary: '归档板（owner.active→false·停用即休眠·带锁·显式可逆·可经 --resume 复活）',
      read: false,
      positionals: [],
      options: {
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm board archive', 'ccm board archive --board <path>'],
      handler: 'board.archive',
    },
    'set-param': {
      summary:
        '写 board.runtime.<白名单 key>（hook-owned 参数区·ADR-020·least-privilege·带锁）；非白名单 key / 非法值 → exit 2',
      read: false,
      positionals: [
        { name: 'key', required: true },
        { name: 'value', required: true },
      ],
      options: {
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: [
        'ccm board set-param last_identity_remind 2026-06-29T12:34:56Z',
        'ccm board set-param last_critpath_remind 2026-06-30T08:00:00Z --board <path>',
      ],
      handler: 'board.setParam',
    },
    'stamp-harness': {
      summary: 'ARM 时从可信 harness env 盖 owner.harness（detect 命中才写；无 env 不覆盖既有值）',
      read: false,
      positionals: [],
      options: {
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm board stamp-harness --board <path> --json'],
      handler: 'board.stampHarness',
    },
    'enable-contract': {
      summary: '预检/启用 task-planning/v1 + agent-routing/v1（历史 terminal 精确 grandfather）',
      read: false,
      positionals: [],
      options: {
        preflight: { type: 'boolean', desc: '只读列出 activation gaps 与 grandfathered terminal' },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm board enable-contract --preflight --json', 'ccm board enable-contract'],
      handler: 'board.enableContract',
    },
  },
  goal: {
    set: {
      summary: '首次写入 normalized goal 与可选 Goal Brief',
      read: false,
      positionals: [],
      options: {
        summary: { type: 'string', required: true, desc: '短、无歧义、可验收的 normalized goal' },
        assurance: {
          type: 'string',
          required: true,
          enum: ['pending', 'asserted'],
          desc: '分级确认状态',
        },
        'brief-file': { type: 'string', desc: '待复制进 ccm home 的 UTF-8 Goal Brief' },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm goal set --summary "交付 draft PR" --assurance asserted --json'],
      handler: 'goal.set',
    },
    confirm: {
      summary: '在用户明确授权后确认当前 Goal Contract revision',
      read: false,
      positionals: [],
      options: {
        'user-authorized': {
          type: 'boolean',
          required: true,
          desc: '声明当前对话已有用户明确确认；agent 不得自授权',
        },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm goal confirm --user-authorized --json'],
      handler: 'goal.confirm',
    },
    amend: {
      summary: '以新 revision 修改 goal 语义并保留旧 Brief',
      read: false,
      positionals: [],
      options: {
        summary: { type: 'string', required: true, desc: '新版 normalized goal' },
        reason: { type: 'string', required: true, desc: '相对上一 revision 的语义变更原因' },
        assurance: {
          type: 'string',
          required: true,
          enum: ['pending', 'asserted'],
          desc: '新版分级确认状态',
        },
        'brief-file': { type: 'string', desc: '新版完整 Goal Brief' },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: [
        'ccm goal amend --summary "交付 PR，不发布" --reason "用户收窄范围" --assurance asserted --json',
      ],
      handler: 'goal.amend',
    },
    show: {
      summary: '显示当前 Goal Contract 与受管 Brief 路径',
      read: true,
      positionals: [],
      options: { json: { type: 'boolean', desc: '结构化输出' } },
      examples: ['ccm goal show --json'],
      handler: 'goal.show',
    },
    check: {
      summary: '校验 Goal Contract 形状、Brief containment/存在性/hash',
      read: true,
      positionals: [],
      options: { json: { type: 'boolean', desc: '结构化输出' } },
      examples: ['ccm goal check --json'],
      handler: 'goal.check',
    },
  },

  // ════════════════════ declared delivery/dependency truth（ADR-036）════════════════════════════
  target: {
    set: {
      summary: '声明并本地解析一个 delivery target（只用本地 Git objects / immutable manifest）',
      read: false,
      positionals: [{ name: 'target-id', required: true }],
      options: {
        kind: {
          type: 'string',
          required: true,
          enum: ['git-ref', 'artifact-set'],
          desc: '目标类型',
        },
        ref: { type: 'string', desc: 'git-ref 的 symbolic ref' },
        repository: { type: 'string', desc: '显式本地 Git worktree；缺省用 board.git.worktree' },
        namespace: { type: 'string', desc: 'artifact-set 的 file:/absolute/manifest.json' },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: [
        'ccm target set main --kind git-ref --ref refs/remotes/origin/main',
        'ccm target set archive --kind artifact-set --namespace file:/abs/manifest.json',
      ],
      handler: 'target.set',
    },
    show: {
      summary: '显示 target 声明、冻结 snapshot 与当前本地 drift fact',
      read: true,
      positionals: [{ name: 'target-id', required: true }],
      options: { json: { type: 'boolean', desc: '结构化输出' } },
      examples: ['ccm target show main --json'],
      handler: 'target.show',
    },
    refresh: {
      summary: '本地重解 target snapshot，并使旧 observation fail-closed 后重验可重验 proof',
      read: false,
      positionals: [{ name: 'target-id', required: true }],
      options: { json: { type: 'boolean', desc: '结构化输出' } },
      examples: ['ccm target refresh main --dry-run', 'ccm target refresh main --json'],
      handler: 'target.refresh',
    },
  },
  delivery: {
    check: {
      summary: '检查一个 task candidate 对一个 target 的 delivered 三态事实',
      read: true,
      positionals: [
        { name: 'task-id', required: true },
        { name: 'target-id', required: true },
      ],
      options: { json: { type: 'boolean', desc: '结构化输出' } },
      examples: ['ccm delivery check UPSTREAM main --json'],
      handler: 'delivery.check',
    },
    audit: {
      summary: '只读 strict preview：未声明 requirement 的 edge 报 unknown；绝不持久化 strict',
      read: true,
      positionals: [],
      options: {
        'strict-dry-run': {
          type: 'boolean',
          required: true,
          desc: '启用本次 ephemeral strict preview',
        },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm delivery audit --strict-dry-run --json'],
      handler: 'delivery.audit',
    },
  },
  dependency: {
    require: {
      summary: '给 exact downstream/dependency edge 声明 candidate 或 delivered 要求',
      read: false,
      positionals: [
        { name: 'downstream-id', required: true },
        { name: 'dependency-id', required: true },
      ],
      options: {
        level: {
          type: 'string',
          required: true,
          enum: ['candidate', 'delivered'],
          desc: '资格层级',
        },
        target: { type: 'string', desc: 'level=delivered 时必给的 target id' },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm dependency require DOWN UP --level delivered --target main'],
      handler: 'dependency.require',
    },
    default: {
      summary: '给 downstream 的未精确覆盖 deps[] edge 声明 * 默认要求',
      read: false,
      positionals: [{ name: 'downstream-id', required: true }],
      options: {
        level: {
          type: 'string',
          required: true,
          enum: ['candidate', 'delivered'],
          desc: '资格层级',
        },
        target: { type: 'string', desc: 'level=delivered 时必给的 target id' },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm dependency default DOWN --level candidate'],
      handler: 'dependency.defaultRequirement',
    },
    explain: {
      summary: '解释 exact edge 的 qualified|unqualified|unknown 派生资格与 diagnostic codes',
      read: true,
      positionals: [
        { name: 'downstream-id', required: true },
        { name: 'dependency-id', required: true },
      ],
      options: {
        'strict-dry-run': { type: 'boolean', desc: '本次把未声明 edge 当 unknown；不写板' },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm dependency explain DOWN UP --json'],
      handler: 'dependency.explain',
    },
    waive: {
      summary: '写入 user-authorized、edge-scoped、expiring waiver（不伪造 target_delivered）',
      read: false,
      positionals: [
        { name: 'downstream-id', required: true },
        { name: 'dependency-id', required: true },
      ],
      options: {
        target: { type: 'string', required: true, desc: 'exact requirement 的 target id' },
        reason: { type: 'string', required: true, desc: '用户批准的具体理由' },
        'expires-at': { type: 'string', required: true, desc: '严格 ISO UTC expiry' },
        'user-authorized': { type: 'boolean', desc: '显式用户授权闸；缺失 exit 7' },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: [
        'ccm dependency waive DOWN UP --target main --reason "user approved" --expires-at 2026-07-21T00:00:00Z --user-authorized',
      ],
      handler: 'dependency.waive',
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
        'review-gate': {
          type: 'string',
          field: 'reviewGate',
          enum: ['APPROVE'],
          desc: '声明 review 依赖门：仅 APPROVE 才满足下游 deps',
        },
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
          desc: '设本 task 的 ✎ 标量（path=val·裸 path 作用于本 task；tasks[<id>].path 可写其它 task）',
        },
        'set-json': {
          type: 'string',
          transform: 'json',
          multiple: true,
          desc: '设本 task 的 ✎ 对象/数组（path=json·裸 path 作用于本 task；tasks[<id>].path 可写其它 task）',
        },
        log: { type: 'string', desc: '同时追一条 log' },
      },
      examples: [
        'ccm task add T7 --type development --deps T1 --estimate 3h',
        'ccm task add REVIEW --type review --review-gate APPROVE',
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
        'review-gate': {
          type: 'string',
          field: 'reviewGate',
          enum: ['APPROVE'],
          desc: '声明 review 依赖门：仅 APPROVE 才满足下游 deps',
        },
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
        set: {
          type: 'string',
          transform: 'kv',
          multiple: true,
          desc: '设本 task 的 ✎ 标量（path=val·裸 path 作用于本 task；tasks[<id>].path 可写其它 task）',
        },
        'set-json': {
          type: 'string',
          transform: 'json',
          multiple: true,
          desc: '设本 task 的 ✎ 对象/数组（path=json·裸 path 作用于本 task；tasks[<id>].path 可写其它 task）',
        },
        log: { type: 'string', desc: '同时追一条 log' },
      },
      examples: [
        'ccm task update T7 --estimate 5h --add-dep T2',
        'ccm task update T7 --rm-dep T2 --verified --artifact /abs/out.md',
        'ccm task update T7 --set-json \'decision_package={"question":"…"}\'',
      ],
      handler: 'task.update',
    },
    start: {
      summary: '起跑（→ in_flight·盖 started_at；可批量：多个 id 一次 mutate+lint+write）',
      read: false,
      positionals: [{ name: 'id...', required: true }],
      options: {
        log: { type: 'string', desc: '同时追一条 log' },
      },
      examples: ['ccm task start T7', 'ccm task start T7 T8 T9'],
      handler: 'task.start',
    },
    done: {
      summary:
        '完成（→ done·盖 finished_at；可批量：多个 id 一次 mutate+lint+write，根治批量回填死结）',
      read: false,
      positionals: [{ name: 'id...', required: true }],
      options: {
        artifact: {
          type: 'string',
          field: 'artifact',
          desc: '产物链接（绝对路径 / URL；批量时对每个 id 一视同仁）',
        },
        verified: {
          type: 'boolean',
          field: 'verified',
          desc: '标记已端点验收（批量时对每个 id 一视同仁）',
        },
        'review-verdict': {
          type: 'string',
          field: 'reviewVerdict',
          enum: E.reviewVerdict,
          desc: 'review 结论（APPROVE 才开门；REQUEST-CHANGES 保持下游 blocked）',
        },
        log: { type: 'string', desc: '同时追一条 log（批量只追一条，summary 含全部 id）' },
      },
      examples: [
        'ccm task done T7 --artifact /abs/out.md --verified',
        'ccm task done REVIEW --artifact /abs/review.md --verified --review-verdict APPROVE',
        'ccm task done T7 T8 T9 --artifact /abs/out.md --verified',
      ],
      handler: 'task.done',
    },
    retry: {
      summary:
        '重试（stale|failed|escalated → ready；原子归档旧 attempt evidence 并清时间/产物、verified=false）',
      read: false,
      positionals: [{ name: 'id...', required: true }],
      options: {
        log: { type: 'string', desc: '除自动 retry 审计外再追一条自定义 log' },
      },
      examples: ['ccm task retry T7', 'ccm task retry T7 T8 T9'],
      handler: 'task.retry',
    },
    'attest-delivery': {
      summary:
        '以本地 exact/reviewed/artifact proof 为当前 true-done candidate 写 delivery observation',
      read: false,
      positionals: [{ name: 'id', required: true }],
      options: {
        target: { type: 'string', required: true, desc: '已声明 target id' },
        method: {
          type: 'string',
          required: true,
          enum: [
            'git-commit-contained',
            'reviewed-reconciliation-contained',
            'artifact-digest-contained',
          ],
          desc: 'proof method',
        },
        'candidate-commit': {
          type: 'string',
          desc: 'git proof 的 candidate commit/ref（本地解析为 OID）',
        },
        'integration-commit': {
          type: 'string',
          desc: 'reviewed reconciliation 的 integration commit/ref',
        },
        attestation: { type: 'string', desc: 'review attestation 的本地绝对路径（≤1 MiB）' },
        'logical-name': { type: 'string', desc: 'artifact subject logical_name' },
        'artifact-version': { type: 'string', desc: 'artifact subject immutable version' },
        'artifact-ref': { type: 'string', desc: 'artifact subject immutable ref' },
        'artifact-digest': { type: 'string', desc: 'artifact subject sha256 digest' },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: [
        'ccm task attest-delivery UP --target main --method git-commit-contained --candidate-commit HEAD',
      ],
      handler: 'task.attestDelivery',
    },
    'set-planning': {
      summary: '经 dedicated writer 写 task-planning/v1 多维任务画像',
      read: false,
      positionals: [{ name: 'id', required: true }],
      options: {
        profile: {
          type: 'string',
          field: 'planning',
          required: true,
          desc: 'planning JSON（@/absolute/file.json、- 或 JSON 字面量）',
        },
        json: { type: 'boolean', desc: '输出完整 task JSON' },
      },
      examples: ['ccm task set-planning T7 --profile @/abs/planning.json'],
      handler: 'task.setPlanning',
    },
    'set-routing': {
      summary: '经 dedicated writer 写 agent-routing/v1 policy（不 selection / 不 spawn）',
      read: false,
      positionals: [{ name: 'id', required: true }],
      options: {
        policy: {
          type: 'string',
          field: 'routing',
          required: true,
          desc: 'routing policy JSON（objective/constraints/candidates/ample+tight/fallback）',
        },
        json: { type: 'boolean', desc: '输出完整 task JSON' },
      },
      examples: ['ccm task set-routing T7 --policy @/abs/routing-policy.json'],
      handler: 'task.setRouting',
    },
    'route-bind': {
      summary:
        '原子写 selection + append running attempt snapshot + opaque handle claim + in_flight',
      read: false,
      positionals: [{ name: 'id', required: true }],
      options: {
        selection: {
          type: 'string',
          required: true,
          desc: 'qualified selection JSON（@file / - / 字面量）',
        },
        attempt: {
          type: 'string',
          required: true,
          desc: 'running attempt JSON；writer 自动冻结 selection_snapshot',
        },
        json: { type: 'boolean', desc: '输出完整 task JSON' },
      },
      examples: [
        'ccm task route-bind T7 --selection @/abs/selection.json --attempt @/abs/attempt.json',
      ],
      handler: 'task.routeBind',
    },
    'native-attempt-create': {
      summary: '创建 host-native starting attempt；只返回 launch permission，不伪造 running',
      read: false,
      positionals: [{ name: 'id', required: true }],
      options: {
        selection: { type: 'string', required: true, desc: 'qualified selection JSON' },
        attempt: { type: 'string', required: true, desc: 'starting native attempt JSON' },
        'replay-intent': {
          type: 'string',
          required: true,
          enum: ['accept-no-launch', 'require-new-launch'],
          desc: '精确重放意图；重放绝不再次授权 launch',
        },
        json: { type: 'boolean', desc: '输出 operation result JSON' },
      },
      examples: [
        'ccm task native-attempt-create T7 --selection @/abs/selection.json --attempt @/abs/attempt.json --replay-intent accept-no-launch',
      ],
      handler: 'task.nativeAttemptCreate',
    },
    'native-attempt-bind': {
      summary: '经私有 owner evidence 鉴权绑定真实 native handle（starting → running）',
      read: false,
      positionals: [{ name: 'id', required: true }],
      options: {
        'attempt-id': { type: 'string', required: true, desc: 'native attempt id' },
        'evidence-record-ref': {
          type: 'string',
          required: true,
          desc: 'owner-only evidence record ref（不接受调用方自证 JSON）',
        },
        json: { type: 'boolean', desc: '输出 operation result JSON' },
      },
      examples: [
        'ccm task native-attempt-bind T7 --attempt-id attempt-1 --evidence-record-ref evidence:bind-1',
      ],
      handler: 'task.nativeAttemptBind',
    },
    'native-attempt-cancel': {
      summary: '记录幂等 cancel request 并返回 host control effect；ack 不作 terminal',
      read: false,
      positionals: [{ name: 'id', required: true }],
      options: {
        'attempt-id': { type: 'string', required: true, desc: 'native attempt id' },
        request: { type: 'string', required: true, desc: 'cancel request JSON' },
        'acknowledgement-terminal-class': {
          type: 'string',
          desc: '拒绝用 cancel acknowledgement 伪造 terminal（负向契约入口）',
        },
        json: { type: 'boolean', desc: '输出 operation result JSON' },
      },
      examples: [
        'ccm task native-attempt-cancel T7 --attempt-id attempt-1 --request @/abs/cancel.json',
      ],
      handler: 'task.nativeAttemptCancel',
    },
    'native-attempt-terminal': {
      summary: '以 owner evidence 记录 native terminal；task 只到 uncertain，不直接 done',
      read: false,
      positionals: [{ name: 'id', required: true }],
      options: {
        'attempt-id': { type: 'string', required: true, desc: 'native attempt id' },
        'evidence-record-ref': { type: 'string', required: true, desc: 'terminal evidence ref' },
        'requested-task-status': {
          type: 'string',
          desc: '拒绝 terminal 直接请求 done（负向契约入口）',
        },
        json: { type: 'boolean', desc: '输出 operation result JSON' },
      },
      examples: [
        'ccm task native-attempt-terminal T7 --attempt-id attempt-1 --evidence-record-ref evidence:terminal-1',
      ],
      handler: 'task.nativeAttemptTerminal',
    },
    'native-attempt-reconcile': {
      summary: '以 owner evidence 幂等 reconcile uncertain/running/terminal/orphaned',
      read: false,
      positionals: [{ name: 'id', required: true }],
      options: {
        'attempt-id': { type: 'string', required: true, desc: 'native attempt id' },
        'evidence-record-ref': { type: 'string', required: true, desc: 'reconcile evidence ref' },
        json: { type: 'boolean', desc: '输出 operation result JSON' },
      },
      examples: [
        'ccm task native-attempt-reconcile T7 --attempt-id attempt-1 --evidence-record-ref evidence:reconcile-1',
      ],
      handler: 'task.nativeAttemptReconcile',
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
    unblock: {
      summary: '解除阻塞（清 blocked_on·交回 deps 门控定 ready/blocked）',
      read: false,
      positionals: [{ name: 'id', required: true }],
      options: {
        log: { type: 'string', desc: '同时追一条 log' },
      },
      examples: ['ccm task unblock T7'],
      handler: 'task.unblock',
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
        set: {
          type: 'string',
          transform: 'kv',
          multiple: true,
          desc: '通用设 ✎ 标量（path=val·裸 path 落 board 顶层；tasks[<id>].path 作用于该 task）',
        },
        'set-json': {
          type: 'string',
          transform: 'json',
          multiple: true,
          desc: '通用设 ✎ 对象/数组（path=json·裸 path 落 board 顶层；tasks[<id>].path 作用于该 task）',
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
        set: {
          type: 'string',
          transform: 'kv',
          multiple: true,
          desc: '通用设 ✎ 标量（path=val·裸 path 落 board 顶层；tasks[<id>].path 作用于该 task）',
        },
        'set-json': {
          type: 'string',
          transform: 'json',
          multiple: true,
          desc: '通用设 ✎ 对象/数组（path=json·裸 path 落 board 顶层；tasks[<id>].path 作用于该 task）',
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
        set: {
          type: 'string',
          transform: 'kv',
          multiple: true,
          desc: '通用设 ✎ 标量（path=val·裸 path 落 board 顶层；tasks[<id>].path 作用于该 task）',
        },
        'set-json': {
          type: 'string',
          transform: 'json',
          multiple: true,
          desc: '通用设 ✎ 对象/数组（path=json·裸 path 落 board 顶层；tasks[<id>].path 作用于该 task）',
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
        'job-id': {
          type: 'string',
          field: 'jobId',
          required: true,
          desc: '真实外部调度句柄（必填；用于追踪与 disarm 清理）',
        },
        checklist: { type: 'string', field: 'checklist', desc: '唤醒后该检查什么' },
      },
      examples: [
        'ccm watchdog arm --fire-at 2026-06-24T12:00:00Z --mechanism cron --job-id cron-abc --checklist "查后台 3 个 subagent"',
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

  // ════════════════════ coordination（ADR-032 notification inbox）═══════════════════════════════════
  coordination: {
    inbox: {
      summary: '通知收件箱：coordination inbox list|ack（durable advisory 投递面）',
      read: false,
      positionals: [
        { name: 'list|ack', required: true },
        { name: 'id...', required: false },
      ],
      options: {
        unconsumed: { type: 'boolean', desc: 'list 时只列 status=unconsumed 的通知' },
        'current-subscription': {
          type: 'boolean',
          desc: '只按当前 session-bound subscription 精确读取；不匹配时返回空',
        },
        origin: {
          type: 'string',
          enum: ['claude-code', 'codex', 'cursor'],
          desc: '订阅来源 harness（与 session/epoch 一起精确绑定）',
        },
        'session-epoch': { type: 'string', desc: '当前订阅 epoch；旧 epoch fail closed' },
        capability: { type: 'string', desc: '当前固定为 coordination-inbox' },
        note: { type: 'string', desc: 'ack 时记录 consumed_note' },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: [
        'ccm coordination inbox list --unconsumed --json',
        'ccm coordination inbox ack ntf-20260709T120000Z-a1b2 --note "降档并暂停 fill-work"',
      ],
      handler: 'coordination.inbox',
    },
    subscription: {
      summary: '注册或读取 credential-free、session-bound coordination inbox 订阅',
      read: false,
      positionals: [{ name: 'register|current', required: true }],
      options: {
        origin: {
          type: 'string',
          enum: ['claude-code', 'codex', 'cursor'],
          required: true,
          desc: '订阅来源 harness',
        },
        capability: {
          type: 'string',
          required: true,
          desc: '当前固定为 coordination-inbox',
        },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: [
        'ccm coordination subscription register --origin codex --session-id SID --capability coordination-inbox --json --no-input',
        'ccm coordination subscription current --origin codex --session-id SID --capability coordination-inbox --json --no-input',
      ],
      handler: 'coordination.subscription',
    },
    notify: {
      summary: '低层 append 一条 coordination.inbox 通知（producer / Tier2 用）',
      read: false,
      positionals: [],
      options: {
        kind: {
          type: 'string',
          enum: E.notificationKind,
          required: true,
          desc: '通知类型（闭集）',
        },
        summary: { type: 'string', required: true, desc: '人类可读摘要' },
        strength: {
          type: 'string',
          enum: ['weak', 'strong'],
          desc: 'ADR-018 advisory strength（默认 strong）',
        },
        payload: { type: 'string', desc: 'JSON object payload（默认 {}）' },
        expires: {
          type: 'string',
          required: true,
          desc: 'expires_at，严格 ISO-8601 UTC',
        },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: [
        'ccm coordination notify --kind pacing_yield --summary "为高优 peer 让路" --strength strong --payload \'{"peer":"A"}\' --expires 2026-07-09T17:00:00Z',
      ],
      handler: 'coordination.notify',
    },
    arbitrate: {
      summary:
        '运行 deterministic pool arbiter，按同 harness 池计算 pacing 建议并按边沿写入本板 inbox',
      read: false,
      positionals: [],
      options: {
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm coordination arbitrate --json'],
      handler: 'coordination.arbitrate',
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
      summary: '单侧 verdict（hold|throttle|switch|stop_5h|stop_7d）+ lever + switch_candidate',
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

  // ════════════════════ status-report（生成式 board 状态报告·ADR-030）══════════════════════════════
  'status-report': {
    render: {
      summary: '纯计算生成 ccm/status-report/v1 到 stdout（不写 board、不写 artifact）',
      read: true,
      positionals: [],
      options: {
        'as-of': { type: 'string', desc: 'as-of 时刻（ISO-8601 UTC·默认 now）' },
        'max-age': { type: 'string', desc: '报告 TTL（默认 30s；支持 s/m/h/d）' },
        json: { type: 'boolean', desc: '输出稳定 JSON envelope（默认人类摘要）' },
      },
      examples: ['ccm status-report render --json', 'ccm status-report render --board <path>'],
      handler: 'statusreport.render',
    },
    write: {
      summary: '生成并原子写报告 artifact；fresh artifact 默认复用（--force 强制刷新）',
      read: false,
      positionals: [],
      options: {
        'as-of': { type: 'string', desc: 'as-of 时刻（ISO-8601 UTC·默认 now）' },
        'max-age': { type: 'string', desc: '报告 TTL（默认 30s；支持 s/m/h/d）' },
        json: { type: 'boolean', desc: '输出完整 JSON envelope' },
      },
      examples: ['ccm status-report write', 'ccm status-report write --json'],
      handler: 'statusreport.write',
    },
    show: {
      summary: '用户入口：读取 fresh artifact，缺失/过期/--refresh 时刷新后显示',
      read: true,
      positionals: [],
      options: {
        refresh: { type: 'boolean', desc: '忽略现有 artifact，强制刷新' },
        'as-of': { type: 'string', desc: 'as-of 时刻（ISO-8601 UTC·默认 now）' },
        'max-age': { type: 'string', desc: '报告 TTL（默认 30s；支持 s/m/h/d）' },
        json: { type: 'boolean', desc: '输出完整 JSON envelope' },
      },
      examples: ['ccm status-report show', 'ccm status-report show --json --refresh'],
      handler: 'statusreport.show',
    },
    watch: {
      summary: '前台周期刷新报告 artifact（v1：用 --iterations 做有界 tick；同 write 路径）',
      read: false,
      positionals: [],
      options: {
        interval: { type: 'string', desc: '刷新间隔（默认 30s；支持 s/m/h/d）' },
        iterations: { type: 'string', desc: '迭代次数；缺省持续运行，测试/脚本建议传 1' },
        'as-of': { type: 'string', desc: 'as-of 时刻（ISO-8601 UTC·默认 now）' },
        'max-age': { type: 'string', desc: '报告 TTL（默认 30s；支持 s/m/h/d）' },
        json: { type: 'boolean', desc: '每次 tick 输出 artifact 元数据 JSON' },
      },
      examples: [
        'ccm status-report watch --interval 30s',
        'ccm status-report watch --iterations 1 --json',
      ],
      handler: 'statusreport.watch',
    },
  },

  // ════════════════════ web-viewer（本地只读 board web viewer lifecycle·ADR-029）═══════════════════
  'web-viewer': {
    start: {
      summary: '启动或复用当前 home 的本地只读 board web viewer service（127.0.0.1 + token）',
      read: false,
      positionals: [],
      options: {
        host: { type: 'string', desc: '监听地址（v1 只允许 127.0.0.1）' },
        port: { type: 'string', desc: '监听端口（默认 0=系统分配；固定端口冲突则失败）' },
        reuse: { type: 'boolean', desc: '复用同 home 的健康 service（默认行为）' },
        board: { type: 'string', desc: '指定 board 文件作 viewer 初始 selection（最高优先）' },
        goal: { type: 'string', desc: '多 active 板时按 goal 子串选初始 selection' },
        'no-open': { type: 'boolean', desc: '只启动/复用，不尝试打开浏览器' },
        json: { type: 'boolean', desc: '结构化输出（start/open 含一次性 open_url）' },
      },
      examples: ['ccm web-viewer start', 'ccm web-viewer start --goal "Ship" --json'],
      handler: 'webviewer.start',
    },
    open: {
      summary:
        '打开当前 home 的 web viewer；默认无 service 时 start-then-open，CI/无 GUI 时打印 URL',
      read: false,
      positionals: [{ name: 'id', required: false }],
      options: {
        'no-start': { type: 'boolean', desc: '只打开已有健康 service；不存在则不启动' },
        board: {
          type: 'string',
          desc: '指定 board 文件作 viewer 初始 selection（service 已在跑也会更新）',
        },
        goal: { type: 'string', desc: '多 active 板时按 goal 子串选初始 selection' },
        json: { type: 'boolean', desc: '结构化输出（含一次性 open_url）' },
      },
      examples: ['ccm web-viewer open', 'ccm web-viewer open --no-start --json'],
      handler: 'webviewer.open',
    },
    status: {
      summary: '显示当前 home 的 web viewer running/stale/stopped 状态（token 脱敏）',
      read: true,
      positionals: [{ name: 'id', required: false }],
      options: {
        json: { type: 'boolean', desc: '结构化输出（不含 raw token）' },
      },
      examples: ['ccm web-viewer status', 'ccm web-viewer status --json'],
      handler: 'webviewer.status',
    },
    stop: {
      summary: '停止当前 home 的 web viewer service；stale state 会被清理',
      read: false,
      positionals: [{ name: 'id', required: false }],
      options: {
        all: { type: 'boolean', desc: '停止/清理当前 home 下全部 web viewer state' },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm web-viewer stop', 'ccm web-viewer stop --json'],
      handler: 'webviewer.stop',
    },
    restart: {
      summary:
        '重启当前 home 的 web viewer service（新 token；--board/--goal 只影响初始 selection）',
      read: false,
      positionals: [{ name: 'id', required: false }],
      options: {
        host: { type: 'string', desc: '监听地址（v1 只允许 127.0.0.1）' },
        port: { type: 'string', desc: '监听端口（默认 0=系统分配）' },
        board: { type: 'string', desc: '指定 board 文件作 viewer 初始 selection（最高优先）' },
        goal: { type: 'string', desc: '多 active 板时按 goal 子串选初始 selection' },
        json: { type: 'boolean', desc: '结构化输出（含 previous/service/open_url）' },
      },
      examples: ['ccm web-viewer restart', 'ccm web-viewer restart --board <path> --json'],
      handler: 'webviewer.restart',
    },
    serve: {
      summary: '内部 daemon target：按 --state 启动 HTTP service（用户通常不直接调用）',
      read: true,
      positionals: [],
      options: {
        state: { type: 'string', required: true, desc: 'web-viewer service state path' },
      },
      examples: ['ccm web-viewer serve --state <path>'],
      handler: 'webviewer.serve',
    },
  },

  // ════════════════════ monitor（ADR-033 optional daemon）══════════════════════════════════════════
  monitor: {
    start: {
      summary:
        '启动或复用当前 home 的 ccm monitor daemon（连续 usage sensing + pool arbiter edge writes）',
      read: false,
      positionals: [],
      options: {
        interval: { type: 'string', desc: 'tick 间隔秒（默认 45，范围 5..3600）' },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm monitor start', 'ccm monitor start --interval 30 --json'],
      handler: 'monitor.start',
    },
    stop: {
      summary: '停止当前 home 的 monitor daemon 并清除 wanted 标记',
      read: false,
      positionals: [],
      options: {
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm monitor stop', 'ccm monitor stop --json'],
      handler: 'monitor.stop',
    },
    status: {
      summary: '显示 monitor running/stale/stopped 状态与 ccm binary_match',
      read: true,
      positionals: [],
      options: {
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm monitor status', 'ccm monitor status --json'],
      handler: 'monitor.status',
    },
    restart: {
      summary: '重启当前 home 的 monitor daemon',
      read: false,
      positionals: [],
      options: {
        interval: { type: 'string', desc: 'tick 间隔秒（默认 45，范围 5..3600）' },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm monitor restart', 'ccm monitor restart --json'],
      handler: 'monitor.restart',
    },
    serve: {
      summary: '内部 daemon target：前台运行 monitor tick loop（用户通常不直接调用）',
      read: true,
      positionals: [],
      options: {
        state: { type: 'string', required: true, desc: 'monitor service state path' },
        iterations: { type: 'string', desc: '测试/调试用有界 tick 次数；缺省持续运行' },
      },
      examples: ['ccm monitor serve --state <path>'],
      handler: 'monitor.serve',
    },
    'install-service': {
      summary: '安装用户级 launchd/systemd monitor service（可选；不引入 PM2）',
      read: false,
      positionals: [],
      options: {
        interval: { type: 'string', desc: 'tick 间隔秒（默认 45，范围 5..3600）' },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm monitor install-service', 'ccm monitor install-service --json'],
      handler: 'monitor.installService',
    },
    'uninstall-service': {
      summary: '卸载用户级 monitor service 并停止 monitor',
      read: false,
      positionals: [],
      options: {
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm monitor uninstall-service', 'ccm monitor uninstall-service --json'],
      handler: 'monitor.uninstallService',
    },
  },

  // ════════════════════ services（ADR-033 home service reconciliation）════════════════════════════
  services: {
    reconcile: {
      summary:
        '按 wanted 语义重启 home 常驻服务（monitor + web-viewer），用于 ccm 二进制替换后收口',
      read: false,
      positionals: [],
      options: {
        'after-binary-replace': {
          type: 'boolean',
          desc: '标记这是 install/upgrade ccm 二进制替换后的 best-effort reconcile',
        },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: [
        'ccm services reconcile --after-binary-replace',
        'ccm services reconcile --after-binary-replace --json',
      ],
      handler: 'services.reconcile',
    },
  },

  // ════════════════════ runtime（cross-harness immutable runtime supply chain·C1）═══════════════════
  runtime: {
    stage: {
      summary:
        '校验 official provenance + SHA-256 后写入 immutable runtime image store（不 activation）',
      read: false,
      positionals: [{ name: 'artifact', required: true }],
      options: {
        provenance: { type: 'string', required: true, desc: 'ccm/runtime-provenance/v1 JSON 文件' },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm runtime stage ./ccm-linux-x64 --provenance ./provenance.json --json'],
      handler: 'runtime.stage',
    },
    activate: {
      summary: '锁内重验 staged image 并原子追加 current/previous activation commit',
      read: false,
      positionals: [{ name: 'transaction-id', required: true }],
      options: { json: { type: 'boolean', desc: '结构化输出' } },
      examples: ['ccm runtime activate tx_<id> --json'],
      handler: 'runtime.activate',
    },
    resolve: {
      summary: '重验并返回 current 的 exact immutable image path/hash（stable selector）',
      read: true,
      positionals: [],
      options: { json: { type: 'boolean', desc: '结构化输出' } },
      examples: ['ccm runtime resolve --json'],
      handler: 'runtime.resolve',
    },
    invoke: {
      summary:
        '按平台执行已重验 runtime：Linux exact-fd；Darwin final path-attested（显式 same-UID residual）',
      read: false,
      positionals: [{ name: 'runtime-arg', required: false }],
      options: {
        'require-assurance': {
          type: 'string',
          enum: ['exact-object'],
          desc: '要求 exact-object；当前 Darwin path-attested 后端会在创建子进程前 typed fail-closed',
        },
      },
      examples: [
        'ccm runtime invoke -- --version',
        'ccm runtime invoke --require-assurance exact-object -- --version',
      ],
      handler: 'runtime.invoke',
    },
    doctor: {
      summary:
        '审计 runtime store/crash transaction；可解释 legacy in-place migration，--repair 锁内收口',
      read: false,
      positionals: [],
      options: {
        'installed-path': { type: 'string', desc: '只读解释现有 in-place ccm binary 的迁移计划' },
        repair: {
          type: 'boolean',
          desc: '锁内补 recovered/aborted event并清已证 dead 的 stale lock',
        },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: [
        'ccm runtime doctor --installed-path ~/.local/bin/ccm --json',
        'ccm runtime doctor --repair --json',
      ],
      handler: 'runtime.doctor',
    },
    rollback: {
      summary: '追加新 activation commit，把 previous 原子切为 current；不杀已启动旧 runtime',
      read: false,
      positionals: [],
      options: { json: { type: 'boolean', desc: '结构化输出' } },
      examples: ['ccm runtime rollback --json'],
      handler: 'runtime.rollback',
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

  // ════════════════════ statusline（self-contained status line·0.10.0）════════════════════════════
  //   render = `ccm statusline` 的默认 verb（status-line 命令本身·读 stdin → 渲染单行 + 落 sidecar）；
  //   install/uninstall = 把它幂等装进 settings.json / 从备份恢复。非 board 操作（不写窄腰·无 field flag）。
  statusline: {
    render: {
      summary:
        '渲染单行 ANSI 状态行（读 status-line stdin JSON·= `ccm statusline` 默认 verb）+ 落用量 sidecar',
      read: true,
      positionals: [],
      options: {},
      examples: ['ccm statusline', 'echo "$STDIN_JSON" | ccm statusline'],
      handler: 'statusline.render',
    },
    install: {
      summary:
        '把 ccm status line 幂等装进全局 settings.json（备份你原有的·绝对路径·会覆盖现有 statusLine）',
      read: false,
      positionals: [],
      options: {
        json: { type: 'boolean', desc: '结构化输出安装结果' },
      },
      examples: ['ccm statusline install', 'ccm statusline install --json'],
      handler: 'statusline.install',
    },
    uninstall: {
      summary: '从备份恢复你原有的 statusLine（无则删字段）+ opt-out·让自动安装不再覆盖回去',
      read: false,
      positionals: [],
      options: {
        json: { type: 'boolean', desc: '结构化输出卸载结果' },
      },
      examples: ['ccm statusline uninstall', 'ccm statusline uninstall --json'],
      handler: 'statusline.uninstall',
    },
  },

  // ════════════════════ harness（本机 supported harness inventory·install/upgrade 分发前置）═══════════
  harness: {
    list: {
      summary: '列出本机 ccm 支持的 harness 与 execution surface 安装状态、当前选择和能力矩阵',
      read: true,
      positionals: [],
      options: {
        json: { type: 'boolean', desc: '结构化输出' },
        'machine-wide': {
          type: 'boolean',
          desc: '枚举所有已知 harness / surface 并输出机器级 registry snapshot（含 session store / usage source / account pool 坐标）',
        },
      },
      examples: [
        'ccm harness list',
        'ccm harness list --json',
        'ccm harness list --machine-wide --json',
      ],
      handler: 'harness.list',
    },
    current: {
      summary:
        '显示当前 selected harness（--harness / env / auto-detect 后的结果）及其安装 / surface 探测',
      read: true,
      positionals: [],
      options: {
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm harness current', 'ccm --harness codex harness current --json'],
      handler: 'harness.current',
    },
  },

  // ════════════════════ upgrade（自升级 ccm 二进制 + cc-master 插件·解耦双线）═══════════════════════════
  //   非 board 操作（不写窄腰·不抢 board-lock）。三 verb：all（默认 verb·裸 `ccm upgrade`）/ ccm / plugin。
  //   版本解析走 GitHub /releases 列表 + tag 前缀过滤 + semver 排序（ccm 线 ccm-v* / plugin 线裸 v*·见
  //   handlers/upgrade.ts）。--to 指定具体 tag、--dry-run（全局）只查不升。async（同 account switch·router 透传 Promise）。
  upgrade: {
    all: {
      summary: '把 ccm 二进制 + cc-master 插件都升到各自发布线最新（裸 `ccm upgrade` 的默认 verb）',
      read: false,
      positionals: [],
      options: {
        json: { type: 'boolean', desc: '结构化输出' },
        'all-harnesses': {
          type: 'boolean',
          desc: '兼容别名：插件升级阶段默认即升本机已安装 harness；与 --harness 互斥（不影响 ccm 二进制自升级）',
        },
      },
      examples: ['ccm upgrade', 'ccm upgrade --dry-run', 'ccm upgrade --harness cursor --dry-run'],
      handler: 'upgrade.all',
    },
    ccm: {
      summary: '只升 ccm 二进制（SEA 自替换·--to 指定 ccm-v* tag·默认线上最新）',
      read: false,
      positionals: [],
      options: {
        to: { type: 'string', desc: '指定 ccm-v* tag（默认线上最新·如 ccm-v0.1.0）' },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: ['ccm upgrade ccm', 'ccm upgrade ccm --to ccm-v0.1.0 --dry-run'],
      handler: 'upgrade.ccm',
    },
    plugin: {
      summary:
        '只升 cc-master 插件（默认升本机已安装且支持分发的全部 harness；--harness 单目标；--to 仅信息性）',
      read: false,
      positionals: [],
      options: {
        to: {
          type: 'string',
          desc: '期望的 v* tag（信息性·claude plugin update 实际升到 marketplace 最新）',
        },
        'all-harnesses': {
          type: 'boolean',
          desc: '兼容别名：默认行为即枚举本机已安装 harness；与 --harness 互斥',
        },
        json: { type: 'boolean', desc: '结构化输出' },
      },
      examples: [
        'ccm upgrade plugin',
        'ccm upgrade plugin --dry-run',
        'ccm upgrade plugin --harness cursor --dry-run --json',
        'ccm upgrade plugin --all-harnesses --dry-run --json',
      ],
      handler: 'upgrade.plugin',
    },
  },
};

// ── ALIASES：热路径顶层捷径（cli-design §3.4·只给最高频两个）。alias → [noun, verb]。──────────────
//   这是 **command 级**别名——固定映到某个 noun 的某一个 verb（bare 敲入即已确定 [noun,verb] 全貌）。
export const ALIASES: Record<string, [string, string]> = {
  next: ['board', 'next'],
  lint: ['board', 'lint'],
  ls: ['task', 'list'], // task ls 别名（cli-design §3.2，verb 级；router 在 task 域内识别）
  peers: ['peers', 'list'], // `ccm peers` → `ccm peers list`（COORD·设计稿 §9 只读）
};

// ── NOUN_ALIASES：**namespace 级**别名——alias noun → 真实 noun，覆盖该 noun 全部 verb（含裸敲行为），
//   与上面 ALIASES 的「command 级」单点 [noun,verb] 映射不同：这里只换 noun token，verb token 原样透传，
//   router 据此重写整个 namespace（见 router.ts run() 顶部的 NOUN_ALIASES 展开）。
export const NOUN_ALIASES: Record<string, string> = {
  viewer: 'web-viewer', // `ccm viewer <verb>` ≡ `ccm web-viewer <verb>`（含裸敲 `ccm viewer`）
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
