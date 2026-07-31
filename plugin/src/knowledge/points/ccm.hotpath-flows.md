---
point: ccm.hotpath-flows
---

## 权威陈述

<!-- ccm:k:start point:ccm.hotpath-flows -->
## 热路径速查(canonical flows)

```bash
# 起步:建 pending 板 → 转写 Goal Contract → 确认交付 DDL → 完整性检查
ccm board init                             # 永不武装·session_id 留空
ccm goal set --summary "无歧义、可验收的目标" --assurance asserted --brief-file /abs/goal.md
ccm goal deadline set --at 2026-08-01T09:00:00Z --source cli-flag --assurance asserted  # 或 confirm-none 确认无 DDL
ccm goal check --json                      # ok 后才能切 DAG；pending/deadline_pending 先 settle
ccm board show                             # goal/owner/任务统计/lint 是否净

# 派发一个任务从生到完成(端点验收后才 done)
ccm model-policy show --task implementation-from-spec --json  # 四 provider 统一角色/事实/taste；再做 target live qualification
{{USING_CCM_TASK_ADD_EXAMPLE}}
ccm task start T3                         # ready → in_flight,盖 started_at
ccm task done  T3 --artifact /abs/out.md --verified   # in_flight → done,盖 finished_at;两项证据必填
ccm task set-status T3 stale              # 上游变更使旧产物失效
ccm task retry T3                         # stale → ready;旧证据归档,当前 attempt 原子复位

# review gate:执行完成与批准分开;只有 APPROVE 解锁下游
ccm task add R1 --type review --review-gate APPROVE
ccm task start R1
ccm task done R1 --artifact /abs/review.md --verified --review-verdict REQUEST-CHANGES

# declared delivery：先声明目标与 edge 要求，再为当前 true-done attempt 做本地 proof
ccm target set main --kind git-ref --ref refs/remotes/origin/main
ccm dependency require DOWN UP --level delivered --target main
ccm task attest-delivery UP --target main --method git-commit-contained --candidate-commit <oid>
ccm dependency explain DOWN UP             # qualified|unqualified|unknown + 稳定 diagnostics
ccm delivery audit --strict-dry-run         # 只预览缺声明边；绝不打开 strict-default、绝不写板

# 阻塞等用户(必带 decision_package,否则 BIZ-AWAITING 硬闸 exit 3)
ccm task block T9 --on user --decision @/abs/decision.json
ccm task block T5 --on T2                 # 阻塞在另一个 task 上

# 调度视图
ccm next                                  # 现在能派发什么(readySet)
ccm board graph                           # 拓扑 / 环 / 临界路径 / makespan
ccm board critical-path                   # 临界链 + 工期

# 自驱决策记录 / 节奏 / watchdog
ccm jc add "选 X 不选 Y" --category architecture --severity high
ccm cadence open I1 --goal "ship 切片" --deadline 2026-06-05T14:00:00Z --members T0,T1
{{USING_CCM_WATCHDOG_ARM_EXAMPLE}}
```

全量命令、每个 flag、`--json` 输出形状 → [references/command-catalog.md](references/command-catalog.md)。
<!-- ccm:k:end point:ccm.hotpath-flows -->

## 失效类型

`environment_fact`（主体：事实方法） —— 删掉后 agent 不知道这套 canonical flow 的具体命令与调用顺序,但这纯粹是命令速查表,不含超出命令面事实的独立判断。

主体是 canonical 命令序列样板，删掉就不知道本项目怎么串起板/目标/派发/验收。
