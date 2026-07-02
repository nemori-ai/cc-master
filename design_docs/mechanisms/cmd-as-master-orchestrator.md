# 机制契约：`commands/as-master-orchestrator.md`

> 类别：command（一次性点火 + hook 触发点）。源码：`commands/as-master-orchestrator.md`（命令体本身是注入 agent context 的 prompt）+ `hooks/scripts/bootstrap-board.sh`（实际武装动作）。本契约描述命令体的语义；bootstrap 的机制细节见 `mechanisms/hook-bootstrap-board.md`。

## 触发输入
- 用户敲 `/cc-master:as-master-orchestrator <goal>` 或 `--resume [选择器]`。
- 命令体首个非空行是 sentinel 注释 `<!-- cc-master:bootstrap:v1 -->`（hook 触发标记），第二行 `<!-- cc-master:args: $ARGUMENTS -->`（机读参数行）。
- argument-hint：`<goal> | --resume [选择器]`。

## 业务流
1. `UserPromptSubmit` 触发 `bootstrap-board.sh`，它据 `--resume` 首-token 分流 **fresh** / **resume**，建板或重盖板，把板路径 + 角色注入 context。
2. **命令体靠注入串的开头字样自判 mode**（不凭参数文本猜）：`cc-master: a fresh orchestration board was created at ...` = fresh；`cc-master resume: you have TAKEN OVER ...` = resume。
3. **fresh 形态**：① 调用 `master-orchestrator-guide` skill 内化身份；② 把目标拆成依赖 DAG 写进 `tasks[]`（每 task 至少 `id`/`status`/`deps` + `title`），填 `goal`/`git`，**保留 hook 盖好的 `owner.session_id`、绝不覆写**；③ 每回合跑决策程序（reconcile → surface 用户决策 → WIP 内派发 → fill-work → 端点验收 → flush）。
4. **resume 形态**：0. 先 `cd` 进 `git.worktree` 并核对 cwd/branch；1. 调 skill；2. 绝不重拆 goal / 重置 tasks，reconcile 现有 status 分布；3. 把每个 `in_flight` 当孤儿走端点验收 + content-hash 判定（产物落地且验过 → done/verified，否则降回 ready/stale 重派）；4. 保留 `owner.session_id`，每次 flush 更新 `owner.heartbeat`。
5. selector 省略且 hook 返回消歧串（含 `Candidates:`）时：把候选分 `active-but-abandoned` / `archived (will be revived)` 两组呈现，让用户重发更精确 `--resume`。

## 输出副作用
- 命令体本身不写文件（它是 prompt）；写盘由 bootstrap hook 完成。
- pacing 的 effective-N 不来自任何命令参数（`--num_account` 已砍·A2 T6），由 `usage-pacing.js` 从 `accounts.json` 算。

## 关键不变式
- **`owner.session_id` 由 bootstrap 盖、命令体原样保留**——写空/猜值会让全套 hook 对本 orchestration 集体休眠。
- mode 判定看注入串开头字样，不看参数文本。
- resume 必须先落到 board 的 worktree 再做任何 reconcile（否则在错目录/错分支静默跑绿）。
- 指挥不演奏：实现与 review 派给 sub-agent / workflow（红线 4）。

## 失败模式
- 找不到带板路径的 `cc-master:` 标记 → fresh 路径退化为：列 home 取 `goal` 空且 `owner.active:true` 的最新板。
- resume 落在 home 或别处（cwd ≠ worktree）→ 不先对齐则 reconcile/验收全在错目录跑（命令体显式警告先 `cd` + 核对）。
