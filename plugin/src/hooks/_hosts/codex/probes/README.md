# Codex Hook Probes

Before implementing production Codex hooks, capture fixtures for the target Codex CLI version:

1. plugin-bundled hook discovery and trust flow;
2. command path behavior for absolute path, repo-root path, and any documented plugin resource path;
3. stdin payload for `UserPromptSubmit`, `SessionStart`, `Stop`, `PreToolUse`, and `PostToolUse`;
4. stdout/stderr envelope for silent allow, advisory context, and block/deny;
5. subagent/thread indicators for main vs subagent context.

Record the CLI version, fixture JSON, expected output, and any divergence from the Codex manual in `design_docs/harnesses/codex.md`.

## Files

- `probe-hook.js` captures stdin/env/cwd/argv to JSON fixtures.
- `hooks.absolute.template.json` is a template for absolute-path hook registration. Replace:
  - `{{PROBE_DIR}}` with an absolute fixture output directory;
  - `{{PROBE_HOOK_JS}}` with the absolute path to `probe-hook.js`.
- `hooks.plugin-env.template.json` is a template for plugin-bundled hook probing with `${PLUGIN_ROOT}`. Copy `probe-hook.js` into the probe plugin's `hooks/` directory before using it.
- `run-plugin-env-probe.sh` builds a temporary local marketplace + plugin, installs it, runs `codex exec`, captures hook fixtures, and removes the temporary plugin/marketplace.
- `run-stop-output-probe.sh` uses project-local absolute hooks to compare Codex Stop hook behavior for `system-message`, `block`, and `exit2` output modes.

Use `hooks.absolute.template.json` for project-local config probes. Use `hooks.plugin-env.template.json` only inside an installed/enabled Codex plugin. Do not substitute `${CODEX_PLUGIN_ROOT}`; current probes found no such token.

Codex CLI 0.142.5 plugin-install probe found:

- plugin-bundled hook command strings can use `${PLUGIN_ROOT}` and Codex resolves it to the installed plugin cache path before execution;
- the hook child process did not contain `PLUGIN_ROOT`, `PLUGIN_DATA`, `CLAUDE_PLUGIN_ROOT`, or `CLAUDE_PLUGIN_DATA` in its environment;
- production hooks should pass cc-master-owned env vars explicitly in the command string if runtime code needs those paths.

Codex CLI 0.142.5 Stop output probe found:

- `system-message` completes normally with one Stop event;
- `decision:block` on Stop repeatedly re-enters Stop until timeout;
- exit code 2 on Stop also repeatedly re-enters Stop until timeout;
- production Codex Stop hooks should be advisory unless a future bounded continuation primitive is verified.

## Output Modes

Set `CC_MASTER_CODEX_HOOK_PROBE_MODE`:

- `silent`: capture fixture and emit nothing.
- `context`: capture fixture and emit a Claude-style additional-context envelope to test whether Codex accepts or ignores it.
- `block`: capture fixture and emit a Claude-style block envelope to test whether Codex accepts or ignores it.
- `exit2`: capture fixture, write a reason to stderr, and exit 2.
- `system-message`: capture fixture and emit Codex common `systemMessage`.

Do not treat `context` or `block` as production behavior until a probe proves the target Codex CLI accepts that envelope.
