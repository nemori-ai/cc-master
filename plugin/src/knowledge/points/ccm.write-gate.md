---
point: ccm.write-gate
---

## 权威陈述

<!-- ccm:k:start point:ccm.write-gate -->
## 心智锚 1:ccm 是 board 的写入关卡,不是事后才跑的 lint

每次动 board,**首选 ccm 命令**,而不是 `Write`/`Edit`/`sed` 直接改 board 的 JSON 文件。ccm 这一道写命令替你做四件手改做不到的事:

1. **持锁**(`.lock`·O_EXCL 原子抢占)——串行化写入,防两个写者撕裂文件。
2. **校验不变式**——FMT/GRAPH/BIZ 规则在落盘前跑;有 hard error 直接 exit 3 拒绝,坏 board 写不进去。
3. **守状态机**——非法状态转移(见锚 2)当场挡下。
4. **守 attempt 边界**——`task start` 自动盖 `started_at`、`task done` 盖 `finished_at`;`task retry` 把旧 attempt 证据（含 current `delivery` candidate/observations）归档到 log 后清空当前态的 `started_at` / `finished_at` / `artifact` / `review_verdict` / `delivery`,并把 `verified` 复位为布尔 `false`。手改 status 会漏掉这些联动,board 就此说谎。

手改 JSON 把这四道全绕过。**别因为"就改一个字段、Write 更快"在 ccm 可用时绕开它**——那一下省的几秒,换来的是绕锁、跳校验、derived 字段失真。
<!-- ccm:k:end point:ccm.write-gate -->

## 失效类型

`motivation_conflict`（主体：行为约束） —— agent 明知该用 ccm、也具备用它的能力，但会在『只改一个字段、Write 更快』的效率诱惑下说服自己这次手改没事——这正是本点原文点名要堵的那句合理化。

主体是「ccm 可用时不得为图快绕开它手改 board」，走命令比 Write 慢，是典型抄近路诱惑。

## 边界

本点只讲『为什么写 board 要走 ccm、绕开它会丢哪四样东西』这条纪律本身，不讲具体命令语法（task start/done/retry 怎么敲）、不讲哪些状态转移合法，也不覆盖『读』board 该怎么读。

## 为什么它随模型变强而更重要

模型越强，越擅长现场论证『这次手改是安全的』——它能指出这个字段孤立、当下没有并发写者、格式仍然合法，把绕开锁与校验包装成一次经过审慎判断的例外，而不是单纯偷懒。护栏要拦的正是这种有论证支持、而非无脑犯规的绕过。

## 失败形态

最隐蔽的违反是文件表面完好：JSON 格式对、字段值也看着对，但 derived 字段（如 started_at/finished_at 联动）悄悄失真、锁被绕开留下并发撕裂隐患，直到下一次 lint 或另一个写者进来才暴露，而不是在手改当场就报错。
