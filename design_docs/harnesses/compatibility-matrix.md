# Harness Compatibility Matrix

更新时间：2026-07-09。

本表不是 paragoge 原表的复制品。它采用 paragoge 的对比维度，但事实按 cc-master 当前资料和实测修正。

Cursor 列事实来源：[`cursor.md`](cursor.md)（2026-07-09 官方文档 + probe 3.10.20；Phase C 已落地）。

| Surface | Claude Code | Codex | Cursor (IDE Agent) | cc-master 决策 |
| --- | --- | --- | --- | --- |
| 当前支持状态 | 已发布 adapter。 | Codex adapter 已有 dist：skills + hooks + prompt-first bootstrap；install/upgrade 通过本地 marketplace 注册 Codex plugin；commands 不投影原生 slash-command artifact。 | **已发布 adapter**（`plugin/dist/cursor`、probe 完成、install `--harness cursor`）。 | 三 host 独立 release zip（ADR-022）；source 保持多 host adapter 边界。 |
| Origin plugin / headless worker 边界 | Claude Code origin 与 `claude` CLI worker 必须分别建 surface facts。 | Codex plugin origin 与 `codex exec` worker 必须分别建 surface facts。 | `cursor-ide-plugin` 只作 IDE master origin；`cursor-agent-cli` 只作 headless worker target。`--plugin-dir`、同品牌或同账号不把 CLI 晋升成 origin，详见 [`cursor-dual-surface-contract.md`](cursor-dual-surface-contract.md)。 | origin plugin 与 headless transport 是独立 bounded context；installed/auth/model/quota/pool 不跨 surface 推导。 |
| Plugin manifest | `.claude-plugin/plugin.json`。 | `.codex-plugin/plugin.json`。 | `.cursor-plugin/plugin.json`【官方】。本地测试 `~/.cursor/plugins/local/<name>/`【官方】。Marketplace 审核发布【官方】。 | manifest 是 host-native artifact；`sync-plugin-dist.sh --host cursor` 全量投影 hooks + commands。 |
| Runtime skills | 插件 manifest 可注册 `skills/`；项目 / 用户侧也有 `.claude/skills`。 | 项目级 skills 官方目录是 `.agents/skills`；不是 `.codex/skills`。 | `.cursor/skills`、`.agents/skills`、`~/.cursor/skills`【官方】；**兼容加载** `.claude/skills`、`.codex/skills`【官方】。 | 分发 runtime skills 放 `plugin/src/skills/<skill>/canonical/`，按 host 投影；dev meta-skills 在 Cursor 上可被 `.claude/skills` 兼容发现。 |
| Skill path token | `${CLAUDE_SKILL_DIR}` 可用于 skill 内引用随 skill 分发的脚本 / 资源。 | `SKILL.md` 不做 runtime path variable substitution。 | **无 documented** `${CURSOR_PLUGIN_ROOT}` / `${CURSOR_SKILL_DIR}`【官方缺位】。 | canonical 正文不要写 host-specific token；Cursor adapter 同 Codex：相对路径 / install-time rewrite / `references/`。 |
| Hook registration | 插件可带 `hooks/hooks.json`；事件、matcher、blocking / additionalContext 等能力以 Claude Code hooks 机制为准。 | 当前官方 manual 使用 `hooks` key；`codex_hooks` 是 deprecated alias。plugin-bundled hooks 可被发现。 | `hooks/hooks.json` `version: 1`【官方】。事件集与 Claude 不同（含 `beforeSubmitPrompt`、`preCompact`、`subagentStart` 等）；**无 PostToolBatch**【官方】。可加载 Claude third-party hooks【官方】。 | PHIP 里共享 hook intent，不共享脚本假设；每个 host 独立 registration。Cursor 正式 adapter 必须原生 `hooks.json`，不能依赖 third-party 兼容层。 |
| Hook command path | `${CLAUDE_PLUGIN_ROOT}` 可指向插件根；`${CLAUDE_PLUGIN_DATA}` 可指向插件数据目录。 | Codex CLI 0.142.5 实测：hook command 里的 `${CODEX_PLUGIN_ROOT}` 不展开，hook 环境也没有 `CODEX_PLUGIN_ROOT`。 | D1（Cursor 3.10.20）确认绝对命令可用、local plugin hook cwd 为安装根；无 documented plugin-root token。 | Cursor 已用相对 plugin-cwd 的 `launcher.js` + `__dirname` 解析 + `CC_MASTER_PLUGIN_ROOT` 注入；不得假设 `${CURSOR_PLUGIN_ROOT}` / `${PLUGIN_ROOT}` 会展开。 |
| Hook runtime | 本仓红线：Claude Code hook 使用 bash + node/JS；不依赖 jq/python/TS runtime。 | Codex hook 的 shell/runtime 不能假设与 Claude 相同；命令从 session cwd 执行，裸相对路径不安全。 | D2（Cursor 3.10.20）确认 hook PATH 中 `node` 可用。退出码：0 成功 / 2 deny / 其他 fail-open（除非 `failClosed`）【官方】。 | Cursor implementation 已落在 `plugin/src/hooks/<hook>/implementations/cursor/`，仍坚持 bash+node（红线 1），不引入官方示例里的 jq/python。 |
| Commands / prompts | Claude Code slash command body 由插件 commands 提供；当前源在 `plugin/src/commands/`。 | Codex 有内置 slash commands；plugin manifest 当前不分发自定义 commands。Codex custom prompts 是 deprecated 且 user-local。 | Plugin `commands/*.md` → `/name`【官方】。本仓六个 command strategy 均为 `host_native`，`/cc-master-stop` 避免与内置 `/stop` 冲突；无 `plugin:` namespace。 | Claude Code 用 `host_native`；Codex 用 `adapter_guidance` + prompt-first hook；Cursor 已落地 `host_native` commands + `beforeSubmitPrompt` hook 双通道。 |
| Skill invocation args | Slash command body 可通过命令文本带 args，再由 command prompt 解释。 | 官方 skills 文档没有 positional/named args 或 `$ARGUMENTS` 展开。 | Skills 无 args 文档【官方】；带参入口走 command body 或 `ccm` CLI【推导】。 | 需要参数的入口不要建成 skill args；用 command + hook 或 `ccm` CLI。 |
| Project memory / rules | `AGENTS.md` / `CLAUDE.md` 可作为项目级入口；本仓 `CLAUDE.md = @AGENTS.md`。 | Codex 读取 `AGENTS.md`；项目 skills 从 `.agents/skills` 发现。 | `.cursor/rules/*.mdc` + 根 `AGENTS.md`【官方】。**不是** SessionStart/compaction reinject 等价物【推导 — 硬缺口】。 | 顶层 `AGENTS.md` 是跨 host 项目导航 SSOT；reinject 需 Cursor-native redesign。 |
| Dist artifact | `plugin/dist/claude-code` 可被 `claude plugin validate` 验证。 | `plugin/dist/codex` 由 sync 生成；Codex 无等价 validate；靠 projection + hook tests + probe。 | `plugin/dist/cursor` 由 sync 生成；`cc-master-plugin-cursor-*.zip` release asset；无 documented validate 等价物。 | 不手改 dist；三 host 经 `sync-plugin-dist.sh` + package + probe/hook tests。 |
| 主要风险 | Claude Code hooks 演进很快，需用本仓 hooks research 和 validator 对齐。 | Codex plugin/hook 机制仍在变化；path token 与 paragoge 旧文档不一致。 | **已接受硬差异**：无 PostToolBatch；reinject 无 1:1；Stop 为 `followup_message` 续跑非 block；D5 `postToolUse` 注入 PASS 但 D4 `sessionStart` 仍是已知 bug；无 Workflow；配额只有 billing-period，无 account pool / external statusline。Cloud Agents 另档。 | Cursor adapter 已发布；新能力继续按 Track A SAP/PHIP + CONTRACT 或 Track B Capability Card（ADR-031）锁步。真实剩余验收缺口见 `cursor.md` Phase 5。 |

## Headless worker surfaces

本表不把 worker CLI 塞进上面的 origin plugin 列。`cursor-agent-cli` 与 `cursor-ide-plugin` 是独立 descriptor；前者只能是 `worker-target`，后者只能是 Cursor 的 `master-origin`。

| Surface | Current | Honest gap / admission | Plugin-host boundary |
| --- | --- | --- | --- |
| `cursor-agent-cli` (`agent` / `cursor-agent` executable aliases) | read-only binary/version/help/auth discovery；plan/payer topology 与 first-party catalog 是独立 fail-closed facts；fixture-only admission/result contract | production model/quota/topology collector、per-OS sandbox、invoke/cancel/resume evidence 未齐即 fail closed；真实模型测试只允许 fresh-proven first-party selector，零 API fallback；只允许用户手动 auth，自动换号永久禁止 | `--plugin-dir` 只是 CLI loader flag，不证明 IDE plugin/hook/session/ARM parity |

完整 probes、TTL、维护 runbook 与 OOP composition 只在 [`cursor-agent-cli.md`](cursor-agent-cli.md) 维护；上表不复制易变 CLI facts。
