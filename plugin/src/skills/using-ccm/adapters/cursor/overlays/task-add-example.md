ccm task add T3 --type development --executor subagent \
    --deps T1,T2 --estimate 3h --ref spec:/abs/spec.md --ref plan:/abs/plan.md --accept "DoD 一句话"
# 真实 Task 启动后再回填返回的 subagent id；不预填 phantom handle
ccm task update T3 --handle <Task-returned-subagent-id>
