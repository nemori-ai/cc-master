---
'ccm': minor
---

新增 `--schema`：任一 verb 上加 `--schema` 打印它 `--json` 输出的 `data` 契约（必有顶层键 / 是否数组 / 是否可为 null），不执行命令。未声明的诚实返回 `declared:false` 并说明「去读真实输出，别假设形状」——一个骗人的 schema 比没有 schema 更糟。

配套 `output-contract-conformance.test.ts`：对每条声明跑真命令、拿真输出校验必有键。这是 `--schema` 能成立的唯一理由——把 `data` 形状从文档副本挪进 registry 本身不解决漂移，换个文件后缀不等于拿到 SSOT。已变异验证：把声明里的键改个名，该用例当场红。

首批声明 4 条（`task show` / `task list` / `board show` / `goal check`），只读 verb 共 59 条。覆盖率由用例打印、**不设下限**——设一个能过的下限等于给自己发通行证。

同时让读不到时的沉默可被陈述：`task show <不存在 id>` / `jc show` 的 `--json` 输出在 `data:null` 之外附加 `not_found:true`；human 侧带上问的是哪个 id（`(无此任务：T404)`）。读不到不是错误，`ok`/exit code 不变，`data` 仍是 `null`——按 `data === null` 判断的既有调用方不受影响。此前 `data:null` 与「字段确实是 null」在调用方看来一模一样：接口能陈述它做了什么，却无法陈述它「什么都没查到」。
