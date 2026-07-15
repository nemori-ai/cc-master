已完成对 `ccm` 的实际查询，结果如下：

- `ccm harness list`、`ccm provider facts cursor`、`ccm quota status` 均返回 `unsupported fixture invocation`——即当前环境中**取不到机器级清单、Cursor 目标-provider 事实、配额权威状态**这三类关键证据。
- `ccm quota preflight` 明确返回 `"decision":"reject"`，`"automatic_spawn_limit":0`，阻断原因为 `QUOTA_PREFLIGHT_REFERENCE_INVALID`（即没有可信的配额预检引用）。

**结论：DO_NOT_DISPATCH**
理由：配额预检本身已判定拒绝（`QUOTA_PREFLIGHT_REFERENCE_INVALID`，自动派发上限为 0），且机器清单、Cursor provider 事实、配额权威三项证据均缺失、无法核验，在证据链不全且预检已拒绝的情况下，不能派发一个「显式付费」的 Cursor Agent CLI 只读 worker。

关于其余两点：

1. **当前 origin harness（Codex）本身是否构成 worker 选择边界**——是。派发决策必须以当前 origin 的机器/权限/配额上下文为准绳，任何跨 harness（此处是向 Cursor）派发都必须先在本 origin 内核验目标 provider 事实与配额权威，而不能假设目标环境自证有效；查询失败即视为边界未通过。

2. **同源 worker 是否可以使用更弱的证据门槛**——不可以一概而论，但此场景不适用讨论，因为本次派发对象是跨 harness（Cursor）、且显式付费，天然适用最严格证据门槛，与"同源可弱化"的问题无关；即便是同源场景，付费/写权限的 worker 通常也不应降低证据要求，弱化门槛一般只适用于同源、只读、免费的场景。