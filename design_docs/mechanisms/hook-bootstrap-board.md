# 机制契约：`hooks/scripts/bootstrap-board.sh`

> 类别：hook（`UserPromptSubmit`，纯 bash + awk）。源码：`hooks/scripts/bootstrap-board.sh`。**唯一豁免武装闸的 hook——它就是 ARM 动作本身**（红线 6）。

## 触发输入
- `UserPromptSubmit` 事件，stdin 是 JSON（含 `prompt` / `session_id`）。
- 触发 gate（收紧的 dual sentinel·Finding #15/#16）：① raw 命令——`prompt` 字段值以 `/cc-master:as-master-orchestrator` 开头（容忍前导空白）；或 ② expanded body——`<!-- cc-master:bootstrap:v1 -->` 是 prompt **首个非空行**（仅独立成行触发，内联提及不触发）。两者皆不命中 → 静默 `exit 0`。
- 纯 bash 提取 JSON 字段（无 jq/node·红线 1）；`sid` 经 sed 从 stdin 取。

## 业务流
1. 通过触发 gate 后，**第二道 demux**判 `--resume` 首-token（raw 路径剥前缀后测；body 路径从 `<!-- cc-master:args: ... -->` 行取回原始 `$ARGUMENTS` 再测）→ mode = fresh / resume。
2. **fresh**：在 home（`$CC_MASTER_HOME`，否则 `$CLAUDE_PROJECT_DIR/.claude/cc-master`）建 `<UTC-ts>-<pid>.board.json`（time-sortable·并发不撞）：cp `board.template.json`（缺则 inline printf 兜底），用 sed 把 `owner.session_id` 空值盖成 stdin 的 `sid`（ARM 身份）。注入 `cc-master: a fresh orchestration board was created at <path>`。
3. **resume**（`resume_main`）：① sid 空守卫——degraded stdin 绝不动既存板（重盖会把板盖成永久休眠）；② 建候选集（所有 `*.board.json`，含归档，排除本 sid 已拥有的）；③ 选板（优先级：板名/路径 > 时间戳前缀 > goal 子串·`grep -iF` 字面匹配防元字符）；④ live-safety probe（仅 `active:true` 板做：heartbeat + mtime 双通道，10min 内新鲜 → 可能 live → 无 `--force-takeover` 拒接管；无信号 → 保守拒接管）；⑤ takeover：用 awk owner-region 状态机就地重写 `owner.session_id ← sid` / `active ← true`（含复活归档板）/ `heartbeat ← takeover 时间戳`。注入 `cc-master resume: you have TAKEN OVER ...`。
4. 歧义/缺失 → **绝不写盘**，注入分两组（active-but-abandoned / archived）的消歧 context。

## 输出副作用
- fresh：新建一块 board 文件并盖 `owner.session_id`。
- resume：就地重写**选定既存板**的 owner 三字段（只动 root owner 子对象，其余字节原样·红线 2）。
- 两路都向 stdout 写 `UserPromptSubmit` additionalContext JSON 信封。

## 关键不变式
- **唯一豁免武装闸者**——它创建武装状态，不能要求先有 armed 板。
- fresh 立刻盖 `owner.session_id = stdin sid`，使「active AND session_id==sid」武装闸即刻为真。
- resume 的 owner 重写只碰 root owner 子对象（awk 深度感知扫描），`goal`/`tasks[]`/`log[]`/`git` 及嵌套 session_id-shaped 字段全原样穿过（红线 2）。
- 空 sid 的 fresh 板 = 异常（停留 dormant，不被任何非空 sid 收养），靠显式 re-arm 认领。
- `--num_account` 已删（A2 T6）——effective-N 由 `usage-pacing.js` 从 accounts.json 算，bootstrap 不再 stamp。

## 失败模式
- degraded stdin（无 session_id）走 resume → 立即拒绝、不动任何板（fail-safe）。
- 板可能 live（10min 内新鲜）且无 `--force-takeover` → 拒接管，注入提示重发带 force。
- 无可比 heartbeat/mtime 信号 → 保守要 force。
- template 缺失 → inline printf 兜底建板（仍盖真 sid）。
