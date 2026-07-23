# Track B with-skill run 2

- endpoint: Claude Code 2.1.206 / `sonnet` / high effort
- isolation: fresh, no persistence, safe mode, read-only `Read` only
- session: `5e4bb41d-cf10-48a7-b8f9-d19db2787d25`

## Final response

## Merge 就绪备忘录：Lumen（第四 host）适配

**结论：不具备合并条件，按以下顺序处理。**

### 判据来源
- `references/n-host-capability-parity.md`：事件名、文件形状或生成绿灯**不能单独决定 Track A**；判据是用户可见 intent + 可测试 acceptance 是否等价。“生成后的 dist / equivalence-class fixture / host-native probe” 才是“能力是否兑现”的证据，projection 绿灯只回答“投影是否同步”。
- `references/host-adapter-boundaries.md`：“文档与实测冲突时以实测为准，冲突写入 host base”。
- `references/source-to-adapter.md` + SKILL.md Skill adapter 纪律：canonical 只应有一份正文；host 需要改正文时用 slot/placeholder，不要 fork。
- `references/plugin-release-system.md`：多 host 场景每个 host 至少要有机制事实文档、projection check、host-native manifest/skill discovery/hook registration check、package check——不是“两个测试绿”就够。

### 逐条定性

1. **文档冲突未消解**：`compatibility-matrix.md` 与 `lumen.md` 对 Lumen 是否已发布说法矛盾，且无仲裁记录，直接违反 host-adapter-boundaries.md 的冲突处理规则。合并前必须以实测结果改一处、并在 host base 写清仲裁依据。

2. **`beforeCondense` 只能观测/记录、不能注入 recovery context**，与现有 host “压缩后注入 state”的行为不等价——这是 `protocol-capability-gap`，属于 Track B，不是“事件名对上了”的 Track A。需要 `design_docs/harnesses/capabilities/<id>.md` 补 host-neutral intent、acceptance、declared divergence、compensating mechanism（很可能对应 `role-substrate-reinject` 或类似 card）。目前无此记录。

3. **`stop` 只能附带下轮建议、不能硬阻断**，对应现有“硬阻断直到 board state safe”的语义——这不是机制差异，是能力真空（安全阻断能力缺失），直接命中 `stop-continuation-gate.md` 的核心方法论。必须作为 Track B 显式声明 divergence，不能当作等价 surface 计入“25 个匹配”。

4. **batch-completion 用 per-tool callback + 机会性 flush 近似**：同样是 Track B 补偿机制，需要 Capability Card 记录 compensating_mechanism，而不是“复制最接近实现”的隐式近似。

5. **直接把 canonical 正文 fork 进 Lumen-only 文件夹改路径示例**：违反 SAP 纪律与 source-to-adapter.md 明文要求——路径应做成中性 slot，由 `adapters/lumen/strategy.yaml` 做 path token rewrite，不应 fork 正文。这是纯架构违规，与能力等价与否无关，必须先撤销。

6. **“28 个 surface 绿”不能作为等价证据**：generated package + direct-mapping tests 只验证投影同步，未见 equivalence-class fixture 或 host-native probe，达不到 n-host-capability-parity.md 的验收标准。

### 有序行动
1. 撤销 canonical 正文 fork，改为 slot + strategy.yaml path rewrite。
2. 消解 compatibility-matrix.md / lumen.md 冲突，写清仲裁依据。
3. 为 beforeCondense、stop、batch-completion 三个 surface 补 Capability Card（Track B：intent/acceptance/divergence/compensating mechanism），不得计入“已等价”的 25 个。
4. 为已声明 Track B 的 surface 补 equivalence-class fixture 和 host-native probe，不得只以 package/direct-mapping 测试为准。
5. 补齐 Lumen 的机制事实文档、host-native manifest/skill discovery/hook registration check（比照 Cursor 无官方 validator 时的自建门禁）。
6. 35 分钟窗口内以上均无法完成，本次**不合并**；如需赶发布窗口，仅可考虑将 25 个已验证等价的 surface 拆分单独合并，Lumen 整体适配延后。
