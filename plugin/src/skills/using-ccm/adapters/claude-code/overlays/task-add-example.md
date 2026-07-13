ccm task add T3 --type development --executor subagent \
    --deps T1,T2 --estimate 3h --ref spec:/abs/spec.md --ref plan:/abs/plan.md --accept "DoD 一句话"
# 调用真实后台派发工具，再把其返回的句柄回填；不预填 phantom handle
ccm task update T3 --handle <派发工具返回的真实句柄>
