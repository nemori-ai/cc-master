# Fan-out Playbook —— 命令级 HUB 生命周期

模式 B 的 walkthrough，一条命令一条命令。`<campaign>` 是语义化 campaign 名；下文 `WT=/data/qiwei/repos/cc-master-wt`（本仓 worktree 兄弟目录惯例——**仓库外**，不进 repo 树）。每条命令都对**显式路径**跑，绝不依赖「shell 恰好在哪」。

> **贯穿全篇的红线**：**spoke worker 只写文件 + 自证 + 报告，绝不 commit / push / merge。** 所有 commit、merge、push 都是 orchestrator 端点验收之后亲手做的（single-committer·AGENTS.md §11）。下面每一处 `git commit` / `git merge` / `git push` 都是 **orchestrator 的动作**，不是 spoke 的。

## 1. 立 HUB（或第一棵 worktree）

```bash
# 从任何地方——路径都是显式的
git -C /data/qiwei/repos/cc-master worktree add $WT/<campaign> -b worktree-<campaign>
cd $WT/<campaign>
pnpm -C ccm install                            # 只有会碰 ccm 时才需要（HUB 自己的 node_modules）

# orchestrator 把计划要求的共享脚手架作为普通 commit 落在 HUB 分支上
git add <files> && git commit -m "chore(<campaign>): HUB setup — <what>"
```

HUB 分支是 campaign 的集成线。它的名字（`worktree-<campaign>` 或 `feat/<campaign>` 风格）是每个 spoke 的 base。

## 2. 建 spoke —— 从 HUB 分支 fork（仅 HUB 集成拓扑）

```bash
HUB_BRANCH=$(git -C $WT/<campaign> branch --show-current)

# spoke 在 main checkout 的 worktree 目录里创建，base 是 HUB 分支：
git -C /data/qiwei/repos/cc-master worktree add \
    $WT/<campaign>-<spoke> -b <campaign>-<spoke> "$HUB_BRANCH"
```

**绝不** `-b <spoke> main`——从 `main` 切的 spoke 对已合并进 HUB 的每个 sibling 都失明，它的 merge-back 会把 campaign 自己的历史重打一遍。

（**独立 feature-branch 拓扑**下不需要 HUB：各 spoke 直接 `git -C /data/qiwei/repos/cc-master worktree add $WT/<campaign>-<spoke> -b feat/<spoke>`，各从 `main` 切、各自成 PR。）

先让 **pilot spoke** 单独走完整生命周期（工作 → orchestrator 端点验收 → orchestrator commit → merge-back → HUB 校验）。它干净落地后，wave 才 fan out。

## 3. 派发一个 spoke worker

派发 prompt 的强制前导（逐字纪律，不是转述；写法与 dispatch.md 同源）：

```
第一批动作，先于任何其它工作：
1. cd /abs/path/cc-master-wt/<campaign>-<spoke>   （或全程用 git -C 锚定这棵树）
2. git branch --show-current   → 必须打印 <campaign>-<spoke>；不是就停下报告
3. 所有文件 Write/Edit 用这棵 worktree 的绝对路径。
4. 所有测试/校验用这棵 worktree 自己的树跑（bash run-tests.sh / pnpm -C ccm ...），输出留档。
5. 你是 spoke worker：只写文件 + 自证测试绿 + 报告落点，绝不 git commit / add / push。
   报告里点明「未提交改动在 <worktree> 的这几个文件、跑了哪些门、结果如何」。
Deadline：接近时，把半截工作原样留在 worktree 里 + 在报告里标 WIP，绝不自己 commit 锁定。
```

worker 报告后，派发者（orchestrator）独立核验落点，**然后才由 orchestrator 提交**：

```bash
git -C $WT/<campaign>-<spoke> status --short       # 预期改动都在，没有落空的
git -C /data/qiwei/repos/cc-master status --short   # main 没被写脏（干净）
git -C /data/qiwei/repos/cc-master log --oneline -3  # main 没有移动
# —— 核验通过 + orchestrator 端点验收（亲跑全套门）之后，orchestrator 分组 commit：
git -C $WT/<campaign>-<spoke> add <该任务真正碰过的文件>   # 绝不 git add -A
git -C $WT/<campaign>-<spoke> commit -m "<type>(<scope>): <task>"
```

## 4. 收割即集成（spoke 完成或到 wave barrier）

```bash
# orchestrator 在 spoke worktree 就地端点验收（碰 ccm → 四门；碰 plugin → run-tests.sh + validate）：
cd $WT/<campaign>-<spoke>
bash /data/qiwei/repos/cc-master/run-tests.sh          # 或 pnpm -C ccm typecheck && lint && test && build
# 绿 + orchestrator 已分组 commit（见 §3 末）后，HUB 拓扑再 merge 回 HUB：
cd $WT/<campaign>
git merge --no-ff <campaign>-<spoke>      # 冲突在 HUB 里解决

# 每次 merge-back 后都跑一次集成级校验——不是攒到最后：
bash /data/qiwei/repos/cc-master/run-tests.sh > /tmp/<campaign>-int-<spoke>.log 2>&1
tail -30 /tmp/<campaign>-int-<spoke>.log

# 立即退役这棵 spoke——完成的 spoke 绝不囤积（会烂、吃磁盘、污染 git worktree list）：
git -C /data/qiwei/repos/cc-master worktree remove --force $WT/<campaign>-<spoke>
git -C /data/qiwei/repos/cc-master branch -d <campaign>-<spoke>
```

一个 wave barrier 就是对该 wave 的每个 spoke 跑一遍这段，然后对着 roadmap 的 barrier 验收门做 go/no-go。某个 spoke 校验失败：orchestrator 仲裁（带 finding 重派 / 在 HUB 里补 / 重新规划）——下一个 wave 不越过一道红 barrier 起跑。

## 5. Campaign 收口

```bash
cd $WT/<campaign>
bash /data/qiwei/repos/cc-master/run-tests.sh > /tmp/<campaign>-final.log 2>&1
# 外加改动该过的门（碰 ccm：pnpm -C ccm typecheck && lint && test && build；plugin：check-plugin-dist-sync + claude plugin validate plugin/dist/claude-code）

git push -u origin "$HUB_BRANCH"
# → 走 gh CLI 手工流开 PR（gh pr create，PR body 末尾带 Claude 署名）；PR 到 main 等人 review。
#   机制全在 AGENTS.md §11——本仓没有 github-pr skill。
```

收口形状（在 roadmap 里定、这里执行）：spoke 共享地基 → 一个从 HUB 出的合并 PR；spoke 真正独立、可分别 review → 各 spoke 各自 PR（这种情况下每个 spoke 在退役**之前**各推自己的分支，HUB 只当校验场、不当 PR 源）。

## 6. merge / PR 后的墙（PR 落地后）

```bash
git -C /data/qiwei/repos/cc-master pull                              # main 更新到最新
git -C /data/qiwei/repos/cc-master worktree remove --force $WT/<campaign>
git -C /data/qiwei/repos/cc-master branch -d "$HUB_BRANCH"
git -C /data/qiwei/repos/cc-master remote prune origin
git -C /data/qiwei/repos/cc-master worktree list                    # 确认干净
```

五步全部做完，**才**开始下一个 PR 的活。存活的 worktree 恰好是：在飞的 wave + 用户指定保留的——别无其它。

## 野外见过的失败形态

| 症状 | 根因 | 本 playbook 的防线 |
|---|---|---|
| spoke 改动「不见了」 | worker 写进了 `main` 或错的树 | §3 前导第 1-2 行 + 派发者核验落点 |
| spoke 测试假绿 | worker 跑了 main checkout 的陈旧树 / 缺自己的 ccm `node_modules` | §3 前导第 4 行（从本树跑 + 本树 `pnpm -C ccm install`）|
| 文件出现在 main 的 `git status` | worktree session 写了 main checkout 的路径 | §3 前导第 3 行 + 建文件后 `git status` 自查 |
| campaign 末尾 merge 冲突风暴 | spoke 从 `main` fork，或没做每次 merge-back 校验 | §2 从 HUB fork；§4 每次 merge-back 都校验 |
| 「失败」的 worker 其实活已落地 | 报告层错，不是工作错 | §3 派发者核验**树**、不信**报告** |
| spoke 自行 commit / push，绕过端点验收 | worker 把自己当 committer（通用教条误植） | §3 前导第 5 行 + SKILL.md 红线 6 single-committer：spoke 只写 + 报告，commit 归 orchestrator |
| 磁盘膨胀、杀不掉的陈旧状态 | spoke merge 后被囤积 | §4 收割即退役；§6 墙 |
```
