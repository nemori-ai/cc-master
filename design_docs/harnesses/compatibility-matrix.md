# Harness Compatibility Matrix

更新时间：2026-07-03。

本表不是 paragoge 原表的复制品。它采用 paragoge 的对比维度，但事实按 cc-master 当前资料和实测修正。

| Surface | Claude Code | Codex | cc-master 决策 |
| --- | --- | --- | --- |
| 当前支持状态 | 已发布 adapter。 | Codex adapter 已有 dist：skills + hooks + prompt-first bootstrap；install/upgrade 通过本地 marketplace 注册 Codex plugin；commands 不投影原生 slash-command artifact。 | 发布策略仍需逐版本明确哪些 host 进入 release 包；source 必须保持多 host adapter 边界。 |
| Plugin manifest | `.claude-plugin/plugin.json`。 | `.codex-plugin/plugin.json`。 | manifest 是 host-native artifact；第二 host 出现后不要强行统一 manifest shape。 |
| Runtime skills | 插件 manifest 可注册 `skills/`；项目 / 用户侧也有 `.claude/skills`。 | 项目级 skills 官方目录是 `.agents/skills`；不是 `.codex/skills`。 | 分发 runtime skills 放 `plugin/src/skills/<skill>/canonical/`，按 host 投影；dev meta-skills 以 `.claude/skills` 为源，生成 `.agents/skills`。 |
| Skill path token | `${CLAUDE_SKILL_DIR}` 可用于 skill 内引用随 skill 分发的脚本 / 资源。 | `SKILL.md` 不做 runtime path variable substitution。 | canonical 正文不要写 host-specific token；需要路径时由 adapter rewrite 或保留 host 专用文本。 |
| Hook registration | 插件可带 `hooks/hooks.json`；事件、matcher、blocking / additionalContext 等能力以 Claude Code hooks 机制为准。 | 当前官方 manual 使用 `hooks` key；`codex_hooks` 是 deprecated alias。plugin-bundled hooks 可被发现。 | PHIP 里共享 hook intent，不共享脚本假设；每个 host 独立 registration。 |
| Hook command path | `${CLAUDE_PLUGIN_ROOT}` 可指向插件根；`${CLAUDE_PLUGIN_DATA}` 可指向插件数据目录。 | Codex CLI 0.142.5 实测：hook command 里的 `${CODEX_PLUGIN_ROOT}` 不展开，hook 环境也没有 `CODEX_PLUGIN_ROOT`。 | Codex adapter 不能照抄 Claude 的 plugin-root token；需要 install-time absolute command、host config 生成，或官方支持后再改。 |
| Hook runtime | 本仓红线：Claude Code hook 使用 bash + node/JS；不依赖 jq/python/TS runtime。 | Codex hook 的 shell/runtime 不能假设与 Claude 相同；命令从 session cwd 执行，裸相对路径不安全。 | hook implementation 放 `plugin/src/hooks/<hook>/implementations/<host>/`，按 host 测试。 |
| Commands / prompts | Claude Code slash command body 由插件 commands 提供；当前源在 `plugin/src/commands/`。 | Codex 有内置 slash commands；plugin manifest 当前不分发自定义 commands。Codex custom prompts 是 deprecated 且 user-local，目录为 `${CODEX_HOME:-~/.codex}/prompts`，调用形式 `/prompts:<name>`；本仓 per-harness install 会注册 Codex plugin，并同步 `plugin/dist/codex/prompts/*.md` 作为入口体验。 | Claude Code 用 `host_native` 投影；Codex 用 `adapter_guidance` 记录 command intent，并用 prompt-first hook 作为真正 bootstrap contract。不要把 Codex prompts 误认为 plugin-distributed command artifact。 |
| Skill invocation args | Slash command body 可通过命令文本带 args，再由 command prompt 解释。 | 官方 skills 文档没有 positional/named args 或 `$ARGUMENTS` 展开；这些参数模板能力只出现在 custom prompts 文档段。 | 需要参数的入口不要建成 Codex skill args；用 prompt-first command line、custom prompt expansion 或 `ccm` CLI。 |
| Project memory / rules | `AGENTS.md` / `CLAUDE.md` 可作为项目级入口；本仓 `CLAUDE.md = @AGENTS.md`。 | Codex 读取 `AGENTS.md`；项目 skills 从 `.agents/skills` 发现。 | 顶层 `AGENTS.md` 是跨 host 项目导航 SSOT；Codex skills 用脚本生成。 |
| Dist artifact | `plugin/dist/claude-code` 可被 `claude plugin validate` 验证。 | `plugin/dist/codex` 由 sync 生成，包含 `.codex-plugin/plugin.json`、skills、hooks；Codex 无等价 `claude plugin validate` 的本仓 gate，靠 projection + hook tests + probe。 | 不手改 dist；生成后跑 host-native validator/probe。 |
| 主要风险 | Claude Code hooks 演进很快，需用本仓 hooks research 和 validator 对齐。 | Codex plugin/hook 机制仍在变化；path token 与 paragoge 旧文档不一致。 | Codex adapter 开工前先补 probe 和 sync check，不从 paragoge 旧实现直接复制。 |
