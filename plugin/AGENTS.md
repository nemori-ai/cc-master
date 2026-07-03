---
path: plugin/AGENTS.md
version: v0.1
last-edited: 2026-07-03
content-summary: |
  cc-master plugin 子树入口。定义 paragoge-style source/dist 边界：plugin/src 是语义源，plugin/dist/claude-code 是当前唯一 adapter host 的可安装产物。
---

# plugin/

`plugin/` 存放 cc-master 的 harness plugin。第一阶段只支持 `claude-code` adapter；Codex 适配留到第二阶段。

## 边界

- `src/` 是唯一语义源：`.claude-plugin/`、`commands/`、`hooks/`、`skills/` 都从这里改。
- `dist/claude-code/` 是当前可安装产物：由 `scripts/sync-plugin-dist.sh` 从 `src/` 投影生成。
- 不手编 `dist/claude-code/{commands,hooks,skills,.claude-plugin}/`。需要改行为时先改 `src/`，再运行 `bash scripts/sync-plugin-dist.sh`。

## Adapter path token 纪律

第一阶段只有 Claude Code adapter，因此 `plugin/src/` 里仍允许出现 Claude Code 运行时变量；这只是阶段性落点，不代表这些变量是跨 harness canonical source。

从 paragoge 学到的策略是：host 差异不直接写死在共享语义层，而是通过 adapter projection 的 slot / placeholder 展开。后续新增 Codex adapter 前，应先把共享文件里的 host-specific 路径前缀抽成中性 slot，再由各 adapter 投影成自己的运行时写法。

当前 Claude Code 映射：

- plugin install root：`${CLAUDE_PLUGIN_ROOT}`，用于 hook command、跨 skill 文件引用、plugin-rooted 脚本路径。
- active skill dir：`${CLAUDE_SKILL_DIR}`，用于当前 skill 自己目录下的 `scripts/` / `references/` / `assets/`。
- persistent plugin data：`${CLAUDE_PLUGIN_DATA}`，用于跨 plugin update 保留的数据；不要把持久数据写到 `${CLAUDE_PLUGIN_ROOT}`。

Codex 阶段的已验证事实（本机 Codex CLI `0.142.5`，2026-07-03 实测）：

- paragoge 文档确认 Codex skill body 不替换 `SKILL.md` 内的 path variables；skill 正文应使用 plain relative paths 或 Codex 明文支持的 env/config。
- Codex plugin-bundled `hooks/hooks.json` 会被发现并执行；但 hook command 里的 `${CODEX_PLUGIN_ROOT}` **不会展开**，hook 进程环境里也没有 `CODEX_PLUGIN_ROOT`。同一 probe script 改成绝对路径后可正常运行，说明失败点就是该变量不存在 / 不替换。
- 因此不要把 `${CODEX_PLUGIN_ROOT}` 写进 `plugin/src` 的共享正文，也不要在 Codex adapter 中假设它可用。Codex adapter 必须用 Codex 当前文档支持的路径策略（例如绝对路径安装期生成、config 侧路径、或经实测有效的 host 机制）单独设计。

## 常用命令

```bash
bash scripts/sync-plugin-dist.sh
bash run-tests.sh
claude plugin validate plugin/dist/claude-code
```

## 触发式深入阅读

| 当你要 | 读什么 |
| --- | --- |
| 改 skill / command / hook 的运行时内容 | `plugin/src/` 下对应文件 |
| 改 Claude Code 安装产物形态 | `plugin/dist/claude-code/`，并同步更新投影脚本 |
| 新增 Codex adapter | 先验证 Codex path token / hook / skill 机制，再补 projection 设计与 compatibility matrix，最后新增 `plugin/dist/codex/` |
