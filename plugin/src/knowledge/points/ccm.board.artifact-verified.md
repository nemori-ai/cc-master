---
point: ccm.board.artifact-verified
---

## 权威陈述

<!-- ccm:k:start point:ccm.board.artifact-verified -->
## L. references、artifact、verified 语义

### references（任务引用）

`references` 把外部文档 / spec / issue 等链接到 task 上，让执行者不需要找人问「spec 在哪」。

```bash
ccm task add T3 \
  --ref spec:/abs/path/to/spec.md \
  --ref plan:/abs/path/to/plan.md \
  --ref web:https://example.com/api-docs
```

**ref 的 `kind` 枚举（开放，未知值 warn 不 fail）：**

| kind | 含义 |
|---|---|
| `spec` | 规格说明文档 |
| `plan` | 实现计划 / 工程设计文档 |
| `doc` | 通用文档 |
| `web` | 外部 URL |
| `code` | 代码文件路径 |
| `issue` | 外部 issue / ticket（executor=external 时必须有） |
| `other` | 其他 |

`kind=issue` 的 URL 是 tracking anchor。它让 orchestrator 能回到同一个 GitHub issue / ticket 看外部进度、评论、链接出的 PR；它本身不是 artifact，也不是 done 证据。

**lint 强制（BIZ-DEV-REFS·hard）：** `type=development` 的 task 必须有 `kind=spec`≥1 且 `kind=plan`≥1。缺失会**拒绝落盘**（`exit 3`，`--force` 可越）——执行者不该拿到一个没有 spec/plan 链接的 development task 就蒙着头开始做，而不是基于设计文档。修法：`ccm task update <id> --add-ref spec:/abs/spec.md --add-ref plan:/abs/plan.md`。

**ref 的格式约束（FMT-REF·hard error）：** `ref` 值必须是绝对路径（`/abs/path`）或 URL（`http(s)://...`）。**禁止相对路径**（如 `./docs/spec.md`），因为 board 会跟随编排 home 移动，相对路径解析基准会漂移。

### artifact（产物链接）

`artifact` 是 task 完成后的产出链接。

```bash
# done 时顺手带上
ccm task done T3 --artifact /abs/path/to/output.ts --verified

# 或分开设
ccm task update T3 --artifact /abs/path/to/output.ts
```

**「done 真语义」三要素（BIZ-DONE-VERIFIED·hard）：** `status=done` ∧ `verified=true` ∧ `artifact` 非空。这是完整意义上的「真的做完并验了」。缺 `--verified` 或缺非空 `--artifact` 时,`ccm task done` 会在写入关卡被拒绝落盘(exit 3);若还没端点验收或没有产物,先别标 `done`,用 `uncertain` / `in_flight` / `stale` 等真实状态。

**external artifact 额外边界（BIZ-EXTERNAL-ARTIFACT·warn）：** 对 `executor=external` 的 task，`artifact` 应是外部实际产出（PR / commit / release / report / CI run 等）。如果 `artifact` 只是同一个 `kind=issue` URL，lint 会 warn：issue link 是 tracking anchor；issue closed 不等于 board done。

### verified（端点验收布尔）

`verified` **不是 status enum 的一个值**——它是与 `status` 正交的独立布尔标记。

```
status = "done"   ← 状态机里的终态
verified = true   ← 端点验收通过
```

两者正交：一个 task 可以 `status=done`（结束了）但 `verified=false`（没有端点验收过）。

重跑时 `task retry` 会把旧 `verified`（包括 `true`）归档后将当前值设为真正的布尔 `false`；不要用 `task update --set verified=false`，通用 `--set` 的值是字符串，且它不能替代完整的 attempt reset。

**什么时候设 verified：**
- sub-agent 跑完、你作为 orchestrator 做了独立的端点验收（不信 leaf 的自报）之后
- `run-tests.sh` 全绿 + `plugin validate` 过了之后
- 不要在没有独立验收的情况下设 verified（等于伪造审计轨迹）

---

<!-- ccm:k:end point:ccm.board.artifact-verified -->
