后台 terminal session → Codex app thread automation（若当前环境可用）→ 外部 scheduler + `codex exec resume` → Codex cloud status loop → manual recon；每档先拿真实 handle 再 arm，没有 handle 就记 blocked / recon 状态、不要伪造
