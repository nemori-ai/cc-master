账号池 namespace 不对 Cursor 可用：`ccm account add` / `refresh` / `list` / `switch` 统一走 `NotImplemented`；仅保留 `usage` 对当前账户 billing_period 的只读 advisory。
