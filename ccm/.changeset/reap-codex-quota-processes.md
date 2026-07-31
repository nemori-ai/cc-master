---
'ccm': patch
---

修复 `ccm monitor` machine-wide Codex quota 轮询的进程回收竞态：collector 现在拥有独立的 app-server 进程组，超时或错误时按 `SIGTERM` → `SIGKILL` 升级清理，并等待 launcher close 与完整进程树消失后才发布结果，避免每轮监控累积一个未回收的 `MainThread` 僵尸进程。
