---
point: handoff.judgment-template
---

## 权威陈述

<!-- ccm:k:start point:handoff.judgment-template -->
**board 本就承载结构化状态**——DAG、每个 task 的 status/deps/artifact/handle、log。新 session `--resume` 会原样读到它。所以交接文档的价值，**恰恰是 board 装不下的那些东西**：你试过又放弃了什么、为什么这么决策、坑埋在哪、临界路径心算落在哪条链、下一步该往哪使劲。**噪声 = 复述 board。** 文档纯叙事层、指向 board。

判据——一段内容该不该进 handoff 文档，问它**这东西 board 里有没有**：

- **board 装不下 → 进文档**：负向结果（试过的死路 + 为什么死，board 只记 task `done`/`ready`，不记「这条路走过、断在哪」）、决策理由、gotcha、临界路径的**综合判断**（board 有原始 deps/status，没有「杠杆在哪条链」这个结论）、悬而未决的用户决策的上下文。
- **board 已装下 → 指向它，绝不复抄**：DAG 本身、per-task 的 status/deps/handle/artifact 清单、log。这些 `--resume` 一读就有，复抄进文档只是造了**第二份会过期的真相**。

**为什么这条要写死（而不是「凭直觉，多写点总没坏处」）：** 切 session 时你正累、context 快耗尽、且怕丢掉攒了一身的 mental context——这三股劲叠起来，会把「为稳妥起见，把整个 board 都 dump 进去 / 再用英文把每个 task 的 status 走一遍，新 session 看着省事」变成一个**感觉负责任**的念头。它感觉像 belt-and-suspenders，实则是反的：

- **两份真相 = 必然漂移**。board 是活的——一个后台 handle 跑完、下游 task 解锁、status 流动。你 dump 进文档的那份快照冻结在交接那一刻；新 session 一动手，board 是对的、你那段是过期的谎，且它**读起来像权威**（一段英文 task 走查，读者分不清该信哪份）。一份和 live board 打架的 handoff 文档，比没有这段还糟。
- **它甚至不更快**。新 session 是用 cc-master 自己的机制读 board，不是手 parse JSON——你拿「省得它 parse JSON」当理由，省的是一笔根本不存在的成本，换来的是维护负担 + 漂移风险。
- **「英文写的就是叙事」是伪装**。一段 prose 形态的 per-task status 走查，**形态是 prose，本质是 board `tasks[]` 的英文转写**——它是噪声，不因为写成了句子就变叙事。叙事 carries 的是 board **装不下**的（why / 死路 / 综合判断），不是 board 内容的 fuzzy 副本。

**最隐蔽的一档是「折中」**：「那我只把临界路径附近那 5 个 task 的 status 用 prose 走一遍，不全 dump」——这不是第三条路，是上面那条错的**穿了件小一号的衣服**。它保留的正是错的那一类内容（live state 的冻结副本），只是少一点；而临界路径「该往哪推」的那个**结论**，本就该由叙事层第 6 段的一行综合判断 carry（「临界路径走 T1→T9→T12，推这里」），不靠复述那 5 个 task 的 status。砍到 5 个不解决漂移，只是把会误导人的那份做小。

---

## 6 段文档模板

交接文档是决策程序 step-6 ledger 的**更丰富的近亲**（step-6 ledger 的固定形态见 `async-hitl.md` §「step-6 ledger」——那是每条未关闭路径一行 + 一行裁决的精炼自检；交接文档在它之上补足 board 装不下的叙事）。照下面 6 段写，**显式 NOT 包含**全量 DAG / task 列表 / status（指向 board 即可）：

```markdown
# Handoff: <goal 一句话>

**Board**: <配对的 board 文件完整路径>
**Handed off by**: session <旧 session_id>, at <UTC 时间戳>
**New session, start here**: 跑 `/cc-master:as-master-orchestrator --resume <选择器>`，
然后读本文件。结构化状态（DAG / 每个 task 的 status·deps·handle / log）全在上面那块
board 里——`--resume` 会原样读到，本文件不复述它，只补 board 装不下的。

## 1. 当前态势（一句话）
交到哪了、整体健康度。例：「14 个 task，9 done+verified，1 个 straggler 孤儿
（见 §3），其余 ready/blocked——临界路径见 §6。」

## 2. 在飞孤儿 + 重验指引
（收敛后 happy path 多半为空；只剩 drain 兜底降级的 straggler。）
逐个：产物落在哪、怎么端点验（亲跑哪道闸 + 读哪段 diff）、content-hash 提示。
→ 怎么 reconcile 一个 `in_flight`（先 list/show/probe，能接则接，不能接则端点验或重派）见
`resume-verify.md` §3，本节不复述那套路由。

## 3. 关键判断 / 上下文（board 装不下的）
试过又放弃了什么、为什么这么决策、坑在哪。
例：「T4 的 i18n key 抽取先试了 AST-walker，它漏 template-literal 插值、耗了 2h，
已换 runtime extraction——别回头走 AST 那条路。」

## 4. 悬而未决的用户决策（blocked_on:user）
每条附上下文，别让新 session 重新挖。
例：「D1：PR 要不要拆成两个？已问用户，未答——拆点见 board T11/T12 的边界。」

## 5. 下一步往哪使劲
临界路径心算 + 建议首动作（结论，不是数据）。
例：「临界路径走 T1→T9→T12，杠杆在这条链；首动作派 T4 的 runtime-extraction 重试
（当前唯一 ready 且解锁下游的）。」
```

（段 2 在 happy path 常为空、可只留一句「无在飞孤儿，board 全部 done/verified 或 ready」。）

---

<!-- ccm:k:end point:handoff.judgment-template -->
