| `external` | cron / CI scheduler / systemd timer / GitHub Actions / `codex exec resume` 等外部调度 | 需要跨 session 或无人值守唤醒；你能记录 scheduler 名称、run id、命令或 URL。 | Codex adapter 的通用 floor。必须写 `handle` 或 `checklist`，否则后续 session 无法 recon。 |
| `thread_automation` | Codex App thread automation | 用户当前环境明确提供并已配置同线程 heartbeat；适合定期检查长命令或外部状态。 | 这是 Codex 产品面能力，不是 cc-master CLI 可机械创建的原语；记录 automation 名称 / 频率 / 检查项。 |
| `background_terminal` | Codex experimental background terminal + 手动/automation recon | 当前线程里已有长命令在后台跑，且可通过 `/ps` / `/stop` 或等价 UI recon。 | 只记录已有句柄；不要假设它会自动唤醒主线。 |
| `manual` | 用户或下一次会话手动 recon | 没有可靠 scheduler，或需要人类在窗口后回来。 | 明确写下一次检查时间和检查项。 |
