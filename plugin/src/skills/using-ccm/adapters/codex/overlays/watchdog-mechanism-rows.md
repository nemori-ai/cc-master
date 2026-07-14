| `cron` | cron / CI scheduler / systemd timer / GitHub Actions / `codex exec resume` 等外部调度；先创建并拿 scheduler id / run URL | 下一项 |
| `loop` | Codex App thread automation（当前环境明确提供且已创建）；`job_id` 写 automation 名称 / id | 下一项 |
| `monitor` | Codex cloud task/status watcher；`job_id` 写 cloud task id | 下一项 |
| `shell` | 后台 terminal / watch loop；`job_id` 写真实 session id | 没有真实 handle 就不要 arm，改记 blocked / recon 状态 |
