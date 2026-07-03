> Codex 当前只支持**当前账户** 5h/7d 用量：ccm 通过 `codex app-server --stdio` 的 `account/rateLimits/read` 读取账户权威信号。账号池 registry / 备号快照在 Codex 下不作为可切换容量使用；缺信号则 `available:false` 降级。
