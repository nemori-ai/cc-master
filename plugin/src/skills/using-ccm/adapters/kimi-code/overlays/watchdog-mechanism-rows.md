| `cron` | cron / CI scheduler / systemd timer / GitHub Actions 等外部调度；先创建并拿 scheduler id / run URL | 下一项 |
| `loop` | 仅当当前 kimi-code 环境有已验证且已创建的 recurring automation；`job_id` 写 automation id | 下一项 |
| `monitor` | 可续查的外部状态 watcher；`job_id` 写 watcher / run id | 下一项 |
| `shell` | kimi-code Bash 后台任务 + 轮询任务输出；`job_id` 写真实 Bash 任务 id | 没有真实 handle 就不要 arm，改记 blocked / recon 状态 |
