---
point: verification.terminal-is-not-done
---

## 权威陈述

<!-- ccm:k:start point:verification.terminal-is-not-done -->
runtime terminal 只说明 child process 或 agent 停了，不说明父 task 完成。runtime 一旦停止，无论 artifact 后续能否通过验收，都先终结 agent 登记（terminalize）并记录它的实际 outcome；不要让已停止的 runtime 因父 task 尚未验收而变成 zombie running agent。这个 runtime 生命周期更新不是 task verdict。

然后你在自己的端点收割 artifact，并独立核对 diff、tests、acceptance、必要的全局 contract 与 content hash；高杠杆或 correctness-critical 结果再加异构族系第二视角。只有证据通过，才把 task 标成 done / verified。验收失败时 task 保持 active，再 retry 或 replan；也可按证据 supersede 或 surface，但不静默放行。

external issue closed、CI green、空 review 与 worker 自报成功都只是验收输入。若仅需说明 terminal ≠ done 以及通过 / 失败时的 task 转移，本节已经足够，不得继续打开 `resume-verify.md`；只有要实际执行 artifact / diff / tests / hash / 异构第二视角的完整验收步骤时，才读 [`resume-verify.md`](resume-verify.md#3-端点验收--唯一可靠的正确性点)。

<!-- ccm:k:end point:verification.terminal-is-not-done -->

## 失效类型

`motivation_conflict`（主体：行为约束） —— 删除后,压力下 agent 会把 CI green、外部 issue closed 或 worker 自报成功直接当验收结论,把父 task 标 done,而不是独立核对 diff/tests/acceptance。

要求 runtime 停止后仍在端点独立验收才标 done，采信 worker 自报/CI 绿更省事。

## 边界

本条只适用于任务由可产出证据的 agent/worker runtime 执行的场景;若任务本身没有可终止的 runtime(纯人工操作、或已有外部权威记录),不存在 terminal 与 done 被混淆的风险,该判断不适用。

## 为什么它随模型变强而更重要

强模型更擅长把 CI 已经覆盖、worker 报告详实可信这类观察组织成一套逻辑自洽的论证,用分析语言包装这次不必再独立核验的决定,让跳过独立验收显得是经过权衡的合理判断。

## 失败形态

表面上流程齐全——runtime 终结、task 状态也更新了,但更新是在同一拍内连带完成的,并没有真正插入独立核对 diff/tests/acceptance 这一步,只是把 runtime 停止的事实包装成了验收通过的结论。
