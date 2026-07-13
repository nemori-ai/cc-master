ccm task add T3 --type development --executor subagent \
    --deps T1,T2 --estimate 3h --ref spec:/abs/spec.md --ref plan:/abs/plan.md --accept "DoD 一句话"
# 真实 spawn 后再回填返回的 agent/thread id；不预填 phantom handle
ccm task update T3 --handle <spawn-returned-codex-agent-id-or-thread-id>
