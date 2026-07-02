# 机制契约：`commands/handoff-to-new-session.md`

> 类别：command（向新 session 优雅交接 orchestration）。源码：`commands/handoff-to-new-session.md`。是 `--resume` 跨 session re-arm 的**写/准备侧**——由旧 session 运行，本身不武装 hook（故无 sentinel）。

## 触发输入
- 用户敲 `/cc-master:handoff-to-new-session`。
- 读：cc-master home 下每块 `owner.active:true` 的 board；动手前读 `${CLAUDE_PLUGIN_ROOT}/skills/master-orchestrator-guide/references/handoff.md`。

## 业务流（6 步）
1. **Quiesce**：立刻停止往 WIP 放新任务（本回合起不再有新任务进 in_flight）；已在飞的让它跑。
2. **Drain**：让 `in_flight` 任务在**当前 session** 收敛，每个落地即就地端点验收（亲跑闸 + 读 diff）——当前 session 还握 live handle，比甩给新 session 当孤儿盲验省得多。straggler 兜底：真长跑排不空的**单个**任务降级成「孤儿 + 重验指引」surface 用户。
3. **Write**：写叙事层 handoff 文档到 `$HOME_DIR/<UTC-timestamp>-<pid>.handoff.md`（纯叙事、指向 board，绝不复抄 DAG/task/status；6 段骨架见 handoff.md）。
4. **Log**：往 board 柔性边 `log` 段追加指向 handoff 文档路径的指针条目 + 一行最终态；把 `owner.heartbeat` 更新为当前时间戳。
5. **Archive**：把 `owner.active` 置 `false`（同 `/stop` 机制）——让新 session `--resume` 走「复活归档板」的无摩擦路径（无需 `--force-takeover`·ADR-009）。
6. **告诉用户**：给出 ① handoff 文档完整路径；② 新 session 要跑的确切命令 `/cc-master:as-master-orchestrator --resume <选择器>`；一句话交代当前态势（有无 straggler 孤儿）。

## 输出副作用
- 新建 `<UTC-timestamp>-<pid>.handoff.md` 叙事文档。
- board：追加 `log` 指针条目 + bump `owner.heartbeat` + 置 `owner.active: false`。

## 关键不变式
- 认准 board 同 `/stop` / `/status`——歧义时询问用户，交接错 board 会归档别人的 orchestration。
- handoff 文档**纯叙事层**——指向 board，绝不复述 DAG / task 列表 / status（避免双源漂移）。
- 归档是**显式可逆**（同 `/stop`）：`tasks`/`log`/`goal`/`git` 全留。
- 本命令是 `--resume` 的写侧、不武装 hook（无 sentinel）。

## 失败模式
- 某长跑 in_flight 在合理收敛窗口排不空 → 降级单个任务为孤儿 + surface 用户，别让收敛把「切 session」无限期焊死。
