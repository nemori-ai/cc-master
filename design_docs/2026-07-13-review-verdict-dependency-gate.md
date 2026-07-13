# Review verdict dependency gate — 最小领域契约

> Date: 2026-07-13
> Scope: `@ccm/engine` deps 门控、ccm task 写命令与 `using-ccm` 派生操作视图。
> Evidence: Dogfood Finding #84。

## 问题与统一语言

review task 的 `status=done` 只表示 **review execution completion**：reviewer 已执行、报告已落盘并经端点确认。它不等于 **review approval**：报告结论满足下游 acceptance。

下游是否可消费一个 review task 由显式 **dependency gate** 决定。没有显式 gate 的 legacy task 继续沿用 `status=done` 即满足依赖；显式 review gate 只有得到精确 `APPROVE` verdict 才满足依赖。

## 数据契约

新增两个 `tasks[]` 柔性字段（tier `✎`，不进入 narrow waist）：

```json
{
  "dependency_gate": {
    "kind": "review",
    "required_verdict": "APPROVE"
  },
  "review_verdict": "APPROVE"
}
```

- `dependency_gate` 是声明；v1 只支持精确形状 `{kind:"review", required_verdict:"APPROVE"}`。
- `review_verdict` 是执行结果；合法非空值为 `APPROVE | REQUEST-CHANGES`。
- `review_verdict` 缺失、空串、`null`、未知值都不满足 review gate。
- `status`、`verified`、`artifact` 的既有真完成契约不变；负向 review 可以诚实地 `done + verified + artifact + review_verdict:"REQUEST-CHANGES"`，因为 review 工作本身确已完成。

## 共享判定

引擎提供唯一具名谓词 `dependencySatisfied(task)`：

```text
task.status !== done                         => false
task.dependency_gate 缺失                    => true   (legacy compatibility)
task.dependency_gate 是合法 review gate      => task.review_verdict === APPROVE
task.dependency_gate 存在但形状非法           => false  (fail closed)
```

`reconcileGating`、`board-graph-core.readySet` 与 `BIZ-STATUS-DEPS` 必须复用这一个谓词，禁止各自重写 verdict 判断。

## 写命令契约

- `ccm task add|update <id> --review-gate APPROVE` 原子写入 review dependency gate。
- `ccm task done <id> --review-verdict APPROVE|REQUEST-CHANGES --verified --artifact <ref>` 在完成 review execution 时原子记录 outcome。
- 对没有合法 review gate 的 task 使用 `--review-verdict` 必须 fail loud，避免孤儿 verdict 被误当成有约束力的审批结论。
- 已声明 review gate 的 task 可以不带 verdict 完成 execution；写入合法，但 gate 保持关闭。这样空 review 不会被伪装成失败的 execution，也绝不放行下游。

## 校验与兼容

- `FMT-DEPENDENCY-GATE`：存在时形状不合法为 hard error；避免 malformed gate 被静默忽略。
- `FMT-REVIEW-VERDICT`：存在且非合法 enum 为 hard error；缺失/`null` 允许，语义是 gate 未批准。
- 无新字段的旧板逐字保持 status-only deps 语义。
- 不解析自然语言 acceptance、不读取 review artifact 内容；机器 gate 只依赖显式字段。

## 非目标与 narrow-waist 判定

- 不新增/删除 task status，不改状态机转移。
- 不改 `tasks[].deps` 形状或边方向。
- 不让 hook 直接读取新字段；字段是 ccm engine 的可选柔性 gate。
- 不把所有 `type=acceptance` task 自动判为 review gate；必须显式 opt in，避免旧板行为突变。

因此本改动是对 deps 满足谓词的 opt-in 扩展，不改变 AGENTS.md §3 红线 2 的 hook-dependent narrow waist。

## 验收矩阵

| 场景 | review task | 下游期望 |
|---|---|---|
| legacy | `done`，无 `dependency_gate` | ready |
| negative | 合法 gate + `REQUEST-CHANGES` | blocked |
| silent | 合法 gate + verdict 缺失/空/`null` | blocked |
| approved | 合法 gate + `APPROVE` | ready |
| malformed | gate / verdict 非法 | lint hard；谓词 fail closed |
