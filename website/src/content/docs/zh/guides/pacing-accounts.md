---
title: 配额配速与号池
description: 读真实窗口、接引擎的 verdict、只在有授权时换号——并且绝不让 token 碰到 agent 的 context。
section: guides
order: 5
deeper:
  - label: pacing-and-estimation SKILL.md —— 消费侧纪律
    url: https://github.com/nemori-ai/cc-master/blob/main/plugin/src/skills/pacing-and-estimation/canonical/SKILL.md
  - label: 'ADR-024 —— 单侧配速：throttle、switch、stop'
    url: https://github.com/nemori-ai/cc-master/blob/main/adrs/ADR-024-single-sided-pacing-switch-stop.md
  - label: ADR-016 —— 板级授权与换号 policy 硬闸
    url: https://github.com/nemori-ai/cc-master/blob/main/adrs/ADR-016-board-scoped-orchestrator-authority.md
---

长编排的生死系于配额窗口。cc-master 的经验法则：**引擎出 verdict，orchestrator 做判断，授权来自你**——绝不来自 agent 自己。

## 信号从哪来

在 Claude Code 上，cc-master 的 status line 自动喂出 5h/7d 配额 sidecar（你第一次跑 `ccm` 命令时自动安装；`ccm statusline uninstall` 可恢复你原来的）。每个 harness 的态势落进一份全机缓存，任何 session 都能读：

```bash
ccm quota status --machine-wide --json        # 所有受支持 target 的缓存态势
ccm --harness claude-code usage show --json   # 下钻某个 target 的当前窗口
ccm --harness claude-code usage advise --json # ……以及它的 verdict
```

缺失、过期或 schema 不匹配的信号如实报 `unknown` / `available: false`——缺口绝不读成「配额充足」。每个决策都绑定到一个精确的 `harness + surface + window`；绝不跨 surface 拼平均。

## 五种 verdict

`ccm usage advise` 对选中的 target 返回一个单侧 verdict：

| Verdict | 含义 | 典型响应 |
|---|---|---|
| `hold` | 在走廊内（或无信号） | 照常推进 |
| `throttle` | 吃紧且无健康逃生口 | 减速：降模型档、压 WIP、推迟 float 工作 |
| `switch` | 吃紧，但池里有健康备号 | 换下一份配额（仅 Claude Code） |
| `stop_5h` | 全池 5h 窗口烧穿 | 暂停派发；arm watchdog 等到 `nearest_reset` |
| `stop_7d` | 撞上 7d 硬闸 | 停止派发；把容量取舍摆给用户 |

刻意**没有「accelerate」verdict**——配额没用满就蒸发，不是编造工作的理由。verdict 附带 `strength`、证据和诚实字段；动不动、怎么动，仍是 orchestrator 的判断。

## 各 harness 的窗口不一样

| Harness | 配速窗口 | 自动换号 |
|---|---|---|
| Claude Code | 5h + 7d | 仅在既存 policy 或你明确授权下 |
| Codex | **仅 7d 硬窗**（rolling-24h 只是 advisory） | 永不 |
| Cursor | 订阅**账期**——IDE 与 Agent CLI 是两条独立 surface | 永不 |
| kimi-code | **没有任何 CLI 配额信号——完全不配速** | 永不 |

单个账号 7d 到顶意味着 `switch` 而不是 `stop`——只有全池无逃生口才真的停。

## 号池（Claude Code）

```bash
ccm account add <email>      # 录下当前登录的账号
ccm account list
ccm account switch <email>   # 覆写官方凭证，无需重启
ccm account refresh <email>  # 重新捕获将过期的 token
ccm account delete <email>
```

三重保证让这件事安全：

- **policy 硬闸。** board 可设 `policy.autonomous_account_switch: deny`，`switch` 随即以 exit 7 拒绝——在引擎里、碰任何凭证之前检查。授予这份权限是用户行为（`--user-authorized`）；agent 绝不自授权。
- **token-blind。** token 只活在 OS keychain 或 `0600` vault 文件里，且只在 `ccm` 子进程内移动。registry 存的是*指针*，绝不是值；任何 token 都不会进 agent 的 context、transcript、board 或日志。
- **诚实的枯竭。** 池里每个账号都顶着硬闸时，选号返回「无可用」，把局面摆给你，而不是盲切进一堵墙。

Codex、Cursor、kimi-code 没有号池，也永不自动换号。

## 先预测，再投入

配速告诉你烧多快；估算告诉你计划到底装不装得下：

```bash
ccm estimate forecast --json          # 数千次 Monte Carlo 模拟出的 P50/P80/P95 ETA
ccm estimate risk --json              # 哪些任务最可能拖期
ccm estimate cost-to-complete --json  # 剩余 backlog 总共要烧多少配额 %
```

预测自带覆盖率和置信度字段，以及一堵诚实硬墙——P95 封顶，绝不装出 100%。当 throttle verdict 遇上一个窗口里已经装不下的 P80 ETA，这份张力就是一个用户决策：缩范围、换号、还是等 reset。
