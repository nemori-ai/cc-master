# 机制契约：`hooks/scripts/usage-pacing.js`

> 类别：hook（`Stop`，node/JS·ADR-006 解锁的旗舰 node hook）。源码：`hooks/scripts/usage-pacing.js`。感知 5h/7d 配额、临界/欠用时注入**非阻断** pacing 提示。**绝不 decision:block。**

## 触发输入
- `Stop` 事件，stdin JSON 含 `session_id` / `stop_hook_active`。
- 读：① 账户权威 sidecar `$RATE_CACHE`（默认 `~/.claude/.cc-master-rate-limits.json`，statusline-capture.js 落的）；② 本地 usage JSONL（`$CC_MASTER_USAGE_DIR`，默认 `~/.claude/projects`，fallback）；③ 号池 registry `accounts.json`（`$CC_MASTER_HOME` 或 `$HOME/.claude/cc-master`，算 effective-N）；④ 武装判定读 home 下 board。
- 大量 `CC_MASTER_*` env 覆写点（测试注入 + 阈值调旋钮）。

## 业务流
1. **stop re-entry guard**：`stop_hook_active:true` → 立即静默 return（防每次 Stop 重注同一警告 = 实质卡死）。
2. **武装闸 `isArmed`**（JSON.parse 读 owner.active/session_id，与 board-lint.js 字字相同）：未武装 → 在读 usage **之前**静默 return（红线 6：读 registry/usage/注入全在闸之后）。
3. 算 `nowMs`（`CC_MASTER_NOW` 覆写）；从 accounts.json 算 effective-N = 非 active 且 token 未过期且非 `switchable:false` 的可切入备号 + 1（无 registry/空池/坏 JSON → 1）。
4. **账户口径优先**（`decideAccountWarning`，权威 used_percentage）：5h 仅在 resets_at 未来时参与判墙；`floor`（默认 85%）；`dispatchGate`（默认 85%，独立于 floor 判，硬边界不被软 floor 架空·Finding 3）。
   - **7d ≥ dispatchGate** → 最硬措辞：「本回合起暂停 dispatch 新节点，把『是否续耗 7d 配额』作 blocked_on:"user" surface 给用户」（无论 5h/n）。
   - **5h 撞墙 + n>1 + 7d 信号确认存在且有余量**（`sdKnown && !sdHit`·Finding 2）→「切到下一份配额」信号、不减速。
   - 其它（n=1 / 7d 信号缺失）→ 保守减速措辞（降档/降 WIP/defer）。
5. 账户有效但未到墙 → 问 `decideAccountUnderuse`（欠用→加速）：四条 AND（5h used% < ceil(默认 60，按 n 抬到 min(95,ceil×n)) + 距 reset ≤ remainMin(默认 60) + 7d < headroom(默认 80，缺则静默) + sidecar captured_at 新鲜 ≤ maxStale(默认 15min)）→ 加速提示；否则静默。
6. 账户口径不可用 → 本地反推 fallback（`computeFiveHour`，approx）：只做撞墙判定，**反推路径禁欠用提示**（reset 倒计时失真到数量级）。
7. warning 非空且号池 `switchable ≥ 1` → 尾部附「号池有 N 个备号、换号是可用 lever」粗事实（不在 hook 跑选号算法）。

## 输出副作用
- warning 非空 → stdout `Stop` additionalContext。**绝不 decision:block、绝不写 board、绝不读 token。**

## 关键不变式
- **绝不 block**——hook 只感知 + 提示，怎么 pace 是认知（SKILL A）；7d 闸的「暂停 dispatch」是软提示、真正暂停由 orchestrator 执行（红线 4）。
- 未武装一律静默（红线 6）——读 registry/usage/注入全在 armed gate 之后。
- effective-N **只**从 accounts.json 算，与 board 正交（红线 2，T6 来源迁移，不再读 board num_account）。
- 账户权威 > 本地反推（Finding #37）：反推 reset 失真到数量级，反推路径不触发 7d dispatch 闸、不触发欠用加速、不纳入 N 缩放。
- 全程 try/catch → 任何失败静默 `exit 0`（hook 崩会污染 Stop）。

## 失败模式
- node 不在 PATH（standalone-binary 内嵌）→ shebang 不被调起 = 等同 hook 不存在（Stop 上优雅降级）。
- sidecar 缺/坏 → 降级本地反推 approx。
- registry 缺/空/坏 → effective-N=1（天然单账号）。
- stop re-entry → 静默（警告对每个真新 Stop 最多一次）。
