cc-master 是事件驱动的：一个后台 job 完成时，harness 会唤醒主线并重新进入——所以它从不需要一个定时器去轮询。至于 harness *无法*替你追踪的状态（CI 状态、一个远程队列、一个审批超时——这些常是 `external` 或你要处置的信号），用一个后台 shell 去等它——这个 shell 轮询它自己的 predicate，再骑着完成通知回来：

```bash
until <external state ready>; do sleep 60; done   # run_in_background → harness notifies on exit, re-enters
```

这既事件驱动又 ship-anywhere——它复用的是一个现成积木（一个后台 shell + 完成通知），而不是另引入一套定时器机制。
