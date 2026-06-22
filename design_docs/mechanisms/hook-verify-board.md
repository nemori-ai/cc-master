# 机制契约：`hooks/scripts/verify-board.sh`

> 类别：hook（`Stop`，纯 bash + awk）。源码：`hooks/scripts/verify-board.sh`。**goal-hook**——据 board status 分布决定是否放行 agent 停下；唯一能 `decision:block` 的 cc-master hook。

## 触发输入
- `Stop` 事件，stdin JSON 含 `session_id`。
- 读 home 下 `*.board.json`（武装匹配后）。
- sidecar `$HOME_DIR/.<sid>.stopcheck`（sid 空 → `.nosession.stopcheck`），一行 `<block_streak> <last_handshook_fp>`，hook 自有。

## 业务流
1. 取 `sid`，读 sidecar（block_streak / last_handshook_fp）。`FUSE=5`。
2. **武装闸 `board_matches`**（同 reinject：active AND sid 匹配，只读 root owner）扫出本 session 的 active 板。
3. 对每块匹配板（detection 全 scoped 到 `tasks_region`，log/owner 不冒充 task）：数 task（按 `"id":`）→ 0 = empty_active；有 `ready`/`uncertain` → actionable；有 `in_flight` 且无 armed `wakeup`（`wakeup_armed`：root wakeup 对象且 fire_at 未过期/缺失/畸形则 graceful-degrade 当 armed，唯「对象 + 合法 fire_at + 已过 now」当 not-armed）→ watchdog_needed。
4. **决策表**：无匹配 active 板 → allow（dormant）；empty（0 task）→ block（DAG 没填）；有 ready/uncertain → block + 重置 handshake；否则（全 in_flight/blocked/done/failed/escalated/stale）→ fingerprint-keyed 自检握手。
5. **指纹**：cksum over per-task `id+status+blocked_on` 三元组（文件序，非排序）+ `watchdog_needed` 位 + 每块板非空的 `wakeup.fire_at`。指纹未变（已握手过）→ allow + 保留 fp；变了 → 记录新 fp 后 block，并在 handshake reason 里点名未答用户决策（`pending_user_decisions`）+ watchdog 提醒。
6. **fuse**：每次 block 累加 streak，≥5 → 强制 allow + warning + 清 sidecar；每次 allow 清 sidecar。

## 输出副作用
- 写/清 sidecar（block_streak + last_handshook_fp，原子 tmp+mv）。
- block → stdout `{"decision":"block","reason":...}`；allow → `exit 0`（无输出）；fuse 跳闸 → `{"reason":...}`（无 decision:block，agent 停 + 显警告）。**永不写 board。**

## 关键不变式
- **未武装一律 allow（dormant）**（红线 6）。
- **永不写 board**——握手/fuse 状态全在 sidecar（board 仍是 agent 单一真相源）。
- 只读 root owner 判武装、task 检测只在 `tasks_region`（log/owner 不冒充 task）。
- `blocked(blocked_on:"user")` 契约：未答用户决策必须 `status:"blocked"` AND `blocked_on:"user"` 双字段（已 done 残留 blocked_on 的不再 warn）。
- watchdog ceiling = **recon 触发器，不是死亡判据**（Finding #60）：fire_at 过期 + in_flight 是「回来 recon 地面真相」、不是 kill 健康长跑；措辞含「慷慨 ceiling，绝不用 output-size 停滞当存活信号」。
- wakeup 是 soft-observed（graceful-degrade·红线 2）：缺/畸形 fire_at 不破老板，只「对象+合法 fire_at+已过期」三元降为 not-armed。

## 失败模式
- 同一完成态在长后台等待里被反复自检 → 指纹未变即 allow（不再问）。
- 陈旧 wakeup（已过期 fire_at + 仍 in_flight）→ 当 not-armed → 提醒再 fire（self-heal·Finding #56）。
- fuse 跳闸（连 block ≥5）→ 强制放行 + 警告（防死锁）。
