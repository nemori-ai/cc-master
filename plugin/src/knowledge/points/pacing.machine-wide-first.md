---
point: pacing.machine-wide-first
---

## 权威陈述

<!-- ccm:k:start point:pacing.machine-wide-first -->
## 先全局，再下钻

1. 先读 `ccm quota status --machine-wide --json`。这是 cached-only 的全机视图，不调用 provider；把
   `summary.decisions[]` 按 `target.harness_id + target.surface_id + target.window` 绑定到候选。只有同一 target
   上的 `state`、`freshness`、`reason_codes[]` 与 source 才能组成一份 posture；不要跨 surface 拼接。
2. 选中一个 target 后，再用 `ccm --harness <target> usage show --accounts current --json` 看原始 current
   window，或用 `ccm --harness <target> usage advise --json` 读单侧 verdict。`usage` 是下钻 advisory，
   不是 machine-wide inventory，也不授权 dispatch。
3. `state:"unknown"`、非 fresh、`available:false`、窗口缺失或过期都保持 unknown；不得从 binary 存在、
   已登录、进程 RC0、同品牌另一 surface 或历史 snapshot 推断为 healthy。

完整 flags 与 JSON schema 查 `using-ccm`；不要在这里复制 provider CLI 参数。

<!-- ccm:k:end point:pacing.machine-wide-first -->
