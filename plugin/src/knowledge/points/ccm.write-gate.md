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
