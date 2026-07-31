---
point: ccm.board.watchdog
---

## 权威陈述

<!-- ccm:k:start point:ccm.board.watchdog -->
## K. watchdog：何时 arm、watchdog / legacy wakeup 字段含义

{{USING_CCM_WATCHDOG_PROBLEM}}

**何时 arm watchdog：**

| 情况 | 要不要 arm |
|---|---|
| 派发 sub-agent 后进入空转等待 | **arm**，fire_at 设为 p95 估算时刻 |
| 等用户回复（`blocked_on:user`） | 视情况——等待时间可预期时可 arm；长期等用户可不 arm |
| 短时间内就能确认（几分钟）| **不用 arm**，直接等 |
| 无 `in_flight` 任务 | **不用 arm**，没有静默失败风险 |

{{USING_CCM_WATCHDOG_HOOK_REMINDER}}

**arm 命令：**

```bash
ccm watchdog arm \
  --fire-at 2026-06-25T14:00:00Z \
  --mechanism cron \
  --job-id cron-abc123 \
  --checklist "recon T7 后台 subagent 是否还活着"
```

**mechanism 降级链（按情境选）：**

| mechanism | 适用情境 | 降级到 |
|---|---|---|
{{USING_CCM_WATCHDOG_MECHANISM_ROWS}}

{{USING_CCM_WATCHDOG_SHELL_GUIDANCE}}

**watchdog 字段含义速查（legacy board 的同形字段名为 `wakeup`）：**

| 字段 | 含义 |
|---|---|
| `armed_at` | arm 时刻（ISO-8601 UTC） |
| `fire_at` | watchdog 预定触发时刻（ISO-8601 UTC·严格定宽） |
| `mechanism` | 使用的唤醒机制（cron/loop/monitor/shell） |
| `job_id` | **必填 nonblank string**；{{USING_CCM_WATCHDOG_JOB_ID_GUIDANCE}}。没有真实 handle 就不要 arm |
| `checklist` | 被唤醒后逐一检查的事项清单 |

**退役 watchdog 必须两件一起做：**

```bash
# 1. 取消外部调度任务（如果用了 cron）
{{USING_CCM_WATCHDOG_CANCEL_GUIDANCE}}

# 2. 从 board 删除 canonical watchdog + legacy wakeup 整字段
ccm watchdog disarm
```

{{USING_CCM_WATCHDOG_DISARM_WARNING}}

**存量不健康记录的 self-heal：** `ccm watchdog status --json` 会把缺失 / 空白 `job_id` 与过期
`fire_at` 都报告为 `health.armed:false`，并给出 `code` / `action`；先 `disarm`，再创建真实机制、拿到
handle，最后重新 arm。legacy 缺 handle 只触发 `FMT-WATCHDOG` warn，不会卡死其它合法写入。

**过期 wakeup 的 self-heal：** {{USING_CCM_WAKEUP_SELF_HEAL_GUIDANCE}}

---

<!-- ccm:k:end point:ccm.board.watchdog -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删除后,agent 在真实调度机制(如 cron job)还没配好、但又想尽快让 arm 命令跑通时,会用占位符填满必填的 job_id,而不是先建好真实机制再 arm,watchdog 名义上 armed 实际没人会来唤醒。

主体是 watchdog 的 arm 判据、字段含义与 disarm/self-heal 命令，属于本工具的具体机制事实。

## 失败形态

job_id 字段填了一个语法合法但语义为假的值(如复制上次的 id、填 pending),FMT 校验只查非空会直接放行,直到 fire_at 到期无人唤醒,静默失败盲区才暴露。
