---
point: verification.hash-and-stale
---

## 权威陈述

<!-- ccm:k:start point:verification.hash-and-stale -->
把动态 workflow 当成一台**增量构建引擎（incremental build engine）**。每个节点拿到一个 **content-hash** = `hash(spec + upstream outputs + key context)`，这正是 Bazel 的 **action key**。

- **跑之前先查 journal**：hash 命中 → 该节点已经做完 → **复用那个已落地的产物**（commit / PR / output）、**跳过**；miss → 执行，并写一条 journal 条目（带 output ref）。
- **compaction / 中断后的续跑 = O(changeset)**：只重跑那些输入变了、或从未完成的节点（Bazel 式增量构建）。
- **确定性守卫**（应对 AI 的非确定性）：你缓存的**不是**"重跑会产出相同的字节"——而是"一个已落地、且通过了 end-to-end 验收的产物"。验收步骤*本身*就是这份缓存的校验。一旦产物存在、并通过端点检查，该节点就 done、不再重跑。

---

## 2. 依赖 pinning / stale 检测

- **Pin 上游**：每个节点绑定它所消费的上游产物的 version / hash（board 柔性边上的 `dep_pins`）。
- **stale → 重跑**：上游产物一变，就把依赖它的节点标 `stale` 并重跑。这挡住的是"建立在过期快照上、自洽却错误的结果"——节点看着 done，其实是对照一份已经不成立的输入算出来的。

---

<!-- ccm:k:end point:verification.hash-and-stale -->

## 失效类型

`capability_gap`（主体：事实方法） —— 删掉后不会想到把动态 workflow 当增量构建引擎处理——续跑时要么全量重跑、要么只凭表面判断「看起来做完了」就跳过，而不会用 content-hash 判定复用、用端点验收结果当作缓存有效性的校验点。

主体是把 workflow 当增量构建引擎的 content-hash / journal / stale 心智模型与机制设计。

## 边界

对不可重复执行的外部副作用（发一封邮件、扣一笔款、触发一次外部通知）——缓存有效性没法靠重新验证来查，因为重新验证本身就是再执行一次副作用；这类节点只能靠一条已落地的回执记录判定，而不是靠重跑校验闸。

## 失败形态

一个节点的产物存在、journal 里也有记录，但那条记录是在上游输入还没变化前写的旧 hash——校验时只看「存在 journal 条目」就判它 done，没有重新对比当前 hash 与记录里的 hash 是否一致，一个早已 stale 的节点被当成仍然有效而被跳过。
