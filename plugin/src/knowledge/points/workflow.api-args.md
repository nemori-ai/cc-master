---
point: workflow.api-args
---

## 权威陈述

<!-- ccm:k:start point:workflow.api-args -->
## `args`——注入的全局

传给 `Workflow` 工具的输入值，原样作为脚本全局暴露。**传真正的 JSON 值（数组 / 对象），
别传 JSON 字符串**——被 stringify 过的 list 会以 `string` 的形态抵达，`args.filter` /
`args.map` 一调就抛错。什么都没传时为 `undefined`。

<!-- ccm:k:end point:workflow.api-args -->
