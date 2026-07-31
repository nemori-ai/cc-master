---
point: ccm.board.antipatterns
---

## 权威陈述

<!-- ccm:k:start point:ccm.board.antipatterns -->
## M. 决策树 / 反模式深化

### footgun 深化（比 SKILL.md 更详细的操作原因分析）

**footgun 1：`--set status=done` 想绕状态机**

```bash
# ❌ 错误（exit 3：裸 path 在 task verb 语境 scope 到本 task，status 是 🔒 字段被守门拒）
ccm task update T3 --set status=done

# 历史注：旧版 ccm 裸 path 落 board 顶层——这条命令曾 exit 0 却写出一个顶层 junk 字段、
# 任务 status 纹丝不动。现在裸 path 作用于本 task，🔒 守门当场拒，不再有静默错落点。

# ✅ 正确
ccm task done T3 --artifact /abs/output.md --verified
```

**footgun 2：`ready → done` 非法（必须先 in_flight）**

根因：ccm 状态机强制「起跑后才能完成」——完成没有 `started_at` 的任务等于在 board 里声称一件事完成了、却没有「什么时候开始做」的记录，是审计轨迹的谎言。

```bash
# ❌ 错误（exit 3: ready → done 非法;即便已 in_flight,缺 --verified/--artifact 也会被 BIZ-DONE-VERIFIED 拒绝）
ccm task done T3

# ✅ 正确（两步）
ccm task start T3          # ready → in_flight，盖 started_at
ccm task done T3 --verified --artifact /abs/output.md   # in_flight → done，盖 finished_at，带 true-done 证据
```

**footgun 2b：用 generic verb / `--force` 修 native-active projection**

```bash
# ❌ 都会被 mutation boundary 拒绝；--force 不是 native 专属状态机的逃生口
ccm task start T3 --force
ccm task update T3 --handle guessed-child
ccm task route-bind T3 --selection @selection.json --attempt @attempt.json --force

# ✅ 只让 dedicated writer 消费 ccm 私有认证 evidence
ccm task native-attempt-bind T3 --attempt-id attempt-1 --evidence-record-ref evidence:bind-1

# terminal 只到 uncertain；父层独立验收后才走普通 true-done
ccm task done T3 --verified --artifact /abs/output.md
```

**footgun 3：重跑只改 status，沿用旧完成证据**

```bash
# ❌ 错误：字段 setter 不能原子清时间、artifact、verified、review_verdict，也可能把 false 写成字符串
ccm task update T3 --set verified=false

# ✅ 正确：旧证据进 append-only log，当前 attempt 从干净的 ready 开始
ccm task set-status T3 stale
ccm task retry T3
ccm task start T3
```

**footgun 4：给 parent 节点加真实的子级 deps**

```bash
# ❌ 反模式：PHASE1 依赖 T_prev（另一个 owner 的子节点）
ccm task update PHASE1 --add-dep T_prev

# 语义问题：等于说「整个 PHASE1 的全部子任务都在等 T_prev」
# 实际意图几乎总是：只有 PHASE1 里的某一个子节点在等 T_prev

# ✅ 正确：把依赖连在叶节点上
ccm task update T1 --add-dep T_prev    # 只有需要 T_prev 的那个子 task 等它
```

**footgun 4：`board update --set goal=…` 想经通用逃生口改 🔒 字段**

```bash
# ❌ 错误（exit 3：goal 是 board 顶层 🔒 字段，--set 被守门拒）
ccm board update --set goal="新目标"

# ✅ Goal Contract board：走 revisioned 专属生命周期
ccm goal amend --summary "新目标" --reason "用户改变范围" --assurance asserted

# ✅ 仅没有 goal_contract 的 legacy board 可走旧具名 flag
ccm board update --goal "legacy 新目标"

# board update 的 --set/--set-json 是板级顶层 ✎ 字段的正门（裸 path 落 board 顶层）：
ccm board update --set notes="收尾备注"
```

**footgun 5：退役 watchdog 只做一件**

```bash
# ❌ 只 disarm，外部 cron 没取消
ccm watchdog disarm    # board 的 watchdog / legacy wakeup 字段删了，但 cron 还在跑

# ❌ 只 CronDelete，board 没清
# （board 里仍有 nonblank handle + future fire_at，读侧无法知道外部机制已消失，仍会认为 healthy）

# ✅ 两件一起做
# 1. CronDelete <job_id>（在工具层）
# 2. ccm watchdog disarm（board 端）
```

**footgun 6：`task show <id>` 返回 data:null 不报错（exit 0）**

```bash
# ❌ 容易踩：id 不存在时 exit 0，data 是 null
ccm task show T_nonexistent --json
# → {"ok": true, "data": null}   exit 0

# ✅ 调用方自己判 data 是否为 null
RESULT=$(ccm task show T99 --json)
if echo "$RESULT" | grep -q '"data":null'; then
  echo "T99 不存在"
fi
```

**footgun 7：ISO 时间字段非严格 UTC**

```bash
# ❌ 本地时区（lint FMT-TIME warn，viewer 跨天算时长会错）
--deadline "2026-06-25T18:00:00+08:00"

# ❌ 带毫秒（格式不匹配 YYYY-MM-DDTHH:MM:SSZ）
--fire-at "2026-06-25T18:00:00.000Z"

# ✅ 严格 UTC 定宽
--deadline "2026-06-25T10:00:00Z"  # UTC 时间（原 +08:00 减 8 小时）
```

### 多 active board 消歧

当 home 里有多个 active board 时，不带限定词的命令会报 `Ambiguous`：

```bash
# ❌ 报错：多个 active board
ccm board show

# ✅ 按 goal 子串消歧
ccm board show --goal "i18n"

# ✅ 或直接指定文件路径
ccm board show --board /abs/path/to/20260625T120000Z-12345.board.json
```

---

<!-- ccm:k:end point:ccm.board.antipatterns -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删掉后模型仍通用地知道状态机、清理、时区该怎么处理的一般原则，但不知道这个具体工具在这些点上的实际怪异行为（如查询不存在的 id 仍 exit 0、--force 在特定状态下被拒、清理要两端同时做），会凭常识做出在这个系统里实际错误或不完整的操作。

删掉后不知本工具状态机/命令的具体踩坑与正确 ccm 用法。

## 失败形态

最容易被忽略的是"看起来已经处理完整，实际只处理了状态机的一半"——退役某个由外部与内部两端共同维护的状态时，只操作了其中一端，另一端仍存活，读侧继续误判为健康；以及把查询命令的 exit 0 当成"存在且成功"，不检查返回内容是否为空。
