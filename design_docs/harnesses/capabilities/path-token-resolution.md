# path-token-resolution

## Intent（host-neutral）

Runtime hooks and skills must reference **plugin-bundled scripts and assets** with paths that
resolve correctly after install — without baking host-specific absolute paths into canonical
skill prose.

## Acceptance（可测等价类）

1. Hook commands resolve to installed plugin root regardless of session cwd.
2. Canonical skill bodies contain **no** host-specific tokens (`${CLAUDE_*}`) — only neutral
   slots or relative conventions rewritten at projection time.
3. After install, a probe hook/script at a known relative path executes successfully.

## Host mechanisms

| host | status | mechanism | notes |
| --- | --- | --- | --- |
| claude-code | implemented | `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PLUGIN_DATA}` in hooks.json / skill rewrite | Documented |
| codex | implemented | `${PLUGIN_ROOT}` in hook **command string** expands; inject `CC_MASTER_PLUGIN_ROOT="${PLUGIN_ROOT}"`; no env at runtime | codex.md probe |
| cursor | planned | **TBD after probe D1**: launcher inject `CC_MASTER_PLUGIN_ROOT` or `__dirname`; no documented `${CURSOR_PLUGIN_ROOT}` | Track A/B boundary |

## Declared divergence

```yaml
- rule: plugin-root-token-name
  kind: protocol-capability-gap
  affected_hosts: [codex, cursor]
  reason: Hosts use different command-string tokens (PLUGIN_ROOT vs none documented for Cursor).
  compensating_mechanism: >
    Per-host hooks.json command prefix + launcher.js; never read PLUGIN_ROOT from env on Codex;
    Cursor to follow same launcher pattern after D1 probe. Canonical uses slots only.
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

cursor.md Dogfood Backlog: **D1** (plugin hook command path resolution)
