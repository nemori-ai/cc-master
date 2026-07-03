ccm task add T3 --type development --executor subagent --handle <spawn-returned-codex-agent-id-or-thread-id> \
    --deps T1,T2 --estimate 3h --ref spec:/abs/spec.md --ref plan:/abs/plan.md --accept "DoD 一句话"
