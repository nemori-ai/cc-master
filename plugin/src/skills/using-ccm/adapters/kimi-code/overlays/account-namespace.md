kimi-code host 当前**不支持账号池管理 / 换号**。`ccm account add/delete/refresh/list/switch` 走到时必须显式报 `NotImplemented` 或 unsupported；不要读取或覆写其他 harness 的 credential store，也不要把账号池当 kimi-code 可用容量。

这不影响 Kimi 的只读用量面：`ccm usage show/advise` 会从 `kimi-usages-api` 读取当前登录态的独立滚动 5h + 7d 窗口。存储 OAuth 已过期时，collector 默认在相邻锁内重读并尝试原子刷新；自动刷新失败仍保留 `kimi -p 'hi'` 的 harness-native recovery hint。`burn-rate` 仍只按它自身支持的窗口合同判断，任何不可得字段保持 unknown，不伪造百分比。
