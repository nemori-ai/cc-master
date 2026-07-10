# ccm CLI Host-Coupling Audit

更新时间：2026-07-10。

本盘点覆盖 `ccm/apps/cli/src` 与 `ccm/packages/engine/src` 中当前绑定 Claude Code harness 或 Claude 账号机制的源码点。目标是给后续 `ccm host <host>` backend 拆分提供任务边界。

## 分类标准

| 类别 | 含义 | 后续处理 |
| --- | --- | --- |
| `portable-core` | board / DAG / lint / estimate 等 cc-master 自有领域逻辑 | 保持 host-neutral |
| `host-config-path` | 使用 Claude Code 配置目录 / home / session env 推导路径 | 抽成 host config backend |
| `host-quota-signal` | 从 Claude Code status line stdin/sidecar 获取 5h/7d 配额 | 抽成 quota signal provider |
| `host-credential` | 读写 Claude OAuth / keychain / `.credentials.json` / `.claude.json` | 抽成 credential/account backend |
| `host-plugin-manager` | shell out 到 `claude plugin ...` | 抽成 plugin manager backend |
| `host-model-fact` | fixtures/docs 中的 Claude model IDs | 抽成 model-tier provider 或 fixture metadata |

## 总览

| Area | Coupling | Files | Notes |
| --- | --- | --- | --- |
| Home / config paths | High | `ccm/packages/engine/src/paths.ts`, `ccm/apps/cli/src/discover.ts` | 默认 home 从 `CLAUDE_CONFIG_DIR` / `$HOME/.claude` 推导；session id 读 `$CLAUDE_CODE_SESSION_ID` |
| Status line install/render/capture | High | `ccm/packages/engine/src/statusline/*`, `ccm/apps/cli/src/handlers/statusline.ts`, `ccm/apps/cli/src/router.ts`, `ccm/apps/cli/src/self.ts` | 写 Claude Code `settings.json.statusLine`；读 Claude Code status-line stdin schema |
| Usage / pacing signal | Medium | `ccm/apps/cli/src/handlers/usage.ts`, `ccm/apps/cli/src/harnesses/*`, engine usage modules | handler 已经 `HarnessAdapter.readCurrentUsage` 读 provider；Claude 仍用 statusline sidecar，Codex/Cursor 有各自信号源 |
| Account registry / vault / switch | Very high | `ccm/apps/cli/src/handlers/account.ts`, `ccm/packages/engine/src/account/*` | 深度绑定 Claude OAuth blob、Claude Code keychain item、`.credentials.json`、`.claude.json`、Claude refresh endpoint |
| Plugin upgrade | Medium | `ccm/apps/cli/src/handlers/upgrade.ts`, `ccm/apps/cli/src/harnesses/*` | handler 已按 `HarnessAdapter.upgradePlugin` 分派；各 host 仍有独立 distribution 约束 |
| Help / registry prose | Medium | `ccm/apps/cli/src/help.ts`, `ccm/apps/cli/src/registry.ts` | 用户可见文案写死 Claude Code |
| Board engine | Low | `ccm/packages/engine/src/board-*` | 基本 portable；个别 fixtures/model 字段是 Claude model ID |

## Concrete Bindings

### 1. Home / Config / Session Discovery

Files:

- `ccm/packages/engine/src/paths.ts`
- `ccm/apps/cli/src/discover.ts`
- `ccm/apps/cli/src/router.ts`
- `ccm/apps/cli/src/help.ts`

Current behavior:

- `resolveClaudeConfigDir(env)` returns `$CLAUDE_CONFIG_DIR` or `$HOME/.claude`.
- `resolveCcMasterHome(env)` returns `$CC_MASTER_HOME` or `$HOME/.cc_master`; this is harness-neutral and no longer follows `CLAUDE_CONFIG_DIR`.
- `resolveRateCachePath(env)` returns `$CC_MASTER_RATE_CACHE` or `<cc-master-home>/.cc-master-rate-limits.json`.
- `resolveCredentialsPath(env)` returns `$CRED_PATH` or `<claudeConfigDir>/.credentials.json`.
- `resolveClaudeJsonPath(env)` uses `$CLAUDE_JSON_PATH`, `<claudeConfigDir>/.claude.json`, then `$HOME/.claude.json`.
- CLI context sid defaults to `$CLAUDE_CODE_SESSION_ID`.
- Some comments still mention older `$CLAUDE_PROJECT_DIR` behavior, though tests assert it no longer participates in home discovery.

Required abstraction:

```ts
interface HostConfigBackend {
  host: 'claude-code' | 'codex';
  configDir(env: Env): string;
  ccMasterHome(env: Env): string;
  sessionId(env: Env): string;
  rateCachePath(env: Env): string | null;
  credentialsPath(env: Env): string | null;
  identityPath(env: Env): string | null;
}
```

Codex open questions:

- Whether Codex exposes a stable session id env.
- Whether Codex has a status/quota sidecar equivalent.

### 2. Status Line

Files:

- `ccm/packages/engine/src/statusline/render.ts`
- `ccm/packages/engine/src/statusline/capture.ts`
- `ccm/packages/engine/src/statusline/install.ts`
- `ccm/apps/cli/src/handlers/statusline.ts`
- `ccm/apps/cli/src/router.ts`
- `ccm/apps/cli/src/self.ts`

Current behavior:

- `ccm statusline` expects Claude Code status-line stdin:
  - `context_window.used_percentage`
  - `rate_limits.five_hour.used_percentage`
  - `rate_limits.five_hour.resets_at`
  - `rate_limits.seven_day.used_percentage`
  - `rate_limits.seven_day.resets_at`
- `installStatusline` writes `<claudeConfigDir>/settings.json` `statusLine.command`.
- `autoInstall` runs on every non-statusline `ccm` invocation unless disabled.
- `resolveSelfCommand()` deliberately writes an absolute command because `${CLAUDE_PLUGIN_ROOT}` is not expanded in statusLine.command.

Required abstraction:

```ts
interface StatusSignalProvider {
  available(env: Env): boolean;
  install?(env: Env, command: string): InstallResult;
  uninstall?(env: Env): InstallResult;
  parseStdin?(json: unknown): QuotaSignal | null;
  render?(json: unknown): string;
}
```

Codex implication:

- Until Codex has a verified status-line equivalent, `statusline` should be a Claude Code-only noun or return an explicit unsupported result under Codex host mode.

### 3. Usage / Pacing

Files:

- `ccm/apps/cli/src/handlers/usage.ts`
- `ccm/packages/engine/src/statusline/capture.ts`
- usage / pacing exports in `ccm/packages/engine/src/index.ts`

Current behavior:

- `ccm usage show/advise` resolves the active `HarnessAdapter` and calls `readCurrentUsage(env)`.
- Claude Code reads the statusline sidecar; Codex reads its app-server signal; Cursor reads dashboard
  `GetCurrentPeriodUsage` and maps it to `billing_period`.
- Provider failure means `available:false`; no provider may invent quota precision.
- Registry effective-N remains Claude account-pool data from `accounts.json`; unsupported hosts do not
  acquire an account pool merely because they have a current-account usage signal.

Current boundary:

- `usage` consumes the host adapter's quota provider.
- Account-pool scaling should be optional and host backend gated.
- Codex should not inherit Claude 5h/7d semantics without provider proof.

### 4. Account / Credential / Switch

Files:

- `ccm/apps/cli/src/handlers/account.ts`
- `ccm/packages/engine/src/account/vault.ts`
- `ccm/packages/engine/src/account/refresh.ts`
- `ccm/packages/engine/src/account/switch.ts`
- `ccm/packages/engine/src/account/registry.ts`
- `ccm/packages/engine/src/account/select.ts`

Current behavior:

- Account add/refresh captures the current Claude Code login blob.
- macOS main path reads keychain service `Claude Code-credentials`, account `$USER`.
- Non-mac fallback reads `<claudeConfigDir>/.credentials.json` `.claudeAiOauth`.
- Identity guard reads `.claude.json` `oauthAccount`.
- Vault stores Claude OAuth blobs with `accessToken` prefix `sk-ant-oat` and `refreshToken` prefix `sk-ant-ort`.
- Refresh endpoint defaults to `https://platform.claude.com/v1/oauth/token`; allowed hosts are Claude/Anthropic domains.
- Switch overwrites three Claude Code credential stores:
  - `.credentials.json` `.claudeAiOauth`
  - `.claude.json` `oauthAccount`
  - macOS keychain `Claude Code-credentials`
- `CLAUDE_CODE_USE_BEDROCK` / `VERTEX` / `FOUNDRY` disable subscription account switching.

Required abstraction:

```ts
interface AccountBackend {
  host: 'claude-code' | 'codex';
  canCaptureCurrentLogin(env: Env): boolean;
  captureCurrentLogin(env: Env): OAuthBlob | Unsupported;
  refresh(blob: OAuthBlob): Promise<OAuthBlob>;
  switchTo(blob: OAuthBlob, identity: unknown, env: Env): SwitchResult;
  readCurrentIdentity(env: Env): Identity | null;
}
```

Codex implication:

- No Codex account switch backend is known.
- `ccm account add/delete/refresh/list/switch` explicitly returns `NotImplemented` under Codex host mode.
- Codex support is limited to current-account usage signals for now; account-pool management remains Claude Code-only.

### 5. Plugin Upgrade

Files:

- `ccm/apps/cli/src/handlers/upgrade.ts`
- `ccm/apps/cli/src/registry.ts`

Current behavior:

- `ccm upgrade ccm` is host-neutral SEA self-upgrade.
- `ccm upgrade plugin` dispatches through `HarnessAdapter.upgradePlugin` and, without an explicit host,
  visits installed supported harnesses.
- Claude Code uses its marketplace/plugin CLI; Codex refreshes its local marketplace/plugin registry;
  Cursor copies the installed cc-master package into `~/.cursor/plugins/local/cc-master`.

Required abstraction:

```ts
interface PluginManagerBackend {
  host: 'claude-code' | 'codex';
  validateCli(): boolean;
  updateMarketplace?(): Result;
  updatePlugin(ref: string): Result;
}
```

Current implication:

- Plugin distribution remains host-specific even though dispatch is shared; each adapter must report an
  honest installed/source/target result.
- Cursor `--to` does not fetch a historical tag directly; install that package version first, then refresh
  the local plugin.

### 6. Help / Registry / User-Facing Prose

Files:

- `ccm/apps/cli/src/help.ts`
- `ccm/apps/cli/src/registry.ts`
- handler messages in `account.ts`, `usage.ts`, `statusline.ts`, `upgrade.ts`

Current behavior:

- Help says `--session-id` defaults to `$CLAUDE_CODE_SESSION_ID`.
- statusline/account/upgrade descriptions mention Claude Code directly.
- account messages instruct `claude login`, mention Orca, and describe running Claude process lazy re-read.

Required abstraction:

- Host-specific nouns should mark `host: claude-code`.
- Help renderer should show unsupported/hidden commands based on host backend.
- Messages should come from backend-specific modules rather than portable handlers.

## Proposed Task List

| ID | Priority | Scope | Deliverable |
| --- | --- | --- | --- |
| C1 | P0 | Add host backend boundary | `ccm/packages/engine/src/host/` or equivalent interfaces for config/status/account/plugin |
| C2 | P0 | Rename Claude path helpers | Keep compatibility exports, but introduce `claudeCodeConfigDir` / `hostConfigDir` naming to stop treating Claude as generic |
| C3 | P0 | Gate statusline by host | `ccm statusline` remains Claude Code backend; Codex returns unsupported until verified |
| C4 | P0 | Gate account commands by host | Done for Codex: `ccm account add/delete/refresh/list/switch` returns `NotImplemented`; current-account usage remains the only intended Codex surface |
| C5 | P1 | Split usage provider | **Done**: `usage advise/show` reads `HarnessAdapter.readCurrentUsage`, with host-specific providers |
| C6 | P1 | Split plugin upgrade backend | **Done** for Claude Code / Codex / Cursor: `upgrade plugin` dispatches by host |
| C7 | P1 | Help/registry host metadata | registry entries declare host support/unsupported reason |
| C8 | P2 | Model fixture/provider cleanup | move Claude model IDs into provider fixtures or mark examples as Claude |

## Cursor Current Coupling (IDE Agent)

调研与 probe 落盘：[`cursor.md`](cursor.md)（2026-07-09）。当前 backend 已实现于
`ccm/apps/cli/src/harnesses/cursor.ts`，不再是 expected sketch。

### Detect / Session

| Surface | Current behavior | Evidence |
| --- | --- | --- |
| `detect(env)` | 识别 `CURSOR_AGENT` / `CURSOR_VERSION` / `CURSOR_PROJECT_DIR` / `CURSOR_CONVERSATION_ID` | `cursor.ts`; D8 确认 Agent Shell 暴露 `CURSOR_*` |
| `session(env)` | 优先 `CURSOR_CONVERSATION_ID`，其次 `CURSOR_AGENT`，否则空 identity | `cursor.ts`; hook 武装仍以 stdin `conversation_id` / `session_id` 为 SSOT |
| `resolveHarnessAdapter` order | `codex → cursor → claude-code` | `harnesses/registry.ts`；Cursor 必须胜过 Claude-compatible fallback env |

### Capabilities (honest current defaults)

| Capability | Cursor (IDE Agent) | Notes |
| --- | --- | --- |
| `accountPool` | `unsupported` | 无 Claude OAuth 号池 / keychain 等价物；mutating account commands 显式 `NotImplemented` |
| `externalStatusline` | `unsupported` | IDE statusline ≠ Claude `settings.json.statusLine` schema；install/uninstall 显式 `NotImplemented` |
| `pluginDistribution` | `supported` | local `~/.cursor/plugins/local/cc-master`；`upgradePlugin` 从本机 cc-master install 刷新 local plugin |
| `readCurrentUsage` | `dashboard-api` / `billing_period` | `GetCurrentPeriodUsage` → `UsageSignal.billing_period`；无 5h/7d，API/token 不可用时诚实返回 unavailable |

### Handler behavior

- `ccm statusline install/uninstall --harness cursor` → explicit `NotImplemented`。
- `ccm account add/delete/refresh/list/switch --harness cursor` → explicit `NotImplemented`；不会读写 Claude 凭据库。
- `ccm usage advise/show --harness cursor` → 消费 Cursor dashboard 当前账期，只产生 `hold|throttle|stop_billing_period`，绝不产生 `switch` / `stop_5h` / `stop_7d`。
- `ccm upgrade plugin --harness cursor` → 已实现 local-install copy；`--to` 不直接拉取历史 tag，需先用 `install.sh` 安装指定版本。

### Home / config

- `resolveCcMasterHome` 保持 harness-neutral：`--home` > `CC_MASTER_HOME` > `$HOME/.cc_master`（已落地）。
- **不要**从 `CURSOR_PROJECT_DIR` 推导 cc-master home；board home 与 IDE workspace 根分离。

### Remaining true gaps

- 无 Cursor account pool / autoswitch backend；这是产品能力缺位，不是未接线的 TODO。
- 无 Claude-style external statusline backend；配额直接读 dashboard provider。
- Cursor marketplace 的远程指定版本更新不在当前 backend 内；当前只保证本机已安装包 → local plugin 刷新。

## Current Safe Position

For multi-harness work today:

- Treat board/DAG/lint/estimate core as portable.
- Treat statusline, Claude subscription quota capture, account switching, and plugin upgrade as Claude Code-only unless a host backend exists.
- Treat home discovery as harness-neutral: `--home > CC_MASTER_HOME > $HOME/.cc_master`.
- Treat Codex account-pool management as explicitly unsupported (`NotImplemented`); only current-account usage-style read surfaces are in scope for the first Codex pass.
- Do not enable Codex runtime adapter features that depend on these ccm surfaces until the corresponding backend exists.
- Treat Cursor account pool / external statusline as explicitly unsupported, but do **not** describe all ccm surfaces as unavailable: current-account `billing_period` usage and local-plugin upgrade have implemented Cursor backends.
