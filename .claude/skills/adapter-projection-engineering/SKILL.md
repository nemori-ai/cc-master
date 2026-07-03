---
name: adapter-projection-engineering
description: 当你要实现、修改或调试 cc-master/paragoge 式 source-to-adapter 投影脚本时使用；覆盖 SAP/PHIP 文件复制、slot/placeholder rewrite、host dist 生成、sync check、path token 和测试策略。
---

# Adapter 投影工程

你负责实现可重复的 adapter projection。目标不是让 source 和 dist 都能手改，而是让 source 单向生成 dist。

## 默认流程

1. 读 `plugin/src/AGENTS.md`，确认 source layout。
2. 读目标 host base 和校对版 harness 事实：
   - skills: `plugin/src/skills/_hosts/<host>/`
   - hooks: `plugin/src/hooks/_hosts/<host>/`
   - facts: `design_docs/harnesses/<host>.md` 和 `design_docs/harnesses/compatibility-matrix.md`
3. 枚举该 host 需要的 generated outputs。
4. 检查每个 skill 是否有 `adapters/<host>/strategy.yaml`。
5. 检查每个 required hook 是否有 `implementations/<host>/meta.yaml` 和 native script/config。
6. 检查每个 adapter skill payload 只保留当前 strategy 引用的 `stub/` 或 `partial/`。
7. 改 projection 脚本。
8. 删除并重建 `plugin/dist/<host>`。
9. 运行 host-native validation 和 tests。

## 实现原则

- Projection 幂等：同一 source 重复运行，dist 内容一致。
- 缺 required adapter config 直接 fail。
- 复制 runtime 文件时排除 maintainer-only 文件。
- 保留 executable bit。
- 不在 projection 时静默吞掉 unsupported host gap。
- 不把 Codex/Claude path token 混进 host-neutral source。
- `description` 是 skill 路由器：adapter stub/partial 也必须中文为主、保留 Triggers / Do NOT use / 职责边界 / unsupported 边界，不许退化成英文摘要。
- strategy 当前未引用的 `stub/` / `partial/` payload 必须删除；不要保留死目录当“以后可能用”的草稿。
- slot/overlay 优先，`partial_overlay` 是最后手段。只有 canonical 结构本身暂时不可复用、且已证明不能用 slot/overlay 表达时，才允许 `mode: partial_overlay`；strategy 必须写 `allow_partial_overlay: true` + `partial_reason`，并说明退回 `copy` 的路径。

## 何时用 slot/patch

使用 slot/placeholder：

- 同一 canonical 正文需要在不同 host 展开不同 path prefix。
- host 需要额外 frontmatter / sidecar，但方法论正文相同。
- host 只支持不同 command/path 语法。

使用 overlay：

- host 需要额外 metadata 文件。
- host 需要 wrapper script。

避免使用 `partial_overlay`：

- 只是某几段 host 指导不同 → 新增 slot + 两边 overlay。
- 只是 description / trigger 要按 host 改 → frontmatter slot 或 strategy-level description overlay。
- 只是某个 reference 不适用 → 把 reference 的 host 绑定段落 slot 化，或用 host-specific reference include；不要 fork 整个 `SKILL.md`。
- 解除 stub 时尤其不要先写一份大 partial 顶上——那是在 fork 方法论。先问“这段差异能不能成为 slot”。

使用 body patch 是最后手段；patch 必须可审计、可测试，并记录在 strategy。

## 验证

每次 projection 改动至少跑：

```bash
bash scripts/sync-plugin-dist.sh
bash run-tests.sh
```

Claude Code adapter 还要跑：

```bash
claude plugin validate plugin/dist/claude-code
```

如果改 Codex adapter，不要假设 `${CODEX_PLUGIN_ROOT}`；先写 probe 或使用 Codex 文档明确支持的路径策略。
