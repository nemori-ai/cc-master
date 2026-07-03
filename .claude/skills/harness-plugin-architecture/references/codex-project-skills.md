# Codex 项目级 Skills

## 官方发现位置

Codex 项目级 skills 放在 `.agents/skills`，不是 `.codex/skills`。

Codex 会从当前工作目录一路向上扫描 `.agents/skills`，直到 repo root。也会扫描用户级 `$HOME/.agents/skills`、admin `/etc/codex/skills` 和 system skills。

Codex 支持 symlinked skill folders，并会 follow symlink target。

## 与 `.claude/skills` 的关系

Codex 不会默认读取 `.claude/skills`。如果本项目以 `.claude/skills` 作为 meta-skill source，需要投影到 `.agents/skills`。

本仓策略：

```text
.claude/skills/      # project meta-skill source
.agents/skills/      # generated Codex project skill projection
```

默认用 symlink 投影，避免两份正文漂移。不能使用 symlink 的环境可用 copy 模式。

同步命令：

```bash
bash scripts/sync-codex-skills.sh
bash scripts/sync-codex-skills.sh --copy
```

## Codex skill 形状

Codex skill 至少需要：

```text
<skill>/
  SKILL.md
  references/
  scripts/
  agents/openai.yaml
```

`agents/openai.yaml` 可选，用于 Codex app UI metadata、implicit invocation policy 和 dependencies。

## 维护纪律

- 改 `.claude/skills` 后运行 sync。
- 不直接手改 `.agents/skills` 里的 generated symlink/copy。
- 若 skill 使用 Claude-only 特性，在 Codex 投影前要拆出 Codex-safe 内容或禁用 implicit invocation。
