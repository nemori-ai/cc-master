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

## 失效类型

`environment_fact`（主体：事实方法） —— 删了这条，agent 在后续 session 里又往 args 里传了字符串 "[1,2,3]" 而非数组 [1,2,3]，到脚本里 args.map crash。知道概念但下一回全忘。

args 全局的注入方式与「传真 JSON 而非字符串」是本工具的具体约定。

## 边界

Workflow runtime 全局约束。args 缺省为 undefined 是唯一例外。

## 失败形态

隐蔽形态：agent 传了字符串 '[1,2,3]'，运行时碰巧 stringify 的字符串能被 for-of 遍历（字符串的每个字符），逻辑跑错但没 crash，后续导致 silent bug（「为什么迭代 3 次」「为什么每次处理一个字符」）。
