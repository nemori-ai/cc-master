在整个本机 worker pool 内，用本 host 的 Cursor **Task**（subagent）/ **Shell**（可 `block_until_ms: 0`）/ external 或 `ccm` 管理的 cross-harness worker 派发；没有真实 handle 不得标 `in_flight`。Workflow unsupported。
