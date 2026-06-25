# 机制契约：`scripts/skill-lint.sh`（dev-only）

> 类别：dev-only 带外脚本（NOT a hook·**不随 plugin 分发**·仅 repo 根调用·红线 5）。源码：`scripts/skill-lint.sh`。对每个 SKILL.md 跑静态 prose-lint 的 checker——绝不改 skill 文件。

## 触发输入
- 开发者敲 `scripts/skill-lint.sh`。
- 读：分发 `skills/` + 项目内 `.claude/skills/` 下每个 SKILL.md（+ 分发 `commands/` `hooks/` 内 markdown，check 4）。
- 依赖 node（不用 bash+jq/python——仓内 content 测试是 node-based，node 在任何 Claude Code 宿主保证存在·红线 1/ADR-006）。

## 业务流（node 程序，四 check）
1. **frontmatter 引号反模式**（Finding #1）：`description:` 值含 `:` 或 `"` 必须整包单引号，否则 YAML 误读。
2. **required frontmatter 字段**：`name` + `description` 都存在且非空。
3. **dead relative links**：每个 markdown 链接 `](relpath)` 指向 repo-relative 文件必须在盘上解析得到。
4. **裸跨 skill 路径引用**（Finding #50·AGENTS.md §12）：分发 markdown 内反引号包裹、以兄弟分发 skill 名（authoring-workflows / orchestrating-to-completion / account-management）开头带 `/` 的路径 = 装机后死链，必须升 `${CLAUDE_PLUGIN_ROOT}/skills/<name>/…`。逐 token 匹配（不接行级 `| grep -v CLAUDE_`，防同行既有修正又有残留漏报）。纯 skill 名提及（不带 `/`）、同 skill 自引用、dev-only repo 根 `scripts/` 路径有意不报。

## 输出副作用
- 无写（CHECKER 非 fixer，绝不改 skill 文件）。命中违规打印 `file:line` + 原因。

## 关键不变式
- **dev-only**——不随 plugin 分发，仅 repo 根调用（红线 5）。绝不进 hooks/。
- CHECKER 非 fixer——绝不编辑任何 skill 文件。
- check 4 的范围只查六个分发 skill 名（纯 skill 名提及、同 skill 自引用、dev-only repo 根 scripts/ 不算）。

## 失败模式
- 任一违规 → 打印 file:line + 原因、exit 1。
- node 缺 / setup 错 → exit 1（报错）。
