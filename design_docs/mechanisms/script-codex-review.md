# 机制契约：`skills/orchestrating-to-completion/scripts/codex-review.sh`

> 类别：运行时带外脚本（codex 第二端点验收者·NOT a hook·随 skill 分发）。源码：`skills/orchestrating-to-completion/scripts/codex-review.sh`。纯 shell 封装 `codex exec review`，对一段 diff 出 verdict。

## 触发输入
- 主线在端点验收节点手动/编排调用。用法 `codex-review.sh [--base <branch>]`（默认 main）。
- 依赖：codex CLI（已 OAuth 登录）。env `CODEX_REVIEW_MODEL`（默认 gpt-5.5）。

## 业务流
1. 解析 `--base`（或位置参数）；`MODEL` 从 env。
2. 核心调用 `codex exec review --base "$BASE" -m "$MODEL" -c model_reasoning_effort=high -c sandbox_mode='"read-only"' --json -o "$OUT" < /dev/null`：`< /dev/null` 防 stdin 死锁；强制 read-only sandbox（reviewer 绝不改 repo·Finding #21）；不传自定义 PROMPT（codex 禁 custom prompt 与 scope flag 共存·Finding #20，它从 AGENTS.md 读 review 约定）。
3. 出 verdict（approve | needs-attention，符合 openai-codex review-output.schema.json）。

## 输出副作用
- temp `$OUT`（trap EXIT 清）。stdout 打印 verdict JSON。
- **退出码语义**：调用失败 → exit 2（CODEX_REVIEW_FAILED）；空/纯空白 review → exit 2；正常 → 打印 verdict。

## 关键不变式
- **silent-pass-through guard**：空 review / 失败调用一律按「未通过」处理（exit 2），null/缺 verdict 绝不是静默放行。
- verdict 映射 Joiner 闸：`needs-attention` → Replan；`approve` + 非空 + 已读 diff → done；空/失败（exit 2）→ NOT passed。
- reviewer 强制 read-only sandbox（绝不改 repo）。
- 绝不进 hooks/（红线 1/5：要联网/OAuth/多分钟超时/JSON 解析，破纯 bash ship-anywhere）——只以带外端点验收节点形态接入。

## 失败模式
- codex 调用失败 / OAuth 过期 → exit 2（按未通过处理，不静默放行）。
- 空 / 纯空白 review → exit 2。
