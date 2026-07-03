---
path: plugin/src/hooks/AGENTS.md
version: v0.1
last-edited: 2026-07-03
content-summary: |
  cc-master PHIP hooks source tree 入口。hook contract 与 host-native implementation 分离，dist 由 sync 生成。
---

# plugin/src/hooks/

本目录采用 paragoge 的 PHIP 形态：

```text
hooks/
  _manifest/
    hooks.yaml
    lifecycle-stages.yaml
  _shared/
    contract.md              # normalized env / payload / result contract
  _hosts/
    claude-code/
      hooks.json              # Claude Code registration source
    codex/
      strategy.yaml           # probe-required Codex host adapter facts
  <hook>/
    core/                     # future host-neutral hook business logic
    implementations/
      claude-code/
        <script>
        meta.yaml
```

## 不变量

- `_manifest/` 描述 host-agnostic hook contract。
- `_shared/` 描述 shared hook core 与 host launcher 之间的标准 env / payload / result contract。
- `_hosts/<host>/` 描述 host-wide registration / lifecycle / launcher 基座。
- `<hook>/implementations/<host>/` 保存当前 host-native script；长期应向 thin launcher + shared core 收敛。
- `plugin/dist/claude-code/hooks/hooks.json` 与 `hooks/scripts/*` 只由 sync 生成。
