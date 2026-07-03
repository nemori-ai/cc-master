executor 值定了「谁负责」；真把活跑起来只有三种后台机制（就本插件的用途，没有别的）：

- **sub-agent（`run_in_background`）** —— 跑 `subagent` executor 的活。一个终端推理单元后台并行、骑完成通知重入。
- **Workflow 工具** —— 跑 `workflow` executor 的活：对多个叶子的确定性控制（确定性、有日志、可续）。
- **后台 shell** —— 可机械检查的执行（build / test / 拉数据 / 监听 / poll CI），零 token 成本；也是你**等外部状态**的方式（等 `external` 的 CI、等你 `master-orchestrator` 要处置的远程队列 / 审批超时）。必须配齐 **timeout + success predicate + log 捕获**，且失败必须能路由到一个下游推理节点（否则就拆成「一个 shell 执行节点 + 一个 subagent 诊断节点」）。

`master-orchestrator`（你自己做）和 `user`（surface）**不经后台机制**——前者是你亲手做，后者靠前台对话 + async 回答。
