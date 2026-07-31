---
point: verification.resume-takeover
---

## 权威陈述

<!-- ccm:k:start point:verification.resume-takeover -->
`--resume` 唤起的新 session，其 shell cwd **未必** == board 声明的 `git.worktree`——它可能落在 home、上一次操作残留的某目录、或另一个 checkout 里。**接手的第一件事**（先于 reconcile、先于任何孤儿验收、先于跑任何闸）：读 board 窄腰里的 `git.worktree`，`cd` 进去，**核对 cwd 确实 == 它**（`pwd` 比对，或 `git -C` 显式锚定每条命令）。确认一致前不要执行任何后续动作。

为什么这是第 0 步而非「顺手」：resume 之后你做的每件事都隐式依赖 cwd——相对路径读写、`git status` / `git diff` / `git log`、端点验收命令、重派 sub-agent 给的工作目录。cwd ≠ worktree 时这些**全在错的地方跑**，而且是**静默错误**，两种后果都致命：

- **挂掉**——命令在错目录找不到文件（`run-tests.sh: No such file`），还算好，至少炸得见。
- **静默跑错树**（更阴险）——cwd 下恰好有另一个 checkout / 另一份产物，闸照样跑、照样绿，你把一个**根本不是 board 目标**的产物标成 `done`/`verified`。端点验收的全部可信度（「只信端点验收」镜头）建立在「验的是对的那棵树」之上；cwd 漂了，gate-green 连必要条件都不是。pressure baseline 实证：强模型在三压下默认信任 ambient cwd、直奔验收，跑绿纯靠运气恰好身处对的 repo，且**跑完闸才**注意到 board 的 `branch` 与实际不符——顺序正好反了。

确认 cwd == worktree 后，顺带核对当前分支 == `git.branch`（窄腰里有）；不符是「这块板的执行环境与我所处环境漂移」的信号，停下来对账，绝不在错分支上接续 / 验收 / 发版。

### resume 第 0.5 步：核对 `git status --porcelain` 是干净基线

落对了 worktree、对上了分支，还差一步才能接手：跑 `git status --porcelain`，**确认它是空的（干净基线）**。resume 唤起的树里可能残留上一段 session 崩溃前没提交完的半截改动、别人留下的脏文件、或某次中断遗下的 untracked 产物——这些**不是**本次要验收的东西，却和你即将验收的产物混在同一棵树上。

为什么这是接手前的硬前置而非「回头再收拾」：单-committer 纪律下，端点验收通过后是**编排者统一分组 commit**——若基线本就带着无关脏改动，那次分组 commit 会把它们**一起焊进**同一个 commit，clean-rollback 保证当场破掉（这个 commit 再也不是「只含这次验收产物」的干净可回滚点了）。脏基线还会污染 `git diff` 读 diff（§3）：你分不清哪几行是 sub-agent 刚做的、哪几行是本就脏在那儿的，端点读 diff 的可信度连必要条件都不成立。

- 基线**干净** → 接手，继续 reconcile / 验收。
- 基线**脏** → 停下先厘清：是崩溃残留（判它该续跑还是丢弃）、还是别处溢进来的无关改动（stash / 移走，绝不裹进验收）——**厘清并回到干净基线之前，不跑任何分组 commit**。

### 孤儿 `in_flight` 续接（新 session 接管旧板时）

`--resume` 把一块**已存在**的 board 盖成本 session 后，不要把旧 `in_flight` 一律判死，也不要仅凭旧 status 继续等。先用 `ccm agent list` 重建 runtime roster；对关联条目运行 `ccm agent show` / `ccm agent probe`，把 registry 的 handle、task link、stored attach command 与 git / transcript / process 证据对上。`ccm agent show` 返回已存的 attach command 且 probe 有足够强的 live evidence 时，从它声明的正确 worktree 执行那条自包含命令；不要臆造新的 attach verb。

- **可恢复且仍活** → 接入后继续 recon；保持 task 与 agent / attempt 分层，不能拿「成功接入」冒充 task 完成。
- **agent 已 terminal** → agent terminal ≠ task done。算该节点的 content-hash（§1：`spec + 上游产物 + key context`），查产物是否已落地，再亲跑闸 + 读 diff；通过才把父 task 标 `done`/`verified`。
- **gone / orphaned，或 unknown 且没有可问责 handle / attach command** → 不再盲等：产物存在就走端点验收；不存在或验收不过，就把父 task 降回 `ready`（上游变化则 `stale`），重新派发并登记新的 runtime agent。

这条恢复路径的核心不是「旧 handle 都死了」或「有 registry 就一定活着」，而是**先读登记、再 probe、能接则接，不能接则验或重派**；父 task 始终独立验收。

<!-- ccm:k:end point:verification.resume-takeover -->

## 失效类型

`motivation_conflict`（主体：行为约束） —— 删掉后模型理论上"应该"核对 cwd，但压力下会默认信任当前所处目录直接开始验收，往往要等跑完闸后偶然发现分支不对，才回头意识到验的是错误的一棵树——这正是压力测试实证过的默认选择。

要求 resume 后先 cd/核对 cwd、分支、干净基线再动手，直奔验收明显更快，实证正是强模型在压力下信任 ambient cwd 抄近路。

## 边界

只在接管一块已有 board 时成立——此时新会话的 shell 落脚点由外部环境决定、未必是 board 声明的那棵树；从零起一块新板时落脚点通常天然就是当下所在目录，不存在这种漂移风险。

## 为什么它随模型变强而更重要

强模型端点验收做得越扎实、闸跑得越绿，"已经验证充分了"这份错觉就越有说服力，越没有动力回头查最基础的那个前提假设；能力越强，越擅长把"我已经验证过了"说服自己，哪怕验证的根基从未被真正检查过。

## 失败形态

最隐蔽的不是完全不核对，而是走了个过场——跑了一下 pwd，但只粗略比对目录名尾段或凭印象判断"应该是这个"，而不是逐字比对 board 里那个具体路径；核对动作看起来已执行，实际并未真正确认是不是同一棵树。
