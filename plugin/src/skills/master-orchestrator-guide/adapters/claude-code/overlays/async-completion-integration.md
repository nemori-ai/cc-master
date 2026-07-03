## 整合各项完成 —— 收到 `<task-notification>` 时

当一个 `<task-notification>` 到达：

1. **对账 board（reconcile）** —— 把完成的后台结果折回它的节点，标 `done`（在端点验收之后——见 `resume-verify.md`）。
2. **解锁新就绪** —— 凡是最后一条依赖刚被满足的节点，转为 `ready`。
3. **在 WIP 内派发** —— 在 WIP cap 内启动这些新就绪的节点。

这就是决策程序里"收到通知即整合"的那一半（step 1 + step 3）：你不轮询；通知驱动对账，对账驱动下一次派发。
