# 机制契约：`skills/master-orchestrator-guide/scripts/board-lint.js`

> **⚠️ 已退役（ADR-014 解耦后·被 `ccm board lint` 取代）。** 该 skill 版脚本已从仓库删除——board lint 引擎已迁入独立安装的 `@ccm/engine`，独立手动 lint 现走 `ccm board lint`（`--board <path> --raw --json` 直读指定 board）。本文正文保留作历史，**不再是 live 机制**。

> 类别（历史）：运行时带外 node 脚本（独立手动 board lint·NOT a hook·随 skill 分发）。源码（已删）：`skills/master-orchestrator-guide/scripts/board-lint.js`。复用 hook 同一份 lint 核心（`hooks/scripts/board-lint-core.js`），补 PostToolUse hook 看不见的编辑路径（尤其 Bash 改 board）。

## 触发输入
- 主线/agent 显式调用。CLI：`node board-lint.js <board-path>` / 无参（lint home 下唯一 active 板）/ `--json [<path>]`。
- require 共享核心：经 plugin 内相对路径 `path.resolve(__dirname,'..','..','..','hooks','scripts','board-lint-core.js')`（两目录都随 plugin 分发、一起 ship，装机后稳定）。
- 无参时 home = `$CC_MASTER_HOME`（否则 `$CLAUDE_PROJECT_DIR/.claude/cc-master`）。

## 业务流
1. 解析 `--json` + board 路径。无路径 → `findSingleActiveBoard`（home 里唯一 active 板；0 块或多块 → die rc 2 提示传显式路径）。
2. 读 board 文本 → 跑 `lintBoard`（同 board-lint-core.js 的 R1-R6 规则集）。
3. `--json` → 打印 `{errors,warnings}`；否则 `formatReport`（PASS / FAIL 分组报告）。

## 输出副作用
- 无（纯只读 lint）。stdout 报告 / JSON。**退出码**：0 = 无 hard error（可能有 warning）；1 = ≥1 hard error；2 = usage/IO 错。

## 关键不变式
- **显式调用、不需武装闸**（武装闸防 hook 在无关 session 自动出声；显式跑就是想要它跑·与 cc-usage.sh/codex-review.sh 同）——对任意给定 board 路径都 lint（想查归档板也行）。
- 复用 hook 同一份核心（DRY 零漂移·content 测试断言两消费者一致）；核心住 `hooks/scripts/`（依赖方向 skill→hooks 合法·红线 5）。
- node/JS only（红线 1·ADR-006）。
- prose 引用核心用 `${CLAUDE_PLUGIN_ROOT}` / plugin 内相对，绝不裸相对（Finding #38 落点纪律）。

## 失败模式
- home 无 active 板 / 多块 active → die rc 2 提示传显式路径。
- 读不到 board 文件 → die rc 2。
- 内部异常 → agent-friendly 错（非裸 stack trace）+ rc 2。
