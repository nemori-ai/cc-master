**本 host 机制（Cursor）**：在 Cursor **已支持的模型**里换族做第二视角——不绑死某一 vendor CLI。选验收模型时对照产出方所属族：

- 产出是 **Grok / Composer（Cursor first-party）或 Claude** → 第二视角优先 **GPT·Codex 族**（如 `gpt-5.5` / `gpt-5.3-codex`），或另一 Claude 档仅当无法换到 GPT 时（同族升档仍弱于真换族）。
- 产出是 **GPT·Codex 族** → 第二视角优先 **Claude（Opus/Sonnet）或 Grok 4.5 xhigh/high**。
- 产出是 **Claude** → 第二视角优先 **GPT·Codex 或 Grok**。

落地：派一个独立 Task（review-only、显式指定异构模型），只给 diff + 验收契约，记录 subagent id / 输出文件。环境若有 `codex` CLI 可带外 `codex exec review`，那只是 GPT 族管道之一，不是唯一做法；**不要假设** Claude Code 的 `codex-review.sh` 路径。同族再派一个 Task（例如主线 Grok、二审还是 Grok）不算异构。
