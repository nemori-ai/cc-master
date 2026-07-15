当前 Codex 账号只对 7d 权威 snapshot 计算配额 burn-rate；rolling-24h 从可信 7d 快照变化导出，只提示相对平均日预算的消耗风险。样本不足、跨 reset 或 provenance 不完整时保持 `null` / `unknown`；信号不可得时 `available:false`、exit 0。
