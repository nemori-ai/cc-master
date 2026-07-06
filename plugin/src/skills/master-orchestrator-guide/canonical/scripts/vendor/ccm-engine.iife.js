var __ccm_node_fs = typeof require !== "undefined" ? require("node:fs") : {};
var __ccm_node_crypto = typeof require !== "undefined" ? require("node:crypto") : {};
var __ccm_node_path = typeof require !== "undefined" ? require("node:path") : {};
var __ccm_node_os = typeof require !== "undefined" ? require("node:os") : {};
var __ccm_node_child_process = typeof require !== "undefined" ? require("node:child_process") : {};
var __ccm_node_https = typeof require !== "undefined" ? require("node:https") : {};
var __ccm_node_http = typeof require !== "undefined" ? require("node:http") : {};
var __ccmEngine = (function(exports, node_fs, node_path, node_os, node_http, node_https, node_child_process, node_crypto) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	//#region \0rolldown/runtime.js
	var __create = Object.create;
	var __defProp = Object.defineProperty;
	var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
	var __getOwnPropNames = Object.getOwnPropertyNames;
	var __getProtoOf = Object.getPrototypeOf;
	var __hasOwnProp = Object.prototype.hasOwnProperty;
	var __exportAll = (all, no_symbols) => {
		let target = {};
		for (var name in all) __defProp(target, name, {
			get: all[name],
			enumerable: true
		});
		if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
		return target;
	};
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
	node_fs = __toESM(node_fs, 1);
	node_path = __toESM(node_path, 1);
	node_os = __toESM(node_os, 1);
	node_http = __toESM(node_http, 1);
	node_https = __toESM(node_https, 1);
	node_crypto = __toESM(node_crypto, 1);
	//#region src/paths.ts
	function resolveClaudeCodeConfigDir(env) {
		const e = env || process.env;
		if (e.CLAUDE_CONFIG_DIR) return node_path.resolve(e.CLAUDE_CONFIG_DIR);
		const home = e.HOME || node_os.homedir();
		return node_path.join(home, ".claude");
	}
	function resolveHostConfigDir(env) {
		return resolveClaudeCodeConfigDir(env);
	}
	const resolveClaudeConfigDir = resolveClaudeCodeConfigDir;
	function resolveCcMasterHome(env) {
		const e = env || process.env;
		if (e.CC_MASTER_HOME) return node_path.resolve(e.CC_MASTER_HOME);
		const home = e.HOME || node_os.homedir();
		return node_path.join(home, ".cc_master");
	}
	function resolveRateCachePath(env) {
		const e = env || process.env;
		if (e.CC_MASTER_RATE_CACHE) return e.CC_MASTER_RATE_CACHE;
		return node_path.join(resolveCcMasterHome(e), ".cc-master-rate-limits.json");
	}
	function resolveCredentialsPath(env) {
		const e = env || process.env;
		if (e.CRED_PATH) return e.CRED_PATH;
		return node_path.join(resolveClaudeConfigDir(e), ".credentials.json");
	}
	function resolveClaudeJsonPath(env) {
		const e = env || process.env;
		if (e.CLAUDE_JSON_PATH) return node_path.resolve(e.CLAUDE_JSON_PATH);
		const inConfigDir = node_path.join(resolveClaudeConfigDir(e), ".claude.json");
		try {
			if (node_fs.existsSync(inConfigDir)) return inConfigDir;
		} catch {}
		const home = e.HOME || node_os.homedir();
		return node_path.join(home, ".claude.json");
	}
	function resolveProjectsDir(env) {
		return node_path.join(resolveClaudeConfigDir(env), "projects");
	}
	//#endregion
	//#region src/account/registry.ts
	const SCHEMA = "cc-master/accounts/v1";
	const ISO_UTC_RE$2 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
	const VAULT_KINDS = /* @__PURE__ */ new Set(["keychain", "file"]);
	const TOKEN_LIKE_RE = /sk-ant-/i;
	function redactToken(s) {
		return typeof s === "string" ? s.replace(/sk-ant-\S+/gi, "<redacted-token>") : s;
	}
	const WINDOW_KEYS = ["5h", "7d"];
	const FORBIDDEN_FIELD_RE = /token$|^token$|oauth|secret|credential|password|bearer/i;
	const KNOWN_SUBSCRIPTION_TYPES = /* @__PURE__ */ new Set([
		"max",
		"pro",
		"team",
		"enterprise",
		"free"
	]);
	function defaultRegistryPath() {
		return node_path.join(resolveCcMasterHome(), "accounts.json");
	}
	function validateRegistry(obj) {
		const errors = [];
		const warnings = [];
		const err = (msg, account) => errors.push(account ? {
			message: redactToken(msg),
			account: redactToken(account)
		} : { message: redactToken(msg) });
		const warn = (msg, account) => warnings.push(account ? {
			message: redactToken(msg),
			account: redactToken(account)
		} : { message: redactToken(msg) });
		if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
			err(`registry 顶层必须是一个 JSON 对象（当前：${Array.isArray(obj) ? "数组" : typeof obj}）。`);
			return {
				errors,
				warnings
			};
		}
		const root = obj;
		if (root.schema !== "cc-master/accounts/v1") err(`schema 必须是字符串字面量 "${SCHEMA}"（当前：${JSON.stringify(root.schema)}）。它是 registry 版本协议锚点，缺/改 = 未来迁移会错认池。`);
		if (!("updated_at" in root)) warn("缺 top-level updated_at（registry 最后写入时刻）；saveRegistry 会在落盘时盖上。");
		else if (typeof root.updated_at !== "string" || !ISO_UTC_RE$2.test(root.updated_at)) warn(`updated_at 非严格 ISO-8601 UTC YYYY-MM-DDTHH:MM:SSZ（当前：${JSON.stringify(root.updated_at)}）。`);
		const accounts = root.accounts;
		if (!accounts || typeof accounts !== "object" || Array.isArray(accounts)) {
			err(`accounts 必须是对象（map：email → entry；空 {} 合法）。当前类型：${Array.isArray(accounts) ? "数组" : typeof accounts}。`);
			return {
				errors,
				warnings
			};
		}
		const accountsMap = accounts;
		for (const k of Object.keys(root)) if (k !== "schema" && k !== "updated_at" && k !== "accounts") warn(`未知顶层字段 ${JSON.stringify(k)}（registry 已知顶层只有 schema/updated_at/accounts）；放行但请确认非误写。`);
		for (const [k, v] of Object.entries(root)) {
			if (k === "accounts") continue;
			scanValuesForToken(v, k, err);
		}
		let activeCount = 0;
		for (const [email, entryRaw] of Object.entries(accountsMap)) {
			if (!entryRaw || typeof entryRaw !== "object" || Array.isArray(entryRaw)) {
				err(`entry for ${email} 必须是对象（当前类型：${Array.isArray(entryRaw) ? "数组" : typeof entryRaw}）——原始值已隐去不回显。`, email);
				scanValuesForToken(entryRaw, `accounts.${email}`, (m) => err(m, email));
				continue;
			}
			const entry = entryRaw;
			scanForTokenLeak(entry, email, err);
			const vault = entry.vault;
			if (!vault || typeof vault !== "object" || Array.isArray(vault)) err(`vault 必填且为对象（token 的非密引用指针，不含 token 值）。当前：${JSON.stringify(vault)}。`, email);
			else {
				const v = vault;
				if (!VAULT_KINDS.has(v.kind)) err(`vault.kind 必须 ∈ {keychain, file}（当前：${JSON.stringify(v.kind)}）。`, email);
				else if (v.kind === "keychain") {
					if (typeof v.service !== "string" || !v.service) err(`keychain vault 需非空 service（如 "cc-master-oauth"）。当前：${JSON.stringify(v.service)}。`, email);
					if (typeof v.account !== "string" || !v.account) err(`keychain vault 需 account（= email key）。当前：${JSON.stringify(v.account)}。`, email);
					else if (v.account !== email) warn(`keychain vault.account（${JSON.stringify(v.account)}）与 entry key email（${JSON.stringify(email)}）不一致——取 token 会按 account 找、与 key 脱节。`, email);
				} else if (v.kind === "file") {
					if (typeof v.path !== "string" || !v.path) err(`file vault 需非空 path（0600 vault 文件路径）。当前：${JSON.stringify(v.path)}。`, email);
					if (typeof v.key !== "string" || !v.key) err(`file vault 需 key（= email，vault 行前缀）。当前：${JSON.stringify(v.key)}。`, email);
					else if (v.key !== email) warn(`file vault.key（${JSON.stringify(v.key)}）与 entry key email（${JSON.stringify(email)}）不一致——取 token 会按 key 找、与 key 脱节。`, email);
				}
			}
			if (typeof entry.active !== "boolean") err(`active 必填且为 boolean（是否当前活跃号）。当前：${JSON.stringify(entry.active)}。`, email);
			else if (entry.active === true) activeCount += 1;
			for (const tf of [
				"token_added_at",
				"token_refreshed_at",
				"token_expires_at"
			]) if (tf in entry && entry[tf] != null) {
				if (typeof entry[tf] !== "string" || !ISO_UTC_RE$2.test(entry[tf])) warn(`${tf} 非严格 ISO-8601 UTC YYYY-MM-DDTHH:MM:SSZ（当前：${JSON.stringify(entry[tf])}）；跨天算时长会错。`, email);
			}
			if ("subscription_type" in entry && entry.subscription_type != null) {
				if (typeof entry.subscription_type !== "string" || !entry.subscription_type) warn(`subscription_type 应为非空字符串（订阅档枚举·非密，来自 blob.subscriptionType）。当前：${JSON.stringify(entry.subscription_type)}。`, email);
				else if (!KNOWN_SUBSCRIPTION_TYPES.has(entry.subscription_type)) warn(`subscription_type ${JSON.stringify(entry.subscription_type)} 不在已知枚举 {max,pro,team,enterprise,free}（放行——Claude Code 可能新增订阅档；仅提示确认非误写）。`, email);
			}
			if ("identity" in entry && entry.identity != null) {
				if (typeof entry.identity !== "object" || Array.isArray(entry.identity)) warn(`identity 应为对象（~/.claude.json oauthAccount 的非密身份原样透传·accountUuid/emailAddress/… 等）。当前：${JSON.stringify(entry.identity)}。`, email);
				else if (Object.keys(entry.identity).length === 0) warn(`identity 是空对象（无身份字段）——switch ②段会降级保留现有 oauthAccount 不动（登录显示可能仍是上一号）；建议重跑 --add 补。`, email);
			}
			if ("switchable" in entry && entry.switchable != null && typeof entry.switchable !== "boolean") warn(`switchable 应为 boolean（是否可无重启换号切入·缺省视作可切）。当前：${JSON.stringify(entry.switchable)}。`, email);
			if ("last_switch_out" in entry && entry.last_switch_out != null) validateSnapshot(entry.last_switch_out, email, "last_switch_out", err, warn);
			if ("last_observed_quota" in entry && entry.last_observed_quota != null) validateSnapshot(entry.last_observed_quota, email, "last_observed_quota", err, warn);
			if ("switch_history" in entry && entry.switch_history != null) if (!Array.isArray(entry.switch_history)) err(`switch_history 必须是数组（当前：${JSON.stringify(typeof entry.switch_history)}）。`, email);
			else entry.switch_history.forEach((snap, i) => {
				validateSnapshot(snap, email, `switch_history[${i}]`, err, warn);
			});
		}
		if (activeCount > 1) err(`active 唯一性破坏：发现 ${activeCount} 个 active:true 的号（至多一个当前活跃号）。写侧切入新号时须把旧 active 号置 false。`);
		return {
			errors,
			warnings
		};
	}
	function scanForTokenLeak(node, email, err, fieldPath, inIdentity) {
		if (node == null) return;
		if (typeof node === "string") {
			if (TOKEN_LIKE_RE.test(node)) err(`字段 ${fieldPath || "(root)"} 的值疑似含 token（命中 sk-ant- 形态）——registry 绝不该含任何 token / 凭证值（只存 vault 引用指针）。值已隐去不回显。`, email);
			return;
		}
		if (typeof node !== "object") return;
		for (const [k, v] of Object.entries(node)) {
			const childPath = fieldPath ? `${fieldPath}.${k}` : k;
			const childInIdentity = inIdentity || !fieldPath && k === "identity";
			if (!childInIdentity && FORBIDDEN_FIELD_RE.test(k)) err(`字段名 ${JSON.stringify(childPath)} 疑似用于存 token / 凭证（registry 只存 vault 非密引用，绝不存 token 字段）。`, email);
			scanForTokenLeak(v, email, err, childPath, childInIdentity);
		}
	}
	function scanValuesForToken(node, fieldPath, report) {
		if (node == null) return;
		if (typeof node === "string") {
			if (TOKEN_LIKE_RE.test(node)) report(`字段 ${fieldPath || "(root)"} 的值疑似含 token（命中 sk-ant- 形态）——registry 绝不该含任何 token / 凭证值（只存 vault 引用指针）。值已隐去不回显。`);
			return;
		}
		if (typeof node !== "object") return;
		for (const [k, v] of Object.entries(node)) scanValuesForToken(v, fieldPath ? `${fieldPath}.${k}` : k, report);
	}
	function validateSnapshot(snap, email, label, err, warn) {
		if (!snap || typeof snap !== "object" || Array.isArray(snap)) {
			err(`${label} 必须是对象（SwitchSnapshot）。当前：${JSON.stringify(snap)}。`, email);
			return;
		}
		const s = snap;
		if (typeof s.at !== "string" || !ISO_UTC_RE$2.test(s.at)) warn(`${label}.at 非严格 ISO-8601 UTC（当前：${JSON.stringify(s.at)}）。`, email);
		for (const wk of WINDOW_KEYS) {
			const w = s[wk];
			if (!w || typeof w !== "object" || Array.isArray(w)) {
				err(`${label}.${JSON.stringify(wk)} 必须是对象 { used_pct, resets_at }（当前：${JSON.stringify(w)}）。`, email);
				continue;
			}
			const win = w;
			if (!Number.isInteger(win.used_pct) || win.used_pct < 0 || win.used_pct > 100) err(`${label}.${wk}.used_pct 必须是 0-100 整数（当前：${JSON.stringify(win.used_pct)}）。`, email);
			if (typeof win.resets_at !== "string" || !ISO_UTC_RE$2.test(win.resets_at)) warn(`${label}.${wk}.resets_at 非严格 ISO-8601 UTC（当前：${JSON.stringify(win.resets_at)}）；选号算法按它推算恢复度、失真会选错号。`, email);
		}
	}
	function loadRegistry(p) {
		const filePath = p || defaultRegistryPath();
		let text;
		try {
			text = node_fs.readFileSync(filePath, "utf8");
		} catch (e) {
			const err = e;
			if (err && err.code === "ENOENT") return emptyRegistry();
			throw e;
		}
		let obj;
		try {
			obj = JSON.parse(text);
		} catch (e) {
			const why = e instanceof Error && e.message ? e.message : String(e);
			throw new Error(`accounts.json 不是合法 JSON（${filePath}）：${why}。请人工修复或删除该文件（删除 = 降级回天然单账号空池）。`);
		}
		if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error(`accounts.json 顶层不是对象（${filePath}），解析出 ${Array.isArray(obj) ? "数组" : typeof obj}。`);
		const reg = obj;
		if (!reg.accounts || typeof reg.accounts !== "object" || Array.isArray(reg.accounts)) reg.accounts = {};
		if (typeof reg.schema !== "string") reg.schema = SCHEMA;
		return reg;
	}
	function emptyRegistry() {
		return {
			schema: SCHEMA,
			accounts: {}
		};
	}
	function lockPath(regPath) {
		return `${regPath || defaultRegistryPath()}.lock`;
	}
	function sleepSyncMs(ms) {
		try {
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(1, ms | 0));
		} catch (_e) {
			const until = Date.now() + ms;
			while (Date.now() < until);
		}
	}
	function acquireRegistryLock(regPath, opts) {
		const o = opts || {};
		const lp = lockPath(regPath);
		const timeoutMs = Number.isFinite(o.timeoutMs) ? o.timeoutMs : Number.isFinite(Number(process.env.CCM_REGISTRY_LOCK_TIMEOUT_MS)) && Number(process.env.CCM_REGISTRY_LOCK_TIMEOUT_MS) > 0 ? Number(process.env.CCM_REGISTRY_LOCK_TIMEOUT_MS) : 2e4;
		const staleMs = Number.isFinite(o.staleMs) ? o.staleMs : Number.isFinite(Number(process.env.CCM_REGISTRY_LOCK_STALE_MS)) && Number(process.env.CCM_REGISTRY_LOCK_STALE_MS) > 0 ? Number(process.env.CCM_REGISTRY_LOCK_STALE_MS) : 12e4;
		const start = Date.now();
		const livePid = o && Number.isInteger(o.livePid) && o.livePid > 0 ? o.livePid : process.pid;
		try {
			node_fs.mkdirSync(node_path.dirname(lp), {
				recursive: true,
				mode: 448
			});
		} catch (_e) {}
		const ownerToken = `${String(livePid)}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		for (;;) try {
			const fd = node_fs.openSync(lp, "wx", 384);
			try {
				node_fs.writeSync(fd, JSON.stringify({
					pid: livePid,
					at: nowIso$1(),
					owner: ownerToken
				}));
			} catch (_e) {}
			node_fs.closeSync(fd);
			return {
				path: lp,
				owner: ownerToken
			};
		} catch (e) {
			const eno = e;
			if (!eno || eno.code !== "EEXIST") throw e;
			let stale = false;
			let observedOwner = null;
			try {
				const st = node_fs.statSync(lp);
				let pidKnown = false;
				let pidAlive = false;
				try {
					const info = JSON.parse(node_fs.readFileSync(lp, "utf8") || "{}");
					observedOwner = info && typeof info.owner === "string" ? info.owner : null;
					if (info && typeof info.pid === "number") {
						pidKnown = true;
						try {
							process.kill(info.pid, 0);
							pidAlive = true;
						} catch (ke) {
							const kerr = ke;
							if (kerr && kerr.code === "ESRCH") pidAlive = false;
							else pidAlive = true;
						}
					}
				} catch (_e) {
					pidKnown = false;
					observedOwner = null;
				}
				if (pidKnown) stale = !pidAlive;
				else stale = Date.now() - st.mtimeMs > staleMs;
			} catch (_e) {}
			if (stale) {
				let okToUnlink = true;
				if (observedOwner != null) try {
					const cur = JSON.parse(node_fs.readFileSync(lp, "utf8") || "{}");
					if (cur && typeof cur.owner === "string" && cur.owner !== observedOwner) okToUnlink = false;
				} catch (_e) {}
				if (okToUnlink) try {
					node_fs.unlinkSync(lp);
				} catch (_e) {}
				continue;
			}
			if (Date.now() - start > timeoutMs) throw new Error(`acquireRegistryLock：取 registry 锁超时（${timeoutMs}ms）——另有进程长时间持锁（${lp}）。稍后重试，或确认无卡死进程。`);
			sleepSyncMs(15 + Math.floor(Math.random() * 10));
		}
	}
	function releaseRegistryLock(handle) {
		if (!handle || !handle.path) return;
		try {
			if (handle.owner) {
				let cur = null;
				try {
					cur = JSON.parse(node_fs.readFileSync(handle.path, "utf8") || "{}");
				} catch (_e) {
					cur = null;
				}
				if (cur && cur.owner && cur.owner !== handle.owner) return;
			}
			node_fs.unlinkSync(handle.path);
		} catch (_e) {}
	}
	function mutateRegistry(regPath, mutator) {
		const rp = regPath || defaultRegistryPath();
		const handle = acquireRegistryLock(rp);
		try {
			const reg = loadRegistry(rp);
			mutator(reg);
			return saveRegistry(reg, rp);
		} finally {
			releaseRegistryLock(handle);
		}
	}
	function acquireFileLock(targetPath, opts) {
		return acquireRegistryLock(targetPath, opts);
	}
	function releaseFileLock(handle) {
		releaseRegistryLock(handle);
	}
	function saveRegistry(reg, p) {
		const filePath = p || defaultRegistryPath();
		if (!reg || typeof reg !== "object" || Array.isArray(reg)) throw new Error("saveRegistry：reg 必须是 registry 对象。");
		const out = JSON.parse(JSON.stringify(reg));
		if (typeof out.schema !== "string") out.schema = SCHEMA;
		if (!out.accounts || typeof out.accounts !== "object" || Array.isArray(out.accounts)) out.accounts = {};
		out.updated_at = nowIso$1();
		const { errors } = validateRegistry(out);
		if (errors.length > 0) {
			const head = errors.some((e) => /token|凭证|secret|credential/i.test(e.message)) ? "saveRegistry 拒写：registry 含疑似 token / 凭证（安全命门——token 绝不进 accounts.json）。" : "saveRegistry 拒写：registry 校验有硬 error（结构非法，落盘会污染号池）。";
			const detail = errors.map((e) => (e.account ? `[${e.account}] ` : "") + e.message).join("\n  - ");
			throw new Error(`${head}\n  - ${detail}`);
		}
		const dir = node_path.dirname(filePath);
		node_fs.mkdirSync(dir, {
			recursive: true,
			mode: 448
		});
		const tmp = node_path.join(dir, `.accounts.json.tmp-${process.pid}-${Date.now()}`);
		const json = `${JSON.stringify(out, null, 2)}\n`;
		node_fs.writeFileSync(tmp, json, { mode: 384 });
		try {
			node_fs.chmodSync(tmp, 384);
			node_fs.renameSync(tmp, filePath);
			node_fs.chmodSync(filePath, 384);
		} catch (e) {
			try {
				node_fs.unlinkSync(tmp);
			} catch (_) {}
			throw e;
		}
		return filePath;
	}
	function upsertAccount(reg, email, fields) {
		requireEmail(email);
		const f = fields || {};
		ensureAccounts(reg);
		assertNoTokenInFields(f);
		const prev = reg.accounts[email] || {};
		const entry = Object.assign({}, prev);
		if (f.vault !== void 0) entry.vault = f.vault;
		if (f.token_added_at !== void 0) entry.token_added_at = f.token_added_at;
		if (f.token_refreshed_at !== void 0) entry.token_refreshed_at = f.token_refreshed_at;
		if (f.token_expires_at !== void 0) entry.token_expires_at = f.token_expires_at;
		if (f.subscription_type !== void 0) entry.subscription_type = f.subscription_type;
		if (f.identity !== void 0) {
			if (f.identity != null) {
				const leak = [];
				scanForTokenLeak(f.identity, email, (m) => leak.push(m), "identity", true);
				if (leak.length > 0) throw new Error(`upsertAccount：identity 子树值疑似含 token（命中 sk-ant- 形态）——身份字段全非密、绝不该含 token 值。值已隐去；identity 不写入。`);
			}
			entry.identity = f.identity;
		}
		if (f.switchable !== void 0) entry.switchable = f.switchable;
		if (typeof entry.active !== "boolean") entry.active = false;
		reg.accounts[email] = entry;
		return reg;
	}
	function removeAccount(reg, email) {
		requireEmail(email);
		ensureAccounts(reg);
		delete reg.accounts[email];
		return reg;
	}
	function setActive(reg, email) {
		requireEmail(email);
		ensureAccounts(reg);
		if (!(email in reg.accounts)) throw new Error(`setActive：email ${JSON.stringify(email)} 不在号池中，无法置 active。`);
		for (const [k, entry] of Object.entries(reg.accounts)) if (entry && typeof entry === "object") entry.active = k === email;
		return reg;
	}
	function recordSwitchOut(reg, email, snap) {
		requireEmail(email);
		ensureAccounts(reg);
		if (!(email in reg.accounts)) throw new Error(`recordSwitchOut：email ${JSON.stringify(email)} 不在号池中。`);
		const s = snap || {};
		const five = s.fiveHour || s["5h"] || {};
		const seven = s.sevenDay || s["7d"] || {};
		const snapshot = {
			at: s.at || nowIso$1(),
			"5h": normalizeWindow(five),
			"7d": normalizeWindow(seven)
		};
		const entry = reg.accounts[email];
		entry.last_switch_out = snapshot;
		if (!Array.isArray(entry.switch_history)) entry.switch_history = [];
		entry.switch_history.push(snapshot);
		return reg;
	}
	function recordObservedQuota(reg, email, snap) {
		requireEmail(email);
		ensureAccounts(reg);
		if (!(email in reg.accounts)) throw new Error(`recordObservedQuota：email ${JSON.stringify(email)} 不在号池中。`);
		const s = snap || {};
		const five = s.fiveHour || s["5h"] || {};
		const seven = s.sevenDay || s["7d"] || {};
		const snapshot = {
			at: s.at || nowIso$1(),
			"5h": normalizeWindow(five),
			"7d": normalizeWindow(seven)
		};
		reg.accounts[email].last_observed_quota = snapshot;
		return reg;
	}
	function normalizeWindow(w) {
		const out = {
			used_pct: w.used_pct,
			resets_at: w.resets_at
		};
		if (w.source !== void 0) out.source = w.source;
		return out;
	}
	function fileVaultLineMatch(email) {
		requireEmail(email);
		return {
			prefix: `${email}_`,
			tokenLine: `${email}_TOKEN=`,
			expiresLine: `${email}_EXPIRES=`,
			grepFixedToken: `grep -F -- ${shArg(`${email}_TOKEN=`)}`,
			grepFixedExpires: `grep -F -- ${shArg(`${email}_EXPIRES=`)}`,
			awkFieldGuard: "index($0, p) == 1",
			note: "file vault 行操作必须用 awk index($0,p)==1 行首锚定（定字符串前缀比较），绝不用 grep -E/BRE 的 ^email_（email 的 . 是正则元字符会误匹配·§A.4），读 token 行也绝不用 grep -F（子串匹配·非行首锚定·重叠标识下取错行→整行畸形当 token·P2-5）。"
		};
	}
	function nowIso$1() {
		return (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
	}
	function ensureAccounts(reg) {
		if (!reg || typeof reg !== "object" || Array.isArray(reg)) throw new Error("reg 必须是 registry 对象。");
		if (!reg.accounts || typeof reg.accounts !== "object" || Array.isArray(reg.accounts)) reg.accounts = {};
	}
	function requireEmail(email) {
		if (typeof email !== "string" || !email) throw new Error(`email 必须是非空字符串（当前：${JSON.stringify(email)}）。`);
	}
	function assertNoTokenInFields(fields) {
		for (const [k, v] of Object.entries(fields || {})) {
			if (FORBIDDEN_FIELD_RE.test(k)) throw new Error(`upsertAccount：字段名 ${JSON.stringify(k)} 疑似存 token / 凭证——registry 只存 vault 非密引用，绝不存 token。`);
			if (typeof v === "string" && TOKEN_LIKE_RE.test(v)) throw new Error(`upsertAccount：字段 ${JSON.stringify(k)} 的值疑似含 token（命中 sk-ant- 形态）——值已隐去；registry 绝不存 token 值。`);
		}
	}
	function shArg(s) {
		return `'${String(s).replace(/'/g, `'\\''`)}'`;
	}
	//#endregion
	//#region src/account/select.ts
	function envNum(name, dflt) {
		const v = typeof process !== "undefined" && process.env ? process.env[name] : void 0;
		if (v == null || v === "") return dflt;
		const n = Number(v);
		return Number.isFinite(n) ? n : dflt;
	}
	const SEVEN_DAY_HARD_GATE = envNum("CCM_SELECT_7D_HARD_GATE", 85);
	const FIVE_HOUR_HARD_GATE = envNum("CCM_SELECT_5H_HARD_GATE", 90);
	const W5 = envNum("CCM_SELECT_W5", .4);
	const W7 = envNum("CCM_SELECT_W7", .6);
	const EXPIRY_WARN_DAYS = envNum("CCM_SELECT_EXPIRY_WARN_DAYS", 14);
	const EXPIRY_PENALTY = envNum("CCM_SELECT_EXPIRY_PENALTY", 40);
	const LOCAL_APPROX_TRUST = envNum("CCM_SELECT_LOCAL_APPROX_TRUST", .85);
	const OBSERVED_QUOTA_TRUST = envNum("CCM_SELECT_OBSERVED_QUOTA_TRUST", .7);
	const RESET_PROXIMITY_WEIGHT = envNum("CCM_SELECT_RESET_PROXIMITY_WEIGHT", 0);
	const RESET_PROXIMITY_HORIZON_H = envNum("CCM_SELECT_RESET_PROXIMITY_HORIZON_H", 24);
	const RESERVE_FLOOR = envNum("CCM_SELECT_RESERVE_FLOOR", 0);
	const RESERVE_FULL_PCT = envNum("CCM_SELECT_RESERVE_FULL_PCT", 90);
	function freshFullScore() {
		return W5 * 100 + W7 * 100;
	}
	const SCORE_UNUSABLE = -1;
	const SCORE_UNUSABLE_FLOOR = envNum("CCM_SELECT_UNUSABLE_FLOOR", 0);
	function isStrictIso(s) {
		return typeof s === "string" && ISO_UTC_RE$2.test(s);
	}
	function isoGte(a, b) {
		if (!isStrictIso(a) || !isStrictIso(b)) return null;
		return a >= b;
	}
	function daysUntil(targetIso, nowIsoStr) {
		if (!isStrictIso(targetIso) || !isStrictIso(nowIsoStr)) return null;
		const t = Date.parse(targetIso);
		const n = Date.parse(nowIsoStr);
		if (!Number.isFinite(t) || !Number.isFinite(n)) return null;
		return (t - n) / 864e5;
	}
	function recoveredWindow(win, nowIsoStr) {
		const w = win || {};
		const usedRaw = Number.isInteger(w.used_pct) ? w.used_pct : 100;
		const resetsAt = typeof w.resets_at === "string" ? w.resets_at : void 0;
		const source = typeof w.source === "string" ? w.source : void 0;
		const gte = isoGte(nowIsoStr, resetsAt);
		let usedPct;
		if (gte === true) usedPct = 0;
		else usedPct = usedRaw;
		return {
			usedPct,
			resetsAt,
			source
		};
	}
	function accountScore(acct, nowIsoStr) {
		const lso = acct.last_switch_out || {};
		const r5 = recoveredWindow(lso["5h"], nowIsoStr);
		const r7 = recoveredWindow(lso["7d"], nowIsoStr);
		const p5 = r5.usedPct;
		const p7 = r7.usedPct;
		const avail5h = 100 - p5;
		const avail7d = 100 - p7;
		const sources = [r5.source, r7.source].filter((s) => s != null);
		const trust = sources.some((s) => s === "local-derived-approx") ? LOCAL_APPROX_TRUST : 1;
		const earliestReset = earliestOf(r5.resetsAt, r7.resetsAt);
		if (p5 >= FIVE_HOUR_HARD_GATE || p7 >= SEVEN_DAY_HARD_GATE) return {
			score: SCORE_UNUSABLE,
			avail5h,
			avail7d,
			p5,
			p7,
			gated: true,
			sources,
			earliestReset,
			trust
		};
		return {
			score: (W5 * avail5h + W7 * avail7d) * trust,
			avail5h,
			avail7d,
			p5,
			p7,
			gated: false,
			sources,
			earliestReset,
			trust
		};
	}
	function earliestOf(a, b) {
		const va = isStrictIso(a) ? a : null;
		const vb = isStrictIso(b) ? b : null;
		if (va == null) return vb;
		if (vb == null) return va;
		return va <= vb ? va : vb;
	}
	function resetProximityBonus(earliestReset, now, weight, horizonH) {
		if (!(weight > 0) || !(horizonH > 0)) return 0;
		const days = daysUntil(earliestReset, now);
		if (days == null) return 0;
		const hours = days * 24;
		if (hours <= 0 || hours >= horizonH) return 0;
		return weight * (1 - hours / horizonH);
	}
	function selectAccount(reg, nowArg, opts) {
		const o = opts || {};
		const now = o.now || nowArg || nowIso$1();
		const warnings = [];
		const proxWeight = Number.isFinite(o.resetProximityWeight) ? o.resetProximityWeight : RESET_PROXIMITY_WEIGHT;
		const proxHorizonH = Number.isFinite(o.resetProximityHorizonH) ? o.resetProximityHorizonH : RESET_PROXIMITY_HORIZON_H;
		const reserveFloor = Number.isFinite(o.reserveFloor) ? o.reserveFloor : RESERVE_FLOOR;
		const reserveFullPct = Number.isFinite(o.reserveFullPct) ? o.reserveFullPct : RESERVE_FULL_PCT;
		const registry = reg && typeof reg === "object" ? reg : {};
		const accounts = registry.accounts && typeof registry.accounts === "object" && !Array.isArray(registry.accounts) ? registry.accounts : {};
		const emails = Object.keys(accounts);
		if (emails.length === 0) return {
			selected: null,
			reason: "NONE_EMPTY_REGISTRY",
			candidates: [],
			warnings
		};
		const ranked = [];
		for (const email of emails) {
			const acct = accounts[email];
			if (!acct || typeof acct !== "object") continue;
			if (acct.active === true) {
				ranked.push(rowExcluded(email, acct, now, "active"));
				continue;
			}
			if (acct.switchable === false) {
				ranked.push(rowExcluded(email, acct, now, "not_switchable"));
				warnings.push(`号 ${email} 标记为不可无重启换号（switchable:false·多半是只含 access token 的残缺号·无 refresh token）——已排除，请重跑 /cc-master:accounts --add ${email} 录完整 blob。`);
				continue;
			}
			if (tokenExpired$1(acct, now)) {
				ranked.push(rowExcluded(email, acct, now, "expired"));
				continue;
			}
			let scoreInfo;
			let fresh = false;
			let observedFallback = false;
			if (acct.last_switch_out != null) scoreInfo = accountScore(acct, now);
			else if (acct.last_observed_quota != null) {
				observedFallback = true;
				const raw = accountScore({ last_switch_out: acct.last_observed_quota }, now);
				scoreInfo = raw.gated ? raw : Object.assign({}, raw, {
					score: raw.score * OBSERVED_QUOTA_TRUST,
					trust: raw.trust * OBSERVED_QUOTA_TRUST
				});
			} else {
				fresh = true;
				scoreInfo = {
					score: freshFullScore(),
					avail5h: 100,
					avail7d: 100,
					p5: 0,
					p7: 0,
					gated: false,
					sources: [],
					earliestReset: null,
					trust: 1
				};
			}
			const d2e = daysUntil(acct.token_expires_at, now);
			const expiringSoon = d2e != null && d2e >= 0 && d2e <= EXPIRY_WARN_DAYS;
			let finalScore = scoreInfo.score;
			if (expiringSoon && !scoreInfo.gated) {
				finalScore = finalScore - EXPIRY_PENALTY;
				warnings.push(`号 ${email} 将在约 ${Math.floor(d2e)} 天后到期（≤${EXPIRY_WARN_DAYS} 天预警），已降权；建议尽快 /cc-master:accounts --refresh ${email}。`);
			}
			const proxBonus = scoreInfo.gated ? 0 : resetProximityBonus(scoreInfo.earliestReset, now, proxWeight, proxHorizonH);
			if (proxBonus !== 0) finalScore = finalScore + proxBonus;
			if (observedFallback && !scoreInfo.gated) warnings.push(`号 ${email} 无切出快照，改用 last_observed_quota（录号那刻 cc-usage 的配额，反映的是当时 session 当前号、未必是本号），评分已按弱信号折扣处理，仅作兜底粗排；切出一次后即被真实 last_switch_out 取代。`);
			if (scoreInfo.trust < 1 && !observedFallback) warnings.push(`号 ${email} 的切出快照来源含 local-derived-approx（reset 反推、口径不可靠·Finding #37），评分已按信任折扣处理，仅作粗排。`);
			ranked.push({
				email,
				score: finalScore,
				scoreForExhaustionFloor: scoreInfo.gated ? SCORE_UNUSABLE : scoreInfo.score,
				avail5h: scoreInfo.avail5h,
				avail7d: scoreInfo.avail7d,
				p5: scoreInfo.p5,
				p7: scoreInfo.p7,
				fresh,
				observedFallback,
				gated: scoreInfo.gated,
				expired: false,
				active: false,
				expiringSoon,
				daysToExpiry: d2e,
				sources: scoreInfo.sources,
				trust: scoreInfo.trust,
				earliestReset: scoreInfo.earliestReset,
				resetProximityBonus: proxBonus,
				isReserve: !scoreInfo.gated && scoreInfo.avail5h >= reserveFullPct && scoreInfo.avail7d >= reserveFullPct
			});
		}
		const candidates = ranked.filter((r) => !r.active && !r.expired && !r.notSwitchable && !r.gated);
		const sorted = ranked.slice().sort(cmpRows);
		if (candidates.length === 0) {
			const nonActiveBackups = ranked.filter((r) => !r.active);
			if (nonActiveBackups.length > 0 && nonActiveBackups.every((r) => r.gated)) {
				warnings.push("所有可切换备号都已逼顶（全部命中 5h 或 7d 硬闸·无双窗口健康号）——这是 blocked_on:\"user\" 决策：等 reset 还是别的，请用户拍板。");
				return {
					selected: null,
					reason: "NONE_ALL_EXHAUSTED",
					candidates: sorted,
					warnings
				};
			}
			if (nonActiveBackups.some((r) => r.gated)) warnings.push("无可切入备号：部分号 5h 或 7d 逼顶、另一些因 token 过期 / 残缺（switchable:false）被排除——可操作的是 --refresh 过期号 / --add 补录残缺号，未必只能等 reset。");
			return {
				selected: null,
				reason: "NONE_NO_CANDIDATES",
				candidates: sorted,
				warnings
			};
		}
		let best = candidates.slice().sort(cmpRows)[0];
		if (candidates.reduce((m, r) => Math.max(m, r.scoreForExhaustionFloor ?? -Infinity), -Infinity) <= SCORE_UNUSABLE_FLOOR) {
			warnings.push("所有可切换备号都已逼顶 / 不可用（候选配额评分全跌破地板）——这是 blocked_on:\"user\" 决策：等 reset 还是别的，请用户拍板。");
			return {
				selected: null,
				reason: "NONE_ALL_EXHAUSTED",
				candidates: sorted,
				warnings
			};
		}
		if (reserveFloor > 0 && best.isReserve === true) {
			const reserves = candidates.filter((r) => r.isReserve === true);
			const nonReserves = candidates.filter((r) => r.isReserve !== true);
			if (reserves.length <= reserveFloor && nonReserves.length > 0) {
				best.reserveHeld = true;
				best = nonReserves.slice().sort(cmpRows)[0];
				warnings.push(`reserve-floor=${reserveFloor}：池中满血储备号仅 ${reserves.length} 个，为保留 ≥${reserveFloor} 个满血可切后备，本次改选非储备号 ${best.email} 切入（满血号留作储备）。`);
			}
		}
		return {
			selected: best.email,
			reason: "SELECTED",
			candidates: sorted,
			warnings
		};
	}
	function cmpRows(a, b) {
		if (b.score !== a.score) return b.score - a.score;
		const ar = a.earliestReset;
		const br = b.earliestReset;
		if (ar != null && br != null && ar !== br) return ar < br ? -1 : 1;
		if (ar == null && br != null) return 1;
		if (ar != null && br == null) return -1;
		return a.email < b.email ? -1 : a.email > b.email ? 1 : 0;
	}
	function rowExcluded(email, acct, now, why) {
		const d2e = daysUntil(acct.token_expires_at, now);
		return {
			email,
			score: -Infinity,
			avail5h: null,
			avail7d: null,
			p5: null,
			p7: null,
			fresh: false,
			observedFallback: false,
			gated: false,
			expired: why === "expired",
			active: why === "active",
			notSwitchable: why === "not_switchable",
			expiringSoon: false,
			daysToExpiry: d2e,
			sources: [],
			trust: null,
			earliestReset: null,
			excludedReason: why
		};
	}
	function tokenExpired$1(acct, nowIsoStr) {
		const exp = acct.token_expires_at;
		if (!isStrictIso(exp) || !isStrictIso(nowIsoStr)) return false;
		return exp < nowIsoStr;
	}
	//#endregion
	//#region src/account/predict.ts
	function isNum$1(x) {
		return typeof x === "number" && Number.isFinite(x);
	}
	function clampPct(x) {
		return x < 0 ? 0 : x > 100 ? 100 : x;
	}
	function frozenWindow(win, now, source) {
		const r = recoveredWindow(win ?? null, now);
		return {
			usedPct: r.usedPct,
			resetsAt: r.resetsAt,
			source,
			authoritative: false
		};
	}
	function predictWindow(acct, key, now) {
		const lso = acct.last_switch_out;
		if (lso != null && typeof lso === "object") return frozenWindow(lso[key], now, "switch-out-frozen");
		const loq = acct.last_observed_quota;
		if (loq != null && typeof loq === "object") return frozenWindow(loq[key], now, "observed-frozen");
		return {
			usedPct: 0,
			resetsAt: void 0,
			source: "fresh",
			authoritative: false
		};
	}
	function liveOrPredict(livePct, liveResetsAt, acct, key, now) {
		if (isNum$1(livePct)) return {
			usedPct: clampPct(livePct),
			resetsAt: isStrictIso(liveResetsAt) ? liveResetsAt : void 0,
			source: "account-live",
			authoritative: true
		};
		return predictWindow(acct, key, now);
	}
	function predictAccountUsage(acct, opts) {
		const now = opts?.now || nowIso$1();
		const a = acct && typeof acct === "object" ? acct : {};
		const active = a.active === true;
		const live = opts?.live;
		if (!!live && (isNum$1(live.fiveHourPct) || isNum$1(live.sevenDayPct))) return {
			active,
			fiveHour: liveOrPredict(live.fiveHourPct, live.fiveHourResetsAt, a, "5h", now),
			sevenDay: liveOrPredict(live.sevenDayPct, live.sevenDayResetsAt, a, "7d", now)
		};
		return {
			active,
			fiveHour: predictWindow(a, "5h", now),
			sevenDay: predictWindow(a, "7d", now)
		};
	}
	function predictPoolUsage(reg, opts) {
		const now = opts?.now || nowIso$1();
		const registry = reg && typeof reg === "object" ? reg : {};
		const accounts = registry.accounts && typeof registry.accounts === "object" && !Array.isArray(registry.accounts) ? registry.accounts : {};
		const out = [];
		for (const email of Object.keys(accounts)) {
			const acct = accounts[email];
			if (!acct || typeof acct !== "object") continue;
			const pred = predictAccountUsage(acct, {
				now,
				live: opts?.liveByEmail && opts.liveByEmail[email] || (acct.active === true ? opts?.live : void 0) || void 0
			});
			const expired = tokenExpired$1(acct, now);
			const switchable = acct.active !== true && acct.switchable !== false && !expired;
			out.push({
				email,
				...pred,
				switchable,
				expired
			});
		}
		return out;
	}
	//#endregion
	//#region src/account/refresh.ts
	const DEFAULT_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
	const DEFAULT_REFRESH_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
	const REFRESH_EXIT = {
		BAD_INPUT: 2,
		NO_REFRESH_TOKEN: 3,
		HTTP_ERROR: 4,
		NETWORK: 5,
		HOST_REJECTED: 6
	};
	var RefreshError = class extends Error {
		code;
		constructor(message, code) {
			super(message);
			this.name = "RefreshError";
			this.code = code;
		}
	};
	function isRefreshHostAllowed(urlStr, opts) {
		let u;
		try {
			u = new URL(urlStr);
		} catch (_e) {
			return {
				allowed: false,
				host: "",
				proto: ""
			};
		}
		const host = (u.hostname || "").toLowerCase();
		const proto = u.protocol;
		const isHttps = proto === "https:";
		const isLoopback = host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
		const isAuthorizedClaudeHost = host === "claude.ai" || host === "claude.com" || host === "anthropic.com" || host.endsWith(".claude.com") || host.endsWith(".anthropic.com");
		const allowLoopback = !!(opts && opts.allowLoopback);
		return {
			allowed: isAuthorizedClaudeHost && isHttps || isLoopback && allowLoopback,
			host,
			proto
		};
	}
	function refreshBlob(inBlob, opts) {
		const url = opts && opts.url || "https://platform.claude.com/v1/oauth/token";
		const clientId = opts && opts.clientId || "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
		const allowLoopback = !!(opts && opts.allowLoopback);
		let timeoutMs = opts && Number(opts.timeoutMs);
		if (!timeoutMs || !Number.isFinite(timeoutMs) || timeoutMs <= 0) timeoutMs = 15e3;
		return new Promise((resolve, reject) => {
			let blob;
			try {
				blob = JSON.parse(inBlob);
			} catch (_e) {
				reject(new RefreshError("refresh: vault blob 非法 JSON。", REFRESH_EXIT.BAD_INPUT));
				return;
			}
			const rt = blob && blob.refreshToken;
			if (typeof rt !== "string" || rt.indexOf("sk-ant-ort") !== 0) {
				reject(new RefreshError("refresh: vault blob 缺 refreshToken（前缀非 sk-ant-ort）——该号无 refresh token，无法主动续期。", REFRESH_EXIT.NO_REFRESH_TOKEN));
				return;
			}
			let u;
			try {
				u = new URL(url);
			} catch (_e) {
				reject(new RefreshError("refresh: REFRESH_TOKEN_URL 非法。", REFRESH_EXIT.BAD_INPUT));
				return;
			}
			const gate = isRefreshHostAllowed(url, { allowLoopback });
			if (!gate.allowed) {
				reject(new RefreshError(`refresh: 拒绝向未授权 refresh 端点发送 refresh token（host=${gate.host} proto=${gate.proto}）——只允许 https://*.claude.com / *.anthropic.com / claude.ai（或显式 opt-in 的 loopback 测试端点）。token 未发送。`, REFRESH_EXIT.HOST_REJECTED));
				return;
			}
			const body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(rt)}&client_id=${encodeURIComponent(clientId)}`;
			const mod = u.protocol === "http:" ? node_http : node_https;
			const reqOpts = {
				method: "POST",
				hostname: u.hostname,
				port: u.port || (u.protocol === "http:" ? 80 : 443),
				path: u.pathname + (u.search || ""),
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					"Content-Length": Buffer.byteLength(body)
				}
			};
			const req = mod.request(reqOpts, (res) => {
				let chunks = "";
				res.on("data", (c) => {
					chunks += c;
				});
				res.on("end", () => {
					const status = res.statusCode || 0;
					if (status < 200 || status >= 300) {
						reject(new RefreshError(`refresh: oauth 端点返回 HTTP ${status}（refresh token 可能失效）。`, REFRESH_EXIT.HTTP_ERROR));
						return;
					}
					let r;
					try {
						r = JSON.parse(chunks);
					} catch (_e) {
						reject(new RefreshError("refresh: oauth 响应非 JSON。", REFRESH_EXIT.HTTP_ERROR));
						return;
					}
					const at = r.access_token;
					if (typeof at !== "string" || at.indexOf("sk-ant-oat") !== 0) {
						reject(new RefreshError("refresh: oauth 响应缺 access_token（前缀非 sk-ant-oat）。", REFRESH_EXIT.HTTP_ERROR));
						return;
					}
					const expiresIn = Number(r.expires_in);
					const rotated = typeof r.refresh_token === "string" && r.refresh_token.indexOf("sk-ant-ort") === 0 && r.refresh_token !== rt;
					const newBlob = {
						accessToken: at,
						refreshToken: rotated ? r.refresh_token : rt,
						expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 8 * 3600) * 1e3
					};
					if (typeof r.scope === "string" && r.scope) newBlob.scopes = r.scope.split(/\s+/);
					else if (Array.isArray(blob.scopes)) newBlob.scopes = blob.scopes;
					if (typeof blob.subscriptionType === "string" && blob.subscriptionType) newBlob.subscriptionType = blob.subscriptionType;
					if (typeof blob.rateLimitTier === "string" && blob.rateLimitTier) newBlob.rateLimitTier = blob.rateLimitTier;
					resolve({
						blob: JSON.stringify(newBlob),
						rotated
					});
				});
			});
			req.on("error", (e) => {
				reject(new RefreshError(`refresh: 网络错误（${e && e.code || "ERR"}）。`, REFRESH_EXIT.NETWORK));
			});
			req.setTimeout(timeoutMs, () => {
				req.destroy();
				reject(new RefreshError(`refresh: oauth 端点 ${timeoutMs}ms 内无响应（连接 stall / captive proxy？）——当网络不通处理。`, REFRESH_EXIT.NETWORK));
			});
			req.write(body);
			req.end();
		});
	}
	//#endregion
	//#region src/account/vault.ts
	const DEFAULT_KEYCHAIN_SERVICE = "cc-master-oauth";
	const KEYCHAIN_CRED_SERVICE = "Claude Code-credentials";
	const ACCESS_PREFIX = "sk-ant-oat";
	const REFRESH_PREFIX = "sk-ant-ort";
	function macKeychainProvider(opts) {
		const bin = opts && opts.bin || "security";
		let availCache = null;
		function run(args, input) {
			return (0, node_child_process.spawnSync)(bin, args, {
				encoding: "utf8",
				input
			});
		}
		return {
			isAvailable() {
				if (availCache !== null) return availCache;
				const r = (0, node_child_process.spawnSync)(bin, [], { encoding: "utf8" });
				availCache = !(r.error && r.error.code === "ENOENT");
				return availCache;
			},
			exists(service, account) {
				const r = run([
					"find-generic-password",
					"-s",
					service,
					"-a",
					account
				]);
				if (r.error) return false;
				return r.status === 0;
			},
			read(service, account) {
				const r = run([
					"find-generic-password",
					"-w",
					"-s",
					service,
					"-a",
					account
				]);
				if (r.error) return null;
				if (r.status !== 0) return null;
				const blob = (typeof r.stdout === "string" ? r.stdout : "").replace(/\r?\n$/, "");
				return blob.length > 0 ? blob : null;
			},
			write(service, account, label, blob) {
				const r = run([
					"add-generic-password",
					"-U",
					"-s",
					service,
					"-a",
					account,
					"-l",
					label,
					"-w",
					blob
				]);
				if (r.error) return false;
				return r.status === 0;
			},
			delete(service, account) {
				const r = run([
					"delete-generic-password",
					"-a",
					account,
					"-s",
					service
				]);
				if (r.error && r.error.code === "ENOENT") return "unavailable";
				if (r.error) return "absent";
				return r.status === 0 ? "deleted" : "absent";
			}
		};
	}
	function resolveKeychain(opts) {
		return opts && opts.keychain || macKeychainProvider();
	}
	function normalizeClaudeAiOauthBlob(raw) {
		let j;
		try {
			j = JSON.parse(raw);
		} catch (_e) {
			return null;
		}
		const o = j && typeof j === "object" ? j.claudeAiOauth : null;
		if (!o || typeof o !== "object") return null;
		const oa = o;
		if (typeof oa.accessToken !== "string" || oa.accessToken.indexOf(ACCESS_PREFIX) !== 0) return null;
		if (typeof oa.refreshToken !== "string" || !oa.refreshToken || oa.refreshToken.indexOf(REFRESH_PREFIX) !== 0) return null;
		if (typeof oa.expiresAt !== "number" || !Number.isFinite(oa.expiresAt)) return null;
		const blob = {
			accessToken: oa.accessToken,
			refreshToken: oa.refreshToken,
			expiresAt: oa.expiresAt
		};
		if (Array.isArray(oa.scopes)) blob.scopes = oa.scopes;
		if (typeof oa.subscriptionType === "string" && oa.subscriptionType) blob.subscriptionType = oa.subscriptionType;
		if (typeof oa.rateLimitTier === "string" && oa.rateLimitTier) blob.rateLimitTier = oa.rateLimitTier;
		return JSON.stringify(blob);
	}
	function validateBlob(blob) {
		if (typeof blob !== "string" || !blob) return false;
		if (blob.indexOf("\n") !== -1 || blob.indexOf("\r") !== -1) return false;
		let o;
		try {
			o = JSON.parse(blob);
		} catch (_e) {
			return false;
		}
		if (!o || typeof o !== "object") return false;
		const b = o;
		const okAt = typeof b.accessToken === "string" && b.accessToken.indexOf(ACCESS_PREFIX) === 0;
		const okRt = typeof b.refreshToken === "string" && !!b.refreshToken && b.refreshToken.indexOf(REFRESH_PREFIX) === 0;
		const okExp = typeof b.expiresAt === "number" && Number.isFinite(b.expiresAt);
		return okAt && okRt && okExp;
	}
	function subscriptionTypeOf(blob) {
		try {
			const o = JSON.parse(blob);
			if (o && typeof o.subscriptionType === "string" && o.subscriptionType) return o.subscriptionType;
		} catch (_e) {}
		return null;
	}
	function extractIdentity(claudeJsonPath) {
		let raw;
		try {
			raw = node_fs.readFileSync(claudeJsonPath, "utf8");
		} catch (_e) {
			return null;
		}
		let j;
		try {
			j = JSON.parse(raw);
		} catch (_e) {
			return null;
		}
		const oa = j && typeof j === "object" ? j.oauthAccount : null;
		if (!oa || typeof oa !== "object" || Array.isArray(oa)) return null;
		if (Object.keys(oa).length === 0) return null;
		return oa;
	}
	function emailOfIdentity(identity) {
		if (identity && typeof identity === "object") {
			const e = identity.emailAddress;
			if (typeof e === "string" && e) return e;
		}
		return null;
	}
	function captureCurrentLoginBlob(opts) {
		const kc = opts && opts.keychain || macKeychainProvider();
		const credService = opts && opts.credService || "Claude Code-credentials";
		const user = opts && opts.user || process.env.USER || "";
		if (kc.isAvailable() && user) {
			const raw = kc.read(credService, user);
			if (raw) {
				const blob = normalizeClaudeAiOauthBlob(raw);
				if (blob) return blob;
			}
		}
		const cjPath = opts && opts.credentialsJsonPath || resolveCredentialsPath();
		let raw;
		try {
			raw = node_fs.readFileSync(cjPath, "utf8");
		} catch (_e) {
			return null;
		}
		return normalizeClaudeAiOauthBlob(raw);
	}
	function defaultVaultKind(keychain) {
		const kc = keychain || macKeychainProvider();
		return process.platform === "darwin" && kc.isAvailable() ? "keychain" : "file";
	}
	function defaultVaultFile(env) {
		return node_path.join(resolveCcMasterHome(env), "accounts.env");
	}
	function atomicWriteFile(filePath, content) {
		const dir = node_path.dirname(filePath);
		node_fs.mkdirSync(dir, {
			recursive: true,
			mode: 448
		});
		const tmp = node_path.join(dir, `.accounts.env.tmp-${process.pid}-${Date.now()}`);
		node_fs.writeFileSync(tmp, content, { mode: 384 });
		try {
			node_fs.chmodSync(tmp, 384);
			node_fs.renameSync(tmp, filePath);
			node_fs.chmodSync(filePath, 384);
		} catch (e) {
			try {
				node_fs.unlinkSync(tmp);
			} catch (_) {}
			throw e;
		}
	}
	function keepOtherLines(text, tokenLine, expiresLine) {
		const out = [];
		for (const line of text.split("\n")) {
			if (line === "") continue;
			if (line.startsWith(tokenLine) || line.startsWith(expiresLine)) continue;
			out.push(line);
		}
		return out;
	}
	function fileVaultStore(blob, filePath, key, expires, opts) {
		const { tokenLine, expiresLine } = fileVaultLineMatch(key);
		let lock;
		try {
			lock = acquireFileLock(filePath, opts && opts.lockOpts);
		} catch (_e) {
			return {
				ok: false,
				error: "vault: 无法取得 file vault 锁——拒绝无锁重写 vault（防并发互踩），未写入。"
			};
		}
		try {
			let kept = [];
			try {
				if (node_fs.existsSync(filePath)) kept = keepOtherLines(node_fs.readFileSync(filePath, "utf8"), tokenLine, expiresLine);
			} catch (_e) {
				return {
					ok: false,
					error: "vault: 读旧 vault 失败（不可读？）——保留原文件，未写入。"
				};
			}
			kept.push(`${tokenLine}${blob}`);
			if (expires) kept.push(`${expiresLine}${expires}`);
			try {
				atomicWriteFile(filePath, `${kept.join("\n")}\n`);
			} catch (_e) {
				return {
					ok: false,
					error: "vault: 原子写 file vault 失败（磁盘满 / rename 错？）——原 vault 原封不动，未写入。"
				};
			}
			return { ok: true };
		} finally {
			releaseFileLock(lock);
		}
	}
	function fileVaultDelete(filePath, key, opts) {
		if (!node_fs.existsSync(filePath)) return "absent";
		const { tokenLine, expiresLine } = fileVaultLineMatch(key);
		let lock;
		try {
			lock = acquireFileLock(filePath, opts && opts.lockOpts);
		} catch (_e) {
			return "error";
		}
		try {
			let text;
			try {
				text = node_fs.readFileSync(filePath, "utf8");
			} catch (_e) {
				return "error";
			}
			let had = 0;
			for (const line of text.split("\n")) if (line.startsWith(tokenLine) || line.startsWith(expiresLine)) had += 1;
			if (had === 0) return "absent";
			const kept = keepOtherLines(text, tokenLine, expiresLine);
			try {
				atomicWriteFile(filePath, kept.length ? `${kept.join("\n")}\n` : "");
			} catch (_e) {
				return "error";
			}
			return "deleted";
		} finally {
			releaseFileLock(lock);
		}
	}
	function fileVaultProbe(filePath, key) {
		if (!node_fs.existsSync(filePath)) return false;
		const { tokenLine } = fileVaultLineMatch(key);
		let text;
		try {
			text = node_fs.readFileSync(filePath, "utf8");
		} catch (_e) {
			return false;
		}
		for (const line of text.split("\n")) if (line.startsWith(tokenLine) && line.length > tokenLine.length) return true;
		return false;
	}
	function fileVaultRead(filePath, key) {
		if (!node_fs.existsSync(filePath)) return null;
		const { tokenLine } = fileVaultLineMatch(key);
		let text;
		try {
			text = node_fs.readFileSync(filePath, "utf8");
		} catch (_e) {
			return null;
		}
		for (const line of text.split("\n")) if (line.startsWith(tokenLine) && line.length > tokenLine.length) return line.slice(tokenLine.length);
		return null;
	}
	function vaultStore(blob, ref, expires, opts) {
		if (!validateBlob(blob)) return {
			ok: false,
			error: "vault: blob 校验失败（缺三必需字段 / 非单行）——拒绝写入残缺 blob。"
		};
		if (ref.kind === "keychain") {
			const kc = resolveKeychain(opts);
			if (!kc.isAvailable()) return {
				ok: false,
				error: "vault: keychain 不可用（非 mac？）——请用 file vault 形态。"
			};
			return kc.write(ref.service, ref.account, `cc-master OAuth: ${ref.account}`, blob) ? { ok: true } : {
				ok: false,
				error: "vault: keychain 写入失败（security 非 0）。"
			};
		}
		return fileVaultStore(blob, ref.path, ref.key, expires, opts);
	}
	function vaultDelete(ref, opts) {
		if (ref.kind === "keychain") return resolveKeychain(opts).delete(ref.service, ref.account);
		return fileVaultDelete(ref.path, ref.key, opts);
	}
	function vaultProbe(ref, opts) {
		if (ref.kind === "keychain") {
			const kc = resolveKeychain(opts);
			if (!kc.isAvailable()) return false;
			return ref.account ? kc.exists(ref.service, ref.account) : false;
		}
		return fileVaultProbe(ref.path, ref.key);
	}
	function vaultRead(ref, opts) {
		if (ref.kind === "keychain") {
			const kc = resolveKeychain(opts);
			if (!kc.isAvailable()) return null;
			return kc.read(ref.service, ref.account);
		}
		return fileVaultRead(ref.path, ref.key);
	}
	function vaultHasValidBlob(ref, opts) {
		const blob = vaultRead(ref, opts);
		if (!blob) return false;
		let o;
		try {
			o = JSON.parse(blob);
		} catch (_e) {
			return false;
		}
		if (!o || typeof o !== "object") return false;
		const b = o;
		const okRt = typeof b.refreshToken === "string" && b.refreshToken.indexOf(REFRESH_PREFIX) === 0 && !!b.refreshToken;
		const okAt = typeof b.accessToken === "string" && b.accessToken.indexOf(ACCESS_PREFIX) === 0;
		return okRt && okAt;
	}
	function defaultExpiresIso() {
		return new Date(Date.now() + 365 * 24 * 3600 * 1e3).toISOString().replace(/\.\d{3}Z$/, "Z");
	}
	//#endregion
	//#region src/account/switch.ts
	function forceRefreshBlob(blob) {
		let o;
		try {
			o = JSON.parse(blob);
		} catch (_e) {
			return null;
		}
		if (!o || typeof o !== "object" || Array.isArray(o)) return null;
		o.expiresAt = Date.now() + 60 * 1e3;
		return JSON.stringify(o);
	}
	function unwrapOfficial(s) {
		if (!s) return null;
		let o;
		try {
			o = JSON.parse(s);
		} catch (_e) {
			return null;
		}
		if (!o || typeof o !== "object" || Array.isArray(o)) return null;
		const wrapped = o.claudeAiOauth;
		const b = wrapped && typeof wrapped === "object" && !Array.isArray(wrapped) ? wrapped : o;
		return b && typeof b === "object" && !Array.isArray(b) ? b : null;
	}
	function validOfficial(b) {
		if (!b) return false;
		const at = b.accessToken;
		const rt = b.refreshToken;
		const exp = b.expiresAt;
		return typeof at === "string" && !!at && typeof rt === "string" && !!rt && (typeof exp === "number" || typeof exp === "string" && !!exp);
	}
	function readOfficialBlob(opts) {
		const kc = opts && opts.keychain || macKeychainProvider();
		const credService = opts && opts.credService || "Claude Code-credentials";
		const user = opts && opts.user || process.env.USER || "";
		let blob = null;
		if (kc.isAvailable() && user) blob = unwrapOfficial(kc.read(credService, user));
		if (!validOfficial(blob)) {
			const cjPath = opts && opts.credentialsJsonPath || resolveCredentialsPath();
			try {
				blob = unwrapOfficial(node_fs.readFileSync(cjPath, "utf8"));
			} catch (_e) {
				blob = null;
			}
		}
		if (!validOfficial(blob)) return null;
		return JSON.stringify(blob);
	}
	function rescueSwitchoutToken(args) {
		const { switchOutEmail, switchInEmail } = args;
		if (!switchOutEmail || switchOutEmail === switchInEmail) return {
			rescued: false,
			skipped: true,
			reason: "no-switchout"
		};
		const soBlob = readOfficialBlob({
			keychain: args.keychain,
			credService: args.credService,
			user: args.user,
			credentialsJsonPath: args.credentialsJsonPath
		});
		if (!soBlob) return {
			rescued: false,
			skipped: true,
			reason: "no-valid-official-blob"
		};
		const idEmail = emailOfIdentity(extractIdentity(args.claudeJsonPath));
		if (!idEmail || idEmail !== switchOutEmail) return {
			rescued: false,
			skipped: true,
			reason: "identity-mismatch",
			identityEmail: idEmail
		};
		if (!vaultStore(soBlob, args.switchOutRef, args.expires ?? null, { keychain: args.keychain }).ok) return {
			rescued: false,
			skipped: true,
			reason: "writeback-failed"
		};
		return {
			rescued: true,
			skipped: false
		};
	}
	function reconcileActiveFromStore(args) {
		let reg = null;
		try {
			reg = loadRegistry(args.regPath);
		} catch (_e) {
			reg = null;
		}
		let regActive = "";
		if (reg && reg.accounts) {
			for (const [email, e] of Object.entries(reg.accounts)) if (e && e.active === true) {
				regActive = email;
				break;
			}
		}
		const storeEmail = emailOfIdentity(extractIdentity(args.claudeJsonPath));
		if (storeEmail && reg && reg.accounts && reg.accounts[storeEmail] && storeEmail !== regActive) try {
			mutateRegistry(args.regPath, (r) => {
				if (r.accounts && r.accounts[storeEmail]) setActive(r, storeEmail);
			});
			return storeEmail;
		} catch (_e) {}
		return regActive;
	}
	function newTrapState(deps) {
		return {
			regPath: deps.regPath,
			keychain: deps.keychain,
			user: deps.user,
			credService: deps.credService || "Claude Code-credentials",
			snapParent: deps.snapParent || node_os.tmpdir(),
			snapDir: "",
			overwriteInProgress: false,
			storesCommitted: false,
			activeAligned: false,
			overwriteCredPath: "",
			overwriteCjPath: "",
			snapCredTmp: "",
			snapCjTmp: "",
			credPreexisted: false,
			cjPreexisted: false,
			commitSwitchinEmail: "",
			commitWrappedBlob: ""
		};
	}
	function atomicWriteJson(filePath, obj) {
		const dir = node_path.dirname(filePath);
		node_fs.mkdirSync(dir, {
			recursive: true,
			mode: 448
		});
		const tmp = node_path.join(dir, `.${node_path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
		node_fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, { mode: 384 });
		try {
			node_fs.chmodSync(tmp, 384);
			node_fs.renameSync(tmp, filePath);
			node_fs.chmodSync(filePath, 384);
		} catch (e) {
			try {
				node_fs.unlinkSync(tmp);
			} catch (_) {}
			throw e;
		}
	}
	function cleanupSnapshots(trap, messages) {
		for (const p of [trap.snapCredTmp, trap.snapCjTmp]) if (p) try {
			node_fs.unlinkSync(p);
		} catch (e) {
			if (e.code !== "ENOENT" && messages) messages.push(`⚠ 含 token 的快照文件清理失败、可能残留于 ${p}——请手动删除（rm -f "${p}"）。`);
		}
		trap.snapCredTmp = "";
		trap.snapCjTmp = "";
		if (trap.snapDir) try {
			node_fs.rmdirSync(trap.snapDir);
		} catch (_) {}
	}
	function rollbackOfficialStores12(credPath, claudeJsonPath, trap) {
		const messages = [];
		let ok = true;
		if (trap.credPreexisted && trap.snapCredTmp && node_fs.existsSync(trap.snapCredTmp)) {
			const tmp = `${credPath}.ccm-rb.${process.pid}`;
			try {
				node_fs.copyFileSync(trap.snapCredTmp, tmp);
				node_fs.renameSync(tmp, credPath);
				node_fs.chmodSync(credPath, 384);
			} catch (_e) {
				try {
					node_fs.unlinkSync(tmp);
				} catch (_) {}
				ok = false;
			}
		} else if (!trap.credPreexisted) try {
			node_fs.rmSync(credPath, { force: true });
			messages.push("stores: 回滚删除换号新建的 ① credentials.json（换号前无此文件·回到无此文件状态·避免 split-brain）。");
		} catch (_e) {
			ok = false;
		}
		else {
			messages.push("stores: ① credentials.json 换号前已存在但无快照可恢复——无法回滚·**可能 split-brain**（① 已是新号 token）·需手动对账！");
			ok = false;
		}
		if (trap.cjPreexisted && trap.snapCjTmp && node_fs.existsSync(trap.snapCjTmp)) {
			const tmp = `${claudeJsonPath}.ccm-rb.${process.pid}`;
			try {
				node_fs.copyFileSync(trap.snapCjTmp, tmp);
				node_fs.renameSync(tmp, claudeJsonPath);
			} catch (_e) {
				try {
					node_fs.unlinkSync(tmp);
				} catch (_) {}
				ok = false;
			}
		} else if (!trap.cjPreexisted) try {
			node_fs.rmSync(claudeJsonPath, { force: true });
			messages.push("stores: 回滚删除换号新建的 ② ~/.claude.json（换号前无此文件·回到无此文件状态·避免 split-brain）。");
		} catch (_e) {
			ok = false;
		}
		else {
			messages.push("stores: ② ~/.claude.json 换号前已存在但无快照可恢复——无法回滚·**可能 split-brain**（② oauthAccount 已是新号）·需手动对账！");
			ok = false;
		}
		return {
			ok,
			messages
		};
	}
	function overwriteOfficialStores(args) {
		const { blob, identityJson, switchInEmail, credPath, claudeJsonPath, trap } = args;
		const messages = [];
		let identityDegraded = true;
		trap.snapCredTmp = "";
		trap.snapCjTmp = "";
		trap.credPreexisted = false;
		trap.cjPreexisted = false;
		if (node_fs.existsSync(credPath)) {
			trap.credPreexisted = true;
			const snap = mkSnapTemp(trap, "credsnap");
			try {
				node_fs.copyFileSync(credPath, snap);
				node_fs.chmodSync(snap, 384);
				trap.snapCredTmp = snap;
			} catch (_e) {
				try {
					node_fs.unlinkSync(snap);
				} catch (_) {}
				messages.push("stores: 快照 ① credentials.json 失败——**中止换号**（无快照则后续失败无法回滚·会 split-brain）：未覆写任何存储、registry 原封不动、可重试。");
				cleanupSnapshots(trap, messages);
				trap.snapCredTmp = "";
				trap.snapCjTmp = "";
				return {
					ok: false,
					committed: false,
					rolledBack: false,
					splitBrainRisk: false,
					identityDegraded: false,
					messages
				};
			}
		}
		if (node_fs.existsSync(claudeJsonPath)) {
			trap.cjPreexisted = true;
			const snap = mkSnapTemp(trap, "cjsnap");
			try {
				node_fs.copyFileSync(claudeJsonPath, snap);
				node_fs.chmodSync(snap, 384);
				trap.snapCjTmp = snap;
			} catch (_e) {
				try {
					node_fs.unlinkSync(snap);
				} catch (_) {}
				messages.push("stores: 快照 ② ~/.claude.json 失败——**中止换号**（无快照则后续失败无法回滚·会 split-brain）：未覆写任何存储、registry 原封不动、可重试。");
				cleanupSnapshots(trap, messages);
				trap.snapCredTmp = "";
				trap.snapCjTmp = "";
				return {
					ok: false,
					committed: false,
					rolledBack: false,
					splitBrainRisk: false,
					identityDegraded: false,
					messages
				};
			}
		}
		let blobObj;
		try {
			blobObj = JSON.parse(blob);
		} catch (_e) {
			cleanupSnapshots(trap, messages);
			trap.snapCredTmp = "";
			trap.snapCjTmp = "";
			messages.push("stores: blob 非法 JSON——未覆写任何存储。");
			return {
				ok: false,
				committed: false,
				rolledBack: false,
				splitBrainRisk: false,
				identityDegraded: false,
				messages
			};
		}
		let identity = null;
		if (identityJson) try {
			const parsed = JSON.parse(identityJson);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length > 0) identity = parsed;
		} catch (_e) {
			identity = null;
		}
		trap.overwriteInProgress = true;
		trap.overwriteCredPath = credPath;
		trap.overwriteCjPath = claudeJsonPath;
		try {
			let cred = {};
			try {
				const parsed = JSON.parse(node_fs.readFileSync(credPath, "utf8"));
				if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) cred = parsed;
			} catch (_e) {
				cred = {};
			}
			cred.claudeAiOauth = blobObj;
			atomicWriteJson(credPath, cred);
			messages.push("stores: ① credentials.json .claudeAiOauth 已覆写（原子·0600）。");
		} catch (e) {
			trap.overwriteInProgress = false;
			cleanupSnapshots(trap, messages);
			trap.snapCredTmp = "";
			trap.snapCjTmp = "";
			messages.push(`stores: ① credentials.json 写失败（${codeOf(e)}）——未完成换号（凭证主存未更新）。`);
			return {
				ok: false,
				committed: false,
				rolledBack: false,
				splitBrainRisk: false,
				identityDegraded: false,
				messages
			};
		}
		if (node_fs.existsSync(claudeJsonPath)) {
			let cj = null;
			try {
				const parsed = JSON.parse(node_fs.readFileSync(claudeJsonPath, "utf8"));
				if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) cj = parsed;
			} catch (_e) {
				cj = null;
			}
			if (cj) if (identity) try {
				cj.oauthAccount = identity;
				atomicWriteJson(claudeJsonPath, cj);
				identityDegraded = false;
				messages.push("stores: ② ~/.claude.json oauthAccount 已用 registry identity 完整替换（真切身份·其它键保留·原子）。");
			} catch (e2) {
				const rb = rollbackOfficialStores12(credPath, claudeJsonPath, trap);
				for (const m of rb.messages) messages.push(m);
				trap.overwriteInProgress = false;
				cleanupSnapshots(trap, messages);
				trap.snapCredTmp = "";
				trap.snapCjTmp = "";
				if (rb.ok) messages.push(`stores: ② 身份写失败（${codeOf(e2)}）→ 已回滚 ①，三存储全留旧号，换号未发生，可重试（避免 split-identity）。`);
				else messages.push("stores: ② 身份写失败、且 ① 回滚失败——可能 split-identity（① 已是新号 token·② 仍旧号）·需手动对账！");
				return {
					ok: false,
					committed: false,
					rolledBack: rb.ok,
					splitBrainRisk: !rb.ok,
					identityDegraded: false,
					messages
				};
			}
			else try {
				const oa = cj.oauthAccount && typeof cj.oauthAccount === "object" && !Array.isArray(cj.oauthAccount) ? cj.oauthAccount : {};
				const sub = blobObj.subscriptionType;
				if (typeof sub === "string" && sub && "subscriptionType" in oa) oa.subscriptionType = sub;
				cj.oauthAccount = oa;
				atomicWriteJson(claudeJsonPath, cj);
				messages.push("stores: ② ~/.claude.json 无 registry identity → 降级只同步 subscriptionType（登录显示可能仍是上一号·建议 --add 补 identity）。");
			} catch (e) {
				messages.push(`stores: ② ~/.claude.json 写失败（非致命·身份显示层·非身份切换路）：${codeOf(e)}`);
			}
			else messages.push("stores: ② ~/.claude.json 非对象/损坏——跳过（不整文件重写·绝不丢配置）。");
		} else messages.push("stores: ② ~/.claude.json 不存在——跳过（不新建·身份由 credentials.json token 主导）。");
		if (trap.keychain.isAvailable()) {
			const wrapped = `{"claudeAiOauth":${blob}}`;
			trap.storesCommitted = true;
			trap.commitSwitchinEmail = switchInEmail;
			trap.commitWrappedBlob = wrapped;
			if (trap.keychain.write(trap.credService, trap.user, `cc-master OAuth: ${trap.user}`, wrapped)) {
				trap.overwriteInProgress = false;
				messages.push(`stores: ③ keychain "Claude Code-credentials" account=${trap.user} 已覆写（argv -w·完整 blob·避 128 截断）。`);
			} else {
				trap.storesCommitted = false;
				trap.commitSwitchinEmail = "";
				trap.commitWrappedBlob = "";
				const rb = rollbackOfficialStores12(credPath, claudeJsonPath, trap);
				for (const m of rb.messages) messages.push(m);
				trap.overwriteInProgress = false;
				cleanupSnapshots(trap, messages);
				trap.snapCredTmp = "";
				trap.snapCjTmp = "";
				if (rb.ok) messages.push("stores: ③ keychain 失败 → 已回滚 ①②，三存储全留旧号，换号未发生，可重试。");
				else messages.push("stores: ③ keychain 失败、且 ①② 回滚失败——可能 split-brain（部分官方凭证态已在新号上）·需手动对账！");
				return {
					ok: false,
					committed: false,
					rolledBack: rb.ok,
					splitBrainRisk: !rb.ok,
					identityDegraded: false,
					messages
				};
			}
		} else {
			trap.storesCommitted = true;
			trap.commitSwitchinEmail = switchInEmail;
			trap.overwriteInProgress = false;
			messages.push("stores: ③ 无 security（非 mac）——跳过 keychain，只覆写了 ①② 两个文件（Linux 正常路径）。");
		}
		cleanupSnapshots(trap, messages);
		return {
			ok: true,
			committed: true,
			rolledBack: false,
			splitBrainRisk: false,
			identityDegraded,
			messages
		};
	}
	function forwardAlignOrRollback(trap) {
		const messages = [];
		if (trap.storesCommitted && !trap.activeAligned && trap.commitSwitchinEmail) {
			if (trap.commitWrappedBlob && trap.keychain.isAvailable()) try {
				trap.keychain.write(trap.credService, trap.user, `cc-master OAuth: ${trap.user}`, trap.commitWrappedBlob);
			} catch (_e) {}
			let regAligned = false;
			try {
				mutateRegistry(trap.regPath, (reg) => {
					if (!reg.accounts || !reg.accounts[trap.commitSwitchinEmail]) throw new Error("switch-in email not in registry — cannot align active (RC-P3 stale-registry)");
					setActive(reg, trap.commitSwitchinEmail);
				});
				regAligned = true;
			} catch (_e) {
				regAligned = false;
			}
			trap.activeAligned = true;
			trap.overwriteInProgress = false;
			trap.overwriteCredPath = "";
			trap.overwriteCjPath = "";
			if (regAligned) messages.push(`switch-account: 换号在「①② 已提交、收尾未完成」窗口被中断——已**前向对齐全部到 ${trap.commitSwitchinEmail}**（补写 keychain ③ + registry active），三存储与 registry 一致·避免 split-brain（不回滚已提交的 ①）。`);
			else messages.push(`switch-account: 换号在「①② 已提交、收尾未完成」窗口被中断——已把三存储前向对齐到 ${trap.commitSwitchinEmail}（补写 keychain ③·不回滚已提交的 ①），但 registry active 对齐失败——registry 暂留旧号、**下次 ccm account switch 启动时 reconcileActiveFromStore 会读 ②~/.claude.json oauthAccount 反向对账修正**（非永久 split-brain·可自愈）。`);
			cleanupSnapshots(trap, messages);
			return {
				action: "forward-align",
				regAligned,
				messages
			};
		}
		if (trap.overwriteInProgress && trap.overwriteCredPath) {
			const rb = rollbackOfficialStores12(trap.overwriteCredPath, trap.overwriteCjPath, trap);
			trap.overwriteInProgress = false;
			for (const m of rb.messages) messages.push(m);
			messages.push("switch-account: 换号在覆写窗口内被中断——已尝试把 ①② 官方存储回滚到旧号（避免 split-brain）。三存储与 registry 保守留旧号。");
			cleanupSnapshots(trap, messages);
			return {
				action: "rollback",
				rolledBack: rb.ok,
				messages
			};
		}
		cleanupSnapshots(trap, messages);
		return {
			action: "noop",
			messages
		};
	}
	function mkSnapTemp(trap, tag) {
		if (!trap.snapDir) {
			node_fs.mkdirSync(trap.snapParent, {
				recursive: true,
				mode: 448
			});
			trap.snapDir = node_fs.mkdtempSync(node_path.join(trap.snapParent, ".ccm-cred-snap-"));
		}
		return node_path.join(trap.snapDir, `.${tag}.${Date.now()}.${Math.random().toString(36).slice(2)}`);
	}
	function codeOf(e) {
		const c = e?.code;
		return typeof c === "string" ? c : "ERR";
	}
	//#endregion
	//#region src/account/when.ts
	const FIVE_HOUR_WATERMARK = envNum("CCM_SELECT_5H_WATERMARK", 85);
	const SEVEN_DAY_WATERMARK = envNum("CCM_SELECT_7D_WATERMARK", 85);
	const IMBALANCE_THRESHOLD = envNum("CCM_SELECT_7D_IMBALANCE", 15);
	const MIN_SWITCH_INTERVAL_SEC = envNum("CCM_SELECT_MIN_SWITCH_INTERVAL_SEC", 1800);
	function isNum(x) {
		return typeof x === "number" && Number.isFinite(x);
	}
	function num(v, dflt) {
		return Number.isFinite(v) ? v : dflt;
	}
	function median(xs) {
		const s = xs.slice().sort((a, b) => a - b);
		const m = s.length >> 1;
		return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
	}
	function round2$2(x) {
		return Number.isFinite(x) ? Math.round(x * 100) / 100 : x;
	}
	function shouldSwitch(input, opts = {}) {
		const fiveWM = num(opts.fiveHourWatermark, FIVE_HOUR_WATERMARK);
		const sevenWM = num(opts.sevenDayWatermark, SEVEN_DAY_WATERMARK);
		const imbThresh = num(opts.imbalanceThreshold, IMBALANCE_THRESHOLD);
		const minInterval = num(opts.minSwitchIntervalSec, MIN_SWITCH_INTERVAL_SEC);
		const nowSec = opts.nowSec ?? input.nowSec ?? Math.floor(Date.now() / 1e3);
		const p5 = isNum(input.activeFiveHourPct) ? input.activeFiveHourPct : null;
		const p7 = isNum(input.activeSevenDayPct) ? input.activeSevenDayPct : null;
		const triggers = [];
		if (p5 !== null && p5 >= fiveWM || input.runwayWillExhaust === true) triggers.push("five_hour_watermark");
		if (p7 !== null && p7 >= sevenWM) triggers.push("seven_day_watermark");
		const forced = triggers.length > 0;
		const pool = (Array.isArray(input.poolSevenDayPcts) ? input.poolSevenDayPcts : []).filter(isNum);
		const poolBest = pool.length ? Math.min(...pool) : null;
		const poolMedian = pool.length ? round2$2(median(pool)) : null;
		const gain = p7 !== null && poolBest !== null ? round2$2(p7 - poolBest) : null;
		const elapsed = isNum(input.lastSwitchAtSec) ? nowSec - input.lastSwitchAtSec : null;
		let hysteresisBlocked = false;
		if (gain !== null && gain >= imbThresh && pool.length > 0) if (forced || elapsed === null || elapsed >= minInterval) triggers.push("seven_day_imbalance");
		else hysteresisBlocked = true;
		const decided = triggers.length > 0;
		return {
			shouldSwitch: decided,
			triggers,
			forced,
			reason: buildReason({
				decided,
				forced,
				triggers,
				p5,
				p7,
				fiveWM,
				sevenWM,
				gain,
				imbThresh,
				poolBest,
				runway: input.runwayWillExhaust === true,
				hysteresisBlocked,
				elapsed,
				minInterval
			}),
			imbalanceGain: gain,
			poolBestSevenDay: poolBest,
			poolMedianSevenDay: poolMedian,
			secondsSinceLastSwitch: elapsed,
			hysteresisBlocked
		};
	}
	function buildReason(c) {
		if (!c.decided) {
			if (c.hysteresisBlocked) return `不切：7d 失衡达标（gain ${c.gain}% ≥ ${c.imbThresh}%）但距上次切号仅 ${c.elapsed}s（< ${c.minInterval}s 滞回）——频率门控挡下，避免缓存抖动反增用量。`;
			return `不切：5h ${c.p5 ?? "n/a"}% < ${c.fiveWM}% 且 7d ${c.p7 ?? "n/a"}% < ${c.sevenWM}% 且无显著 7d 失衡（gain ${c.gain ?? "n/a"}% < ${c.imbThresh}%）——当前节奏无须切号。`;
		}
		const parts = [];
		if (c.triggers.includes("five_hour_watermark")) parts.push(c.runway && !(c.p5 !== null && c.p5 >= c.fiveWM) ? `5h runway 撑不到（will-exhaust-before-reset）` : `5h 已用 ${c.p5}%（≥${c.fiveWM}%·forced·不切就 wall）`);
		if (c.triggers.includes("seven_day_watermark")) parts.push(`7d 已用 ${c.p7}%（≥${c.sevenWM}%·forced·安全·防烧穿）`);
		if (c.triggers.includes("seven_day_imbalance")) parts.push(`7d 显著失衡（active ${c.p7}% − 池最优 ${c.poolBest}% = gain ${c.gain}% ≥ ${c.imbThresh}%·已过滞回）`);
		return `该切：${parts.join("；")}。（切到哪个号由 select 决定·本判定只答时机）`;
	}
	function evaluateSwitch(reg, opts = {}) {
		const now = opts.now || nowIso$1();
		let nowSec;
		if (isNum(opts.nowSec)) nowSec = opts.nowSec;
		else {
			const parsed = Math.floor(Date.parse(now) / 1e3);
			nowSec = Number.isFinite(parsed) ? parsed : Math.floor(Date.now() / 1e3);
		}
		const preds = predictPoolUsage(reg, {
			now,
			live: opts.live,
			liveByEmail: opts.liveByEmail
		});
		const active = preds.find((p) => p.active) || null;
		const candidates = preds.filter((p) => p.switchable);
		const fiveAuth = !!active && active.fiveHour.authoritative;
		const sevenAuth = !!active && active.sevenDay.authoritative;
		return {
			...shouldSwitch({
				activeFiveHourPct: fiveAuth ? active.fiveHour.usedPct : null,
				activeSevenDayPct: sevenAuth ? active.sevenDay.usedPct : null,
				runwayWillExhaust: opts.runwayWillExhaust,
				poolSevenDayPcts: candidates.map((c) => c.sevenDay.usedPct),
				lastSwitchAtSec: opts.lastSwitchAtSec,
				nowSec
			}, opts),
			activeEmail: active ? active.email : null,
			poolCandidates: candidates.length,
			activeAuthoritative: fiveAuth || sevenAuth
		};
	}
	//#endregion
	//#region src/account/index.ts
	var account_exports = /* @__PURE__ */ __exportAll({
		DEFAULT_KEYCHAIN_SERVICE: () => DEFAULT_KEYCHAIN_SERVICE,
		DEFAULT_OAUTH_CLIENT_ID: () => DEFAULT_OAUTH_CLIENT_ID,
		DEFAULT_REFRESH_TOKEN_URL: () => DEFAULT_REFRESH_TOKEN_URL,
		EXPIRY_PENALTY: () => EXPIRY_PENALTY,
		EXPIRY_WARN_DAYS: () => EXPIRY_WARN_DAYS,
		FIVE_HOUR_HARD_GATE: () => FIVE_HOUR_HARD_GATE,
		FIVE_HOUR_WATERMARK: () => FIVE_HOUR_WATERMARK,
		IMBALANCE_THRESHOLD: () => IMBALANCE_THRESHOLD,
		ISO_UTC_RE: () => ISO_UTC_RE$2,
		KEYCHAIN_CRED_SERVICE: () => KEYCHAIN_CRED_SERVICE,
		LOCAL_APPROX_TRUST: () => LOCAL_APPROX_TRUST,
		MIN_SWITCH_INTERVAL_SEC: () => MIN_SWITCH_INTERVAL_SEC,
		OBSERVED_QUOTA_TRUST: () => OBSERVED_QUOTA_TRUST,
		REFRESH_EXIT: () => REFRESH_EXIT,
		RESERVE_FLOOR: () => RESERVE_FLOOR,
		RESERVE_FULL_PCT: () => RESERVE_FULL_PCT,
		RESET_PROXIMITY_HORIZON_H: () => RESET_PROXIMITY_HORIZON_H,
		RESET_PROXIMITY_WEIGHT: () => RESET_PROXIMITY_WEIGHT,
		RefreshError: () => RefreshError,
		SCHEMA: () => SCHEMA,
		SEVEN_DAY_HARD_GATE: () => SEVEN_DAY_HARD_GATE,
		SEVEN_DAY_WATERMARK: () => SEVEN_DAY_WATERMARK,
		VAULT_KINDS: () => VAULT_KINDS,
		W5: () => W5,
		W7: () => W7,
		accountScore: () => accountScore,
		acquireFileLock: () => acquireFileLock,
		acquireRegistryLock: () => acquireRegistryLock,
		captureCurrentLoginBlob: () => captureCurrentLoginBlob,
		daysUntil: () => daysUntil,
		defaultExpiresIso: () => defaultExpiresIso,
		defaultRegistryPath: () => defaultRegistryPath,
		defaultVaultFile: () => defaultVaultFile,
		defaultVaultKind: () => defaultVaultKind,
		emailOfIdentity: () => emailOfIdentity,
		emptyRegistry: () => emptyRegistry,
		envNum: () => envNum,
		evaluateSwitch: () => evaluateSwitch,
		extractIdentity: () => extractIdentity,
		fileVaultLineMatch: () => fileVaultLineMatch,
		forceRefreshBlob: () => forceRefreshBlob,
		forwardAlignOrRollback: () => forwardAlignOrRollback,
		isRefreshHostAllowed: () => isRefreshHostAllowed,
		isStrictIso: () => isStrictIso,
		isoGte: () => isoGte,
		loadRegistry: () => loadRegistry,
		macKeychainProvider: () => macKeychainProvider,
		mutateRegistry: () => mutateRegistry,
		newTrapState: () => newTrapState,
		normalizeClaudeAiOauthBlob: () => normalizeClaudeAiOauthBlob,
		nowIso: () => nowIso$1,
		overwriteOfficialStores: () => overwriteOfficialStores,
		predictAccountUsage: () => predictAccountUsage,
		predictPoolUsage: () => predictPoolUsage,
		readOfficialBlob: () => readOfficialBlob,
		reconcileActiveFromStore: () => reconcileActiveFromStore,
		recordObservedQuota: () => recordObservedQuota,
		recordSwitchOut: () => recordSwitchOut,
		recoveredWindow: () => recoveredWindow,
		refreshBlob: () => refreshBlob,
		releaseFileLock: () => releaseFileLock,
		releaseRegistryLock: () => releaseRegistryLock,
		removeAccount: () => removeAccount,
		rescueSwitchoutToken: () => rescueSwitchoutToken,
		resetProximityBonus: () => resetProximityBonus,
		rollbackOfficialStores12: () => rollbackOfficialStores12,
		saveRegistry: () => saveRegistry,
		scanForTokenLeak: () => scanForTokenLeak,
		scanValuesForToken: () => scanValuesForToken,
		selectAccount: () => selectAccount,
		setActive: () => setActive,
		shouldSwitch: () => shouldSwitch,
		subscriptionTypeOf: () => subscriptionTypeOf,
		tokenExpired: () => tokenExpired$1,
		upsertAccount: () => upsertAccount,
		validateBlob: () => validateBlob,
		validateRegistry: () => validateRegistry,
		vaultDelete: () => vaultDelete,
		vaultHasValidBlob: () => vaultHasValidBlob,
		vaultProbe: () => vaultProbe,
		vaultRead: () => vaultRead,
		vaultStore: () => vaultStore
	});
	//#endregion
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
		accountSwitchPolicy: ["allow", "deny"],
		coordPriority: [
			"urgent",
			"high",
			"normal",
			"low",
			"trivial"
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
				readers: "Stop-block 收口逼 + CLI 拆解校验 + cadence health lint",
				writers: "agent 经 CLI",
				when: "定节奏 / 开收 iteration",
				degrade: "缺→无 cadence 牙齿;iteration 形状坏→warn(FMT-CADENCE);members 估时/验收/容量问题→warn(BIZ-CADENCE-*/BIZ-AGILE-*)"
			},
			baseline: {
				tier: "✎",
				type: "object{captured_at:ISO, t0:ISO, task_estimates:{<id>:{value:number,unit:string}}, dag_snapshot:{<id>:{deps:[]}}, bac_h:number, history:[{reset_at:ISO, note:string?, bac_h:number, task_estimates_snapshot:{}}]}?",
				default: "缺省(无 baseline)",
				readers: "estimate evm / baseline show",
				writers: "baseline snapshot / reset",
				when: "EVM 基线拍摄时",
				degrade: "缺→无 EVM baseline；形状坏→warn(FMT-BASELINE)"
			},
			policy: {
				tier: "✎",
				type: "object{autonomous_account_switch:allow|deny}?",
				default: "缺省(=allow·向后兼容)",
				readers: "switch-account.sh 机制硬闸 / SKILL A 建议层 / policy show",
				writers: "policy set",
				when: "用户锁/放开自主权限时",
				degrade: "缺→解析为 allow；形状坏→warn(FMT-POLICY)"
			},
			coordination: {
				tier: "✎",
				type: "object{priority?:enum coordPriority, state?:{current?:{active_tasks?:int, workload?:string, burn_contribution?:number}, planned?:{remaining_work?:string, cost_to_complete_pct?:number}}}?",
				default: "缺省(无协调 publish·priority 解析为 normal)",
				readers: "ccm peers 跨板只读花名册 / SKILL A 多-orch pacing 推理（COORD·hook 不读·非窄腰）",
				writers: "agent 经 CLI(决策点 / Stop / wake 时刷)",
				when: "多 orchestrator 并行抽同一配额缸时 publish 自身状态",
				degrade: "缺→该 peer 不计入花名册对应维度(退单板·fail-safe)；形状坏→warn(FMT-COORD)"
			},
			runtime: {
				tier: "✎",
				type: "object{ last_identity_remind?: ISO, last_critpath_remind?: ISO, last_account_switch?: ISO, stop_allow_until?: ISO, ... }?",
				default: "缺省(无 runtime 参数)",
				readers: "IDNUDGE hook 读 last_identity_remind / critpath-nudge hook 读 last_critpath_remind 判阈值 / usage-pacing hook 读 last_account_switch 注入换号 ambient(ADR-024) / Codex Stop hook 读 stop_allow_until 判是否释放 decision:block；未来其它周期 hook/script",
				writers: "hook 经 ccm board set-param（带锁·hook-owned 参数区·ADR-020）/ agent 经 ccm",
				when: "周期 hook 注入提示后刷簿记时间戳；agent 独立确认本板可停止后写短期 stop_allow_until",
				degrade: "缺→视为「从未提示」(首次必提示)；形状坏→warn(FMT-RUNTIME)·不拦写盘"
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
				degrade: "ref 相对路径→hard(FMT-REF);type=development 缺 spec/plan→warn(BIZ-DEV-REFS);executor=external 缺 issue→warn(BIZ-EXTERNAL-ISSUE)"
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
				readers: "cadence health(estimate vs timebox) / CPM 喂时长降级 / estimate stale drift",
				writers: "agent 经 CLI",
				when: "估点",
				degrade: "缺→CPM 降级 unit;open cadence member 缺→warn(BIZ-CADENCE-MISSING-ESTIMATE);形状坏→warn(FMT-ESTIMATE)"
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
				when: "派发 subagent/workflow 时；external 可记录 issue URL/number 或外部 run id",
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
				degrade: "缺→done 真语义不满足(BIZ-DONE-VERIFIED·hard);external 的 artifact 若只是 issue 跟踪锚点→warn(BIZ-EXTERNAL-ARTIFACT)"
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
			},
			model: {
				tier: "✎",
				type: "string?",
				default: "缺省",
				readers: "estimate tier 分层校准 / #34 档位成本效益",
				writers: "agent 经 CLI(dispatch/done 时记录)",
				when: "派发或完成时记录模型档",
				degrade: "缺→无 tier 校准"
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
			id: "GRAPH-CONNECTED",
			level: "warn",
			family: "GRAPH",
			scope: "graph",
			summary: "任务图弱连通(deps 当无向边·分量>1=有孤岛子图·目标聚焦·容多分量·warn)"
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
			id: "BIZ-EXTERNAL-ARTIFACT",
			level: "warn",
			family: "BIZ",
			scope: "task",
			summary: "executor=external 且 done 时 artifact 不应只是 issue tracking anchor(issue closed ≠ board done)"
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
			id: "BIZ-CADENCE-MISSING-ESTIMATE",
			level: "warn",
			family: "BIZ",
			scope: "cadence",
			summary: "open iteration member 缺有效 estimate，无法判断 timebox 是否装得下"
		},
		{
			id: "BIZ-CADENCE-OVERBOOKED",
			level: "warn",
			family: "BIZ",
			scope: "cadence",
			summary: "open iteration 成员估时总量超过 cadence timebox(含小幅 grace)"
		},
		{
			id: "BIZ-CADENCE-CRITICAL-PATH-OVER",
			level: "warn",
			family: "BIZ",
			scope: "cadence",
			summary: "open iteration 的依赖关键路径估时超过 cadence timebox(含小幅 grace)"
		},
		{
			id: "BIZ-TASK-OVERSIZED-FOR-CADENCE",
			level: "warn",
			family: "BIZ",
			scope: "task",
			summary: "单个 cadence member 的 estimate 超过 cadence ship_every 目标(提示再切片)"
		},
		{
			id: "BIZ-AGILE-ACCEPTANCE-MISSING",
			level: "warn",
			family: "BIZ",
			scope: "task",
			summary: "cadence member 缺清晰 acceptance，无法作为可验收薄切片收口"
		},
		{
			id: "BIZ-ESTIMATE-STALE",
			level: "warn",
			family: "BIZ",
			scope: "task",
			summary: "实测 duration 与 estimate 明显漂移，提示重估未开始下游"
		},
		{
			id: "BIZ-STATUS-DEPS",
			level: "warn",
			family: "BIZ",
			scope: "task",
			summary: "deps 门控不一致(手改造出·CLI 经 reconcileGating 永不产生):ready 但 deps 未全 done / blocked 无 blocked_on 但 deps 全 done(ADR-023)"
		},
		{
			id: "BIZ-DONE-VERIFIED",
			level: "hard",
			family: "BIZ",
			scope: "task",
			summary: "status=done ⇒ verified ∧ artifact 非空(done 真语义·#32 true-done hard gate)"
		},
		{
			id: "FMT-BASELINE",
			level: "warn",
			family: "FMT",
			scope: "board",
			summary: "baseline.captured_at/t0 须 ISO-8601 UTC、task_estimates/dag_snapshot 形状合法"
		},
		{
			id: "FMT-POLICY",
			level: "warn",
			family: "FMT",
			scope: "board",
			summary: "policy 非对象、或 autonomous_account_switch 不在 {allow,deny} 枚举"
		},
		{
			id: "FMT-COORD",
			level: "warn",
			family: "FMT",
			scope: "board",
			summary: "coordination 非对象、或 priority 不在 coordPriority 枚举、或 state.current/planned 形状/数字字段类型不合法"
		},
		{
			id: "FMT-MODEL",
			level: "warn",
			family: "FMT",
			scope: "task",
			summary: "task.model 若存在须为 string"
		},
		{
			id: "FMT-RUNTIME",
			level: "warn",
			family: "FMT",
			scope: "board",
			summary: "runtime 非对象、或已知键（last_identity_remind 等）类型不合法（时间锚须 ISO-8601 UTC）"
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
	const DURATION_UNITS = {
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
	};
	function durationHours(v) {
		if (typeof v === "string") {
			const m = v.trim().match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)\b/);
			if (!m) return null;
			const n = Number(m[1]);
			const mult = DURATION_UNITS[m[2].toLowerCase()];
			return Number.isFinite(n) && n > 0 && mult ? n * mult : null;
		}
		if (!v || typeof v !== "object" || Array.isArray(v)) return null;
		const e = v;
		if (typeof e.value !== "number" || !Number.isFinite(e.value) || e.value <= 0) return null;
		const mult = DURATION_UNITS[typeof e.unit === "string" ? e.unit.trim().toLowerCase() : ""];
		return mult ? e.value * mult : null;
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
		lintBaseline(b, emit);
		lintPolicy(b, emit);
		lintCoordination(b, emit);
		lintRuntime(b, emit);
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
		const fillWorkIds = /* @__PURE__ */ new Set();
		for (const [id, t] of taskById) if (t.role === "fill-work") fillWorkIds.add(id);
		if (validIds.size - fillWorkIds.size >= 2) {
			const comps = weaklyConnectedComponents(g, fillWorkIds);
			if (comps.length > 1) {
				const [main, ...islands] = comps;
				const mainComp = main;
				const islandLines = islands.map((c, i) => `  孤岛 #${i + 1}（${c.length} 个）：${c.join(", ")}`);
				emit("GRAPH-CONNECTED", `任务依赖图被切成 ${comps.length} 个互不相连的子图（弱连通分量·把 deps ∪ parent 容器边当无向边算）——存在与主图没有任何依赖/归属关系的孤岛节点。\n  主图（最大分量·${mainComp.length} 个）：${mainComp.join(", ")}\n${islandLines.join("\n")}\n  影响：不致命（warn）——为目标聚焦，规划出的图希望是全通图（但不强求）；孤岛节点和主目标无依赖联系，常是规划失焦（漏连依赖、或这个任务根本不属于本目标）。\n  怎么修：给孤岛节点补上指向主图的 deps（它依赖谁 / 谁依赖它），或确认它确实独立后忽略本 warning。`);
			}
		}
		for (const [id, t] of taskById) lintTaskFields(id, t, validIds, emit);
		for (const [id, t] of taskById) lintTaskBiz(id, t, emit);
		for (const [id, t] of taskById) lintStatusDeps(id, t, g.upstream, taskById, emit);
		lintCadenceShipped(b, taskById, emit);
		lintCadenceAgileHealth(b, taskById, g.upstream, emit);
		lintEstimateStale(taskById, g.downstream, emit);
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
	function lintBaseline(board, emit) {
		const bl = board.baseline;
		if (bl === void 0 || bl === null) return;
		if (typeof bl !== "object" || Array.isArray(bl)) {
			emit("FMT-BASELINE", `baseline 若存在必须是对象（当前：${JSON.stringify(bl)}）。`);
			return;
		}
		const b = bl;
		for (const k of ["captured_at", "t0"]) if (badTimestamp(b[k])) emit("FMT-BASELINE", `baseline.${k} 是 ${JSON.stringify(b[k])}，非严格 ISO-8601 UTC（YYYY-MM-DDTHH:MM:SSZ）。影响：estimate evm 读它——格式不对则 EVM 时间轴错位。`);
		for (const k of ["task_estimates", "dag_snapshot"]) if (b[k] !== void 0 && (typeof b[k] !== "object" || Array.isArray(b[k]) || b[k] === null)) emit("FMT-BASELINE", `baseline.${k} 若存在必须是对象（当前：${JSON.stringify(b[k])}）。`);
		if (b.bac_h !== void 0 && typeof b.bac_h !== "number") emit("FMT-BASELINE", `baseline.bac_h 若存在必须是数字（当前：${JSON.stringify(b.bac_h)}）。`);
		if (b.history !== void 0) if (!Array.isArray(b.history)) emit("FMT-BASELINE", `baseline.history 若存在必须是数组（当前：${JSON.stringify(b.history)}）。`);
		else for (let i = 0; i < b.history.length; i++) {
			const h = b.history[i];
			if (!h || typeof h !== "object" || Array.isArray(h)) {
				emit("FMT-BASELINE", `baseline.history[${i}] 应为对象 {reset_at, note?, bac_h, task_estimates_snapshot}（当前：${JSON.stringify(h)}）。`);
				continue;
			}
			if (badTimestamp(h.reset_at)) emit("FMT-BASELINE", `baseline.history[${i}].reset_at 是 ${JSON.stringify(h.reset_at)}，非严格 ISO-8601 UTC。`);
			if (h.bac_h !== void 0 && typeof h.bac_h !== "number") emit("FMT-BASELINE", `baseline.history[${i}].bac_h 若存在必须是数字（当前：${JSON.stringify(h.bac_h)}）。`);
		}
	}
	function lintPolicy(board, emit) {
		const pl = board.policy;
		if (pl === void 0 || pl === null) return;
		if (typeof pl !== "object" || Array.isArray(pl)) {
			emit("FMT-POLICY", `policy 若存在必须是对象（当前：${JSON.stringify(pl)}）。影响：switch-account.sh 机制硬闸读 policy.autonomous_account_switch——非对象则读不出、硬闸解析退化为 allow。`);
			return;
		}
		const p = pl;
		if (p.autonomous_account_switch !== void 0 && !isEnumMember("accountSwitchPolicy", p.autonomous_account_switch)) emit("FMT-POLICY", `policy.autonomous_account_switch 是 ${JSON.stringify(p.autonomous_account_switch)}，应 ∈ {allow, deny}。影响：硬闸只认这两个值——未知值则开关判定失效。`);
	}
	function lintCoordination(board, emit) {
		const co = board.coordination;
		if (co === void 0 || co === null) return;
		if (typeof co !== "object" || Array.isArray(co)) {
			emit("FMT-COORD", `coordination 若存在必须是对象（当前：${JSON.stringify(co)}）。影响：ccm peers 跨板读它出花名册——非对象则该 peer 整块降级、不计入感知（退单板 pacing·fail-safe）。`);
			return;
		}
		const c = co;
		if (c.priority !== void 0 && !isEnumMember("coordPriority", c.priority)) emit("FMT-COORD", `coordination.priority 是 ${JSON.stringify(c.priority)}，应 ∈ {urgent, high, normal, low, trivial}。影响：板级优先级是裁决主轴 + 机械 fair-share 权重源——未知值则该板优先级退化为默认 normal。`);
		if (c.state !== void 0) {
			if (typeof c.state !== "object" || Array.isArray(c.state) || c.state === null) {
				emit("FMT-COORD", `coordination.state 若存在必须是对象 {current?, planned?}（当前：${JSON.stringify(c.state)}）。`);
				return;
			}
			const st = c.state;
			if (st.current !== void 0) if (typeof st.current !== "object" || Array.isArray(st.current) || st.current === null) emit("FMT-COORD", `coordination.state.current 若存在必须是对象（当前：${JSON.stringify(st.current)}）。`);
			else {
				const cur = st.current;
				for (const k of ["active_tasks", "burn_contribution"]) if (cur[k] !== void 0 && typeof cur[k] !== "number") emit("FMT-COORD", `coordination.state.current.${k} 若存在必须是数字（当前：${JSON.stringify(cur[k])}）。影响：数字喂机械 fair-share floor / headroom 估计——非数字则该维度降级忽略。`);
				if (cur.workload !== void 0 && typeof cur.workload !== "string") emit("FMT-COORD", `coordination.state.current.workload 若存在必须是字符串（人类可读·喂 peer 价值推理；当前：${JSON.stringify(cur.workload)}）。`);
			}
			if (st.planned !== void 0) if (typeof st.planned !== "object" || Array.isArray(st.planned) || st.planned === null) emit("FMT-COORD", `coordination.state.planned 若存在必须是对象（当前：${JSON.stringify(st.planned)}）。`);
			else {
				const pl = st.planned;
				if (pl.cost_to_complete_pct !== void 0 && typeof pl.cost_to_complete_pct !== "number") emit("FMT-COORD", `coordination.state.planned.cost_to_complete_pct 若存在必须是数字（当前：${JSON.stringify(pl.cost_to_complete_pct)}）。影响：偿付力信号喂价值/紧迫推理——非数字则降级忽略。`);
				if (pl.remaining_work !== void 0 && typeof pl.remaining_work !== "string") emit("FMT-COORD", `coordination.state.planned.remaining_work 若存在必须是字符串（人类可读·喂 peer 价值推理；当前：${JSON.stringify(pl.remaining_work)}）。`);
			}
		}
	}
	function lintRuntime(board, emit) {
		const rt = board.runtime;
		if (rt === void 0 || rt === null) return;
		if (typeof rt !== "object" || Array.isArray(rt)) {
			emit("FMT-RUNTIME", `runtime 若存在必须是对象（当前：${JSON.stringify(rt)}）。影响：IDNUDGE 等周期 hook 读 runtime.<key> 判阈值——非对象则读不出、退化为「从未提示」(首次必提示·fail-safe)。`);
			return;
		}
		const r = rt;
		if (badTimestamp(r.last_identity_remind)) emit("FMT-RUNTIME", `runtime.last_identity_remind 是 ${JSON.stringify(r.last_identity_remind)}，非严格 ISO-8601 UTC（YYYY-MM-DDTHH:MM:SSZ）。影响：IDNUDGE 读它判周期阈值——格式不对则退化为「从未提示」(首次必提示)。`);
		if (badTimestamp(r.last_critpath_remind)) emit("FMT-RUNTIME", `runtime.last_critpath_remind 是 ${JSON.stringify(r.last_critpath_remind)}，非严格 ISO-8601 UTC（YYYY-MM-DDTHH:MM:SSZ）。影响：critpath-nudge 读它判周期阈值——格式不对则退化为「从未提示」(首次必提示)。`);
		if (badTimestamp(r.last_account_switch)) emit("FMT-RUNTIME", `runtime.last_account_switch 是 ${JSON.stringify(r.last_account_switch)}，非严格 ISO-8601 UTC（YYYY-MM-DDTHH:MM:SSZ）。影响：usage-pacing hook 读它判「上次换号是否已 surface」——格式不对则退化为不注入换号 ambient（fail-safe·ADR-024）。`);
		if (badTimestamp(r.stop_allow_until)) emit("FMT-RUNTIME", `runtime.stop_allow_until 是 ${JSON.stringify(r.stop_allow_until)}，非严格 ISO-8601 UTC（YYYY-MM-DDTHH:MM:SSZ）。影响：Codex Stop hook 读它判本次是否允许停止——格式不对则退化为继续阻止停止（fail-safe）。`);
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
		if (t.model !== void 0 && typeof t.model !== "string") emit("FMT-MODEL", `${id}.model 是 ${JSON.stringify(t.model)}，非字符串。影响：estimate 层 tier 分层校准读它——非 string 则降级忽略。`, id);
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
		if (t.executor === "external" && t.status === "done" && typeof t.artifact === "string") {
			if (refs.filter((r) => r.kind === "issue").map((r) => r.ref).filter((ref) => typeof ref === "string" && ref !== "").includes(t.artifact)) emit("BIZ-EXTERNAL-ARTIFACT", `${id}.executor=external 且 status=done，但 artifact 等于 kind=issue 的追踪锚点 ${JSON.stringify(t.artifact)}。影响：issue link 只是外部进度 tracking anchor；GitHub issue closed / 存在不等于 board done。artifact 应指向外部实际产出（PR / commit / release / report / CI run 等），再由 orchestrator 端点验收后 done --verified。`, id);
		}
		if (isAwaitingUser(t)) {
			const dp = t.decision_package;
			if (!dp || typeof dp !== "object" || Array.isArray(dp)) emit("BIZ-AWAITING", `${id} 是 awaiting-user 节点（blocked_on:"user" + status=${JSON.stringify(t.status)}），但缺少 decision_package 对象（当前：${JSON.stringify(dp)}）。awaiting-user 节点的存在意义就是一个「备好料的用户决策点」——没包 = 新 session 跑 /cc-master:discuss 开不起来讨论，采访闭环塌掉。\n  怎么修：在 ${id} 上挂 decision_package（version/inputs_hash/ask_type/context_md/what_i_need/options…），或若已不在等用户拍板，改 blocked_on / status。`, id);
			else lintDecisionPackage(id, dp, emit);
		}
		if (t.status === "done" && !taskTrulyDone(t)) emit("BIZ-DONE-VERIFIED", `${id} status=done 但缺少 true-done 证据（需要 verified=true 且 artifact 非空）。done 是对世界状态的完成声称，必须带端点验收与可追溯产物；否则 board 会把未验收/无证据的工作谎报为完成。\n  怎么修：用 \`ccm task done ${id} --verified --artifact <path-or-url>\`，或若尚未验收/无产物，把状态改回 uncertain / in_flight / stale 等真实状态。`, id);
		lintTimeOrder(id, t, emit);
	}
	function lintStatusDeps(id, t, upstream, taskById, emit) {
		const status = t.status;
		if (status !== "ready" && status !== "blocked") return;
		const bo = t.blocked_on;
		if (typeof bo === "string" && bo !== "") return;
		const undone = (upstream.get(id) || []).filter((d) => !isDoneStatus(taskById.get(d)?.status));
		if ((undone.length === 0 ? "ready" : "blocked") === status) return;
		if (status === "ready") emit("BIZ-STATUS-DEPS", `${id} status=ready 但 deps 未全 done（未完成上游：${undone.join(", ")}）——门控不一致（应 blocked）。CLI 写路径经 reconcileGating 自动归一（ready⟺deps 全 done），此态多半来自手改 board。\n  怎么修：跑任意 ccm 写命令触发归一，或 \`ccm task set-status ${id} blocked\`（deps 未满足应 blocked）。`, id);
		else emit("BIZ-STATUS-DEPS", `${id} status=blocked 且无 blocked_on（非语义阻塞）但 deps 全 done——门控不一致（应已 ready）。CLI 写路径经 reconcileGating 自动归一，此态多半来自手改 board（或 deps 刚全部完成而未重跑写命令）。\n  怎么修：跑任意 ccm 写命令触发归一，或 \`ccm task unblock ${id}\` / \`ccm task set-status ${id} ready\`。`, id);
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
	const CADENCE_GRACE = 1.1;
	function cadenceTimeboxHours(cadence, iteration) {
		const started = isISOUTC(iteration.started_at) ? Date.parse(iteration.started_at) : null;
		const deadline = isISOUTC(iteration.deadline) ? Date.parse(iteration.deadline) : null;
		if (started != null && deadline != null && deadline > started) return (deadline - started) / 36e5;
		const target = cadence.target;
		return target && typeof target === "object" ? durationHours(target.ship_every) : null;
	}
	function criticalPathHoursForMembers(members, taskById, upstream) {
		const validMembers = members.filter((id) => {
			const t = taskById.get(id);
			return !!t && durationHours(t.estimate) != null;
		});
		if (validMembers.length === 0) return null;
		const memberSet = new Set(validMembers);
		const indeg = /* @__PURE__ */ new Map();
		const downstream = /* @__PURE__ */ new Map();
		const dist = /* @__PURE__ */ new Map();
		for (const id of validMembers) {
			const t = taskById.get(id);
			if (!t) return null;
			const h = durationHours(t.estimate);
			if (h == null) return null;
			indeg.set(id, 0);
			downstream.set(id, []);
			dist.set(id, h);
		}
		for (const id of validMembers) for (const dep of upstream.get(id) || []) {
			if (!memberSet.has(dep)) continue;
			indeg.set(id, (indeg.get(id) || 0) + 1);
			downstream.get(dep).push(id);
		}
		const queue = validMembers.filter((id) => (indeg.get(id) || 0) === 0).sort();
		let seen = 0;
		while (queue.length) {
			const id = queue.shift();
			seen++;
			const base = dist.get(id) || 0;
			for (const next of downstream.get(id) || []) {
				const nDur = durationHours(taskById.get(next)?.estimate);
				if (nDur == null) return null;
				dist.set(next, Math.max(dist.get(next) || 0, base + nDur));
				indeg.set(next, (indeg.get(next) || 0) - 1);
				if (indeg.get(next) === 0) queue.push(next);
			}
			queue.sort();
		}
		if (seen !== validMembers.length) return null;
		return Math.max(0, ...dist.values());
	}
	function lintCadenceAgileHealth(board, taskById, upstream, emit) {
		const c = board.cadence;
		if (!c || typeof c !== "object" || Array.isArray(c) || !Array.isArray(c.iterations)) return;
		const target = c.target;
		const targetHours = target && typeof target === "object" ? durationHours(target.ship_every) : null;
		for (const itAny of c.iterations) {
			const it = itAny;
			if (!it || typeof it !== "object") continue;
			const members = Array.isArray(it.members) ? it.members.filter((m) => typeof m === "string") : [];
			if (members.length === 0) continue;
			const label = typeof it.id === "string" && it.id ? it.id : "<unknown>";
			for (const id of members) {
				const t = taskById.get(id);
				if (!t) continue;
				if (!acceptanceNonEmpty(t.acceptance)) emit("BIZ-AGILE-ACCEPTANCE-MISSING", `${id} 是 cadence iteration "${label}" 的 member，但缺清晰 acceptance。影响：cadence member 应是一片可验收的纵向增量；缺 DoD 时 iteration 即便按时完成，也无法可靠 endpoint-verify。\n  怎么修：给该 task 补一句可验收 DoD（或 criteria），再决定是否仍归入本 iteration。`, id);
			}
			if (it.status !== void 0 && it.status !== "open") continue;
			const timebox = cadenceTimeboxHours(c, it);
			let total = 0;
			const missing = [];
			for (const id of members) {
				const t = taskById.get(id);
				if (!t) continue;
				const h = durationHours(t.estimate);
				if (h == null) missing.push(id);
				else {
					total += h;
					if (targetHours != null && h > targetHours * CADENCE_GRACE) emit("BIZ-TASK-OVERSIZED-FOR-CADENCE", `${id}.estimate≈${h.toFixed(2)}h 超过 cadence target ship_every≈${targetHours.toFixed(2)}h（grace ${(CADENCE_GRACE * 100).toFixed(0)}%）。影响：单片大于 ship cadence 时，它通常不是薄纵切，而是会吞掉整个 timebox 的大块工作。\n  怎么修：优先把 ${id} 再切成能在一个 cadence 目标内验收的薄片；若确实不能切，在 task 上写清理由并接受本 warning。`, id);
				}
			}
			if (missing.length) emit("BIZ-CADENCE-MISSING-ESTIMATE", `cadence iteration "${label}" 有 member 缺有效 estimate：${missing.join(", ")}。影响：缺估时则无法判断 timebox 是否 overbooked、临界路径是否能在 cadence 内 ship。\n  怎么修：给这些 members 补 task.estimate（如 {value:2,unit:"h"} / ccm --estimate 2h），或移出本 iteration。`);
			if (timebox == null) continue;
			if (total > timebox * CADENCE_GRACE) emit("BIZ-CADENCE-OVERBOOKED", `cadence iteration "${label}" 估时总量≈${total.toFixed(2)}h，超过 timebox≈${timebox.toFixed(2)}h（grace ${(CADENCE_GRACE * 100).toFixed(0)}%）。影响：iteration 装入的工作量超过节奏容量，默认会拖延 ship 或迫使未验收收口。\n  怎么修：拆小 / 移出非临界 member / 降 WIP 后重排，直到总量能放进 timebox。`);
			const cp = criticalPathHoursForMembers(members, taskById, upstream);
			if (cp != null && cp > timebox * CADENCE_GRACE) emit("BIZ-CADENCE-CRITICAL-PATH-OVER", `cadence iteration "${label}" 的 member 内关键路径≈${cp.toFixed(2)}h，超过 timebox≈${timebox.toFixed(2)}h（grace ${(CADENCE_GRACE * 100).toFixed(0)}%）。影响：即使并行度拉满，依赖链本身也无法按 cadence 收口。\n  怎么修：重切临界链上的 oversized member、删假依赖边，或把 iteration timebox / scope surface 给用户裁决。`);
		}
	}
	function measuredHours(t) {
		const started = isISOUTC(t.started_at) ? Date.parse(t.started_at) : null;
		const finished = isISOUTC(t.finished_at) ? Date.parse(t.finished_at) : null;
		if (started == null || finished == null || finished <= started) return null;
		return (finished - started) / 36e5;
	}
	function lintEstimateStale(taskById, downstream, emit) {
		for (const [id, t] of taskById) {
			if (t.status !== "done") continue;
			const est = durationHours(t.estimate);
			const actual = measuredHours(t);
			if (est == null || actual == null) continue;
			const ratio = actual / est;
			if (ratio < .5 || ratio > 2) {
				const candidates = (downstream.get(id) || []).filter((d) => {
					const dt = taskById.get(d);
					return !!dt && dt.started_at === void 0 && durationHours(dt.estimate) != null;
				});
				if (candidates.length === 0) continue;
				emit("BIZ-ESTIMATE-STALE", `${id} 实测 duration≈${actual.toFixed(2)}h，与 estimate≈${est.toFixed(2)}h 漂移 ${(ratio * 100).toFixed(0)}%。影响：依赖它的未开始任务仍沿用旧估时，forecast / cadence 装箱可能继续偏。建议重估下游：${candidates.join(", ")}。`, candidates[0]);
			}
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
	function weaklyConnectedComponents(g, exclude = /* @__PURE__ */ new Set()) {
		const { ids, upstream, parentOf } = g;
		const has = (id) => ids.has(id) && !exclude.has(id);
		const adj = /* @__PURE__ */ new Map();
		for (const id of ids) if (!exclude.has(id)) adj.set(id, /* @__PURE__ */ new Set());
		for (const [id, deps] of upstream) {
			if (!has(id)) continue;
			for (const d of deps) {
				if (!has(d)) continue;
				adj.get(id).add(d);
				adj.get(d).add(id);
			}
		}
		for (const [child, ownerId] of parentOf) {
			if (!has(child) || !has(ownerId) || child === ownerId) continue;
			adj.get(child).add(ownerId);
			adj.get(ownerId).add(child);
		}
		const seen = /* @__PURE__ */ new Set();
		const comps = [];
		for (const start of ids) {
			if (exclude.has(start)) continue;
			if (seen.has(start)) continue;
			const comp = [];
			const stack = [start];
			seen.add(start);
			while (stack.length) {
				const n = stack.pop();
				comp.push(n);
				for (const m of adj.get(n) || []) if (!seen.has(m)) {
					seen.add(m);
					stack.push(m);
				}
			}
			comp.sort();
			comps.push(comp);
		}
		comps.sort((a, b) => {
			if (b.length !== a.length) return b.length - a.length;
			const fa = a[0] ?? "";
			const fb = b[0] ?? "";
			return fa < fb ? -1 : fa > fb ? 1 : 0;
		});
		return comps;
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
	function parseTs$3(v) {
		if (typeof v !== "string" || !ISO_UTC_RE$1.test(v)) return null;
		const ms = Date.parse(v);
		return Number.isFinite(ms) ? ms : null;
	}
	function estimateHours(estimate) {
		return durationHours(estimate);
	}
	function nodeDuration(task, nowMs) {
		if (task && typeof task === "object") {
			const started = parseTs$3(task.started_at);
			const finished = parseTs$3(task.finished_at);
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
	const DEFAULTS$2 = {
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
			...DEFAULTS$2,
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
			...DEFAULTS$2,
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
	//#region src/board-reconcile.ts
	const GATED = /* @__PURE__ */ new Set(["ready", "blocked"]);
	function hasSemanticBlock(t) {
		return typeof t.blocked_on === "string" && t.blocked_on !== "";
	}
	function reconcileGating(board) {
		if (!board || typeof board !== "object" || Array.isArray(board)) return board;
		const src = board;
		if (!Array.isArray(src.tasks)) return board;
		const b = structuredClone(board);
		const g = analyzeGraph(b);
		const doneIds = /* @__PURE__ */ new Set();
		for (const t of b.tasks) if (t && typeof t === "object" && typeof t.id === "string" && isDoneStatus(t.status)) doneIds.add(t.id);
		for (const t of b.tasks) {
			if (!t || typeof t !== "object" || typeof t.id !== "string") continue;
			if (!GATED.has(t.status)) continue;
			if (hasSemanticBlock(t)) continue;
			t.status = g.predecessors(t.id).every((d) => doneIds.has(d)) ? "ready" : "blocked";
		}
		return b;
	}
	//#endregion
	//#region src/coordination/peers.ts
	const PEER_FRESHNESS_SEC = 600;
	function parseISOms(v) {
		if (typeof v !== "string" || !ISO_UTC_RE.test(v)) return null;
		const ms = Date.parse(v);
		return Number.isFinite(ms) ? ms : null;
	}
	function numOrNull(v) {
		return typeof v === "number" && Number.isFinite(v) ? v : null;
	}
	function strOrNull(v) {
		return typeof v === "string" ? v : null;
	}
	function projectCurrent(state) {
		const cur = state && typeof state.current === "object" && !Array.isArray(state.current) && state.current ? state.current : null;
		if (!cur) return null;
		return {
			active_tasks: numOrNull(cur.active_tasks),
			workload: strOrNull(cur.workload),
			burn_contribution: numOrNull(cur.burn_contribution)
		};
	}
	function projectPlanned(state) {
		const pl = state && typeof state.planned === "object" && !Array.isArray(state.planned) && state.planned ? state.planned : null;
		if (!pl) return null;
		return {
			remaining_work: strOrNull(pl.remaining_work),
			cost_to_complete_pct: numOrNull(pl.cost_to_complete_pct)
		};
	}
	const _PRIORITY_RANK = {
		urgent: 0,
		high: 1,
		normal: 2,
		low: 3,
		trivial: 4
	};
	function priorityRank(p) {
		return _PRIORITY_RANK[p] ?? _PRIORITY_RANK.normal ?? 2;
	}
	function buildPeerRoster(boards, opts = {}) {
		const nowMs = opts.nowMs ?? Date.now();
		const freshnessSec = opts.freshnessSec ?? 600;
		const freshnessMs = freshnessSec * 1e3;
		const peers = [];
		for (const { file, board } of boards) {
			if (!board || typeof board !== "object" || Array.isArray(board)) continue;
			const b = board;
			const owner = b.owner && typeof b.owner === "object" && !Array.isArray(b.owner) ? b.owner : null;
			if (!owner || owner.active !== true) continue;
			const hbStr = typeof owner.heartbeat === "string" ? owner.heartbeat : null;
			const hbMs = parseISOms(owner.heartbeat);
			if (hbMs == null) continue;
			const ageMs = nowMs - hbMs;
			if (ageMs >= freshnessMs) continue;
			const co = b.coordination && typeof b.coordination === "object" && !Array.isArray(b.coordination) ? b.coordination : null;
			const state = co && typeof co.state === "object" && !Array.isArray(co.state) && co.state ? co.state : null;
			const rawPriority = co ? co.priority : void 0;
			const priority = isEnumMember("coordPriority", rawPriority) ? rawPriority : "normal";
			peers.push({
				board_file: file,
				goal: typeof b.goal === "string" ? b.goal : "",
				priority,
				session_id: typeof owner.session_id === "string" ? owner.session_id : "",
				heartbeat: hbStr,
				heartbeat_age_sec: Math.round(ageMs / 1e3),
				current: projectCurrent(state),
				planned: projectPlanned(state)
			});
		}
		peers.sort((a, b) => {
			const pr = priorityRank(a.priority) - priorityRank(b.priority);
			if (pr !== 0) return pr;
			const ageA = a.heartbeat_age_sec ?? Number.POSITIVE_INFINITY;
			const ageB = b.heartbeat_age_sec ?? Number.POSITIVE_INFINITY;
			if (ageA !== ageB) return ageA - ageB;
			return a.board_file.localeCompare(b.board_file);
		});
		return {
			peers,
			count: peers.length,
			freshness_sec: freshnessSec,
			as_of: new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, "Z")
		};
	}
	//#endregion
	//#region src/usage/history-loader.ts
	const DEFAULT_MAX_BOARDS = 50;
	const DEFAULT_MAX_DAYS_AGO = 90;
	function parseTs$2(v) {
		if (typeof v !== "string" || !ISO_UTC_RE.test(v)) return null;
		const ms = Date.parse(v);
		return Number.isFinite(ms) ? ms : null;
	}
	function boardRepo(board) {
		const git = board && typeof board.git === "object" ? board.git : {};
		if (typeof git.remote === "string" && git.remote) return git.remote;
		if (typeof git.root === "string" && git.root) return git.root;
		if (typeof git.worktree === "string" && git.worktree) return git.worktree;
		return typeof board.goal === "string" ? board.goal.slice(0, 24) : "unknown";
	}
	function boardTime(board) {
		const hb = parseTs$2(board?.owner?.heartbeat);
		if (hb != null) return hb;
		return parseTs$2(board?.meta?.created_at);
	}
	function extractDoneRecords(board, boardFile = "") {
		const b = board;
		if (!b || typeof b !== "object" || !Array.isArray(b.tasks)) return [];
		const repo = boardRepo(b);
		const bt = boardTime(b);
		const out = [];
		for (const raw of b.tasks) {
			const t = raw;
			if (!t || typeof t !== "object" || t.status !== "done") continue;
			const est = estimateHours(t.estimate);
			const started = parseTs$2(t.started_at);
			const finished = parseTs$2(t.finished_at);
			const actual = started != null && finished != null && finished > started ? (finished - started) / 36e5 : null;
			const ratio = est != null && actual != null && est > 0 ? actual / est : null;
			const obs = t.observability && typeof t.observability === "object" ? t.observability : {};
			const tok = obs.tokens && typeof obs.tokens === "object" ? obs.tokens : null;
			const tokensIn = tok && typeof tok.input === "number" ? tok.input : null;
			const tokensOut = tok && typeof tok.output === "number" ? tok.output : null;
			out.push({
				boardFile,
				repo,
				taskId: typeof t.id === "string" ? t.id : "",
				type: typeof t.type === "string" ? t.type : "",
				executor: typeof t.executor === "string" ? t.executor : "",
				model: typeof t.model === "string" ? t.model : "",
				tier: typeof t.tier === "string" ? t.tier : "",
				estimateHours: est,
				actualHours: actual,
				ratio,
				depsCount: Array.isArray(t.deps) ? t.deps.length : 0,
				tokensIn,
				tokensOut,
				finishedAtMs: finished,
				boardTimeMs: bt
			});
		}
		return out;
	}
	function recencyWeight(record, nowMs, halfLifeDays = 30) {
		const ts = record.finishedAtMs ?? record.boardTimeMs;
		if (ts == null) return .5;
		const ageDays = (nowMs - ts) / 864e5;
		if (ageDays <= 0) return 1;
		return 2 ** (-ageDays / halfLifeDays);
	}
	function loadHomeBoards(homeDir, opts = {}) {
		const maxBoards = opts.maxBoards ?? 50;
		const maxDaysAgo = opts.maxDaysAgo ?? 90;
		const nowMs = opts.nowMs ?? Date.now();
		let entries;
		try {
			entries = node_fs.readdirSync(homeDir, { withFileTypes: true });
		} catch {
			return [];
		}
		const parsed = [];
		for (const ent of entries) {
			if (!ent.isFile() || !ent.name.endsWith(".board.json")) continue;
			let board;
			try {
				board = JSON.parse(node_fs.readFileSync(node_path.join(homeDir, ent.name), "utf8"));
			} catch {
				continue;
			}
			const ts = boardTime(board) ?? 0;
			parsed.push({
				file: ent.name,
				board,
				ts
			});
		}
		const cutoff = nowMs - maxDaysAgo * 864e5;
		return parsed.filter((p) => p.ts === 0 || p.ts >= cutoff).sort((a, b) => b.ts - a.ts).slice(0, maxBoards).map((p) => ({
			file: p.file,
			board: p.board
		}));
	}
	function loadCorpus(homeDir, opts = {}) {
		const boards = loadHomeBoards(homeDir, opts);
		const out = [];
		for (const { file, board } of boards) for (const r of extractDoneRecords(board, file)) out.push(r);
		return out;
	}
	function poolLayers(records, query) {
		const match = (r, keys) => keys.every((k) => query[k] === void 0 || query[k] === "" || r[k] === query[k]);
		return [
			{
				level: "repo+type+executor+tier",
				records: records.filter((r) => match(r, [
					"repo",
					"type",
					"executor",
					"tier"
				]))
			},
			{
				level: "repo+type",
				records: records.filter((r) => match(r, ["repo", "type"]))
			},
			{
				level: "type",
				records: records.filter((r) => match(r, ["type"]))
			},
			{
				level: "home",
				records: records.slice()
			}
		];
	}
	function selectPoolLayer(records, query, minN = 3, isUsable = () => true) {
		const layers = poolLayers(records, query);
		const usableCount = (layer) => layer.records.reduce((n, r) => n + (isUsable(r) ? 1 : 0), 0);
		for (let i = 0; i < layers.length; i++) {
			const layer = layers[i];
			if (layer && usableCount(layer) >= minN) return {
				layer,
				confidence: i === 0 ? "high" : i === 1 ? "medium" : "low"
			};
		}
		return {
			layer: layers[layers.length - 1],
			confidence: "low"
		};
	}
	//#endregion
	//#region src/estimate/calibration.ts
	function hasUsableRatio(r) {
		return r.ratio != null && r.ratio > 0;
	}
	function ewmaWeightedRatio(records, nowMs, halfLifeDays) {
		let wsum = 0;
		let vsum = 0;
		let n = 0;
		for (const r of records) {
			if (!hasUsableRatio(r)) continue;
			const w = recencyWeight(r, nowMs, halfLifeDays);
			wsum += w;
			vsum += w * r.ratio;
			n += 1;
		}
		if (n === 0 || wsum === 0) return {
			mean: null,
			n: 0
		};
		return {
			mean: vsum / wsum,
			n
		};
	}
	function calibrate(records, query, opts = {}) {
		const nowMs = opts.nowMs ?? Date.now();
		const halfLifeDays = opts.halfLifeDays ?? 30;
		const prior = opts.prior ?? 1;
		const k = opts.priorStrength ?? 3;
		const { layer, confidence } = selectPoolLayer(records, query, opts.minN ?? 3, hasUsableRatio);
		const { mean, n } = ewmaWeightedRatio(layer.records, nowMs, halfLifeDays);
		if (mean == null || n === 0) return {
			multiplier: prior,
			confidence: "low",
			history_n: 0,
			source: "no-history",
			level: layer.level,
			raw_mean: null
		};
		return {
			multiplier: (n * mean + k * prior) / (n + k),
			confidence,
			history_n: n,
			source: n >= 2 * k ? "calibrated" : "shrunk-to-prior",
			level: layer.level,
			raw_mean: mean
		};
	}
	function calibratedEstimate(rawHours, cal) {
		if (rawHours == null || !(rawHours > 0)) return null;
		return rawHours * cal.multiplier;
	}
	function dispersionCv(records, query, opts = {}, fallbackCv = .4) {
		const { layer } = selectPoolLayer(records, query, opts.minN ?? 3, hasUsableRatio);
		const ratios = layer.records.map((r) => r.ratio).filter((x) => x != null && x > 0);
		if (ratios.length < 2) return fallbackCv;
		const mean = ratios.reduce((s, v) => s + v, 0) / ratios.length;
		if (!(mean > 0)) return fallbackCv;
		const variance = ratios.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (ratios.length - 1);
		const cv = Math.sqrt(variance) / mean;
		return cv > 0 ? cv : fallbackCv;
	}
	//#endregion
	//#region src/estimate/ccpm.ts
	function sizeProjectBuffer(input) {
		const f = input.f ?? .5;
		let sumSq = 0;
		let meanTotal = 0;
		for (const t of input.chainTasks) {
			const s = t.sigma > 0 ? t.sigma : 0;
			sumSq += s * s;
			meanTotal += t.mean > 0 ? t.mean : 0;
		}
		return {
			buffer_size: f * Math.sqrt(sumSq),
			chain_mean_total: meanTotal,
			source: "ccpm-ssq"
		};
	}
	function feverStatus(input) {
		const size = input.bufferSize > 0 ? input.bufferSize : 0;
		const consumedPct = size > 0 ? Math.max(0, input.bufferConsumed) / size : 0;
		const progress = Math.max(0, Math.min(1, input.chainProgress));
		const greenCeil = progress * (2 / 3);
		const yellowCeil = progress * (4 / 3) + 1 / 3;
		let zone;
		if (consumedPct <= greenCeil) zone = "green";
		else if (consumedPct <= yellowCeil) zone = "yellow";
		else zone = "red";
		return {
			buffer_consumed_pct: Math.round(consumedPct * 1e3) / 1e3,
			chain_progress_pct: Math.round(progress * 1e3) / 1e3,
			zone,
			buffer_health: Math.round((progress - consumedPct) * 1e3) / 1e3,
			source: "ccpm-fever"
		};
	}
	//#endregion
	//#region src/estimate/conformal.ts
	function empiricalQuantile(sorted, p) {
		const n = sorted.length;
		if (n === 0) return NaN;
		if (n === 1) return sorted[0];
		const idx = (p < 0 ? 0 : p > 1 ? 1 : p) * (n - 1);
		const lo = Math.floor(idx);
		const hi = Math.ceil(idx);
		const frac = idx - lo;
		return sorted[lo] * (1 - frac) + sorted[hi] * frac;
	}
	function quantilesOf(values) {
		const arr = Float64Array.from(values.filter((v) => Number.isFinite(v)));
		arr.sort();
		return {
			p50: empiricalQuantile(arr, .5),
			p80: empiricalQuantile(arr, .8),
			p95: empiricalQuantile(arr, .95)
		};
	}
	function conformalGroupKey(rec, dim) {
		if (dim === "type") return rec.type ?? "";
		if (dim === "executor") return rec.executor ?? "";
		return `${rec.type ?? ""}|${rec.executor ?? ""}`;
	}
	function relativeResiduals(records) {
		const out = [];
		for (const r of records) if (r.ratio != null && r.ratio > 0) out.push(r.ratio);
		return out;
	}
	function conformalInterval(pointEstimate, records, opts = {}) {
		const dim = opts.dim ?? "type";
		const minGroupN = opts.minGroupN ?? 5;
		const groupKey = opts.group ? conformalGroupKey(opts.group, dim) : "";
		let res = relativeResiduals(records);
		let basis = "global";
		let confidence = "medium";
		if (groupKey) {
			const groupRes = relativeResiduals(records.filter((r) => conformalGroupKey(r, dim) === groupKey));
			if (groupRes.length >= minGroupN) {
				res = groupRes;
				basis = "mondrian-group";
				confidence = "high";
			} else confidence = "low";
		}
		if (res.length === 0) return {
			p50: pointEstimate,
			p80: pointEstimate,
			p95: pointEstimate,
			confidence: "low",
			coverage_basis: "no-history",
			history_n: 0,
			group_key: groupKey
		};
		if (basis === "global" && res.length < minGroupN) confidence = "low";
		const q = quantilesOf(res);
		return {
			p50: pointEstimate * q.p50,
			p80: pointEstimate * q.p80,
			p95: pointEstimate * q.p95,
			confidence,
			coverage_basis: basis,
			history_n: res.length,
			group_key: groupKey
		};
	}
	function empiricalCoverage(records, nominal = .95) {
		const withRatio = records.filter((r) => r.ratio != null && r.ratio > 0);
		const n = withRatio.length;
		if (n < 2) return {
			coverage: NaN,
			n
		};
		let hit = 0;
		for (let i = 0; i < n; i++) {
			const rest = [];
			for (let j = 0; j < n; j++) {
				const rec = withRatio[j];
				if (j !== i && rec) rest.push(rec.ratio);
			}
			const arr = Float64Array.from(rest);
			arr.sort();
			const upper = empiricalQuantile(arr, nominal);
			if (withRatio[i].ratio <= upper) hit += 1;
		}
		return {
			coverage: hit / n,
			n
		};
	}
	//#endregion
	//#region src/estimate/evm.ts
	function parseTs$1(v) {
		if (typeof v !== "string" || !ISO_UTC_RE.test(v)) return null;
		const ms = Date.parse(v);
		return Number.isFinite(ms) ? ms : null;
	}
	function baselineHours(baseline, id) {
		return estimateHours(baseline.task_estimates?.[id]) ?? 0;
	}
	function computeEvm(board, baseline, opts = {}) {
		const asOfMs = opts.asOfMs ?? Date.now();
		const acSource = opts.acSource ?? "duration";
		const asOfISO = new Date(asOfMs).toISOString().replace(/\.\d{3}Z$/, "Z");
		const warnings = [];
		const tasks = Array.isArray(board.tasks) ? board.tasks : [];
		if (!baseline || typeof baseline !== "object" || !baseline.task_estimates) {
			warnings.push("无 board.baseline——EVM 需要计划基线，先 `baseline snapshot`");
			return emptyEvm(asOfISO, acSource, warnings);
		}
		const t0 = parseTs$1(baseline.t0) ?? parseTs$1(baseline.captured_at);
		if (t0 == null) {
			warnings.push("baseline.t0 缺/非 ISO——无法定零时刻，EVM 降级");
			return emptyEvm(asOfISO, acSource, warnings);
		}
		const atHours = Math.max(0, (asOfMs - t0) / 36e5);
		const ids = Object.keys(baseline.task_estimates);
		let bacFromTasks = 0;
		for (const id of ids) bacFromTasks += baselineHours(baseline, id);
		const bac = typeof baseline.bac_h === "number" && baseline.bac_h > 0 ? baseline.bac_h : bacFromTasks;
		const cp = analyzeGraph({
			schema: "cc-master/v2",
			tasks: ids.map((id) => ({
				id,
				status: "ready",
				deps: baseline.dag_snapshot?.[id]?.deps ?? [],
				estimate: {
					value: baselineHours(baseline, id),
					unit: "h"
				}
			}))
		}).criticalPath({ now: asOfMs });
		const pvAtTime = (limit) => {
			let pv = 0;
			for (const id of ids) {
				const e = cp.schedule.get(id);
				if (!e) continue;
				const dur = e.dur;
				if (dur <= 0) continue;
				const overlap = Math.max(0, Math.min(e.ef, limit) - e.es);
				pv += Math.min(overlap, dur) / dur * baselineHours(baseline, id);
			}
			return pv;
		};
		const pv = pvAtTime(atHours);
		let ev = 0;
		let ac = 0;
		let acCovered = 0;
		let acTotal = 0;
		for (const t of tasks) {
			const id = typeof t.id === "string" ? t.id : "";
			if (!id || !(id in baseline.task_estimates)) continue;
			if (t.status !== "done") continue;
			const fin = parseTs$1(t.finished_at);
			if (fin != null && fin > asOfMs) continue;
			ev += baselineHours(baseline, id);
			acTotal += 1;
			if (acSource === "duration") {
				const s = parseTs$1(t.started_at);
				const f = parseTs$1(t.finished_at);
				if (s != null && f != null && f > s) {
					ac += (f - s) / 36e5;
					acCovered += 1;
				}
			} else {
				const tok = (t.observability && typeof t.observability === "object" ? t.observability : {}).tokens;
				if (tok && (typeof tok.input === "number" || typeof tok.output === "number")) {
					ac += (tok.input ?? 0) + (tok.output ?? 0);
					acCovered += 1;
				}
			}
		}
		const coverage = acTotal > 0 ? Math.round(acCovered / acTotal * 100) : 0;
		const es = earnedSchedule(ev, pvAtTime, atHours, cp.makespan ?? bac);
		const spi = pv > 0 ? ev / pv : null;
		const cpi = ac > 0 ? ev / ac : acSource === "duration" && acTotal > 0 ? null : null;
		const spiT = atHours > 0 && es != null ? es / atHours : null;
		const svT = es != null ? es - atHours : null;
		const acUnit = acSource === "token" ? "tok" : "h";
		const eac = cpi && cpi > 0 ? {
			value: bac / cpi,
			unit: acUnit
		} : null;
		const ieacT = spiT && spiT > 0 ? {
			value: atHours / spiT,
			unit: "h"
		} : null;
		const etc = eac ? {
			value: Math.max(0, eac.value - ac),
			unit: acUnit
		} : null;
		const vac = eac && acSource !== "token" ? {
			value: bac - eac.value,
			unit: acUnit
		} : null;
		if (acSource === "token" && eac) warnings.push("AC 口径为 token 但无同量纲 planned token budget——VAC（=BAC−EAC）量纲不可比，已省略");
		if (coverage < 100 && acTotal > 0) warnings.push(`AC 覆盖 ${coverage}%（部分 done 任务缺 ${acSource} 数据）——CPI/EAC 偏乐观`);
		const confidence = coverage >= 80 && acTotal >= 3 ? "high" : acTotal >= 1 ? "medium" : "low";
		return {
			has_baseline: true,
			baseline_captured_at: baseline.captured_at ?? null,
			as_of: asOfISO,
			pv: {
				value: round2$1(pv),
				unit: "h"
			},
			ev: {
				value: round2$1(ev),
				unit: "h"
			},
			ac: {
				value: round2$1(ac),
				unit: acUnit,
				source: acSource,
				coverage_pct: coverage
			},
			spi: spi != null ? round3(spi) : null,
			cpi: cpi != null ? round3(cpi) : null,
			spi_t: spiT != null ? round3(spiT) : null,
			sv_t: svT != null ? round2$1(svT) : null,
			es_hours: es != null ? round2$1(es) : null,
			at_hours: round2$1(atHours),
			eac: eac ? {
				value: round2$1(eac.value),
				unit: eac.unit
			} : null,
			ieac_t: ieacT ? {
				value: round2$1(ieacT.value),
				unit: ieacT.unit
			} : null,
			etc: etc ? {
				value: round2$1(etc.value),
				unit: etc.unit
			} : null,
			bac: {
				value: round2$1(bac),
				unit: "h"
			},
			vac: vac ? {
				value: round2$1(vac.value),
				unit: vac.unit
			} : null,
			confidence,
			warnings,
			source: "evm-earned-schedule"
		};
	}
	function earnedSchedule(ev, pvFn, atHours, horizon) {
		if (ev <= 0) return 0;
		const maxT = Math.max(horizon, atHours, 1);
		const steps = 200;
		let prevT = 0;
		let prevPv = pvFn(0);
		for (let i = 1; i <= steps; i++) {
			const t = maxT * i / steps;
			const pv = pvFn(t);
			if (pv >= ev) {
				const denom = pv - prevPv;
				const frac = denom > 0 ? (ev - prevPv) / denom : 0;
				return prevT + frac * (t - prevT);
			}
			prevT = t;
			prevPv = pv;
		}
		return maxT;
	}
	function emptyEvm(asOfISO, acSource, warnings) {
		return {
			has_baseline: false,
			baseline_captured_at: null,
			as_of: asOfISO,
			pv: {
				value: 0,
				unit: "h"
			},
			ev: {
				value: 0,
				unit: "h"
			},
			ac: {
				value: 0,
				unit: acSource === "token" ? "tok" : "h",
				source: acSource,
				coverage_pct: 0
			},
			spi: null,
			cpi: null,
			spi_t: null,
			sv_t: null,
			es_hours: null,
			at_hours: null,
			eac: null,
			ieac_t: null,
			etc: null,
			bac: {
				value: 0,
				unit: "h"
			},
			vac: null,
			confidence: "low",
			warnings,
			source: "evm-earned-schedule"
		};
	}
	function round2$1(x) {
		return Math.round(x * 100) / 100;
	}
	function round3(x) {
		return Math.round(x * 1e3) / 1e3;
	}
	//#endregion
	//#region src/estimate/knn.ts
	const DEFAULTS$1 = {
		k: 5,
		halfLifeDays: 30,
		repoPenalty: 2,
		typePenalty: 1.5,
		executorPenalty: .6,
		tierPenalty: .4,
		modelPenalty: .4
	};
	function caseDistance(query, rec, opts) {
		let d = 0;
		const cmp = (qv, rv, pen) => {
			if (qv !== void 0 && qv !== "" && qv !== rv) d += pen;
		};
		cmp(query.repo, rec.repo, opts.repoPenalty);
		cmp(query.type, rec.type, opts.typePenalty);
		cmp(query.executor, rec.executor, opts.executorPenalty);
		cmp(query.tier, rec.tier, opts.tierPenalty);
		cmp(query.model, rec.model, opts.modelPenalty);
		if (query.depsCount !== void 0) d += Math.abs(query.depsCount - rec.depsCount) * .1;
		if (query.estimateHours != null && query.estimateHours > 0 && rec.estimateHours != null && rec.estimateHours > 0) d += Math.abs(Math.log(query.estimateHours) - Math.log(rec.estimateHours)) * .5;
		return d;
	}
	function knnPredict(query, records, opts = {}) {
		const o = {
			...DEFAULTS$1,
			nowMs: opts.nowMs ?? Date.now(),
			...opts
		};
		const k = o.k;
		const candidates = records.filter((r) => r.actualHours != null && r.actualHours > 0);
		if (candidates.length === 0) return {
			predictedHours: null,
			predictedTokens: null,
			neighbors: [],
			confidence: "low",
			history_n: 0
		};
		const scored = candidates.map((rec) => ({
			rec,
			distance: caseDistance(query, rec, o)
		})).sort((a, b) => a.distance - b.distance || a.rec.taskId.localeCompare(b.rec.taskId));
		const neighbors = scored.slice(0, Math.min(k, scored.length)).map(({ rec, distance }) => ({
			record: rec,
			distance,
			weight: 1 / (1 + distance) * recencyWeight(rec, o.nowMs, o.halfLifeDays)
		}));
		let wsum = 0;
		let hsum = 0;
		for (const nb of neighbors) {
			if (nb.record.actualHours == null) continue;
			wsum += nb.weight;
			hsum += nb.weight * nb.record.actualHours;
		}
		const predictedHours = wsum > 0 ? hsum / wsum : null;
		let twsum = 0;
		let tsum = 0;
		for (const nb of neighbors) {
			const tin = nb.record.tokensIn;
			const tout = nb.record.tokensOut;
			if (tin == null && tout == null) continue;
			twsum += nb.weight;
			tsum += nb.weight * ((tin ?? 0) + (tout ?? 0));
		}
		const predictedTokens = twsum > 0 ? tsum / twsum : null;
		const nearest = neighbors[0]?.distance ?? Infinity;
		let confidence = "low";
		if (neighbors.length >= k && nearest < 1) confidence = "high";
		else if (neighbors.length >= 3 && nearest < 2.5) confidence = "medium";
		return {
			predictedHours,
			predictedTokens,
			neighbors,
			confidence,
			history_n: candidates.length
		};
	}
	//#endregion
	//#region src/estimate/prng.ts
	function splitmix32(a) {
		let s = a >>> 0;
		return () => {
			s = s + 2654435769 >>> 0;
			let t = s;
			t = Math.imul(t ^ t >>> 16, 569420461);
			t = Math.imul(t ^ t >>> 15, 1935289751);
			return (t ^ t >>> 15) >>> 0;
		};
	}
	var Sfc32 = class {
		a;
		b;
		c;
		d;
		constructor(seed) {
			const sm = splitmix32(Number.isFinite(seed) ? seed >>> 0 : 0);
			this.a = sm();
			this.b = sm();
			this.c = sm();
			this.d = sm();
			for (let i = 0; i < 12; i++) this.next();
		}
		next() {
			this.a >>>= 0;
			this.b >>>= 0;
			this.c >>>= 0;
			this.d >>>= 0;
			let t = this.a + this.b >>> 0;
			this.a = this.b ^ this.b >>> 9;
			this.b = this.c + (this.c << 3) >>> 0;
			this.c = this.c << 21 | this.c >>> 11;
			this.d = this.d + 1 >>> 0;
			t = t + this.d >>> 0;
			this.c = this.c + t >>> 0;
			return (t >>> 0) / 4294967296;
		}
		nextInt(n) {
			return Math.floor(this.next() * n);
		}
	};
	function makePrng(seed) {
		const g = new Sfc32(seed);
		return () => g.next();
	}
	//#endregion
	//#region src/estimate/sampling.ts
	function sampleNormal(prng) {
		let u1 = prng();
		if (u1 <= 0) u1 = Number.MIN_VALUE;
		const u2 = prng();
		return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
	}
	function sampleLogNormalFromLogParams(prng, mu, sigma) {
		return Math.exp(mu + sigma * sampleNormal(prng));
	}
	function logNormalParamsFromMeanCv(mean, cv) {
		const m = mean > 0 ? mean : 1e-9;
		const c = cv > 0 ? cv : 1e-9;
		const sigma2 = Math.log(1 + c * c);
		const sigma = Math.sqrt(sigma2);
		return {
			mu: Math.log(m) - sigma2 / 2,
			sigma
		};
	}
	function sampleTaskDuration(prng, mean, cv) {
		if (!(mean > 0)) return 0;
		const { mu, sigma } = logNormalParamsFromMeanCv(mean, cv);
		return sampleLogNormalFromLogParams(prng, mu, sigma);
	}
	//#endregion
	//#region src/estimate/mc-scheduler.ts
	function pearson(x, y) {
		const n = x.length;
		if (n < 2) return 0;
		let mx = 0;
		let my = 0;
		for (let i = 0; i < n; i++) {
			mx += x[i];
			my += y[i];
		}
		mx /= n;
		my /= n;
		let cov = 0;
		let vx = 0;
		let vy = 0;
		for (let i = 0; i < n; i++) {
			const dx = x[i] - mx;
			const dy = y[i] - my;
			cov += dx * dy;
			vx += dx * dx;
			vy += dy * dy;
		}
		if (vx <= 0 || vy <= 0) return 0;
		return cov / Math.sqrt(vx * vy);
	}
	function stddev(arr) {
		const n = arr.length;
		if (n < 2) return 0;
		let m = 0;
		for (let i = 0; i < n; i++) m += arr[i];
		m /= n;
		let v = 0;
		for (let i = 0; i < n; i++) {
			const d = arr[i] - m;
			v += d * d;
		}
		return Math.sqrt(v / (n - 1));
	}
	function estimateDagMonteCarlo(board, params, opts = {}) {
		const seed = opts.seed ?? 42;
		const runs = Math.max(1, opts.runs ?? 2e3);
		const defaultCv = opts.defaultCv ?? .4;
		const defaultMean = opts.defaultMeanHours ?? 1;
		const g = analyzeGraph(board);
		const { order, cycle } = g.topoSort();
		const ids = order;
		const nodeCount = ids.length;
		if (cycle || nodeCount === 0) return {
			makespan: {
				p50: NaN,
				p80: NaN,
				p95: NaN
			},
			mean: NaN,
			criticality_index: [],
			runs,
			seed,
			node_count: 0,
			source: "estimate-dag-mc"
		};
		const prng = new Sfc32(seed);
		const idx = /* @__PURE__ */ new Map();
		for (let i = 0; i < ids.length; i++) idx.set(ids[i], i);
		const upstreamIdx = ids.map((id) => g.predecessors(id).map((p) => idx.get(p)).filter((x) => x !== void 0));
		const meanArr = new Float64Array(nodeCount);
		const cvArr = new Float64Array(nodeCount);
		for (let i = 0; i < nodeCount; i++) {
			const p = params.get(ids[i]);
			meanArr[i] = p ? p.meanHours : defaultMean;
			cvArr[i] = p && p.cv > 0 ? p.cv : defaultCv;
		}
		const makespanSamples = new Float64Array(runs);
		const durSamples = ids.map(() => new Float64Array(runs));
		const critCount = new Float64Array(nodeCount);
		const ef = new Float64Array(nodeCount);
		const es = new Float64Array(nodeCount);
		for (let t = 0; t < runs; t++) {
			let makespan = 0;
			let sinkIdx = 0;
			for (let i = 0; i < nodeCount; i++) {
				const mean = meanArr[i];
				const dur = mean > 0 ? sampleTaskDuration(() => prng.next(), mean, cvArr[i]) : 0;
				durSamples[i][t] = dur;
				let start = 0;
				const ups = upstreamIdx[i];
				for (const u of ups) {
					const uef = ef[u];
					if (uef > start) start = uef;
				}
				es[i] = start;
				const e = start + dur;
				ef[i] = e;
				if (e > makespan) {
					makespan = e;
					sinkIdx = i;
				}
			}
			makespanSamples[t] = makespan;
			let cur = sinkIdx;
			const guard = /* @__PURE__ */ new Set();
			const EPS = 1e-9;
			while (cur >= 0 && !guard.has(cur)) {
				guard.add(cur);
				critCount[cur] = critCount[cur] + 1;
				const myEs = es[cur];
				let pick = -1;
				for (const u of upstreamIdx[cur]) if (Math.abs(ef[u] - myEs) < EPS) {
					pick = u;
					break;
				}
				cur = pick;
			}
		}
		const sortedMakespan = Float64Array.from(makespanSamples);
		sortedMakespan.sort();
		const projStd = stddev(makespanSamples);
		let meanMakespan = 0;
		for (let t = 0; t < runs; t++) meanMakespan += makespanSamples[t];
		meanMakespan /= runs;
		const sens = ids.map((id, i) => {
			const ci = critCount[i] / runs;
			const cri = pearson(durSamples[i], makespanSamples);
			const nodeStd = stddev(durSamples[i]);
			return {
				id,
				criticality: ci,
				cruciality: cri,
				sensitivity: projStd > 0 ? ci * (nodeStd / projStd) : 0
			};
		});
		sens.sort((a, b) => b.criticality - a.criticality || a.id.localeCompare(b.id));
		return {
			makespan: {
				p50: quantileFromSorted(sortedMakespan, .5),
				p80: quantileFromSorted(sortedMakespan, .8),
				p95: quantileFromSorted(sortedMakespan, .95)
			},
			mean: meanMakespan,
			criticality_index: sens,
			runs,
			seed,
			node_count: nodeCount,
			source: "estimate-dag-mc"
		};
	}
	function quantileFromSorted(sorted, p) {
		const n = sorted.length;
		if (n === 0) return NaN;
		if (n === 1) return sorted[0];
		const idx = (p < 0 ? 0 : p > 1 ? 1 : p) * (n - 1);
		const lo = Math.floor(idx);
		const hi = Math.ceil(idx);
		const frac = idx - lo;
		return sorted[lo] * (1 - frac) + sorted[hi] * frac;
	}
	function dailyThroughput(records) {
		const byDay = /* @__PURE__ */ new Map();
		let minMs = Number.POSITIVE_INFINITY;
		let maxMs = Number.NEGATIVE_INFINITY;
		for (const r of records) {
			if (r.finishedAtMs == null) continue;
			const day = new Date(r.finishedAtMs).toISOString().slice(0, 10);
			byDay.set(day, (byDay.get(day) ?? 0) + 1);
			if (r.finishedAtMs < minMs) minMs = r.finishedAtMs;
			if (r.finishedAtMs > maxMs) maxMs = r.finishedAtMs;
		}
		if (byDay.size === 0) return [];
		const DAY_MS = 864e5;
		const firstDayMs = Date.parse(`${new Date(minMs).toISOString().slice(0, 10)}T00:00:00Z`);
		const lastDayMs = Date.parse(`${new Date(maxMs).toISOString().slice(0, 10)}T00:00:00Z`);
		const out = [];
		for (let d = firstDayMs; d <= lastDayMs; d += DAY_MS) {
			const key = new Date(d).toISOString().slice(0, 10);
			out.push(byDay.get(key) ?? 0);
		}
		return out;
	}
	function throughputMonteCarlo(backlog, records, opts = {}) {
		const seed = opts.seed ?? 42;
		const runs = Math.max(1, opts.runs ?? 2e3);
		const daily = dailyThroughput(records);
		const m = Math.max(0, Math.floor(backlog));
		if (daily.length === 0 || m === 0) return {
			days: {
				p50: m === 0 ? 0 : NaN,
				p80: m === 0 ? 0 : NaN,
				p95: m === 0 ? 0 : NaN
			},
			mean: m === 0 ? 0 : NaN,
			backlog: m,
			daily_throughput_samples: daily.length,
			runs,
			seed,
			confidence: "low",
			source: "throughput-mc"
		};
		const prng = new Sfc32(seed ^ 2654435769);
		const daysSamples = new Float64Array(runs);
		for (let t = 0; t < runs; t++) {
			let remaining = m;
			let days = 0;
			const cap = m * 1e3 + 1e3;
			while (remaining > 0 && days < cap) {
				const tp = daily[prng.nextInt(daily.length)];
				remaining -= tp;
				days += 1;
			}
			daysSamples[t] = days;
		}
		const sorted = Float64Array.from(daysSamples);
		sorted.sort();
		let mean = 0;
		for (let t = 0; t < runs; t++) mean += daysSamples[t];
		mean /= runs;
		const confidence = daily.length >= 10 ? "high" : daily.length >= 4 ? "medium" : "low";
		return {
			days: {
				p50: quantileFromSorted(sorted, .5),
				p80: quantileFromSorted(sorted, .8),
				p95: quantileFromSorted(sorted, .95)
			},
			mean,
			backlog: m,
			daily_throughput_samples: daily.length,
			runs,
			seed,
			confidence,
			source: "throughput-mc"
		};
	}
	function pctCostToCompleteMonteCarlo(backlog, perUnitPctSamples, opts = {}) {
		const seed = opts.seed ?? 42;
		const runs = Math.max(1, opts.runs ?? 2e3);
		const pool = (Array.isArray(perUnitPctSamples) ? perUnitPctSamples : []).filter((x) => Number.isFinite(x) && x >= 0);
		const m = Math.max(0, Math.floor(backlog));
		if (pool.length === 0 || m === 0) return {
			pct: {
				p50: m === 0 ? 0 : NaN,
				p80: m === 0 ? 0 : NaN,
				p95: m === 0 ? 0 : NaN
			},
			mean: m === 0 ? 0 : NaN,
			backlog: m,
			per_unit_samples: pool.length,
			runs,
			seed,
			confidence: "low",
			source: "pct-cost-mc"
		};
		const prng = new Sfc32(seed ^ 2246822507);
		const samples = new Float64Array(runs);
		for (let t = 0; t < runs; t++) {
			let total = 0;
			for (let i = 0; i < m; i++) total += pool[prng.nextInt(pool.length)];
			samples[t] = total;
		}
		const sorted = Float64Array.from(samples);
		sorted.sort();
		let mean = 0;
		for (let t = 0; t < runs; t++) mean += samples[t];
		mean /= runs;
		const confidence = pool.length >= 10 ? "high" : pool.length >= 4 ? "medium" : "low";
		return {
			pct: {
				p50: quantileFromSorted(sorted, .5),
				p80: quantileFromSorted(sorted, .8),
				p95: quantileFromSorted(sorted, .95)
			},
			mean,
			backlog: m,
			per_unit_samples: pool.length,
			runs,
			seed,
			confidence,
			source: "pct-cost-mc"
		};
	}
	function dualChannelConsistency(est, thr, hoursPerDay = 8, threshold = .2) {
		const a = Number.isFinite(est.makespan.p50) ? est.makespan.p50 / hoursPerDay : NaN;
		const b = thr.days.p50;
		if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0 && b === 0) return {
			estimate_days_p50: a,
			throughput_days_p50: b,
			deviation: NaN,
			warning: false,
			note: "一通道无有效输出（冷启动 / 含环 / 无估值）——无法 consistency 比对"
		};
		const dev = Math.abs(a - b) / Math.max(a, b, 1e-9);
		return {
			estimate_days_p50: a,
			throughput_days_p50: b,
			deviation: dev,
			warning: dev > threshold,
			note: dev > threshold ? `两通道偏差 ${(dev * 100).toFixed(0)}% > ${(threshold * 100).toFixed(0)}%——估值与历史吞吐不一致，建议复核估值或 coverage` : "两通道一致"
		};
	}
	//#endregion
	//#region src/estimate/rcpsp.ts
	function rcpspSchedule(board, opts = {}) {
		const nowMs = opts.nowMs ?? Date.now();
		const g = analyzeGraph(board);
		const { order, cycle } = g.topoSort();
		const cp = g.criticalPath({ now: nowMs });
		if (cycle || order.length === 0) return {
			makespan: 0,
			dispatch_order: [],
			unlimited_makespan: 0,
			wip: opts.wip ?? Infinity,
			weight_source: cycle ? "cycle" : cp.weight_source,
			scheduled: [],
			source: "rcpsp-list-scheduling"
		};
		const wip = opts.wip != null && opts.wip > 0 ? opts.wip : Infinity;
		const durOf = (id) => {
			if (opts.durations?.has(id)) return Math.max(0, opts.durations.get(id));
			const e = cp.schedule.get(id);
			return e ? e.dur : 1;
		};
		const slackOf = (id) => cp.schedule.get(id)?.float ?? 0;
		const lftOf = (id) => cp.schedule.get(id)?.lf ?? Infinity;
		const preds = /* @__PURE__ */ new Map();
		for (const id of order) preds.set(id, g.predecessors(id));
		const finish = /* @__PURE__ */ new Map();
		const start = /* @__PURE__ */ new Map();
		const scheduled = /* @__PURE__ */ new Set();
		const dispatchOrder = [];
		const busy = [];
		const total = order.length;
		let safety = total * (Number.isFinite(wip) ? 2 : 1) + total + 5;
		while (scheduled.size < total && safety-- > 0) {
			const ready = order.filter((id) => !scheduled.has(id) && preds.get(id).every((p) => scheduled.has(p)));
			if (ready.length === 0) break;
			ready.sort((a, b) => slackOf(a) - slackOf(b) || lftOf(a) - lftOf(b) || a.localeCompare(b));
			const readyTimeOf = (id) => {
				let rt = 0;
				for (const p of preds.get(id)) rt = Math.max(rt, finish.get(p) ?? 0);
				return rt;
			};
			const id = ready[0];
			const rt = readyTimeOf(id);
			let startTime;
			if (busy.length < wip) {
				startTime = rt;
				busy.push(0);
				busy[busy.length - 1] = rt + durOf(id);
			} else {
				let minIdx = 0;
				for (let i = 1; i < busy.length; i++) if (busy[i] < busy[minIdx]) minIdx = i;
				startTime = Math.max(rt, busy[minIdx]);
				busy[minIdx] = startTime + durOf(id);
			}
			start.set(id, startTime);
			finish.set(id, startTime + durOf(id));
			scheduled.add(id);
			dispatchOrder.push(id);
		}
		let makespan = 0;
		const scheduledOut = [];
		for (const id of dispatchOrder) {
			const f = finish.get(id) ?? 0;
			if (f > makespan) makespan = f;
			scheduledOut.push({
				id,
				start: start.get(id) ?? 0,
				finish: f
			});
		}
		return {
			makespan,
			dispatch_order: dispatchOrder,
			unlimited_makespan: cp.makespan ?? makespan,
			wip,
			weight_source: cp.weight_source,
			scheduled: scheduledOut,
			source: "rcpsp-list-scheduling"
		};
	}
	//#endregion
	//#region src/estimate/sle.ts
	function parseTs(v) {
		if (typeof v !== "string" || !ISO_UTC_RE.test(v)) return null;
		const ms = Date.parse(v);
		return Number.isFinite(ms) ? ms : null;
	}
	function cycleTimeSle(records) {
		const cts = records.map((r) => r.actualHours).filter((x) => x != null && x > 0);
		const arr = Float64Array.from(cts);
		arr.sort();
		const n = arr.length;
		const confidence = n >= 10 ? "high" : n >= 4 ? "medium" : "low";
		return {
			p50: empiricalQuantile(arr, .5),
			p85: empiricalQuantile(arr, .85),
			p95: empiricalQuantile(arr, .95),
			history_n: n,
			confidence
		};
	}
	function wipAging(board, sle, nowMs) {
		const tasks = Array.isArray(board.tasks) ? board.tasks : [];
		const out = [];
		const hasP85 = Number.isFinite(sle.p85);
		const hasP95 = Number.isFinite(sle.p95);
		for (const t of tasks) {
			if (t.status !== "in_flight") continue;
			const s = parseTs(t.started_at);
			if (s == null) continue;
			const age = (nowMs - s) / 36e5;
			if (age <= 0) continue;
			let status = "ok";
			if (hasP95 && age > sle.p95) status = "critical";
			else if (hasP85 && age > sle.p85) status = "at_risk";
			out.push({
				id: typeof t.id === "string" ? t.id : "",
				age_hours: Math.round(age * 100) / 100,
				status,
				sle_p85: hasP85 ? Math.round(sle.p85 * 100) / 100 : NaN,
				sle_p95: hasP95 ? Math.round(sle.p95 * 100) / 100 : NaN
			});
		}
		const rank = {
			critical: 0,
			at_risk: 1,
			ok: 2
		};
		out.sort((a, b) => rank[a.status] - rank[b.status] || b.age_hours - a.age_hours);
		return out;
	}
	//#endregion
	//#region src/statusline/capture.ts
	function nowEpoch(env) {
		const o = env.CC_MASTER_NOW;
		if (o) {
			const t = Date.parse(o.replace("Z", "+00:00"));
			if (!Number.isNaN(t)) return Math.floor(t / 1e3);
		}
		return Math.floor(Date.now() / 1e3);
	}
	function pickWindow(w) {
		if (!w || typeof w !== "object") return null;
		const o = w;
		if (typeof o.used_percentage !== "number" || !Number.isFinite(o.used_percentage)) return null;
		const out = { used_percentage: o.used_percentage };
		if (typeof o.resets_at === "number" && Number.isFinite(o.resets_at)) out.resets_at = o.resets_at;
		return out;
	}
	function writeAtomic(file, data) {
		const dir = node_path.dirname(file);
		try {
			node_fs.mkdirSync(dir, { recursive: true });
		} catch {}
		const tmp = node_path.join(dir, `.rate-${process.pid}-${Math.random().toString(36).slice(2)}.tmp`);
		node_fs.writeFileSync(tmp, data);
		node_fs.renameSync(tmp, file);
	}
	function captureRateLimits(input, env) {
		const e = env || process.env;
		const file = resolveRateCachePath(e);
		try {
			const obj = input && typeof input === "object" ? input : null;
			const rl = obj && obj.rate_limits && typeof obj.rate_limits === "object" ? obj.rate_limits : null;
			if (!rl) return {
				captured: false,
				path: file
			};
			const fh = pickWindow(rl.five_hour);
			const sd = pickWindow(rl.seven_day);
			if (!fh && !sd) return {
				captured: false,
				path: file
			};
			const payload = { captured_at: nowEpoch(e) };
			if (fh) payload.five_hour = fh;
			if (sd) payload.seven_day = sd;
			writeAtomic(file, JSON.stringify(payload));
			return {
				captured: true,
				path: file
			};
		} catch {
			return {
				captured: false,
				path: file
			};
		}
	}
	//#endregion
	//#region src/statusline/install.ts
	function settingsPath(env) {
		return node_path.join(resolveClaudeConfigDir(env), "settings.json");
	}
	function statePath(env) {
		return node_path.join(resolveClaudeConfigDir(env), ".cc-master-statusline-state.json");
	}
	function installedMarkerPath(env) {
		return node_path.join(resolveClaudeConfigDir(env), ".cc-master-statusline-installed");
	}
	function optoutMarkerPath(env) {
		return node_path.join(resolveClaudeConfigDir(env), ".cc-master-statusline-optout");
	}
	function readJsonObject(file) {
		let raw;
		try {
			raw = node_fs.readFileSync(file, "utf8");
		} catch {
			return {
				obj: {},
				existed: false,
				ok: true
			};
		}
		try {
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return {
				obj: parsed,
				existed: true,
				ok: true
			};
			return {
				obj: {},
				existed: true,
				ok: false
			};
		} catch {
			return {
				obj: {},
				existed: true,
				ok: false
			};
		}
	}
	function writeJsonAtomic(file, obj) {
		const dir = node_path.dirname(file);
		try {
			node_fs.mkdirSync(dir, { recursive: true });
		} catch {}
		const tmp = node_path.join(dir, `.cc-sl-${process.pid}-${Math.random().toString(36).slice(2)}.tmp`);
		node_fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`);
		node_fs.renameSync(tmp, file);
	}
	function fileExists(file) {
		try {
			node_fs.accessSync(file);
			return true;
		} catch {
			return false;
		}
	}
	function removeFileQuiet(file) {
		try {
			node_fs.unlinkSync(file);
		} catch {}
	}
	function readState(env) {
		const r = readJsonObject(statePath(env));
		if (!r.existed || !r.ok) return null;
		const o = r.obj;
		if (o.managed !== true) return null;
		return {
			managed: true,
			backup: "backup" in o ? o.backup : null,
			command: typeof o.command === "string" ? o.command : "",
			installed_at: typeof o.installed_at === "string" ? o.installed_at : ""
		};
	}
	function nowIso(env) {
		const o = env.CC_MASTER_NOW;
		if (o) {
			const t = Date.parse(o.replace("Z", "+00:00"));
			if (!Number.isNaN(t)) return new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
		}
		return (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
	}
	function installStatusline(env, command) {
		const sFile = settingsPath(env);
		const read = readJsonObject(sFile);
		if (read.existed && !read.ok) return {
			action: "error",
			reason: "settings-unparseable",
			settingsPath: sFile
		};
		const settings = read.obj;
		const prevState = readState(env);
		let backup;
		let backedUp = false;
		let action;
		if (prevState && prevState.managed) {
			backup = prevState.backup;
			action = prevState.command === command ? "noop" : "updated";
		} else {
			backup = "statusLine" in settings ? settings.statusLine : null;
			backedUp = backup != null;
			action = "installed";
		}
		settings.statusLine = {
			type: "command",
			command
		};
		writeJsonAtomic(sFile, settings);
		writeJsonAtomic(statePath(env), {
			managed: true,
			backup: backup ?? null,
			command,
			installed_at: nowIso(env)
		});
		try {
			node_fs.writeFileSync(installedMarkerPath(env), `${nowIso(env)}\n`);
		} catch {}
		removeFileQuiet(optoutMarkerPath(env));
		return {
			action,
			settingsPath: sFile,
			backedUp,
			command
		};
	}
	function uninstallStatusline(env) {
		const sFile = settingsPath(env);
		const read = readJsonObject(sFile);
		if (read.existed && !read.ok) {
			writeOptOut(env);
			removeFileQuiet(installedMarkerPath(env));
			return {
				action: "error",
				reason: "settings-unparseable",
				settingsPath: sFile
			};
		}
		const settings = read.obj;
		const state = readState(env);
		let action;
		if (state && state.managed) {
			if (state.backup != null) {
				settings.statusLine = state.backup;
				action = "restored";
			} else {
				delete settings.statusLine;
				action = "removed";
			}
			writeJsonAtomic(sFile, settings);
			removeFileQuiet(statePath(env));
		} else action = "noop";
		writeOptOut(env);
		removeFileQuiet(installedMarkerPath(env));
		return {
			action,
			settingsPath: sFile
		};
	}
	function writeOptOut(env) {
		try {
			node_fs.writeFileSync(optoutMarkerPath(env), `${nowIso(env)}\n`);
		} catch {}
	}
	function killSwitch(env) {
		const v = env.CC_MASTER_NO_AUTOINSTALL;
		return v !== void 0 && v !== "" && v !== "0";
	}
	const DEV_WALKUP_MARKERS = [
		".git",
		"pnpm-workspace.yaml",
		"turbo.json"
	];
	function hasMarker(dir, name) {
		try {
			node_fs.accessSync(node_path.join(dir, name));
			return true;
		} catch {
			return false;
		}
	}
	function looksLikeDevInvocation(binPath) {
		if (!binPath) return false;
		try {
			if (binPath.replace(/\\/g, "/").includes("/worktrees/")) return true;
			let dir = node_path.dirname(binPath);
			for (let i = 0; i < 40; i++) {
				for (const m of DEV_WALKUP_MARKERS) if (hasMarker(dir, m)) return true;
				const parent = node_path.dirname(dir);
				if (parent === dir) break;
				dir = parent;
			}
			return false;
		} catch {
			return false;
		}
	}
	function autoInstallStatuslineOnce(env, command, binPath) {
		const sFile = settingsPath(env);
		try {
			if (killSwitch(env)) return {
				action: "skipped",
				reason: "kill-switch",
				settingsPath: sFile
			};
			if (looksLikeDevInvocation(binPath)) return {
				action: "skipped",
				reason: "dev-invocation",
				settingsPath: sFile
			};
			if (fileExists(optoutMarkerPath(env))) return {
				action: "skipped",
				reason: "opt-out",
				settingsPath: sFile
			};
			if (fileExists(installedMarkerPath(env))) return {
				action: "skipped",
				reason: "already-installed",
				settingsPath: sFile
			};
			const st = readState(env);
			if (st && st.managed) {
				try {
					node_fs.writeFileSync(installedMarkerPath(env), `${nowIso(env)}\n`);
				} catch {}
				return {
					action: "skipped",
					reason: "already-managed",
					settingsPath: sFile
				};
			}
			return installStatusline(env, command);
		} catch {
			return {
				action: "skipped",
				reason: "error",
				settingsPath: sFile
			};
		}
	}
	//#endregion
	//#region src/statusline/render.ts
	const ANSI = {
		reset: "\x1B[0m",
		green: "\x1B[32m",
		yellow: "\x1B[33m",
		red: "\x1B[31m",
		gray: "\x1B[90m",
		dim: "\x1B[2m"
	};
	function bandFor(kind, pct) {
		let lo;
		let hi;
		if (kind === "ctx") {
			lo = 60;
			hi = 85;
		} else if (kind === "5h") {
			lo = 70;
			hi = 90;
		} else {
			lo = 70;
			hi = 85;
		}
		if (pct < lo) return "green";
		if (pct <= hi) return "yellow";
		return "red";
	}
	function colorOf(band) {
		return band === "green" ? ANSI.green : band === "yellow" ? ANSI.yellow : ANSI.red;
	}
	function paint(s, code, enabled) {
		return enabled ? `${code}${s}${ANSI.reset}` : s;
	}
	function pctField(obj, key) {
		if (!obj || typeof obj !== "object") return null;
		const v = obj[key];
		if (typeof v !== "number" || !Number.isFinite(v)) return null;
		if (v < 0) return null;
		return v > 100 ? 100 : v;
	}
	function progressBar(pct, enabled, band) {
		const filledN = Math.max(0, Math.min(10, Math.round(pct / 10)));
		const filled = "█".repeat(filledN);
		const empty = "░".repeat(10 - filledN);
		return `${paint(filled, colorOf(band), enabled)}${paint(empty, ANSI.gray, enabled)}`;
	}
	function shortModel(input) {
		const model = input.model;
		if (!model || typeof model !== "object") return "";
		const name = model.display_name;
		if (typeof name !== "string" || !name.trim()) return "";
		return name.replace(/^Claude\s+/i, "").trim();
	}
	function renderStatusline(input, opts = {}) {
		const enabled = opts.color !== false;
		const obj = input && typeof input === "object" ? input : {};
		const segments = [];
		const model = shortModel(obj);
		if (model) segments.push(paint(model, ANSI.dim, enabled));
		const ctxPct = pctField(obj.context_window, "used_percentage");
		if (ctxPct !== null) {
			const band = bandFor("ctx", ctxPct);
			const bar = progressBar(ctxPct, enabled, band);
			const num = paint(`${Math.round(ctxPct)}%`, colorOf(band), enabled);
			segments.push(`ctx ${bar} ${num}`);
		}
		const rl = obj.rate_limits;
		const rlObj = rl && typeof rl === "object" ? rl : null;
		if (rlObj) {
			const fh = pctField(rlObj.five_hour, "used_percentage");
			if (fh !== null) {
				const band = bandFor("5h", fh);
				segments.push(`5h ${paint(`${Math.round(fh)}%`, colorOf(band), enabled)}`);
			}
			const sd = pctField(rlObj.seven_day, "used_percentage");
			if (sd !== null) {
				const band = bandFor("7d", sd);
				segments.push(`7d ${paint(`${Math.round(sd)}%`, colorOf(band), enabled)}`);
			}
		}
		return segments.join("   ");
	}
	//#endregion
	//#region src/usage/pacing.ts
	const DEFAULTS = {
		corridorHigh: 90,
		sevenDayHardStop: 85,
		warnLine: 80
	};
	function pctOf(w, nowSec) {
		if (!w || typeof w.used_percentage !== "number") return null;
		if (typeof w.resets_at === "number" && w.resets_at < nowSec) return null;
		return w.used_percentage;
	}
	function nearestFutureReset(candidates, nowSec) {
		let best = null;
		for (const c of candidates) if (typeof c === "number" && Number.isFinite(c) && c > nowSec) {
			if (best === null || c < best) best = c;
		}
		return best;
	}
	function isoToSec(iso) {
		if (typeof iso !== "string" || !iso) return null;
		const ms = Date.parse(iso);
		return Number.isFinite(ms) ? Math.floor(ms / 1e3) : null;
	}
	const DEGRADED = {
		verdict: "hold",
		reason: "账户权威信号不可用（5h/7d used% 均缺/过期）——降级，pacing 不可判",
		levers: [],
		strength: "weak",
		window_5h_pct: null,
		window_7d_pct: null,
		effective_n: 1,
		switch_candidate: null,
		stop_dimension: null,
		nearest_reset: null,
		available: false,
		confidence: "low"
	};
	function pacingAdvice(signal, opts = {}) {
		const o = {
			...DEFAULTS,
			...opts
		};
		const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1e3);
		const nowIso = opts.nowIso ?? (/* @__PURE__ */ new Date(nowSec * 1e3)).toISOString().replace(/\.\d{3}Z$/, "Z");
		const n = Number.isInteger(o.effectiveN) && o.effectiveN >= 1 ? o.effectiveN : 1;
		const p5 = pctOf(signal?.five_hour, nowSec);
		const p7 = pctOf(signal?.seven_day, nowSec);
		if (p5 === null && p7 === null) return {
			...DEGRADED,
			effective_n: n
		};
		const registry = opts.registry ?? null;
		const live = {
			fiveHourPct: signal?.five_hour?.used_percentage ?? null,
			sevenDayPct: signal?.seven_day?.used_percentage ?? null,
			fiveHourResetsAt: null,
			sevenDayResetsAt: null
		};
		const preds = registry ? predictPoolUsage(registry, {
			now: nowIso,
			live
		}) : [];
		const sel = registry ? selectAccount(registry, nowIso) : {
			selected: null,
			reason: "NONE_EMPTY_REGISTRY",
			candidates: [],
			warnings: []
		};
		const candidate = sel.reason === "SELECTED" ? sel.selected : null;
		const poolExhausted = sel.reason === "NONE_ALL_EXHAUSTED";
		const best = candidate ? sel.candidates.find((c) => c.email === candidate) : void 0;
		const bestUsed = best && (best.p5 !== null || best.p7 !== null) ? Math.max(best.p5 ?? 0, best.p7 ?? 0) : candidate ? 0 : null;
		const healthyEscape = candidate !== null && bestUsed !== null && bestUsed < o.warnLine;
		const pool5hResets = [signal?.five_hour?.resets_at, ...preds.map((p) => isoToSec(p.fiveHour.resetsAt))];
		const pool7dResets = [signal?.seven_day?.resets_at, ...preds.map((p) => isoToSec(p.sevenDay.resetsAt))];
		const echo = {
			window_5h_pct: p5,
			window_7d_pct: p7,
			effective_n: n,
			available: true
		};
		const active7dCrit = p7 !== null && p7 >= o.sevenDayHardStop;
		const active5hCrit = p5 !== null && p5 >= o.corridorHigh;
		if (active7dCrit) {
			if (candidate && !poolExhausted) return {
				...echo,
				verdict: "switch",
				reason: `active 号 7d 已用 ${p7}%（≥${o.sevenDayHardStop}%·逼顶）但池中有可切入备号 ${candidate}（7d 有余量）——换到下一份配额，非减速（7d 单号逼顶 → switch·全池才停）`,
				levers: ["switch_account"],
				strength: "strong",
				switch_candidate: candidate,
				stop_dimension: null,
				nearest_reset: null,
				confidence: "high"
			};
			return {
				...echo,
				verdict: "stop_7d",
				reason: `active 号 7d 已用 ${p7}%（≥${o.sevenDayHardStop}%）且全池 7d 都撞墙 / 无可切入备号——跨窗口不可逆消耗边界，暂停 dispatch、把「是否续耗 7d」作 blocked_on:user surface 给用户；arm wakeup 到最近 7d reset`,
				levers: [
					"pause_dispatch",
					"surface_user",
					"arm_wakeup"
				],
				strength: "strong",
				switch_candidate: null,
				stop_dimension: "7d",
				nearest_reset: nearestFutureReset(pool7dResets, nowSec),
				confidence: "high"
			};
		}
		if (active5hCrit) {
			if (healthyEscape && !poolExhausted) return {
				...echo,
				verdict: "switch",
				reason: `active 号 5h 已用 ${p5}%（≥${o.corridorHigh}%）且池中有满血可切入备号 ${candidate}——当前 5h 烧满是切到下一份配额的触发信号，不是减速信号`,
				levers: ["switch_account"],
				strength: "weak",
				switch_candidate: candidate,
				stop_dimension: null,
				nearest_reset: null,
				confidence: "high"
			};
			if (candidate && !poolExhausted) return {
				...echo,
				verdict: "throttle",
				reason: `active 号 5h 已用 ${p5}%（≥${o.corridorHigh}%）且池中备号也接近警告线（换号收益有限）——减速避免烧穿`,
				levers: [
					"downgrade_model",
					"reduce_parallelism",
					"defer_high_float"
				],
				strength: "weak",
				switch_candidate: candidate,
				stop_dimension: null,
				nearest_reset: null,
				confidence: "high"
			};
			return {
				...echo,
				verdict: "stop_5h",
				reason: `active 号 5h 已用 ${p5}%（≥${o.corridorHigh}%）且全池 5h 撞墙 / 无可切入备号——短停，arm wakeup 到最近 5h reset（窗口刷新即可续）`,
				levers: ["pause_dispatch", "arm_wakeup"],
				strength: "strong",
				switch_candidate: null,
				stop_dimension: "5h",
				nearest_reset: nearestFutureReset(pool5hResets, nowSec),
				confidence: "high"
			};
		}
		if ((p5 !== null && p5 >= o.warnLine || p7 !== null && p7 >= o.warnLine) && !healthyEscape) {
			const sevenDriven = p7 !== null && p7 >= o.warnLine;
			return {
				...echo,
				verdict: "throttle",
				reason: sevenDriven ? `7d 已用 ${p7}%（≥${o.warnLine}% 警告线）且无健康可切入备号——减速（7d 跨窗口·strong）` : `5h 已用 ${p5}%（≥${o.warnLine}% 警告线）且无健康可切入备号——减速（5h·weak）`,
				levers: [
					"downgrade_model",
					"reduce_parallelism",
					"defer_high_float"
				],
				strength: sevenDriven ? "strong" : "weak",
				switch_candidate: null,
				stop_dimension: null,
				nearest_reset: null,
				confidence: "high"
			};
		}
		return {
			...echo,
			verdict: "hold",
			reason: p5 !== null ? `5h 用量 ${p5}% 在警告线内（<${o.warnLine}%）或有健康可切入备号——保持当前节奏` : "仅 7d 信号可用且有余量——保持当前节奏",
			levers: [],
			strength: "weak",
			switch_candidate: candidate,
			stop_dimension: null,
			nearest_reset: null,
			confidence: p5 !== null ? "high" : "medium"
		};
	}
	function tokenExpired(v, nowMs) {
		const exp = parseExp(v);
		return exp !== null && exp < nowMs;
	}
	function effectiveN(accounts, nowMs) {
		if (!accounts || typeof accounts !== "object") return {
			backups: 0,
			switchable: 0,
			effective_n: 1
		};
		let backups = 0;
		let switchable = 0;
		for (const entry of Object.values(accounts)) {
			if (!entry || typeof entry !== "object") continue;
			if (entry.active === true) continue;
			backups += 1;
			if (entry.switchable === false) continue;
			if (tokenExpired(entry.token_expires_at, nowMs)) continue;
			switchable += 1;
		}
		return {
			backups,
			switchable,
			effective_n: switchable + 1
		};
	}
	function parseExp(v) {
		if (typeof v === "number") return Number.isFinite(v) ? v : null;
		if (typeof v === "string" && v) {
			const ms = Date.parse(v);
			return Number.isFinite(ms) ? ms : null;
		}
		return null;
	}
	//#endregion
	//#region src/usage/solvency.ts
	const WINDOW_5H_SEC = 5 * 3600;
	const WINDOW_7D_SEC = 168 * 3600;
	function pctBurnRate(samples, opts = {}) {
		const valid = (Array.isArray(samples) ? samples : []).filter((s) => !!s && typeof s.atSec === "number" && Number.isFinite(s.atSec) && typeof s.usedPct === "number" && Number.isFinite(s.usedPct)).slice().sort((a, b) => a.atSec - b.atSec);
		for (let i = valid.length - 1; i >= 1; i--) {
			const cur = valid[i];
			const prev = valid[i - 1];
			const dt = cur.atSec - prev.atSec;
			const dp = cur.usedPct - prev.usedPct;
			if (dt > 0 && dp >= 0) return {
				burn_pct_per_hour: round4(dp / (dt / 3600)),
				method: "finite-diff",
				samples_used: valid.length,
				confidence: valid.length >= 3 ? "high" : "medium"
			};
		}
		const latest = valid.length > 0 ? valid[valid.length - 1] : null;
		const wStart = opts.windowStartSec;
		if (latest && typeof wStart === "number" && Number.isFinite(wStart) && latest.atSec > wStart) {
			const elapsedH = (latest.atSec - wStart) / 3600;
			if (elapsedH > 0) return {
				burn_pct_per_hour: round4(latest.usedPct / elapsedH),
				method: "window-elapsed",
				samples_used: valid.length,
				confidence: "low"
			};
		}
		return {
			burn_pct_per_hour: null,
			method: "none",
			samples_used: valid.length,
			confidence: "low"
		};
	}
	function pctRunway(opts) {
		const ceiling = typeof opts.ceilingPct === "number" ? opts.ceilingPct : 90;
		const used = opts.usedPct;
		const burn = opts.burnPctPerHour;
		const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1e3);
		const remaining = typeof used === "number" && Number.isFinite(used) ? Math.max(0, round2(ceiling - used)) : null;
		let hoursToReset = null;
		if (typeof opts.resetsAtSec === "number" && Number.isFinite(opts.resetsAtSec)) {
			const dh = (opts.resetsAtSec - nowSec) / 3600;
			hoursToReset = dh > 0 ? round2(dh) : 0;
		}
		const burnValid = typeof burn === "number" && Number.isFinite(burn);
		let hoursToCeiling = null;
		if (remaining != null && burnValid && burn > 0) hoursToCeiling = round2(remaining / burn);
		let verdict = "unknown";
		if (remaining != null && remaining === 0) verdict = "will-exhaust-before-reset";
		else if (hoursToCeiling != null && hoursToReset != null) verdict = hoursToCeiling < hoursToReset ? "will-exhaust-before-reset" : "ample";
		else if (remaining != null && remaining > 0 && burnValid && burn <= 0) verdict = "ample";
		return {
			remaining_corridor_pct: remaining,
			hours_to_ceiling: hoursToCeiling,
			hours_to_reset: hoursToReset,
			verdict,
			ceiling_pct: ceiling,
			burn_pct_per_hour: burnValid ? burn : null
		};
	}
	function tokenWeightedShares(weights, total) {
		const w = (Array.isArray(weights) ? weights : []).map((x) => Number.isFinite(x) && x > 0 ? x : 0);
		const n = w.length;
		if (n === 0) return [];
		const sum = w.reduce((a, b) => a + b, 0);
		if (!(sum > 0)) return w.map(() => total / n);
		return w.map((x) => total * x / sum);
	}
	function round2(x) {
		return Number.isFinite(x) ? Math.round(x * 100) / 100 : x;
	}
	function round4(x) {
		return Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : x;
	}
	//#endregion
	exports.DEFAULT_MAX_BOARDS = DEFAULT_MAX_BOARDS;
	exports.DEFAULT_MAX_DAYS_AGO = DEFAULT_MAX_DAYS_AGO;
	exports.ENUMS = ENUMS;
	exports.FIELDS = FIELDS;
	exports.INVARIANTS = INVARIANTS;
	exports.ISO_UTC_RE = ISO_UTC_RE;
	exports.OPEN_ENUMS = OPEN_ENUMS;
	exports.PEER_FRESHNESS_SEC = PEER_FRESHNESS_SEC;
	exports.SCHEMA_VERSION = SCHEMA_VERSION;
	exports.STATUS_ENUM = STATUS_ENUM;
	exports.STATUS_MACHINE = STATUS_MACHINE;
	exports.Sfc32 = Sfc32;
	exports.TIERS = TIERS;
	exports.WINDOW_5H_SEC = WINDOW_5H_SEC;
	exports.WINDOW_7D_SEC = WINDOW_7D_SEC;
	exports.acceptanceConverged = acceptanceConverged;
	Object.defineProperty(exports, "account", {
		enumerable: true,
		get: function() {
			return account_exports;
		}
	});
	exports.acquire = acquire;
	exports.analyzeGraph = analyzeGraph;
	exports.autoInstallStatuslineOnce = autoInstallStatuslineOnce;
	exports.boardRepo = boardRepo;
	exports.buildGraph = buildGraph;
	exports.buildPeerRoster = buildPeerRoster;
	exports.calibrate = calibrate;
	exports.calibratedEstimate = calibratedEstimate;
	exports.captureRateLimits = captureRateLimits;
	exports.computeEvm = computeEvm;
	exports.conformalGroupKey = conformalGroupKey;
	exports.conformalInterval = conformalInterval;
	exports.cycleTimeSle = cycleTimeSle;
	exports.dailyThroughput = dailyThroughput;
	exports.dispersionCv = dispersionCv;
	exports.dualChannelConsistency = dualChannelConsistency;
	exports.durationHours = durationHours;
	exports.effectiveN = effectiveN;
	exports.empiricalCoverage = empiricalCoverage;
	exports.empiricalQuantile = empiricalQuantile;
	exports.estimateDagMonteCarlo = estimateDagMonteCarlo;
	exports.estimateHours = estimateHours;
	exports.extractDoneRecords = extractDoneRecords;
	exports.feverStatus = feverStatus;
	exports.findCycle = findCycle;
	exports.formatReport = formatReport;
	exports.installStatusline = installStatusline;
	exports.invariant = invariant;
	exports.isAbsolutePathOrUrl = isAbsolutePathOrUrl;
	exports.isActiveStatus = isActiveStatus;
	exports.isAwaitingUser = isAwaitingUser;
	exports.isDoneStatus = isDoneStatus;
	exports.isEnumMember = isEnumMember;
	exports.isISOUTC = isISOUTC;
	exports.isLegalTransition = isLegalTransition;
	exports.isLocked = isLocked;
	exports.knnPredict = knnPredict;
	exports.levelOf = levelOf;
	exports.lintBoard = lintBoard;
	exports.loadCorpus = loadCorpus;
	exports.loadHomeBoards = loadHomeBoards;
	exports.lockPathFor = lockPathFor;
	exports.logNormalParamsFromMeanCv = logNormalParamsFromMeanCv;
	exports.looksLikeDevInvocation = looksLikeDevInvocation;
	exports.makePrng = makePrng;
	exports.nodeDuration = nodeDuration;
	exports.pacingAdvice = pacingAdvice;
	exports.pctBurnRate = pctBurnRate;
	exports.pctCostToCompleteMonteCarlo = pctCostToCompleteMonteCarlo;
	exports.pctOf = pctOf;
	exports.pctRunway = pctRunway;
	exports.poolLayers = poolLayers;
	exports.quantilesOf = quantilesOf;
	exports.rcpspSchedule = rcpspSchedule;
	exports.recencyWeight = recencyWeight;
	exports.reconcileGating = reconcileGating;
	exports.release = release;
	exports.renderStatusline = renderStatusline;
	exports.resolveCcMasterHome = resolveCcMasterHome;
	exports.resolveClaudeCodeConfigDir = resolveClaudeCodeConfigDir;
	exports.resolveClaudeConfigDir = resolveClaudeConfigDir;
	exports.resolveClaudeJsonPath = resolveClaudeJsonPath;
	exports.resolveCredentialsPath = resolveCredentialsPath;
	exports.resolveHostConfigDir = resolveHostConfigDir;
	exports.resolveProjectsDir = resolveProjectsDir;
	exports.resolveRateCachePath = resolveRateCachePath;
	exports.sampleLogNormalFromLogParams = sampleLogNormalFromLogParams;
	exports.sampleNormal = sampleNormal;
	exports.sampleTaskDuration = sampleTaskDuration;
	exports.selectPoolLayer = selectPoolLayer;
	exports.sizeProjectBuffer = sizeProjectBuffer;
	exports.statuslineSettingsPath = settingsPath;
	exports.taskTrulyDone = taskTrulyDone;
	exports.throughputMonteCarlo = throughputMonteCarlo;
	exports.tokenExpired = tokenExpired;
	exports.tokenWeightedShares = tokenWeightedShares;
	exports.uninstallStatusline = uninstallStatusline;
	exports.weaklyConnectedComponents = weaklyConnectedComponents;
	exports.wipAging = wipAging;
	exports.withLock = withLock;
	return exports;
})({}, __ccm_node_fs, __ccm_node_path, __ccm_node_os, __ccm_node_http, __ccm_node_https, __ccm_node_child_process, __ccm_node_crypto);
