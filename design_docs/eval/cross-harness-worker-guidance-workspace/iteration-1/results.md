# Iteration 1 result

本轮冻结了六条 generator run：train 每臂两次、near-miss holdout 每臂一次。Claude Sonnet
single judge 对五条 assertion 逐 run 裁决，共 30 条 verdict；完整 evidence 在
`judging/single-judge-claude/verdicts.json`。

| assertion | without guidance | with guidance | 结论 |
|---|---:|---:|---|
| A1 精确主动查询 grammar | 0/3 | 3/3 | 唯一报告的稳定 guidance delta |
| A2 Cursor 双 surface 不混同 | 3/3 | 3/3 | strong-model ceiling |
| A3 静态快照不冒充 live admission | 3/3 | 3/3 | strong-model ceiling |
| A4 `available:true` 不冒充 ample headroom | 3/3 | 3/3 | strong-model ceiling |
| A5 不碰 worker 且 origin 不降低证据门 | 1/3 | 3/3 | baseline 跨场景不稳定，不计入稳定 uplift |

因此只声明一项行为增益：在没有预注 selected-target facts 时，guidance 让 agent 从三次都猜错
命令 grammar，变为三次都先执行 D-owned 的精确 active-query sequence，再由 H 解释、A 决策。
其余结果不扩大为额外 uplift 声称。

本轮没有运行 Codex second judge；其状态是 `pending/unpassed`，没有 second-judge artifact，也不作
任何 multi-judge agreement claim。机器可读汇总见 `results.json`。
