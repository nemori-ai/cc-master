// VENDORED BUILD ARTIFACT — do not edit by hand.
// Source: @ccm/engine (ccm/packages/engine) tsdown IIFE build → dist/index.iife.js
// Publishes a single global: globalThis.__ccmEngine (analyzeGraph / lintBoard / formatReport / ENUMS / ... all symbols merged).
// Regenerate on each release: `pnpm -F @ccm/engine build` then copy dist/index.iife.js here (release flow update is T6).
var __ccm_node_fs = typeof require !== "undefined" ? require("node:fs") : {};
var __ccm_node_crypto = typeof require !== "undefined" ? require("node:crypto") : {};
var __ccmEngine = (function(exports, node_crypto, node_fs) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	//#region \0rolldown/runtime.js
	var __create = Object.create;
	var __defProp = Object.defineProperty;
	var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
	var __getOwnPropNames = Object.getOwnPropertyNames;
	var __getProtoOf = Object.getPrototypeOf;
	var __hasOwnProp = Object.prototype.hasOwnProperty;
	var __copyProps = (to, from, except, desc) => {
		if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
			key = keys[i];
			if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
				get: ((k) => from[k]).bind(null, key),
				enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
			});
		}
		return to;
	};
	var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
		value: mod,
		enumerable: true
	}) : target, mod));
	//#endregion
	node_crypto = __toESM(node_crypto, 1);
	node_fs = __toESM(node_fs, 1);
	//#region src/board-model.ts
	const SCHEMA_VERSION = "cc-master/v2";
	const ENUMS = {
		status: [
			"ready",
			"in_flight",
			"blocked",
			"done",
			"escalated",
			"failed",
			"stale",
			"uncertain"
		],
		executor: [
			"user",
			"master-orchestrator",
			"subagent",
			"workflow",
			"external"
		],
		taskType: [
			"design",
			"planning",
			"development",
			"development-demo",
			"acceptance",
			"e2e-integration",
			"doc-alignment",
			"pr"
		],
		role: ["normal", "fill-work"],
		refKind: [
			"spec",
			"plan",
			"doc",
			"web",
			"code",
			"issue",
			"other"
		],
		askType: [
			"decision",
			"advice",
			"solution"
		],
		logKind: [
			"dispatch",
			"recon",
			"verify",
			"finding",
			"decision",
			"replan",
			"handoff",
			"note"
		],
		jcCategory: [
			"architecture",
			"drift",
			"spec-impl-misalignment",
			"other"
		],
		jcSeverity: [
			"low",
			"medium",
			"high",
			"critical"
		],
		jcStatus: [
			"pending_review",
			"upheld",
			"overturned"
		],
		iterationStatus: ["open", "shipped"],
		watchdogMechanism: [
			"cron",
			"loop",
			"monitor",
			"shell"
		],
		acceptanceKind: [
			"test",
			"metric",
			"manual",
			"review"
		],
		acceptanceStatus: [
			"pending",
			"met",
			"failed"
		]
	};
	const OPEN_ENUMS = ["taskType", "refKind"];
	const _ENUM_SETS = {};
	for (const k of Object.keys(ENUMS)) _ENUM_SETS[k] = new Set(ENUMS[k]);
	function isEnumMember(name, value) {
		const s = _ENUM_SETS[name];
		return s ? s.has(value) : false;
	}
	const TIERS = {
		LOAD_BEARING: "🔒",
		OBSERVED: "👁",
		FLEXIBLE: "✎"
	};
	const FIELDS = {
		board: {
			schema: {
				tier: "🔒",
				type: "string(\"cc-master/v2\")",
				default: "必填",
				readers: "lint + content 契约 + resume 选板",
				writers: "bootstrap",
				when: "建板",
				degrade: "hard error(FMT-SCHEMA)"
			},
			meta: {
				tier: "✎",
				type: "object{template_version:int, created_at?:ISO}",
				default: "{template_version:N}",
				readers: "viewer timeline 版本门",
				writers: "bootstrap / agent 经 CLI",
				when: "建板 / 模板升级",
				degrade: "timeline 当旧板降级走拓扑轴"
			},
			goal: {
				tier: "🔒",
				type: "string",
				default: "必填(可空串)",
				readers: "resume 按子串选板 / viewer 顶栏",
				writers: "agent 经 CLI",
				when: "建板 / 重定目标",
				degrade: "hard error(FMT-GOAL)"
			},
			owner: {
				tier: "🔒",
				type: "object{active:bool, session_id:string, heartbeat:ISO}",
				default: "必填",
				readers: "全 hook 武装闸(active/session_id) + bootstrap resume 探测(heartbeat)",
				writers: "bootstrap + 活 session 每回合 flush heartbeat",
				when: "建板 / 每回合",
				degrade: "active·session_id 缺→hard;heartbeat 非 ISO→warn(FMT-TIME)"
			},
			git: {
				tier: "🔒",
				type: "object{worktree?:string, branch?:string}",
				default: "必填(子字段可空)",
				readers: "viewer 渲染 branch/worktree",
				writers: "agent 经 CLI / bootstrap",
				when: "建板 / 换 worktree",
				degrade: "对象缺 hard;子字段非 string hard(FMT-GIT)"
			},
			scheduling: {
				tier: "👁",
				type: "object{wip_limit:int, owner_wip_limit?:int}",
				default: "缺省(对应警告静默关)",
				readers: "posttool-batch 两级 WIP 软警告",
				writers: "agent 经 CLI",
				when: "调 WIP cap",
				degrade: "缺→对应警告静默关闭(graceful);非数字→warn(FMT-SCHEDULING)"
			},
			watchdog: {
				tier: "👁",
				type: "object{armed_at, fire_at, mechanism, job_id, checklist} | null",
				default: "缺省(无 watchdog)",
				readers: "verify-board 到点/缺失提醒 + 过期 self-heal",
				writers: "agent 经 CLI(arm / 退役)",
				when: "arm 自我唤醒 / 退役",
				degrade: "缺→提醒按需注入;退役须删整对象(不留残骸);fire_at 非 ISO→warn"
			},
			tasks: {
				tier: "🔒",
				type: "array<task>",
				default: "必填([] 合法)",
				readers: "goal-hook 数状态 / viewer 整图 / resume 重建",
				writers: "agent 经 CLI",
				when: "拆解 / 推进",
				degrade: "非数组 hard(FMT-TASKS)"
			},
			log: {
				tier: "✎",
				type: "array<{ts, summary, kind?, task?, detail?, refs?}>(append-only)",
				default: "[]",
				readers: "viewer activity 流",
				writers: "agent 经 CLI(只增不改不删)",
				when: "每事件",
				degrade: "空数组合法;坏条目→warn(FMT-LOG)"
			},
			judgment_calls: {
				tier: "👁",
				type: "array<judgment_call>",
				default: "缺省(无)",
				readers: "回前台 hook 按 severity 告知(high/critical 必显眼)",
				writers: "agent 经 CLI",
				when: "自决重大事项时",
				degrade: "缺/空→无告警;形状坏→warn(FMT-JUDGMENT-CALLS)"
			},
			cadence: {
				tier: "👁",
				type: "object{target?, iterations?}",
				default: "缺省(无节奏约束·纯 DAG)",
				readers: "Stop-block 收口逼 + CLI 拆解校验",
				writers: "agent 经 CLI",
				when: "定节奏 / 开收 iteration",
				degrade: "缺→无 cadence 牙齿;iteration 形状坏→warn(FMT-CADENCE)"
			}
		},
		task: {
			id: {
				tier: "🔒",
				type: "string",
				default: "必填(非空唯一)",
				readers: "viewer 建节点 key / goal-hook 计数 / deps·parent 引用",
				writers: "agent 经 CLI",
				when: "建 task",
				degrade: "hard error(FMT-ID / FMT-ID-UNIQUE)"
			},
			status: {
				tier: "🔒",
				type: "enum:status",
				default: "必填",
				readers: "goal-hook 路由 / viewer 灯 / readySet",
				writers: "agent 经 CLI",
				when: "状态转移",
				degrade: "hard error(FMT-STATUS);非法转移由 STATUS_MACHINE 提示(CLI)"
			},
			deps: {
				tier: "🔒",
				type: "string[]",
				default: "[]",
				readers: "graph 拓扑 / readySet / viewer 边",
				writers: "agent 经 CLI",
				when: "建 task / 重连依赖",
				degrade: "缺 / 非数组 hard(FMT-DEPS);悬挂 / 自环 / 环 hard(GRAPH-*)"
			},
			parent: {
				tier: "🔒",
				type: "string?",
				default: "缺省=顶层节点",
				readers: "graph parent 倒排 / rollup / viewer 分组",
				writers: "agent 经 CLI",
				when: "嵌套子图",
				degrade: "畸形(非空串)hard(FMT-PARENT);悬挂 / 破 depth=1 / 环 hard(GRAPH-PARENT-*)"
			},
			title: {
				tier: "✎",
				type: "string",
				default: "\"\"",
				readers: "viewer 卡片标题",
				writers: "agent 经 CLI",
				when: "建 task",
				degrade: "缺→空标题"
			},
			description: {
				tier: "✎",
				type: "string?",
				default: "缺省",
				readers: "viewer 详情栏",
				writers: "agent 经 CLI",
				when: "建 task",
				degrade: "缺→无描述"
			},
			acceptance: {
				tier: "✎",
				type: "string | object{criteria:[{desc,kind?,check?,target?,measured?,status}]}",
				default: "缺省(特定 type 必须)",
				readers: "viewer / done 真语义判定 / CLI",
				writers: "agent 经 CLI",
				when: "建 dev 类 task",
				degrade: "特定 type 缺→warn(BIZ-ACCEPTANCE-REQUIRED);obj 则 criteria 非空(FMT-ACCEPTANCE)"
			},
			references: {
				tier: "✎",
				type: "array<{kind, ref, note?}>",
				default: "缺省(特定 type 必须)",
				readers: "viewer 链接 / executor 上下文",
				writers: "agent 经 CLI",
				when: "建 dev 类 task",
				degrade: "ref 相对路径→hard(FMT-REF);type=development 缺 spec/plan→warn(BIZ-DEV-REFS)"
			},
			created_at: {
				tier: "✎",
				type: "ISO",
				default: "缺省",
				readers: "viewer timeline",
				writers: "agent 经 CLI",
				when: "建 task",
				degrade: "非 ISO→warn(FMT-TIME)"
			},
			started_at: {
				tier: "✎",
				type: "ISO",
				default: "缺省",
				readers: "viewer timeline / graph 时长(measured)",
				writers: "agent 经 CLI",
				when: "起跑",
				degrade: "非 ISO→warn(FMT-TIME);in_flight 缺→warn(BIZ-TIME-ORDER)"
			},
			finished_at: {
				tier: "✎",
				type: "ISO",
				default: "缺省",
				readers: "viewer timeline / graph 时长(measured)",
				writers: "agent 经 CLI",
				when: "完成",
				degrade: "非 ISO→warn(FMT-TIME);无 started 而有 finished→warn(BIZ-TIME-ORDER)"
			},
			estimate: {
				tier: "✎",
				type: "object{value:number, unit:string}",
				default: "缺省",
				readers: "cadence 拆解校验(estimate vs timebox) / CPM 喂时长降级",
				writers: "agent 经 CLI",
				when: "估点",
				degrade: "缺→CPM 降级 unit;形状坏→warn(FMT-ESTIMATE)"
			},
			blocked_on: {
				tier: "✎",
				type: "\"user\" | <task-id>",
				default: "缺省",
				readers: "viewer 阻塞边 / awaiting-user 判定",
				writers: "agent 经 CLI",
				when: "阻塞时",
				degrade: "非 user 且非存在 id→warn(FMT-BLOCKED-ON)"
			},
			verified: {
				tier: "✎",
				type: "bool?",
				default: "false",
				readers: "端点验收 / done 真语义(P3) / viewer",
				writers: "agent 经 CLI(端点验收后)",
				when: "验收过",
				degrade: "缺→视为未验"
			},
			executor: {
				tier: "✎",
				type: "enum:executor",
				default: "缺省",
				readers: "viewer / 派发 / CLI",
				writers: "agent 经 CLI",
				when: "派发前",
				degrade: "非法值→hard(FMT-EXECUTOR);subagent/workflow 缺 handle→warn(BIZ-EXECUTOR-HANDLE)"
			},
			type: {
				tier: "✎",
				type: "enum:taskType(开放)",
				default: "缺省",
				readers: "viewer / BIZ 条件规则触发",
				writers: "agent 经 CLI",
				when: "建 task",
				degrade: "未知值→warn(FMT-TYPE·开放枚举)"
			},
			role: {
				tier: "✎",
				type: "enum:role",
				default: "normal",
				readers: "viewer / 调度",
				writers: "agent 经 CLI",
				when: "标 fill-work 时",
				degrade: "非法值→hard(FMT-ROLE)"
			},
			handle: {
				tier: "✎",
				type: "string?",
				default: "缺省",
				readers: "resume 接驳后台句柄 / viewer",
				writers: "agent 经 CLI",
				when: "派发 subagent/workflow 时",
				degrade: "executor∈{subagent,workflow} 缺→warn(BIZ-EXECUTOR-HANDLE)"
			},
			justification: {
				tier: "✎",
				type: "string?",
				default: "缺省",
				readers: "viewer / 审计",
				writers: "agent 经 CLI",
				when: "需说明决策时",
				degrade: "缺→无理由记录"
			},
			artifact: {
				tier: "✎",
				type: "string | object?",
				default: "缺省",
				readers: "done 真语义(P3) / viewer 产物链接",
				writers: "agent 经 CLI(产出落盘后)",
				when: "产出落盘后",
				degrade: "缺→done 真语义不满足(BIZ-DONE-VERIFIED·P3 预留)"
			},
			output_schema: {
				tier: "✎",
				type: "object?(低频)",
				default: "缺省",
				readers: "workflow 结构化产出契约",
				writers: "agent 经 CLI",
				when: "需结构化产出时",
				degrade: "缺→无 schema 约束"
			},
			dep_pins: {
				tier: "✎",
				type: "object?(低频)",
				default: "缺省",
				readers: "freshness / inputs_hash 钉依赖快照",
				writers: "agent 经 CLI",
				when: "钉依赖快照时",
				degrade: "缺→无 pin"
			},
			wip_limit: {
				tier: "👁",
				type: "int?",
				default: "缺省(覆写 owner cap)",
				readers: "posttool-batch 两级 WIP",
				writers: "agent 经 CLI",
				when: "覆写 per-owner cap 时",
				degrade: "非数字→warn(FMT-WIP)"
			},
			observability: {
				tier: "✎",
				type: "object?",
				default: "缺省",
				readers: "viewer 遥测 / resume",
				writers: "agent 经 CLI",
				when: "派发后台时",
				degrade: "缺→无遥测"
			},
			hitl_rounds: {
				tier: "✎",
				type: "int?",
				default: "0",
				readers: "viewer / HITL 往返计数",
				writers: "agent 经 CLI",
				when: "HITL 往返时",
				degrade: "缺→视为 0"
			},
			decision_package: {
				tier: "✎",
				type: "object?{prepared_at, inputs_hash, freshness, ask_type, context_md, question, what_i_need, why_it_matters, options[{id,label,rationale,tradeoffs}], enter_cmd}",
				default: "缺省(awaiting-user 必须)",
				readers: "discuss 采访 / viewer 富决策卡",
				writers: "agent 经 CLI",
				when: "建 awaiting-user 节点时",
				degrade: "awaiting-user 缺→hard(BIZ-AWAITING);字段不全→warn(BIZ-DECISION-PACKAGE)"
			}
		}
	};
	const STATUS_MACHINE = {
		transitions: {
			ready: ["in_flight", "blocked"],
			in_flight: [
				"done",
				"uncertain",
				"escalated",
				"failed",
				"blocked"
			],
			blocked: ["ready", "in_flight"],
			done: ["stale"],
			uncertain: [
				"done",
				"failed",
				"in_flight"
			],
			escalated: ["ready"],
			failed: ["ready", "escalated"],
			stale: ["ready"]
		},
		doneStatus: "done",
		activeStatuses: ["in_flight"]
	};
	function isLegalTransition(from, to) {
		if (from === to) return true;
		const outs = STATUS_MACHINE.transitions[from];
		return Array.isArray(outs) && outs.includes(to);
	}
	const INVARIANTS = [
		{
			id: "FMT-JSON",
			level: "hard",
			family: "FMT",
			scope: "board",
			summary: "board 是合法 JSON 且顶层为对象"
		},
		{
			id: "FMT-SCHEMA",
			level: "hard",
			family: "FMT",
			scope: "board",
			summary: "schema === \"cc-master/v2\""
		},
		{
			id: "FMT-GOAL",
			level: "hard",
			family: "FMT",
			scope: "board",
			summary: "goal 是字符串"
		},
		{
			id: "FMT-OWNER",
			level: "hard",
			family: "FMT",
			scope: "board",
			summary: "owner 对象 + active:bool + session_id:string"
		},
		{
			id: "FMT-GIT",
			level: "hard",
			family: "FMT",
			scope: "board",
			summary: "git 对象 + worktree/branch 字符串或缺"
		},
		{
			id: "FMT-TASKS",
			level: "hard",
			family: "FMT",
			scope: "board",
			summary: "tasks 是数组"
		},
		{
			id: "FMT-SCHEDULING",
			level: "warn",
			family: "FMT",
			scope: "board",
			summary: "scheduling.wip_limit / owner_wip_limit 是数字"
		},
		{
			id: "FMT-WATCHDOG",
			level: "warn",
			family: "FMT",
			scope: "board",
			summary: "watchdog.mechanism ∈ enum + fire_at ISO(观察档·graceful)"
		},
		{
			id: "FMT-META",
			level: "warn",
			family: "FMT",
			scope: "board",
			summary: "meta.template_version 是整数"
		},
		{
			id: "FMT-LOG",
			level: "warn",
			family: "FMT",
			scope: "board",
			summary: "log[] 条目 ts/summary 字符串 + kind ∈ enum"
		},
		{
			id: "FMT-JUDGMENT-CALLS",
			level: "warn",
			family: "FMT",
			scope: "board",
			summary: "judgment_calls[] category/severity/status ∈ enum + summary 字符串"
		},
		{
			id: "FMT-CADENCE",
			level: "warn",
			family: "FMT",
			scope: "cadence",
			summary: "cadence.iterations[] id/status ∈ enum + 时间 ISO"
		},
		{
			id: "FMT-ID",
			level: "hard",
			family: "FMT",
			scope: "task",
			summary: "task.id 非空字符串"
		},
		{
			id: "FMT-ID-UNIQUE",
			level: "hard",
			family: "FMT",
			scope: "task",
			summary: "task.id 全局唯一"
		},
		{
			id: "FMT-STATUS",
			level: "hard",
			family: "FMT",
			scope: "task",
			summary: "task.status ∈ status 枚举(8)"
		},
		{
			id: "FMT-DEPS",
			level: "hard",
			family: "FMT",
			scope: "task",
			summary: "task.deps 必填字符串数组"
		},
		{
			id: "FMT-PARENT",
			level: "hard",
			family: "FMT",
			scope: "task",
			summary: "task.parent 非空字符串或缺"
		},
		{
			id: "FMT-EXECUTOR",
			level: "hard",
			family: "FMT",
			scope: "task",
			summary: "task.executor ∈ executor 枚举(5)"
		},
		{
			id: "FMT-ROLE",
			level: "hard",
			family: "FMT",
			scope: "task",
			summary: "task.role ∈ {normal, fill-work}"
		},
		{
			id: "FMT-TYPE",
			level: "warn",
			family: "FMT",
			scope: "task",
			summary: "task.type ∈ taskType 枚举(开放·未知值 warn)"
		},
		{
			id: "FMT-REF",
			level: "hard",
			family: "FMT",
			scope: "task",
			summary: "references[].ref 绝对路径或 URL(禁相对)"
		},
		{
			id: "FMT-REF-KIND",
			level: "warn",
			family: "FMT",
			scope: "task",
			summary: "references[].kind ∈ refKind 枚举(开放)"
		},
		{
			id: "FMT-BLOCKED-ON",
			level: "warn",
			family: "FMT",
			scope: "task",
			summary: "blocked_on = \"user\" 或存在的 task id"
		},
		{
			id: "FMT-WIP",
			level: "warn",
			family: "FMT",
			scope: "task",
			summary: "task.wip_limit 是数字"
		},
		{
			id: "FMT-TIME",
			level: "warn",
			family: "FMT",
			scope: "task",
			summary: "时间锚为严格 ISO-8601 UTC(YYYY-MM-DDTHH:MM:SSZ)"
		},
		{
			id: "FMT-ESTIMATE",
			level: "warn",
			family: "FMT",
			scope: "task",
			summary: "estimate {value:number, unit:string}"
		},
		{
			id: "FMT-ACCEPTANCE",
			level: "warn",
			family: "FMT",
			scope: "task",
			summary: "acceptance string 或 {criteria 非空, criterion.status ∈ enum}"
		},
		{
			id: "GRAPH-DANGLING",
			level: "hard",
			family: "GRAPH",
			scope: "graph",
			summary: "deps 指向存在的 id(无悬挂)"
		},
		{
			id: "GRAPH-SELFLOOP",
			level: "hard",
			family: "GRAPH",
			scope: "graph",
			summary: "deps 不含自身(无自环)"
		},
		{
			id: "GRAPH-CYCLE",
			level: "hard",
			family: "GRAPH",
			scope: "graph",
			summary: "deps 图无有向环"
		},
		{
			id: "GRAPH-PARENT-EXISTS",
			level: "hard",
			family: "GRAPH",
			scope: "graph",
			summary: "parent 指向存在的 owner id"
		},
		{
			id: "GRAPH-PARENT-DEPTH",
			level: "hard",
			family: "GRAPH",
			scope: "graph",
			summary: "嵌套 depth=1(owner 只含 leaf)"
		},
		{
			id: "GRAPH-PARENT-CYCLE",
			level: "hard",
			family: "GRAPH",
			scope: "graph",
			summary: "parent 链无环"
		},
		{
			id: "GRAPH-ROLLUP",
			level: "warn",
			family: "GRAPH",
			scope: "graph",
			summary: "done owner ⇒ 子全 done(容瞬态·warn)"
		},
		{
			id: "BIZ-AWAITING",
			level: "hard",
			family: "BIZ",
			scope: "task",
			summary: "awaiting-user(blocked_on:user + status∈{blocked,in_flight}) ⇒ decision_package 对象"
		},
		{
			id: "BIZ-DECISION-PACKAGE",
			level: "warn",
			family: "BIZ",
			scope: "task",
			summary: "decision_package 字段完整(context_md/what_i_need/ask_type/inputs_hash/enter_cmd;decision 型 options 非空)"
		},
		{
			id: "BIZ-DEV-REFS",
			level: "warn",
			family: "BIZ",
			scope: "task",
			summary: "type=development ⇒ references 含 kind=spec≥1 且 kind=plan≥1"
		},
		{
			id: "BIZ-ACCEPTANCE-REQUIRED",
			level: "warn",
			family: "BIZ",
			scope: "task",
			summary: "type ∈ {development, development-demo, acceptance, e2e-integration} ⇒ acceptance 非空"
		},
		{
			id: "BIZ-EXECUTOR-HANDLE",
			level: "warn",
			family: "BIZ",
			scope: "task",
			summary: "executor ∈ {subagent, workflow} ⇒ handle 存在"
		},
		{
			id: "BIZ-EXTERNAL-ISSUE",
			level: "warn",
			family: "BIZ",
			scope: "task",
			summary: "executor=external ⇒ references 含 kind=issue≥1"
		},
		{
			id: "BIZ-TIME-ORDER",
			level: "warn",
			family: "BIZ",
			scope: "task",
			summary: "created≤started≤finished;in_flight⇒started;done⇒finished"
		},
		{
			id: "BIZ-CADENCE-SHIPPED",
			level: "hard",
			family: "BIZ",
			scope: "cadence",
			summary: "iteration.status=shipped ⇒ members 全 done+verified(收口完整性)"
		},
		{
			id: "BIZ-DONE-VERIFIED",
			level: "reserved",
			family: "BIZ",
			scope: "task",
			summary: "status=done ⇒ verified ∧ artifact 非空(done 真语义·#32·P3·需 ADR)"
		}
	];
	const _INV_BY_ID = new Map(INVARIANTS.map((inv) => [inv.id, inv]));
	function invariant(id) {
		return _INV_BY_ID.get(id);
	}
	function levelOf(id) {
		const inv = _INV_BY_ID.get(id);
		return inv ? inv.level : void 0;
	}
	const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
	function isISOUTC(v) {
		return typeof v === "string" && ISO_UTC_RE.test(v);
	}
	function isAwaitingUser(task) {
		return !!task && task.blocked_on === "user" && (task.status === "blocked" || task.status === "in_flight");
	}
	function isDoneStatus(s) {
		return s === STATUS_MACHINE.doneStatus;
	}
	function isActiveStatus(s) {
		return STATUS_MACHINE.activeStatuses.includes(s);
	}
	function acceptanceConverged(acceptance) {
		if (!acceptance || typeof acceptance !== "object" || Array.isArray(acceptance)) return null;
		const c = acceptance.criteria;
		if (!Array.isArray(c) || c.length === 0) return false;
		return c.every((cr) => cr && cr.status === "met");
	}
	function taskTrulyDone(task) {
		if (!task || typeof task !== "object") return false;
		const hasArtifact = task.artifact !== void 0 && task.artifact !== null && task.artifact !== "";
		return task.status === "done" && task.verified === true && hasArtifact;
	}
	function isAbsolutePathOrUrl(ref) {
		if (typeof ref !== "string" || ref === "") return false;
		if (/^https?:\/\//.test(ref)) return true;
		if (ref.startsWith("/")) return true;
		return false;
	}
	//#endregion
	//#region src/board-lint-core.ts
	const STATUS_ENUM_LOCAL = new Set(ENUMS.status);
	const SCHEMA_VERSION_LOCAL = SCHEMA_VERSION;
	const badTimestamp = (v) => v !== void 0 && v !== null && v !== "" && !isISOUTC(v);
	function acceptanceNonEmpty(a) {
		if (typeof a === "string") return a.trim() !== "";
		if (a && typeof a === "object" && !Array.isArray(a)) {
			const criteria = a.criteria;
			return Array.isArray(criteria) && criteria.length > 0;
		}
		return false;
	}
	function lintBoard(text) {
		const errors = [];
		const warnings = [];
		const emit = (id, message, task) => {
			const lvl = levelOf(id) || "hard";
			if (lvl === "reserved") return;
			const entry = task ? {
				rule: id,
				message,
				task
			} : {
				rule: id,
				message
			};
			(lvl === "warn" ? warnings : errors).push(entry);
		};
		let board;
		try {
			board = JSON.parse(text);
		} catch (e) {
			emit("FMT-JSON", `不合法 JSON — board 无法被解析，会导致 webview 永久冻结（404 后停在旧帧）、resume 选板读出垃圾。\n  解析器原话（仅供定位）：${e && e.message ? e.message : String(e)}\n  怎么修：检查逗号与括号配对（尤其 sed/echo 截断了含 } 或 " 的字段值）；经 CLI 写盘（写入校验挡住大多数手写坏 JSON）。`);
			return {
				errors,
				warnings
			};
		}
		if (!board || typeof board !== "object" || Array.isArray(board)) {
			emit("FMT-JSON", `board 顶层不是一个 JSON 对象（解析出 ${Array.isArray(board) ? "数组" : typeof board}）。怎么修：board 必须是 {…} 对象。`);
			return {
				errors,
				warnings
			};
		}
		const b = board;
		if (typeof b.schema !== "string" || b.schema !== SCHEMA_VERSION_LOCAL) emit("FMT-SCHEMA", `schema 必须是字符串字面量 "${SCHEMA_VERSION_LOCAL}"（当前：${JSON.stringify(b.schema)}）。坏什么：它是窄腰版本协议锚点，content 契约断言它；缺/改 = 窄腰破、schema 路由会错认板。`);
		if (typeof b.goal !== "string") emit("FMT-GOAL", `goal 必须是字符串（当前：${JSON.stringify(b.goal)}）。坏什么：resume selector 按 goal 子串匹配认板、viewer 顶栏渲染它；缺 = resume 认领退化、顶栏空。`);
		const owner = b.owner;
		if (!owner || typeof owner !== "object" || Array.isArray(owner)) emit("FMT-OWNER", `owner 必须是对象（当前：${JSON.stringify(owner)}）。坏什么：武装闸读 owner.active/session_id；缺 = 本 session 武装判定崩。`);
		else {
			const ow = owner;
			if (typeof ow.active !== "boolean") emit("FMT-OWNER", `owner.active 必须是 boolean（当前：${JSON.stringify(ow.active)}）。坏什么：武装闸（全 hook 的 isArmed）读它；非 bool = orchestrator 不再被 reinject / Stop 不再 gate / pacing 失声。`);
			if (typeof ow.session_id !== "string") emit("FMT-OWNER", `owner.session_id 必须是字符串（空串 "" 合法、表示待显式 re-arm 认领；当前：${JSON.stringify(ow.session_id)}）。坏什么：武装闸 session-scope 匹配读它（ADR-007）。`);
			if (badTimestamp(ow.heartbeat)) emit("FMT-TIME", `owner.heartbeat 是 ${JSON.stringify(ow.heartbeat)}，非严格 ISO-8601 UTC（YYYY-MM-DDTHH:MM:SSZ）。影响：resume 探测活 session 新鲜度读它——格式不对则换班判定退化（不致命，建议补全 UTC 时间戳）。`);
		}
		const git = b.git;
		if (!git || typeof git !== "object" || Array.isArray(git)) emit("FMT-GIT", `git 必须是对象（含 worktree/branch 字符串，可空；当前：${JSON.stringify(git)}）。坏什么：窄腰一员（ADR-003），viewer 渲染 git.branch。`);
		else {
			const gi = git;
			if (gi.worktree !== void 0 && typeof gi.worktree !== "string") emit("FMT-GIT", `git.worktree 若存在必须是字符串（当前：${JSON.stringify(gi.worktree)}）。`);
			if (gi.branch !== void 0 && typeof gi.branch !== "string") emit("FMT-GIT", `git.branch 若存在必须是字符串（当前：${JSON.stringify(gi.branch)}）。`);
		}
		lintScheduling(b, emit);
		lintWatchdog(b, emit);
		lintMeta(b, emit);
		lintLog(b, emit);
		lintJudgmentCalls(b, emit);
		lintCadenceFormat(b, emit);
		const tasks = b.tasks;
		if (!Array.isArray(tasks)) {
			emit("FMT-TASKS", `tasks 必须是数组（当前：${Array.isArray(tasks) ? "array" : typeof tasks}）。坏什么：goal-hook 数状态、viewer 整个 DAG、resume 重建模型全靠它；非数组 = viewer 空图（静默）、hook 扫描错位。`);
			return {
				errors,
				warnings
			};
		}
		const ids = /* @__PURE__ */ new Set();
		const dupIds = /* @__PURE__ */ new Set();
		const taskById = /* @__PURE__ */ new Map();
		for (let i = 0; i < tasks.length; i++) {
			const t = tasks[i];
			const where = `tasks[${i}]`;
			if (!t || typeof t !== "object" || Array.isArray(t)) {
				emit("FMT-ID", `${where} 必须是对象（当前：${JSON.stringify(t)}）。坏什么：viewer 按 t.id 建节点、goal-hook 按 status 路由。`);
				continue;
			}
			const idLabel = typeof t.id === "string" && t.id ? t.id : where;
			if (typeof t.id !== "string" || t.id === "") emit("FMT-ID", `${where}.id 必须是非空字符串（当前：${JSON.stringify(t.id)}）。坏什么：viewer 用 id 建节点 key、goal-hook 按 id 计数；缺 id = 节点 key 撞/丢、hook 漏数。`, idLabel);
			else {
				if (ids.has(t.id)) dupIds.add(t.id);
				ids.add(t.id);
				taskById.set(t.id, t);
			}
			if (typeof t.status !== "string" || !STATUS_ENUM_LOCAL.has(t.status)) emit("FMT-STATUS", `${idLabel}.status 是 ${JSON.stringify(t.status)}，不在合法集合内。坏什么：goal-hook 无法路由它（可能在还有活时放行 Stop），webview 把它画成 unknown 灯。\n  怎么修：改成合法值之一：${[...STATUS_ENUM_LOCAL].join(" / ")}。`, idLabel);
			if (t.deps === void 0) emit("FMT-DEPS", `${idLabel}.deps 缺失。deps 是钉死的窄腰字段（与 id/status 同级），不是可省略的柔性边。坏什么：缺 deps = 畸形窄腰；下游图校验把它当无上游，让「手编 tasks[] 忘写 deps」这个真实错误静默溜过。\n  怎么修：补上 deps——无上游写 "deps": []，有上游写 "deps": ["<上游 task id>", …]。`, idLabel);
			else if (!Array.isArray(t.deps)) emit("FMT-DEPS", `${idLabel}.deps 必须是字符串数组（当前：${typeof t.deps}）。坏什么：viewer 兜底丢掉该任务的全部依赖边（静默错图）。\n  怎么修：无上游写 "deps": []，有上游写 "deps": ["<上游 task id>", …]。`, idLabel);
			else for (const d of t.deps) if (typeof d !== "string") emit("FMT-DEPS", `${idLabel}.deps 含非字符串元素（${JSON.stringify(d)}）；dep 必须是上游 task 的 id 字符串。`, idLabel);
		}
		for (const dup of dupIds) emit("FMT-ID-UNIQUE", `task id "${dup}" 出现多次，必须全局唯一。坏什么：viewer 后写者覆盖前者（静默丢节点）；deps 指向它时歧义。`, dup);
		const validIds = ids;
		const g = buildGraph(tasks);
		for (const issue of g.edgeIssues) if (issue.kind === "dangling") emit("GRAPH-DANGLING", `${issue.id}.deps 含 "${issue.dep}"，但没有任何 task 的 id 是 "${issue.dep}"。坏什么：webview 静默丢这条依赖边，且 ${issue.id} 永远不会因上游完成而解锁。\n  怎么修：把 "${issue.dep}" 改成真实存在的上游 id，或从 ${issue.id}.deps 删掉它。现有 id：${[...validIds].join(", ")}。`, issue.id);
		else emit("GRAPH-SELFLOOP", `${issue.id}.deps 含它自己（自环）。坏什么：${issue.id} 依赖自己 → 永远 blocked、永不 ready。怎么修：从 ${issue.id}.deps 删掉 "${issue.id}"。`, issue.id);
		const cycle = findCycle(g.upstream);
		if (cycle) emit("GRAPH-CYCLE", `deps 图存在环：${cycle.join(" → ")} → ${cycle[0]}。坏什么：环上的任务互相等待 → 永远 ready 不了 → 编排死锁；viewer 拓扑/临界路径算法在环上行为未定义。\n  怎么修：打破环——删掉环上某条 deps 边，让依赖关系回到无环的 DAG。`);
		const { parentOf, children } = g;
		for (const tt of tasks) {
			const t = tt;
			if (!t || typeof t !== "object" || Array.isArray(t)) continue;
			if (typeof t.id !== "string" || t.id === "" || taskById.get(t.id) !== t) continue;
			if (!Object.hasOwn(t, "parent")) continue;
			if (typeof t.parent !== "string" || t.parent === "") emit("FMT-PARENT", `${t.id}.parent 必须是非空字符串（指向一个存在的 owner id；当前：${JSON.stringify(t.parent)}）。parent 是钉死的窄腰容器边（ADR-012），非字符串会被图构建静默丢弃，悄悄关掉套娃 depth=1 与 rollup 保护。\n  怎么修：把 parent 改成单个 owner task 的 id 字符串（如 "M1"），或删掉 parent 键让它成顶层节点。`, t.id);
		}
		for (const [child, ownerId] of parentOf) if (!validIds.has(ownerId)) emit("GRAPH-PARENT-EXISTS", `${child}.parent 是 "${ownerId}"，但没有任何 task 的 id 是 "${ownerId}"。坏什么：悬挂 parent = rollup gate 找不到 owner、webview 分组渲染丢边。\n  怎么修：把 "${ownerId}" 改成真实存在的 owner id，或从 ${child} 删掉 parent。现有 id：${[...validIds].join(", ")}。`, child);
		for (const [owner2, kids] of children) for (const c of kids) if (children.has(c)) emit("GRAPH-PARENT-DEPTH", `${c} 既是 ${owner2} 的子（有 parent="${owner2}"），自己又是某些节点的 parent——违反 depth=1（owner 只能含 leaf 子）。坏什么：破 depth=1 type 不变式，rollup 与 webview 分组的「一层」假设崩。\n  怎么修：把 ${c} 的孙子节点（${children.get(c).join(", ")}）改挂到顶层 owner，或把 ${c} 升为顶层 owner（删它的 parent）。`, c);
		const padj = /* @__PURE__ */ new Map();
		for (const id of validIds) padj.set(id, []);
		for (const [child, ownerId] of parentOf) if (validIds.has(child) && validIds.has(ownerId)) padj.get(child).push(ownerId);
		const pCycle = findCycle(padj);
		if (pCycle) emit("GRAPH-PARENT-CYCLE", `parent 链存在环：${pCycle.join(" → ")} → ${pCycle[0]}（含自指或 2-环）。坏什么：parent 成环 = 容器归属无穷回指，rollup 永远算不出顶层 owner、depth=1 也被违反。\n  怎么修：打破环——让 parent 链回到「子单跳指向一个无 parent 的顶层 owner」。`);
		for (const [owner2, kids] of children) {
			const ownerTask = taskById.get(owner2);
			if (!ownerTask || ownerTask.status !== "done") continue;
			const bad = kids.filter((c) => {
				const ct = taskById.get(c);
				return !ct || ct.status !== "done";
			});
			if (bad.length) emit("GRAPH-ROLLUP", `${owner2} 标 done，但它的子 ${bad.join(", ")} 还非 done——rollup 不一致（父不应在子未全 done 时算真 done）。影响：不致命（可能是父整合中、子刚标完的瞬态），但若非瞬态 = 父被错标 done 而子在飞，子图静默漏掉。\n  建议：确认子全 done + 父端点验收过再标父 done（Finding #12）。`, owner2);
		}
		for (const [id, t] of taskById) lintTaskFields(id, t, validIds, emit);
		for (const [id, t] of taskById) lintTaskBiz(id, t, emit);
		lintCadenceShipped(b, taskById, emit);
		return {
			errors,
			warnings
		};
	}
	function lintScheduling(board, emit) {
		const sc = board.scheduling;
		if (sc !== void 0) if (!sc || typeof sc !== "object" || Array.isArray(sc)) emit("FMT-SCHEDULING", `scheduling 若存在必须是对象（含 wip_limit / owner_wip_limit 数字；当前：${JSON.stringify(sc)}）。`);
		else {
			const s = sc;
			for (const k of ["wip_limit", "owner_wip_limit"]) if (s[k] !== void 0 && typeof s[k] !== "number") emit("FMT-SCHEDULING", `scheduling.${k} 是 ${JSON.stringify(s[k])}，非数字。影响：posttool-batch 的两级 WIP 软警告会静默关闭（graceful）；建议用数字或省略。`);
		}
		if (board.wip_limit !== void 0 && typeof board.wip_limit !== "number") emit("FMT-SCHEDULING", `wip_limit（顶层·旧板形态）是 ${JSON.stringify(board.wip_limit)}，非数字。影响：WIP 软警告静默关闭（graceful）；建议迁入 scheduling.wip_limit。`);
	}
	function lintWatchdog(board, emit) {
		const w = board.watchdog;
		if (w === void 0 || w === null) return;
		if (typeof w !== "object" || Array.isArray(w)) {
			emit("FMT-WATCHDOG", `watchdog 若存在必须是对象或 null（当前：${JSON.stringify(w)}）。`);
			return;
		}
		const wd = w;
		if (wd.mechanism !== void 0 && !isEnumMember("watchdogMechanism", wd.mechanism)) emit("FMT-WATCHDOG", `watchdog.mechanism 是 ${JSON.stringify(wd.mechanism)}，应 ∈ {cron, loop, monitor, shell}。影响：verify-board 到点/缺失提醒按机制分支——错值则提醒退化。`);
		for (const k of ["armed_at", "fire_at"]) if (badTimestamp(wd[k])) emit("FMT-WATCHDOG", `watchdog.${k} 是 ${JSON.stringify(wd[k])}，非严格 ISO-8601 UTC。影响：verify-board 到点判定/过期 self-heal 读它——格式不对则自我唤醒提醒失准。`);
	}
	function lintMeta(board, emit) {
		const m = board.meta;
		if (!m || typeof m !== "object" || Array.isArray(m)) return;
		const mt = m;
		if (mt.template_version !== void 0 && !Number.isInteger(mt.template_version)) emit("FMT-META", `meta.template_version 是 ${JSON.stringify(mt.template_version)}，非整数。影响：timeline 版本门读它（非整数 → 当旧板走拓扑轴，降级不挂）；建议用整数或省略。`);
		if (badTimestamp(mt.created_at)) emit("FMT-META", `meta.created_at 是 ${JSON.stringify(mt.created_at)}，非严格 ISO-8601 UTC。影响：viewer 建板时刻渲染退化（不致命）。`);
	}
	function lintLog(board, emit) {
		const log = board.log;
		if (log === void 0) return;
		if (!Array.isArray(log)) {
			emit("FMT-LOG", `log 若存在必须是数组（append-only 审计轨迹；当前：${JSON.stringify(log)}）。`);
			return;
		}
		for (let i = 0; i < log.length; i++) {
			const e = log[i];
			if (!e || typeof e !== "object" || Array.isArray(e)) {
				emit("FMT-LOG", `log[${i}] 应为对象 {ts, summary, …}（当前：${JSON.stringify(e)}）。`);
				continue;
			}
			if (typeof e.ts !== "string") emit("FMT-LOG", `log[${i}].ts 应为字符串时间戳（当前：${JSON.stringify(e.ts)}）。`);
			else if (!isISOUTC(e.ts)) emit("FMT-LOG", `log[${i}].ts 是 ${JSON.stringify(e.ts)}，非严格 ISO-8601 UTC（影响 timeline 排序，不致命）。`);
			if (typeof e.summary !== "string" || e.summary === "") emit("FMT-LOG", `log[${i}].summary 应为非空字符串（当前：${JSON.stringify(e.summary)}）。`);
			if (e.kind !== void 0 && !isEnumMember("logKind", e.kind)) emit("FMT-LOG", `log[${i}].kind 是 ${JSON.stringify(e.kind)}，应 ∈ {dispatch, recon, verify, finding, decision, replan, handoff, note}。`);
		}
	}
	function lintJudgmentCalls(board, emit) {
		const jc = board.judgment_calls;
		if (jc === void 0) return;
		if (!Array.isArray(jc)) {
			emit("FMT-JUDGMENT-CALLS", `judgment_calls 若存在必须是数组（自决诚实台账；当前：${JSON.stringify(jc)}）。`);
			return;
		}
		for (let i = 0; i < jc.length; i++) {
			const e = jc[i];
			const lbl = e && typeof e.id === "string" && e.id ? e.id : `judgment_calls[${i}]`;
			if (!e || typeof e !== "object" || Array.isArray(e)) {
				emit("FMT-JUDGMENT-CALLS", `${lbl} 应为对象（当前：${JSON.stringify(e)}）。`);
				continue;
			}
			if (typeof e.summary !== "string" || e.summary === "") emit("FMT-JUDGMENT-CALLS", `${lbl}.summary 应为非空字符串。`);
			if (e.category !== void 0 && !isEnumMember("jcCategory", e.category)) emit("FMT-JUDGMENT-CALLS", `${lbl}.category 是 ${JSON.stringify(e.category)}，应 ∈ {architecture, drift, spec-impl-misalignment, other}。`);
			if (e.severity !== void 0 && !isEnumMember("jcSeverity", e.severity)) emit("FMT-JUDGMENT-CALLS", `${lbl}.severity 是 ${JSON.stringify(e.severity)}，应 ∈ {low, medium, high, critical}（回前台 hook 按它告知）。`);
			if (e.status !== void 0 && !isEnumMember("jcStatus", e.status)) emit("FMT-JUDGMENT-CALLS", `${lbl}.status 是 ${JSON.stringify(e.status)}，应 ∈ {pending_review, upheld, overturned}。`);
			for (const k of ["raised_at", "resolved_at"]) if (badTimestamp(e[k])) emit("FMT-JUDGMENT-CALLS", `${lbl}.${k} 是 ${JSON.stringify(e[k])}，非严格 ISO-8601 UTC。`);
		}
	}
	function lintCadenceFormat(board, emit) {
		const c = board.cadence;
		if (c === void 0) return;
		if (!c || typeof c !== "object" || Array.isArray(c)) {
			emit("FMT-CADENCE", `cadence 若存在必须是对象 {target?, iterations?}（当前：${JSON.stringify(c)}）。`);
			return;
		}
		const cd = c;
		if (cd.iterations !== void 0) if (!Array.isArray(cd.iterations)) emit("FMT-CADENCE", `cadence.iterations 若存在必须是数组（当前：${JSON.stringify(cd.iterations)}）。`);
		else for (let i = 0; i < cd.iterations.length; i++) {
			const it = cd.iterations[i];
			const lbl = it && typeof it.id === "string" && it.id ? it.id : `cadence.iterations[${i}]`;
			if (!it || typeof it !== "object" || Array.isArray(it)) {
				emit("FMT-CADENCE", `${lbl} 应为对象 {id, started_at, deadline?, goal?, members?, status}（当前：${JSON.stringify(it)}）。`);
				continue;
			}
			if (typeof it.id !== "string" || it.id === "") emit("FMT-CADENCE", `${lbl}.id 应为非空字符串。`);
			if (it.status !== void 0 && !isEnumMember("iterationStatus", it.status)) emit("FMT-CADENCE", `${lbl}.status 是 ${JSON.stringify(it.status)}，应 ∈ {open, shipped}。`);
			for (const k of ["started_at", "deadline"]) if (badTimestamp(it[k])) emit("FMT-CADENCE", `${lbl}.${k} 是 ${JSON.stringify(it[k])}，非严格 ISO-8601 UTC。`);
			if (it.members !== void 0) {
				if (!Array.isArray(it.members) || it.members.some((m) => typeof m !== "string")) emit("FMT-CADENCE", `${lbl}.members 应为 task-id 字符串数组（当前：${JSON.stringify(it.members)}）。`);
			}
		}
	}
	function lintTaskFields(id, t, validIds, emit) {
		if (t.executor !== void 0 && !isEnumMember("executor", t.executor)) emit("FMT-EXECUTOR", `${id}.executor 是 ${JSON.stringify(t.executor)}，应 ∈ {user, master-orchestrator, subagent, workflow, external}。坏什么：执行者类型路由派发/viewer 渲染；非法值 = 调度与展示错配。`, id);
		if (t.role !== void 0 && !isEnumMember("role", t.role)) emit("FMT-ROLE", `${id}.role 是 ${JSON.stringify(t.role)}，应 ∈ {normal, fill-work}。`, id);
		if (t.type !== void 0 && !isEnumMember("taskType", t.type)) emit("FMT-TYPE", `${id}.type 是 ${JSON.stringify(t.type)}，不在已知集合 {design, planning, development, development-demo, acceptance, e2e-integration, doc-alignment, pr} 内。影响：type 是开放枚举（未来可扩展），未知值不致命；但若是 typo 会让基于 type 的 BIZ 规则（如 spec/plan refs 必填）漏触发。`, id);
		if (t.references !== void 0) if (!Array.isArray(t.references)) emit("FMT-REF", `${id}.references 若存在必须是数组 [{kind, ref, note?}]（当前：${JSON.stringify(t.references)}）。`, id);
		else for (let i = 0; i < t.references.length; i++) {
			const r = t.references[i];
			if (!r || typeof r !== "object" || Array.isArray(r)) {
				emit("FMT-REF", `${id}.references[${i}] 应为对象 {kind, ref, note?}（当前：${JSON.stringify(r)}）。`, id);
				continue;
			}
			if (!isAbsolutePathOrUrl(r.ref)) emit("FMT-REF", `${id}.references[${i}].ref 是 ${JSON.stringify(r.ref)}，必须是绝对路径（/…）或 URL（http(s)://…）——禁相对路径。坏什么：相对路径装到别的机器/cwd 解析就死链（Finding #38 家族）；ref 是给别的 session/人/viewer 跳转用的，必须自洽。`, id);
			if (r.kind !== void 0 && !isEnumMember("refKind", r.kind)) emit("FMT-REF-KIND", `${id}.references[${i}].kind 是 ${JSON.stringify(r.kind)}，应 ∈ {spec, plan, doc, web, code, issue, other}（开放枚举，未知值不致命）。`, id);
		}
		if (t.estimate !== void 0) {
			const e = t.estimate;
			if (!e || typeof e !== "object" || Array.isArray(e) || typeof e.value !== "number" || typeof e.unit !== "string") emit("FMT-ESTIMATE", `${id}.estimate 应为对象 {value:number, unit:string}（当前：${JSON.stringify(e)}）。影响：cadence 拆解校验 / CPM 喂时长读它——形状坏则降级 unit（不致命）。`, id);
		}
		if (t.acceptance !== void 0) {
			const a = t.acceptance;
			if (typeof a !== "string") if (!a || typeof a !== "object" || Array.isArray(a)) emit("FMT-ACCEPTANCE", `${id}.acceptance 应为字符串（一句话 DoD）或对象 {criteria:[…]}（当前：${JSON.stringify(a)}）。`, id);
			else {
				const ao = a;
				if (!Array.isArray(ao.criteria) || ao.criteria.length === 0) emit("FMT-ACCEPTANCE", `${id}.acceptance 是目标函数对象时 criteria 必须是非空数组（当前：${JSON.stringify(ao.criteria)}）。`, id);
				else for (let i = 0; i < ao.criteria.length; i++) {
					const cr = ao.criteria[i];
					if (!cr || typeof cr !== "object" || cr.status !== void 0 && !isEnumMember("acceptanceStatus", cr.status)) emit("FMT-ACCEPTANCE", `${id}.acceptance.criteria[${i}].status 应 ∈ {pending, met, failed}（当前：${JSON.stringify(cr && cr.status)}）。`, id);
				}
			}
		}
		if (t.blocked_on !== void 0 && t.blocked_on !== "user") {
			if (typeof t.blocked_on !== "string" || !validIds.has(t.blocked_on)) emit("FMT-BLOCKED-ON", `${id}.blocked_on 是 ${JSON.stringify(t.blocked_on)}，但它既不是 "user"、也不是某个存在的 task id。影响：不致命（webview 显示裸字符串），但这条阻塞关系画不出来。建议指向真实 id 或 "user"。`, id);
		}
		if (t.wip_limit !== void 0 && typeof t.wip_limit !== "number") emit("FMT-WIP", `${id}.wip_limit 是 ${JSON.stringify(t.wip_limit)}，非数字。影响：posttool-batch 两级 WIP 读它覆写 owner cap——非数字则该覆写静默失效（graceful）。`, id);
		for (const field of [
			"created_at",
			"started_at",
			"finished_at"
		]) {
			const v = t[field];
			if (badTimestamp(v)) emit("FMT-TIME", `${id}.${field} 是 ${JSON.stringify(v)}，非严格 ISO-8601 UTC（YYYY-MM-DDTHH:MM:SSZ）。影响：跨天 orchestration 的 timeline 时长会算错；建议用完整 UTC 时间戳。`, id);
		}
	}
	function lintTaskBiz(id, t, emit) {
		const refs = Array.isArray(t.references) ? t.references.filter((r) => r && typeof r === "object") : [];
		const hasRefKind = (k) => refs.some((r) => r.kind === k);
		if (t.type === "development") {
			if (!hasRefKind("spec") || !hasRefKind("plan")) emit("BIZ-DEV-REFS", `${id} 是 development task，但 references 缺 ${!hasRefKind("spec") ? "kind=spec " : ""}${!hasRefKind("plan") ? "kind=plan" : ""} 引用。影响：开发型节点至少要有 spec doc 与 plan doc 作为依据，缺则执行者/复盘者无锚点（用户定·warn 容渐进补全）。`, id);
		}
		if ((/* @__PURE__ */ new Set([
			"development",
			"development-demo",
			"acceptance",
			"e2e-integration"
		])).has(t.type) && !acceptanceNonEmpty(t.acceptance)) emit("BIZ-ACCEPTANCE-REQUIRED", `${id} 是 ${t.type} task，但缺 acceptance（验收标准）。影响：这些 type 的 done 真语义靠 acceptance 锚定，缺则「做完了没」无客观判据（warn 容 in_flight 起补全）。`, id);
		if ((t.executor === "subagent" || t.executor === "workflow") && (typeof t.handle !== "string" || t.handle === "")) emit("BIZ-EXECUTOR-HANDLE", `${id}.executor=${JSON.stringify(t.executor)} 但缺 handle（后台句柄）。影响：resume 接驳在飞后台任务靠 handle，缺则换 session 后接不回（warn 容刚派发未回填的瞬态）。`, id);
		if (t.executor === "external" && !hasRefKind("issue")) emit("BIZ-EXTERNAL-ISSUE", `${id}.executor=external 但 references 缺 kind=issue 引用。影响：外部第三方执行的任务该挂一个 issue 做追踪锚点（#31·task→github issue 映射），缺则无外部协作落点。`, id);
		if (isAwaitingUser(t)) {
			const dp = t.decision_package;
			if (!dp || typeof dp !== "object" || Array.isArray(dp)) emit("BIZ-AWAITING", `${id} 是 awaiting-user 节点（blocked_on:"user" + status=${JSON.stringify(t.status)}），但缺少 decision_package 对象（当前：${JSON.stringify(dp)}）。awaiting-user 节点的存在意义就是一个「备好料的用户决策点」——没包 = 新 session 跑 /cc-master:discuss 开不起来讨论，采访闭环塌掉。\n  怎么修：在 ${id} 上挂 decision_package（version/inputs_hash/ask_type/context_md/what_i_need/options…），或若已不在等用户拍板，改 blocked_on / status。`, id);
			else lintDecisionPackage(id, dp, emit);
		}
		lintTimeOrder(id, t, emit);
	}
	function lintDecisionPackage(id, dp, emit) {
		const INPUTS_HASH_RE = /^sha256:[0-9a-f]{64}$/;
		if (typeof dp.context_md !== "string" || dp.context_md === "") emit("BIZ-DECISION-PACKAGE", `${id}.decision_package.context_md 应为非空字符串（当前：${JSON.stringify(dp.context_md)}）。影响：discuss 用它讲清「为什么卡在这」——缺它用户被空投到失上下文决策点。`, id);
		if (typeof dp.what_i_need !== "string" || dp.what_i_need === "") emit("BIZ-DECISION-PACKAGE", `${id}.decision_package.what_i_need 应为非空字符串（当前：${JSON.stringify(dp.what_i_need)}）。影响：discuss 据它告诉用户「该给你什么」——缺它讨论没有明确产出物。`, id);
		if (typeof dp.ask_type !== "string" || !isEnumMember("askType", dp.ask_type)) emit("BIZ-DECISION-PACKAGE", `${id}.decision_package.ask_type 应 ∈ {decision, advice, solution}（当前：${JSON.stringify(dp.ask_type)}）。影响：discuss 据它设定姿态——缺/错则姿态错配。`, id);
		else if (dp.ask_type === "decision" && !(Array.isArray(dp.options) && dp.options.length > 0)) emit("BIZ-DECISION-PACKAGE", `${id}.decision_package.ask_type 是 "decision" 却没有非空 options 数组（当前 options：${JSON.stringify(dp.options)}）。影响：decision 型采访让用户在 options 里拍板——没选项用户无从选起。`, id);
		if (typeof dp.inputs_hash !== "string" || !INPUTS_HASH_RE.test(dp.inputs_hash)) emit("BIZ-DECISION-PACKAGE", `${id}.decision_package.inputs_hash 应匹配 sha256:<64位hex>（当前：${JSON.stringify(dp.inputs_hash)}）。影响：discuss 入口重算此值做 freshness-check——格式不对则时效性校验失效。`, id);
		if (typeof dp.enter_cmd !== "string" || dp.enter_cmd === "") emit("BIZ-DECISION-PACKAGE", `${id}.decision_package.enter_cmd 应为非空字符串（当前：${JSON.stringify(dp.enter_cmd)}）。影响：webview 据此渲染复制 /cc-master:discuss 按钮——缺它「复制即用」那一环断掉。`, id);
	}
	function lintTimeOrder(id, t, emit) {
		const c = isISOUTC(t.created_at) ? Date.parse(t.created_at) : null;
		const s = isISOUTC(t.started_at) ? Date.parse(t.started_at) : null;
		const f = isISOUTC(t.finished_at) ? Date.parse(t.finished_at) : null;
		if (c != null && s != null && s < c) emit("BIZ-TIME-ORDER", `${id} started_at 早于 created_at（语义乱序）。`, id);
		if (s != null && f != null && f < s) emit("BIZ-TIME-ORDER", `${id} finished_at 早于 started_at（语义乱序）。`, id);
		if (t.finished_at !== void 0 && t.started_at === void 0) emit("BIZ-TIME-ORDER", `${id} 有 finished_at 却无 started_at（语义：先起跑才能完成）。`, id);
		if (t.status === "in_flight" && t.started_at === void 0) emit("BIZ-TIME-ORDER", `${id} status=in_flight 却无 started_at（已派发执行应有起跑戳）。`, id);
		if (t.status === "done" && t.finished_at === void 0) emit("BIZ-TIME-ORDER", `${id} status=done 却无 finished_at（完成应有完成戳）。`, id);
	}
	function lintCadenceShipped(board, taskById, emit) {
		const c = board.cadence;
		if (!c || typeof c !== "object" || Array.isArray(c) || !Array.isArray(c.iterations)) return;
		for (const itAny of c.iterations) {
			const it = itAny;
			if (!it || typeof it !== "object" || it.status !== "shipped") continue;
			const members = Array.isArray(it.members) ? it.members.filter((m) => typeof m === "string") : [];
			const bad = [];
			for (const m of members) {
				const mt = taskById.get(m);
				if (!mt) {
					bad.push(`${m}(不存在)`);
					continue;
				}
				if (mt.status !== "done" || mt.verified !== true) bad.push(`${m}(${mt.status}${mt.verified === true ? "" : "/未验"})`);
			}
			if (bad.length) emit("BIZ-CADENCE-SHIPPED", `cadence iteration "${it.id}" 标 status=shipped，但其 members 未全部 done+verified：${bad.join(", ")}。坏什么：iteration 收口（shipped）的语义就是「这一批纵切切片全交付并验过」——成员没到位却标 shipped = 收口完整性破，节奏台账谎报进度。\n  怎么修：把未完成成员推到 done+verified 再标 shipped，或把它们移出本 iteration 的 members。`);
		}
	}
	function buildGraph(tasks) {
		const list = Array.isArray(tasks) ? tasks : [];
		const ids = /* @__PURE__ */ new Set();
		const taskById = /* @__PURE__ */ new Map();
		for (const t of list) if (t && typeof t === "object" && !Array.isArray(t) && typeof t.id === "string" && t.id !== "") {
			if (!ids.has(t.id)) {
				ids.add(t.id);
				taskById.set(t.id, t);
			}
		}
		const upstream = /* @__PURE__ */ new Map();
		const downstream = /* @__PURE__ */ new Map();
		for (const id of ids) {
			upstream.set(id, []);
			downstream.set(id, []);
		}
		const dangling = [];
		const selfLoops = [];
		const edgeIssues = [];
		for (const t of list) {
			if (!t || typeof t !== "object" || Array.isArray(t)) continue;
			const id = t.id;
			if (typeof id !== "string" || id === "" || !ids.has(id)) continue;
			if (taskById.get(id) !== t) continue;
			const deps = Array.isArray(t.deps) ? t.deps.filter((d) => typeof d === "string") : [];
			for (const d of deps) {
				if (!ids.has(d)) {
					dangling.push({
						id,
						dep: d
					});
					edgeIssues.push({
						kind: "dangling",
						id,
						dep: d
					});
					continue;
				}
				if (d === id) {
					selfLoops.push(id);
					edgeIssues.push({
						kind: "selfLoop",
						id
					});
					continue;
				}
				upstream.get(id).push(d);
				downstream.get(d).push(id);
			}
		}
		const parentOf = /* @__PURE__ */ new Map();
		const children = /* @__PURE__ */ new Map();
		for (const t of list) {
			if (!t || typeof t !== "object" || Array.isArray(t)) continue;
			const id = t.id;
			if (typeof id !== "string" || id === "" || !ids.has(id)) continue;
			if (taskById.get(id) !== t) continue;
			const p = t.parent;
			if (typeof p !== "string" || p === "") continue;
			parentOf.set(id, p);
			if (!children.has(p)) children.set(p, []);
			children.get(p).push(id);
		}
		return {
			ids,
			taskById,
			upstream,
			downstream,
			dangling,
			selfLoops,
			edgeIssues,
			children,
			parentOf
		};
	}
	function findCycle(graph) {
		const WHITE = 0, GRAY = 1, BLACK = 2;
		const color = /* @__PURE__ */ new Map();
		const parent = /* @__PURE__ */ new Map();
		for (const id of graph.keys()) color.set(id, WHITE);
		for (const start of graph.keys()) {
			if (color.get(start) !== WHITE) continue;
			const stack = [{
				node: start,
				deps: graph.get(start) || [],
				i: 0
			}];
			color.set(start, GRAY);
			while (stack.length) {
				const top = stack[stack.length - 1];
				if (top.i >= top.deps.length) {
					color.set(top.node, BLACK);
					stack.pop();
					continue;
				}
				const next = top.deps[top.i++];
				const c = color.get(next);
				if (c === void 0) continue;
				if (c === GRAY) {
					const cyc = [next];
					let cur = top.node;
					while (cur !== next && cur !== void 0) {
						cyc.push(cur);
						cur = parent.get(cur);
					}
					return cyc.reverse();
				}
				if (c === WHITE) {
					color.set(next, GRAY);
					parent.set(next, top.node);
					stack.push({
						node: next,
						deps: graph.get(next) || [],
						i: 0
					});
				}
			}
		}
		return null;
	}
	function formatReport(result) {
		const { errors, warnings } = result;
		if (errors.length === 0 && warnings.length === 0) return "";
		const lines = [];
		const head = errors.length > 0 ? `cc-master board lint: FAIL（${errors.length} 个 hard error${warnings.length ? `，${warnings.length} warning` : ""}）` : `cc-master board lint: PASS（0 hard error，${warnings.length} warning）`;
		lines.push(head, "");
		for (const e of errors) lines.push(`[hard] ${e.rule} ${e.message}`, "");
		for (const w of warnings) lines.push(`[warn] ${w.rule} ${w.message}`, "");
		return lines.join("\n").replace(/\n+$/, "\n");
	}
	const STATUS_ENUM = STATUS_ENUM_LOCAL;
	//#endregion
	//#region src/board-graph-core.ts
	const DONE = "done";
	const ISO_UTC_RE$1 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
	function parseTs(v) {
		if (typeof v !== "string" || !ISO_UTC_RE$1.test(v)) return null;
		const ms = Date.parse(v);
		return Number.isFinite(ms) ? ms : null;
	}
	function estimateHours(estimate) {
		if (!estimate || typeof estimate !== "object" || Array.isArray(estimate)) return null;
		const v = estimate.value;
		if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
		const mult = {
			h: 1,
			hour: 1,
			hours: 1,
			m: 1 / 60,
			min: 1 / 60,
			minute: 1 / 60,
			minutes: 1 / 60,
			d: 24,
			day: 24,
			days: 24,
			w: 168,
			week: 168,
			weeks: 168
		}[typeof estimate.unit === "string" ? estimate.unit.trim().toLowerCase() : ""];
		return mult ? v * mult : null;
	}
	function nodeDuration(task, nowMs) {
		if (task && typeof task === "object") {
			const started = parseTs(task.started_at);
			const finished = parseTs(task.finished_at);
			if (started != null && finished != null && finished > started) return {
				dur: (finished - started) / 36e5,
				source: "measured"
			};
			if (started != null && task.status === "in_flight") {
				const el = nowMs - started;
				if (el > 0) return {
					dur: el / 36e5,
					source: "measured"
				};
			}
			const est = estimateHours(task.estimate);
			if (est != null) return {
				dur: est,
				source: "estimate"
			};
		}
		return {
			dur: 1,
			source: "unit"
		};
	}
	function analyzeGraph(board) {
		const g = buildGraph(board && typeof board === "object" && Array.isArray(board.tasks) ? board.tasks : []);
		const ids = g.ids;
		const taskById = g.taskById;
		const upstream = g.upstream;
		const downstream = g.downstream;
		const statusOf = (id) => {
			const t = taskById.get(id);
			return t ? t.status : void 0;
		};
		const isDone = (id) => statusOf(id) === DONE;
		function topoSort() {
			const cyc = findCycle(upstream);
			const indeg = /* @__PURE__ */ new Map();
			for (const id of ids) indeg.set(id, upstream.get(id).length);
			const queue = [];
			for (const id of ids) if (indeg.get(id) === 0) queue.push(id);
			queue.sort();
			const order = [];
			while (queue.length) {
				const n = queue.shift();
				order.push(n);
				const next = [];
				for (const m of downstream.get(n)) {
					indeg.set(m, indeg.get(m) - 1);
					if (indeg.get(m) === 0) next.push(m);
				}
				next.sort();
				for (const m of next) queue.push(m);
			}
			return {
				order,
				cycle: cyc
			};
		}
		function cycle() {
			return findCycle(upstream);
		}
		function predecessors(id) {
			return ids.has(id) ? upstream.get(id).slice() : [];
		}
		function successors(id) {
			return ids.has(id) ? downstream.get(id).slice() : [];
		}
		function readySet() {
			const out = [];
			for (const id of ids) {
				if (statusOf(id) !== "ready") continue;
				if (upstream.get(id).every((d) => isDone(d))) out.push(id);
			}
			return out;
		}
		function wipStats() {
			const counts = {};
			let inFlight = 0, blocked = 0, userGates = 0;
			for (const id of ids) {
				const s = statusOf(id);
				counts[s] = (counts[s] || 0) + 1;
				if (s === "in_flight") inFlight++;
				if (s === "blocked") blocked++;
				const t = taskById.get(id);
				if (t && t.blocked_on === "user" && (s === "blocked" || s === "in_flight")) userGates++;
			}
			return {
				in_flight: inFlight,
				blocked,
				userGates,
				counts
			};
		}
		function children(ownerId) {
			return g.children.has(ownerId) ? g.children.get(ownerId).slice() : [];
		}
		function parentOf(id) {
			return g.parentOf.has(id) ? g.parentOf.get(id) : null;
		}
		function rollupConsistency() {
			const out = [];
			for (const [owner, kids] of g.children) {
				if (statusOf(owner) !== DONE) continue;
				const bad = kids.filter((c) => !isDone(c));
				if (bad.length) out.push({
					owner,
					nonDoneChildren: bad
				});
			}
			return out;
		}
		function checkDepth1() {
			const out = [];
			for (const [owner, kids] of g.children) for (const c of kids) if (g.children.has(c)) for (const gc of g.children.get(c)) out.push({
				owner,
				grandchild: gc
			});
			return out;
		}
		function parentCycles() {
			const padj = /* @__PURE__ */ new Map();
			for (const id of ids) padj.set(id, []);
			for (const [child, owner] of g.parentOf) if (ids.has(child) && ids.has(owner)) padj.get(child).push(owner);
			const cyc = findCycle(padj);
			return cyc ? [cyc] : [];
		}
		function descendants(id) {
			const acc = /* @__PURE__ */ new Set();
			if (!ids.has(id)) return acc;
			const stack = downstream.get(id).slice();
			while (stack.length) {
				const n = stack.pop();
				if (acc.has(n)) continue;
				acc.add(n);
				for (const c of downstream.get(n)) if (!acc.has(c)) stack.push(c);
			}
			acc.delete(id);
			return acc;
		}
		function ancestors(id) {
			const acc = /* @__PURE__ */ new Set();
			if (!ids.has(id)) return acc;
			const stack = upstream.get(id).slice();
			while (stack.length) {
				const n = stack.pop();
				if (acc.has(n)) continue;
				acc.add(n);
				for (const p of upstream.get(n)) if (!acc.has(p)) stack.push(p);
			}
			acc.delete(id);
			return acc;
		}
		function reachable(a, b) {
			if (a === b) return ids.has(a);
			return descendants(a).has(b);
		}
		function longestPath() {
			const order = topoSort().order;
			if (order.length === 0 && ids.size > 0) return {
				chain: [],
				length: 0
			};
			const len = /* @__PURE__ */ new Map();
			const prev = /* @__PURE__ */ new Map();
			let endId = null, endLen = 0;
			for (const id of order) {
				let best = 1, bestPrev = null;
				for (const d of upstream.get(id)) {
					const c = (len.get(d) || 0) + 1;
					if (c > best) {
						best = c;
						bestPrev = d;
					}
				}
				len.set(id, best);
				prev.set(id, bestPrev);
				if (best > endLen) {
					endLen = best;
					endId = id;
				}
			}
			const chain = [];
			let cur = endId;
			while (cur != null) {
				chain.push(cur);
				cur = prev.get(cur);
			}
			chain.reverse();
			return {
				chain,
				length: endLen
			};
		}
		function criticalPath(opts) {
			const nowMs = opts && Number.isFinite(opts.now) ? opts.now : Date.now();
			const cyc = findCycle(upstream);
			if (cyc) return {
				chain: [],
				schedule: /* @__PURE__ */ new Map(),
				makespan: null,
				weight_source: "cycle",
				cycle: cyc
			};
			const order = topoSort().order;
			const dur = /* @__PURE__ */ new Map();
			let nMeasured = 0, nEstimate = 0, nUnit = 0;
			for (const id of ids) {
				const { dur: d, source } = nodeDuration(taskById.get(id), nowMs);
				dur.set(id, d);
				if (source === "measured") nMeasured++;
				else if (source === "estimate") nEstimate++;
				else nUnit++;
			}
			const kinds = (nMeasured > 0 ? 1 : 0) + (nEstimate > 0 ? 1 : 0) + (nUnit > 0 ? 1 : 0);
			let weight_source = "unit";
			if (kinds > 1) weight_source = "mixed";
			else if (nMeasured > 0) weight_source = "measured";
			else if (nEstimate > 0) weight_source = "estimate";
			else weight_source = "unit";
			const es = /* @__PURE__ */ new Map(), ef = /* @__PURE__ */ new Map();
			for (const id of order) {
				let e = 0;
				for (const d of upstream.get(id)) e = Math.max(e, ef.get(d) || 0);
				es.set(id, e);
				ef.set(id, e + dur.get(id));
			}
			let makespan = 0;
			for (const id of ids) makespan = Math.max(makespan, ef.get(id) || 0);
			const lf = /* @__PURE__ */ new Map(), ls = /* @__PURE__ */ new Map();
			const revOrder = order.slice().reverse();
			for (const id of revOrder) {
				const downs = downstream.get(id);
				let l = makespan;
				if (downs.length) {
					l = Infinity;
					for (const m of downs) l = Math.min(l, ls.get(m));
				}
				lf.set(id, l);
				ls.set(id, l - dur.get(id));
			}
			const schedule = /* @__PURE__ */ new Map();
			for (const id of ids) {
				const downs = downstream.get(id);
				let ff = makespan - (ef.get(id) || 0);
				if (downs.length) {
					ff = Infinity;
					for (const m of downs) ff = Math.min(ff, (es.get(m) || 0) - (ef.get(id) || 0));
				}
				schedule.set(id, {
					es: es.get(id) || 0,
					ef: ef.get(id) || 0,
					ls: ls.get(id) || 0,
					lf: lf.get(id) || 0,
					float: (ls.get(id) || 0) - (es.get(id) || 0),
					free_float: ff,
					dur: dur.get(id)
				});
			}
			const EPS = 1e-9;
			let endId = null, endEf = -Infinity;
			for (const id of ids) {
				const e = ef.get(id) || 0;
				if (e > endEf) {
					endEf = e;
					endId = id;
				}
			}
			const chain = [];
			let cur = endId;
			const guard = /* @__PURE__ */ new Set();
			while (cur != null && !guard.has(cur)) {
				guard.add(cur);
				chain.push(cur);
				const myEs = es.get(cur) || 0;
				let pick = null;
				for (const d of upstream.get(cur)) if (Math.abs((ef.get(d) || 0) - myEs) < EPS) {
					pick = d;
					break;
				}
				cur = pick;
			}
			chain.reverse();
			return {
				chain,
				schedule,
				makespan: weight_source === "measured" || weight_source === "estimate" ? makespan : null,
				weight_source
			};
		}
		function parallelism() {
			const T1 = ids.size;
			const Tinf = longestPath().length;
			return {
				T1,
				Tinf,
				parallelism: Tinf > 0 ? T1 / Tinf : 0,
				brent: Tinf
			};
		}
		function rollupProgress(ownerId) {
			const kids = g.children.has(ownerId) ? g.children.get(ownerId) : [];
			const total = kids.length;
			const done = kids.filter((c) => isDone(c)).length;
			return {
				done,
				total,
				ratio: total > 0 ? done / total : 0
			};
		}
		return {
			ids,
			taskById,
			upstream,
			downstream,
			topoSort,
			cycle,
			predecessors,
			successors,
			readySet,
			wipStats,
			children,
			parentOf,
			rollupConsistency,
			checkDepth1,
			parentCycles,
			descendants,
			ancestors,
			reachable,
			criticalPath,
			longestPath,
			parallelism,
			rollupProgress
		};
	}
	//#endregion
	//#region src/board-lock.ts
	const DEFAULTS = {
		staleMs: 3e4,
		retries: 50,
		retryMs: 100
	};
	function lockPathFor(boardPath) {
		return `${boardPath}.lock`;
	}
	function sleepSync(ms) {
		if (!(ms > 0)) return;
		try {
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
		} catch (_) {
			const end = Date.now() + ms;
			while (Date.now() < end);
		}
	}
	function readLockMeta(lockPath) {
		try {
			const raw = node_fs.readFileSync(lockPath, "utf8");
			const m = JSON.parse(raw);
			return m && typeof m === "object" && !Array.isArray(m) ? m : null;
		} catch (_) {
			return null;
		}
	}
	function acquire(boardPath, opts = {}) {
		const { staleMs, retries, retryMs } = {
			...DEFAULTS,
			...opts
		};
		const lockPath = lockPathFor(boardPath);
		const token = `${process.pid}:${node_crypto.randomUUID ? node_crypto.randomUUID() : node_crypto.randomBytes(16).toString("hex")}`;
		for (let attempt = 0; attempt <= retries; attempt++) try {
			const fd = node_fs.openSync(lockPath, "wx");
			try {
				node_fs.writeFileSync(fd, JSON.stringify({
					token,
					pid: process.pid,
					ts: Date.now()
				}));
			} finally {
				node_fs.closeSync(fd);
			}
			return token;
		} catch (e) {
			const err = e;
			if (!err || err.code !== "EEXIST") throw e;
			const meta = readLockMeta(lockPath);
			const ts = meta && Number.isFinite(meta.ts) ? meta.ts : null;
			if (ts == null || Date.now() - ts > staleMs) {
				try {
					node_fs.unlinkSync(lockPath);
				} catch (_) {}
				continue;
			}
			if (attempt < retries) sleepSync(retryMs);
		}
		throw new Error(`LOCK_TIMEOUT: ${lockPath} 被占用超过 ${retries} 次重试（可能另一个写者在写，或锁未被释放——必要时手动删 .lock）`);
	}
	function release(boardPath, token) {
		const lockPath = lockPathFor(boardPath);
		const meta = readLockMeta(lockPath);
		if (!meta) return false;
		if (meta.token !== token) return false;
		try {
			node_fs.unlinkSync(lockPath);
			return true;
		} catch (_) {
			return false;
		}
	}
	function withLock(boardPath, fn, opts = {}) {
		const token = acquire(boardPath, opts);
		try {
			return fn();
		} finally {
			release(boardPath, token);
		}
	}
	function isLocked(boardPath, opts = {}) {
		const { staleMs } = {
			...DEFAULTS,
			...opts
		};
		const lockPath = lockPathFor(boardPath);
		if (!node_fs.existsSync(lockPath)) return false;
		const meta = readLockMeta(lockPath);
		const ts = meta && Number.isFinite(meta.ts) ? meta.ts : null;
		if (ts == null) return true;
		return Date.now() - ts <= staleMs;
	}
	//#endregion
	exports.ENUMS = ENUMS;
	exports.FIELDS = FIELDS;
	exports.INVARIANTS = INVARIANTS;
	exports.ISO_UTC_RE = ISO_UTC_RE;
	exports.OPEN_ENUMS = OPEN_ENUMS;
	exports.SCHEMA_VERSION = SCHEMA_VERSION;
	exports.STATUS_ENUM = STATUS_ENUM;
	exports.STATUS_MACHINE = STATUS_MACHINE;
	exports.TIERS = TIERS;
	exports.acceptanceConverged = acceptanceConverged;
	exports.acquire = acquire;
	exports.analyzeGraph = analyzeGraph;
	exports.buildGraph = buildGraph;
	exports.estimateHours = estimateHours;
	exports.findCycle = findCycle;
	exports.formatReport = formatReport;
	exports.invariant = invariant;
	exports.isAbsolutePathOrUrl = isAbsolutePathOrUrl;
	exports.isActiveStatus = isActiveStatus;
	exports.isAwaitingUser = isAwaitingUser;
	exports.isDoneStatus = isDoneStatus;
	exports.isEnumMember = isEnumMember;
	exports.isISOUTC = isISOUTC;
	exports.isLegalTransition = isLegalTransition;
	exports.isLocked = isLocked;
	exports.levelOf = levelOf;
	exports.lintBoard = lintBoard;
	exports.lockPathFor = lockPathFor;
	exports.nodeDuration = nodeDuration;
	exports.release = release;
	exports.taskTrulyDone = taskTrulyDone;
	exports.withLock = withLock;
	return exports;
})({}, __ccm_node_crypto, __ccm_node_fs);
