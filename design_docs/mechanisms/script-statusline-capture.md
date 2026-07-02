# 机制契约：`skills/master-orchestrator-guide/scripts/statusline-capture.js`

> 类别：运行时带外 node 脚本（status-line 信号捕获·**NOT a hook**——是 settings.json 的 statusLine·随 skill 分发）。源码：`skills/master-orchestrator-guide/scripts/statusline-capture.js`。把账户权威 5h/7d rate_limits 从 status-line stdin 捕获落 sidecar。

## 触发输入
- 接进用户的 status line：`statusLine.command = "<脚本绝对路径> --passthrough '<原 status line 命令>'"`（用绝对路径——`${CLAUDE_PLUGIN_ROOT}` 在 statusLine.command 的展开官方未文档化·Finding #39）。
- status-line stdin JSON（含 `rate_limits.five_hour/seven_day` 的 used_percentage + resets_at——这是订阅 5h/7d 权威信号**唯一**出现的地方，hook/JSONL/CLI 全无）。
- env：`CC_MASTER_RATE_CACHE`（sidecar 路径，默认 `~/.claude/.cc-master-rate-limits.json`，账户级跨 project 共享）、`CC_MASTER_NOW`（captured_at 覆写）。

## 业务流
1. 读 stdin → JSON.parse（坏 → 不解析、不写）。
2. 仅当 stdin 真带 `rate_limits` 且至少一个窗口有数值 `used_percentage` 时，落 sidecar：`{captured_at, five_hour?:{used_percentage,resets_at?}, seven_day?:{...}}`。原子写（写 temp + rename）。
3. 输出：有 `--passthrough` → 捕获后透传原 stdin 给原命令、原样输出其 stdout（用户状态行不变）；无 → 输出一行 `5h:NN% 7d:NN%`。

## 输出副作用
- 写 sidecar（账户级 rate-limits 缓存，被 cc-usage.sh / usage-pacing.js 读为权威口径）。**不注入 agent context、不 block、不碰 board。**

## 关键不变式
- **不是 hook**（不在 hooks/、不在 hooks.json）→ 无武装闸（无注入/无 block/无 per-session 污染，dormant-until-armed 精神不触犯·红线 6）。
- status-line 脚本绝不污染 UI——任何失败一律静默 `exit 0`（try/catch 全兜）。
- 原子写（temp + rename）——读取方永不看到半写 sidecar。
- 缺 rate_limits（非 Pro/Max，或窗口尚未在本 session 出现）→ **不写 sidecar**（不抹掉上次捕获的权威值）。
- node/JS only、零网络、零额外依赖（红线 1·ADR-006）。

## 失败模式
- 坏 stdin / 落盘失败 / passthrough 命令失败 → 静默（绝不污染 status line）。
- 非订阅账户无 rate_limits → 不写 sidecar → cc-usage/usage-pacing 降级本地反推 approx。
