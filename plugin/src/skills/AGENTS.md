---
path: plugin/src/skills/AGENTS.md
version: v0.2
last-edited: 2026-07-21
content-summary: |
  cc-master SAP skills source tree 入口。每个分发 skill 使用 canonical runtime body + per-host adapter strategy。
---

# plugin/src/skills/

本目录采用 paragoge 的 SAP 形态：

```text
<skill>/
  canonical/                 # 投影到 host 的 runtime 内容
    SKILL.md
    references/
    scripts/
    assets/
  adapters/
    claude-code/
      strategy.yaml          # Claude Code 投影策略
  .design/                   # dev-only，不投影
  evals/                     # dev/eval-only，不投影
```

## 不变量

- `canonical/` 承载 agent 安装后真正读取的内容。
- `adapters/<host>/strategy.yaml` 承载 host-specific 投影策略；即使当前是 no-op，也要显式存在。
- `.design/` 与 `evals/` 不进入 `plugin/dist/<host>/skills/`。
- 四个现行 host 都必须有显式 strategy：`claude-code` / `codex` / `cursor` / `kimi-code`；新增或改变 host 能力时同步更新 strategy、Capability Card 与投影检查。
