**watchdog 解决的问题：** 后台 sub-agent / workflow 有时会静默失败——没有错误返回、任务看起来还在 `in_flight`，但实际上已经卡死或消失。主线等待时没有任何信号。watchdog 是「如果过了这么久还没回来，就来唤醒我让我主动去 recon」的安全网。
