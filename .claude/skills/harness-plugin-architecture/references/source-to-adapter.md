# Source-to-Adapter 投影模型

## 目标形态

项目要同时支持多个 agent harness 时，不能把 Claude Code、Codex、Cursor 等 host 的 runtime 细节写进同一份可安装目录。共享语义和 host 投影要分开。

基本模型：

```text
plugin/src/        # semantic source
  -> projection
plugin/dist/<host> # installable host-native adapter
```

`dist` 是 adapter output。它可以长得完全 host-native，例如 Claude Code 的 `.claude-plugin/`、Codex 的 `.codex-plugin/`、其他 host 的 TOML/JSON/Python registration。不要为了让 dist 看起来统一而牺牲 host-native 行为。

## SAP：Skill Adapter Protocol

每个 skill 自带共享 runtime 和 per-host strategy：

```text
plugin/src/skills/<skill>/
  canonical/
    SKILL.md
    references/
    scripts/
    assets/
  adapters/
    claude-code/
      strategy.yaml
    codex/
      strategy.yaml
    cursor/
      strategy.yaml
```

规则：

- `canonical/` 承载方法论和 runtime payload。
- `adapters/<host>/strategy.yaml` 承载该 host 的 frontmatter、sidecar、path rewrite、permission、registration、overlay、patch 决策。
- `.design/`、`evals/`、roadmap 类维护资料不投影到 runtime skill。
- 如果 host 需要改正文，优先用 slot/placeholder 或明确 patch，不要 fork 一份独立正文。

## PHIP：Plugin Hook Integration Protocol

Hook 的共享点是 contract，不是脚本正文。不同 host 的 event、payload、decision shape 可能不同。

```text
plugin/src/hooks/
  _manifest/
    hooks.yaml
    lifecycle-stages.yaml
  _hosts/<host>/
  <hook>/
    shared/
    implementations/<host>/
```

规则：

- `_manifest/` 写 host-agnostic intent、stage、coverage、acceptance。
- `_hosts/<host>/` 写 host-wide registration、templates、stage map、validator 约束。
- `<hook>/implementations/<host>/` 写 host-native 实现。
- 生成到 `dist/<host>/hooks/` 的形状由 host 决定。

## Capability INTENT：非 1:1 与跨 surface 能力

SAP / PHIP 处理能落到单一 skill 或 hook surface 的适配；一项能力若横跨 hooks、commands、skills
和 / 或 ccm，或目标 host 没有 1:1 机制，则以
`design_docs/harnesses/capabilities/<capability-id>.md` 承载 host-neutral intent、testable acceptance、
host mechanism 与 declared divergence。单 hook 规则仍由该 hook 的 `CONTRACT.md` 承载。

Track A / Track B、artifact 分工与 N+1 host touch set 见
[`n-host-capability-parity.md`](n-host-capability-parity.md)。Cursor 的 rules、host-native commands 与
Capability Cards 属于 adapter 输入，不应为了维持统一 dist 外观而抹平。

## Projection 脚本要求

Projection 必须可重复、幂等、清空并重建目标 host dist。不要靠维护者手动同步。

最低要求：

- 缺少 required strategy/meta 时 fail。
- `dist/<host>` 每次重建。
- 复制文件时保留 executable bit。
- 生成后跑 host-native validator。
- CI 或 `run-tests.sh` 能发现 source/dist drift。
