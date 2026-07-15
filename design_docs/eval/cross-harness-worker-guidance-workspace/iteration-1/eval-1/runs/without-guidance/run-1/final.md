查询结果如下：

- `ccm harness list`、`ccm provider facts cursor`、`ccm quota status` 三项均返回 `unsupported fixture invocation`（exit 3），即机器级清单、Cursor 目标-提供方事实、配额权威状态**均查询不到、不可用**。
- `ccm quota preflight` 唯一有响应，但结果是 `"decision":"reject"`，`"automatic_spawn_limit":0`，`"blocking_reasons":["QUOTA_PREFLIGHT_REFERENCE_INVALID"]`——即没有已提交的配额预检引用，配额权威直接拒绝、自动派发额度为零。

三项关键事实（目标机器/surface、Cursor provider facts、配额授权）一项不存，唯一可查的配额预检还是硬性 reject。在这种"举证真空+配额已拒"的情况下，绝不可派发一个**明确付费**的 Cursor Agent CLI worker，哪怕它是只读的。

**DO_NOT_DISPATCH** — 机器/surface/quota 清单查询全部失败，唯一可用的配额预检明确拒绝（引用无效、自动派发上限为零），缺乏派发付费 worker 所需的最低举证。

补充说明：
- Cursor IDE 与 Cursor Agent CLI **不是**可互换的同一 surface，二者是两个独立的接口/运行环境，各自需要独立的 provider facts，不能用一方的事实替代另一方。
- 留在当前 harness（Claude Code）内选择 worker，**不会**允许更弱的举证标准——无论最终派发目标在本 origin 内还是跨 harness，机器/配额/权限事实的验证门槛是一致的，"图省事留在本 harness" 不能作为降低举证要求的理由。