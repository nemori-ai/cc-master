# Claude Code Harness Facts

更新时间：2026-07-03。

## Source Hierarchy

Claude Code 事实以本仓当前研究和验证为准：

- `design_docs/research/claude-code-hooks-reference.md`：本仓 hooks 研究资料，官方资料抓取日期为 2026-06-11。
- `plugin/dist/claude-code`：当前可安装 adapter 产物。
- `claude plugin validate plugin/dist/claude-code`：当前 host-native validator。
- paragoge 的 Claude Code mechanism 文档只作为历史输入；若与本仓研究冲突，以本仓研究为准。

## Plugin Shape

当前 cc-master Claude Code adapter 生成到：

```text
plugin/dist/claude-code/
  .claude-plugin/plugin.json
  commands/
  hooks/hooks.json
  hooks/scripts/
  skills/
```

源码在 `plugin/src`：

```text
plugin/src/
  .claude-plugin/
  commands/
  skills/<skill>/canonical/
  skills/<skill>/adapters/claude-code/strategy.yaml
  hooks/_manifest/
  hooks/_hosts/claude-code/
  hooks/<hook>/implementations/claude-code/
```

## Path Tokens

Claude Code adapter 可使用这些 host token：

- `${CLAUDE_PLUGIN_ROOT}`：插件根。
- `${CLAUDE_SKILL_DIR}`：当前 skill 目录。
- `${CLAUDE_PLUGIN_DATA}`：插件数据目录。

这些 token 只能出现在 Claude Code adapter 文本、manifest、hook command 或 adapter rewrite 后的产物中。不要把它们当成跨 host canonical 事实。

## Hooks

本仓对 Claude Code hooks 的工程结论：

- hooks 可以使用 bash + node/JS。不要使用 `jq`、Python、TS runtime 或未随 host 保证存在的工具。
- hook 运行在 shell 里，看不到完整 agent context；需要通过 hook stdin、board、`ccm` 或 host 提供字段做判断。
- Claude Code hooks 支持多类事件和 blocking / additionalContext 等输出机制；不要用 paragoge 旧表里的事件数量作为当前事实。
- cc-master 的 runtime hooks 必须 dormant-until-armed，除 `bootstrap-board` 作为 arm 动作本身外。

## Current Adapter Rules

- 修改 runtime skill 语义：改 `plugin/src/skills/<skill>/canonical/`。
- 修改 Claude Code skill 投影策略：改 `plugin/src/skills/<skill>/adapters/claude-code/strategy.yaml`。
- 修改 hook 行为：改 `plugin/src/hooks/<hook>/implementations/claude-code/`。
- 修改 hook registration：改 `plugin/src/hooks/_hosts/claude-code/hooks.json`。
- 生成产物：运行 `bash scripts/sync-plugin-dist.sh`。
- 验证：运行 `bash run-tests.sh` 和 `claude plugin validate plugin/dist/claude-code`。
