---
name: plugin-release-engineering
description: 当你要打包、分发、发布或审查 cc-master 的 CLI/plugin release 流程时使用；覆盖 source/dist/package 边界、host adapter artifacts、版本线、release checks 和 marketplace 元数据。
---

# Plugin 发布工程

你负责让发布产物来自已验证的 adapter dist，而不是来自开发 source。

## 发布前先分层

- `plugin/src/`：语义源，包含 strategy、manifest contract、dev-only design/eval。
- `plugin/dist/<host>/`：host-native installable adapter。
- release artifact：从一个或多个 `dist/<host>` 打包出来。

不要把 `plugin/src` 整包发布给用户。

## 发布流程

1. 运行 projection。
2. 跑 tests。
3. 跑 host-native validate。
4. 检查 package contents。
5. 更新对应版本线。
6. 生成 artifact。
7. 记录 release notes。

当前 Claude Code adapter：

```bash
bash scripts/sync-plugin-dist.sh
bash run-tests.sh
claude plugin validate plugin/dist/claude-code
```

## Package contents 检查

Artifact 应包含：

- host manifest
- commands
- runtime skills
- runtime hooks
- runtime scripts/assets
- user-facing docs if release policy requires

Artifact 不应包含：

- `.design/`
- `evals/`
- adapter strategy source
- PHIP `_manifest`
- maintainer AGENTS unless该 host 明确需要
- dev-only scripts

## 多 host 发布

新增 host 后，不要把一个 host 的 artifact 当成所有 host 的 artifact。每个 host 要有独立 dist 和 validation。

版本说明中要区分：

- plugin runtime 行为变化
- CLI/projection 工具变化
- host adapter packaging 变化
- docs-only 变化
