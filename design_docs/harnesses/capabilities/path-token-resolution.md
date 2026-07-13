# path-token-resolution

## Intent（host-neutral）

Runtime hooks and skills must reference **plugin-bundled scripts and assets** with paths that
resolve correctly after install — without baking host-specific absolute paths into canonical
skill prose.

## Acceptance（可测等价类）

1. Hook commands resolve to installed plugin root regardless of session cwd, including installed
   roots containing spaces or Unicode. Command registration quotes the complete executable path.
2. Canonical skill bodies contain **no** host-specific tokens (`${CLAUDE_*}`) — only neutral
   slots or relative conventions rewritten at projection time.
3. After install, a probe hook/script at a known relative path executes successfully.
4. Host launchers project the central `RuntimeEnvironment` home precedence exactly, but preserve
   the plugin→`ccm` process boundary: no hook imports `@ccm/engine` and no resolver copy is embedded.
5. A symlinked home remains a valid lexical home. Hooks do not silently realpath it or split it.
6. Claude fresh bootstrap negotiates `board-init/structured-board-path-v1` through
   `ccm board init --capabilities --json --no-input` before mutating init. Capability discovery is
   deliberately separate from `--dry-run`: discovery must precede all init-path resolution and
   persistence in legacy binaries, while exact legacy probes are invoked with statusline auto-install
   disabled. Missing capability fails before any board or host-config artifact; ccm `0.21.0` is the
   first planned compatible release. Current ccm makes the discovery endpoint caller-independently
   read-only; dry-run remains zero-write and omits `data.board_path` because it wrote no artifact.

## Host mechanisms

| host | status | mechanism | notes |
| --- | --- | --- | --- |
| claude-code | implemented | `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PLUGIN_DATA}` in hooks.json / skill rewrite; complete hook path is shell-quoted; fresh ARM preflights the ccm structured-path capability | Installed-root + previous-ccm refusal probes cover spaces/Unicode and zero board artifacts |
| codex | implemented | `${PLUGIN_ROOT}` in hook **command string** expands; inject `CC_MASTER_PLUGIN_ROOT="${PLUGIN_ROOT}"`; launcher fallback climbs from `hooks/_hosts/codex` to installed root | codex.md probe + installed-root conformance |
| cursor | implemented | launcher injects `CC_MASTER_PLUGIN_ROOT` via `__dirname`; Cursor IDE plugin root remains separate from the `cursor-agent` executable surface | Track A + installed-root conformance |

## Declared divergence

```yaml
- rule: plugin-root-token-name
  kind: protocol-capability-gap
  affected_hosts: [codex, cursor]
  reason: Hosts use different command-string tokens (PLUGIN_ROOT vs none documented for Cursor).
  compensating_mechanism: >
    Per-host hooks.json command prefix + launcher.js; never read PLUGIN_ROOT from env on Codex;
    Cursor uses relative plugin-cwd commands plus launcher `__dirname` resolution and injected
    CC_MASTER_PLUGIN_ROOT (D1 closed). Canonical uses slots only.
  tracked_by: design_docs/harnesses/codex.md, cursor.md D1

- rule: skill-path-substitution
  kind: protocol-capability-gap
  affected_hosts: [codex, cursor]
  reason: SKILL.md does not do runtime path variable substitution on these hosts.
  compensating_mechanism: SAP projection copy + slot_replacements; references/ for deep links.
  tracked_by: compatibility-matrix.md Skill path token row
```

## Linked surfaces

- SAP: all `adapters/<host>/strategy.yaml` slot_replacements
- PHIP: `_hosts/<host>/hooks.json`, `launcher.js`
- Red line 5: `${CLAUDE_PLUGIN_ROOT}` in distributed skills (Finding #38)

## Probe deps

Closed 2026-07-09: Cursor D1 verified absolute/local-plugin paths and the production launcher strategy.
Literal `${PLUGIN_ROOT}` expansion remains deliberately unclaimed and is not a blocker.
