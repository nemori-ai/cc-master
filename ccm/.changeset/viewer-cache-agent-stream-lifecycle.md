---
"ccm": minor
---

web-viewer #178 缓存 invalidation + agent-stream #180 per-harness 适配 + agent list stale advisory

- **#178 web-viewer same-version 缓存永不失效修复**：`web-viewer-app-dist.ts` 加 build-id marker（sha256 over bundled base64 asset map）版本内 invalidation——快路径只在 marker 匹配时返回缓存，否则 rmSync 清孤儿 + 重 materialize + marker 写最后（crash-safe）。同版本号换前端构建时缓存自动失效，不再永久遮蔽（此前 VIEW STREAM/DDL 倒计时被旧 bundle 遮蔽看不到的根因）。
- **#180 agent-stream per-harness 适配 + N-host parity**：kimi 结构化（源定位改 path-segment sid 匹配 + `parseKimiLine` 从 live wire.jsonl 推导 typed schema）；cursor 外部文本 transcript 短期方案（`CURSOR_TRANSCRIPT_PATH`）+ SQLite reader 声明 Track B；新增 agent-stream capability card 纳入 N-host parity matrix。
- **agent list stale-running advisory**：`ccm agent list` 新增只读 `stale_candidates`（active agent 的 linked task 全 `done` → 疑似漏收口候选·**绝不自动 terminal**·保守判据），落在 recon roster-rebuild 触点机械兜住"收割后忘 terminal"的注意力遗漏。
