# Routing hub behavior comparison runbook

Composer 2.5 在当前 Cursor 官方文档中只是 first-party pool identity，不是已证明的 executable target。Agent CLI / IDE 的精确 surface binding、selector、version、effort、entitlement 与 T1 资格都仍未知。本轮 implementation worker 受 implementation-only policy 约束，不运行任何模型端点、Track A/B 或 heterogeneous review，也不把未运行对照写成行为证据。

## 物化两个 arm

1. `without-hub` 固定到 `arm-manifest.json` 的 `baseline_revision`。用 `git show <revision>:<path>` 物化 entrypoint 与列出的六份 reference，保持原文，不从候选工作树补文件。
2. `with-hub` 从待评候选 revision 物化同一 entrypoint、`worker-routing.md` 与 manifest 列出的 owner references。
3. 给每个 arm 建独立只读 bundle；运行环境不得访问仓库、网络或另一个 arm。每个 case、每个 arm 使用 fresh session。
4. 在 entrypoint 前追加同一条记录要求：回答前输出你依次打开的 bundle 文件；entrypoint 不计 drill，每打开一份 reference 计一次。不得把多个文件预拼成一个假 reference。

## 运行与盲评

1. 先把 Composer 2.5 只记为 Cursor first-party pool candidate，不把 pool 名当 surface，不从本 board 的本地调用推导 provider 事实。只有当前官方来源同时建立 Agent CLI 或 IDE 的精确 surface、selector、version、effort、entitlement 与 T1 资格后，才可把它物化为 reviewer。没有 exact qualification 就保持 `BLOCKED_UNQUALIFIED_JUDGE`，不换成其他 selector、model、surface 或 provider family。
2. 对 `cases.json` 中每个 case 各跑两个 arm；保持 prompt、随机性设置和输出上限一致。原始输出按 `<case>/<arm>/run-1.json` 保存，至少包含 `files_opened_in_order` 与 `answer`。
3. 隐去 arm 名称后，把配对答案与 drill 记录交给 `grader-prompt.md`；rubric 的每条 load-bearing assertion 都须逐项判。
4. 只有 `grader-rubric.json` 的 success contract 满足时，才允许声称 hub 带来可复现 uplift。单看结构测试通过、或 without-hub 恰好答对但多次 drill，都不能改写原始结果。

## 结果记账

把执行元数据、原始 run 路径、逐项判决、drill count 与 unblinded comparison 写入 `results.json`。保留失败样本；不要只挑最好的一次。若 policy、资格或工具阻塞，记录 blocked 原因，不把它算作通过或失败。
