# Routing hub behavior comparison runbook

本轮按用户显式 board policy 做 **manual user-directed** Cursor first-party T1 行为对照：精确 selector `composer-2.5`、Cursor Agent CLI `ask` mode、禁止 Auto。该授权只服务本次异构评审，不声称 provider 自动认证事实。

## 物化两个 arm

1. `without-hub` 固定到 `arm-manifest.json` 的 `baseline_revision`；按 manifest 物化 entrypoint 与 reference，不从候选工作树补 hub。
2. `with-hub` 从候选工作树物化同一 entrypoint、`worker-routing.md` 与 owner references。
3. 每个 arm 使用独立只读 bundle；不得访问仓库、网络或另一个 arm。每个 case、每个 arm 使用 fresh session。
4. 要求 subject 先读 entrypoint，再依 progressive disclosure 自选 reference；entrypoint 不计 drill，每份 `references/*.md` 计一次。

## 运行与登记

1. 每个外部 Cursor subject / judge 在启动前 `ccm agent create`，真实进程出现后 bind PID 并 link `RC4-187-HUB`；退出后先 terminalize，runtime terminal 不代替 task verdict。
2. subject 只用 exact `composer-2.5`、`ask` mode；不得用 Auto 或替代 harness。
3. 两 arm 用同一 case prompt、输出合同与只读约束；最终配对 run 都显式记录同一个 `prompt_contract_revision=fair-final-v1`。保留所有 RED 与 superseded run，不只留最好的一次。
4. tracked run 是 **normalized capture**：保留 `files_opened_in_order`、字段顺序、决定与证据主张；允许去 markdown fence、去前后闲聊及压缩重复段落。不要把 normalized capture 称为 raw transcript；PID、agent id 与实际 outcome 以 board agent registry 为准。

## 盲评

1. 取每个 case 的原 baseline 与最终 with-hub normalized capture，删除 arm 名并随机交换匿名 label。
2. 交给 fresh Cursor T1 judge，逐项判 A1–A10；judge 不知道 label→arm 映射，也不得猜哪份来自 hub。
3. A1–A9 全过才是 semantic pass；A10 要求 entry skill 后最多一个 reference drill。
4. judge 返回后先 terminalize；再 unblind 并把逐项摘要写入 `judgments/<case>.json`。

## 结果记账

三组最终同 prompt 对照的 without-hub drill count 为 2 / 4 / 4，with-hub 均为 1。三名 fresh blinded judge 分别给最终 with-hub A1–A10 全过；基线还分别出现未取证动态事实、把不合格 target 放进 fallback、terminal / endpoint 次序冲突，并全部 drill 超额。因此 `results.json` 可记可复现 uplift。任何后续合同变化都必须让两个 arm 一起重跑 subject 与盲评；结构测试不能替代本行为证据。
