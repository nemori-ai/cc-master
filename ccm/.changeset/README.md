# Changesets

本目录用 [changesets](https://github.com/changesets/changesets) 管理 **ccm monorepo 的包版本**——即 `@ccm/engine`（board 引擎库）与 `ccm`（per-OS Node SEA CLI 二进制）这两个 workspace 包。

## 这套版本流的边界（重要）

changesets 只管 **ccm 包**，**独立于** cc-master **插件**的发版流。两套并存、互不干扰：

- **cc-master 插件**——手动门：版本号同步改 `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json` 两处 manifest + `CHANGELOG.md`，再 `gh release create`（详见仓库根 `AGENTS.md` §11）。
- **ccm 包**（本目录）——用 changesets：每个改动 ccm 包行为的 PR 附一份 changeset 文件声明 bump 级别（patch / minor / major），`changeset version` 据此聚合版本号 + 生成各包 changelog。

二者**不共享版本号**：插件版本（`plugin.json`）与 ccm 包版本（`packages/*/package.json`、`apps/*/package.json`）各自独立演进。

## 日常用法

```bash
# 在一个改了 ccm 包的 PR 里，记录这次改动的 bump：
pnpm -C ccm exec changeset

# 查看当前 pending 的 changeset（有没有未消费的版本意图）：
pnpm -C ccm exec changeset status

# 消费 pending changeset → bump 各包版本 + 更新 changelog（发版时跑）：
pnpm -C ccm exec changeset version
```

## 当前配置要点（见 `config.json`）

- `access: "restricted"`——**暂不 npm publish**（ccm 走 GitHub release 附 per-OS SEA 二进制分发，不发 npm；将来若要发 npm 再改为 `public`）。
- `commit: false`——changesets 不自动 commit，由本仓 single-committer 纪律统一提交。
- `baseBranch: "main"`——`changeset status` 的 diff 基线。
- `updateInternalDependencies: "patch"`——`ccm` 依赖 `@ccm/engine`（`workspace:*`），后者 bump 时前者至少 patch。
- `changelog: "@changesets/cli/changelog"`——用内置 changelog 生成器（不依赖 GitHub API token）。
