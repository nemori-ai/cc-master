| `external` | cron / CI scheduler / systemd timer / GitHub Actions / 手动 session recon 等外部调度 | 需要跨 session 或无人值守唤醒；你能记录 scheduler 名称、run id、命令或 URL。 | Cursor adapter 的通用 floor。必须写 `handle` 或 `checklist`，否则后续 session 无法 recon。 |
| `background_terminal` | Cursor Shell（`block_until_ms: 0`）+ AwaitShell / notify_on_output | 当前线程里已有长命令在后台跑，且可通过 AwaitShell 或等价 UI recon。 | 只记录已有 shell id；不要假设它会自动唤醒主线。 |
| `manual` | 用户或下一次会话手动 recon | 没有可靠 scheduler，或需要人类在窗口后回来。 | 明确写下一次检查时间和检查项。 |
