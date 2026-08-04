#!/usr/bin/env bash
# eval-trigger.sh — Track A（触发准确率）入口。
#
# 2026-08-04 起本脚本只是 scripts/eval-trigger.mjs 的薄包装。
#
# 此前它 shell out 到 skill-creator 的 `scripts.run_eval`，而那个装置把被测 skill 写成
# `.claude/commands/<name>.md`（slash command），指望自然语言 query 自动触发它 —— 实测不会。
# 于是它对每条 query 都判"未触发"，产出一份格式完整、正例触发率恒为 0 的报告：看着像
# description 差，实则测的东西和想测的东西不是一回事。同一份 description 装成真 skill
# （`.claude/skills/<name>/SKILL.md`）则稳定触发，4/4 正例 trigger_rate=1。
#
# run_eval 住在插件缓存里（改了会被插件更新冲掉），故自研装置取代之。新装置额外焊入三条
# 纪律：装置自检先于测量、spawn 失败即硬失败、claude 解引用到稳定真实路径。详见 .mjs 头部。
#
# 用法： scripts/eval-trigger.sh <skill-name> [--runs N] [--limit N] [--json <out>]
set -euo pipefail
exec node "$(cd "$(dirname "$0")" && pwd)/eval-trigger.mjs" "$@"
