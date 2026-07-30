---
point: verification.terminal-is-not-done
---

## 权威陈述

<!-- ccm:k:start point:verification.terminal-is-not-done -->
runtime terminal 只说明 child process 或 agent 停了，不说明父 task 完成。runtime 一旦停止，无论 artifact 后续能否通过验收，都先终结 agent 登记（terminalize）并记录它的实际 outcome；不要让已停止的 runtime 因父 task 尚未验收而变成 zombie running agent。这个 runtime 生命周期更新不是 task verdict。

然后你在自己的端点收割 artifact，并独立核对 diff、tests、acceptance、必要的全局 contract 与 content hash；高杠杆或 correctness-critical 结果再加异构族系第二视角。只有证据通过，才把 task 标成 done / verified。验收失败时 task 保持 active，再 retry 或 replan；也可按证据 supersede 或 surface，但不静默放行。

external issue closed、CI green、空 review 与 worker 自报成功都只是验收输入。若仅需说明 terminal ≠ done 以及通过 / 失败时的 task 转移，本节已经足够，不得继续打开 `resume-verify.md`；只有要实际执行 artifact / diff / tests / hash / 异构第二视角的完整验收步骤时，才读 [`resume-verify.md`](resume-verify.md#3-端点验收--唯一可靠的正确性点)。

<!-- ccm:k:end point:verification.terminal-is-not-done -->
