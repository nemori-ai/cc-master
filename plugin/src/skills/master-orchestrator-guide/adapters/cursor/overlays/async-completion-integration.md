## 整合各项完成 —— handle 完成或 watchdog recon 时

Cursor 下不要等待其他 harness 的后台完成通知语义。当 Task subagent 完成（`subagentStop`）、后台 Shell 退出（AwaitShell）、CI run 完成，或 watchdog 叫你回来 recon 时：

1. **对账 board（reconcile）** —— 用记录的 subagent id / shell id / run URL 查地面真相，把完成结果折回节点，端点验收后再标 `done`。
2. **解锁新就绪** —— 凡是最后一条依赖刚被满足的节点，转为 `ready`。
3. **在 WIP 内派发** —— 在 WIP cap 内启动这些新就绪的节点。

这就是决策程序里“完成即整合”的那一半（step 1 + step 3）：可观察完成的 handle 直接整合；没有自动通知的 handle 用 AwaitShell / 外部 scheduler 回来 recon。关键是不在前台 busy-poll，也不把无 handle 的想象进度当在飞任务。
