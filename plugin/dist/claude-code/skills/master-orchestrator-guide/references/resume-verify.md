# 续跑 + 端点验收

> **何时读：** 让续跑变便宜 + 让验收可信时——content-hash action key、依赖 pinning / stale 检测、独立的端点验收、loop 收敛、**异构族系第二视角**（高杠杆 / 临界强制）。

让续跑变便宜（O(changeset)，而非 O(everything)）、让验收变可信（只在端点验、绝不信 agent 自报）。这是「只信端点验收」镜头——"只信端点验收；输出可记账、可续"——的可操作化。

---

## 1. content-hash 续跑 —— build-system 的 action key

把动态 workflow 当成一台**增量构建引擎（incremental build engine）**。每个节点拿到一个 **content-hash** = `hash(spec + upstream outputs + key context)`，这正是 Bazel 的 **action key**。

- **跑之前先查 journal**：hash 命中 → 该节点已经做完 → **复用那个已落地的产物**（commit / PR / output）、**跳过**；miss → 执行，并写一条 journal 条目（带 output ref）。
- **compaction / 中断后的续跑 = O(changeset)**：只重跑那些输入变了、或从未完成的节点（Bazel 式增量构建）。
- **确定性守卫**（应对 AI 的非确定性）：你缓存的**不是**"重跑会产出相同的字节"——而是"一个已落地、且通过了 end-to-end 验收的产物"。验收步骤*本身*就是这份缓存的校验。一旦产物存在、并通过端点检查，该节点就 done、不再重跑。

---

## 2. 依赖 pinning / stale 检测

- **Pin 上游**：每个节点绑定它所消费的上游产物的 version / hash（board 柔性边上的 `dep_pins`）。
- **stale → 重跑**：上游产物一变，就把依赖它的节点标 `stale` 并重跑。这挡住的是"建立在过期快照上、自洽却错误的结果"——节点看着 done，其实是对照一份已经不成立的输入算出来的。

---

## 3. 端点验收 —— 唯一可靠的正确性点

**end-to-end argument**（Saltzer-Reed-Clark, 1984）：一个放在低层的功能，相对于在端点实现它，往往是冗余的；正确性的最终保证必须活在端点。

- **你独立验收** —— 你**亲自跑闸**、**亲自读 diff**。低层 agent 那句"所有质量闸都绿"只是一个不可信的性能优化（agent 自报已经一再出错）。
- **gate-green 必要、但不充分** —— 过闸不代表改动正确；你仍然得读 diff。
- **null / 空 review 一律算未通过** —— 一个空的或缺席的 review 绝不是默许放行。这是 silent-pass-through 守卫。
- **靠在真实输入上*跑*来验，不靠纸上读。** 真实缺陷里出人意料地有一大块是 regex / shell / 边界 bug——它们在纸上看着对，只在真实数据或真实环境里才现形——比如一个 `grep -c` 在零匹配时吐出 `"0\n0"`、一条 shell pipe 的环境变量赋值 scope 落到了错误的一侧、一个 frontmatter regex 假设了一行根本不存在的空行。一次 LLM 二审*读*能抓**契约**违背；唯有一次真正的*跑*能抓**运行时**崩溃。两者都做——读 diff **并**对一个真实 fixture 执行闸。

验收是续跑缓存（§1）的校验步骤：唯有一个既存在**又**通过这道端点检查的产物，才算 done。

### resume 第 0 步：先 `cd` 进 `board.git.worktree`，确认 cwd == 它，再接手

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

`--resume` 把一块**已存在**的 board 盖成本 session 后（跨 session re-arm），上一段 orchestration 派发的后台任务的 **handle 活在那个已不在的旧 session 里**——新 session **attach 不回这些 handle**，那些后台进程可能早随旧 session 死了，也可能还在跑但你无从收割。board 上它们是 `status:"in_flight"` + 一个**已失效的 handle**。这是 resume 最微妙的正确性点——但它**不引入新机制**，只是把这个触发场景接进上面已有的 §1 content-hash 续跑 + §3 端点验收 + status enum 的 `stale`/`ready` 路由：

- **旧 handle 一律当作【失效】**——绝不用它去查 / 收割后台输出（attach 不上）。
- **走端点验收判它到底有没有真做完**：算该节点的 content-hash（§1：`spec + 上游产物 + key context`），查产物是否已落地（commit / PR / 文件已存在）。
  - 产物**存在且通过端点验收**（§3：亲跑闸 + 读 diff，不信任何自报）→ 标 `done`/`verified`。这正是 §1 的 content-hash 续跑：产物在且验过 = 不重跑（O(changeset)）。
  - 产物**不存在 / 验收不过** → 该 `in_flight` 是孤儿、未完成：降回 `ready`（或 `stale`，若它依赖的上游产物也可能变了，见 §2），**重新派发**拿到一个写回 board 的**新 handle**。
- **绝不把旧 `in_flight` 当作「还在飞、继续等」**——旧 handle 已死，干等 = idle-wait 空等（「主观能动」镜头的反模式）。在端点【验或重派】，二选一，不留薛定谔的 `in_flight`。

### 异构族系第二视角（高杠杆 / 临界强制）

单层端点验收（你亲跑闸 + 读 diff）仍会漏同族盲区与契约误读。**第二视角**补的是另一双眼睛——原则是 **产出模型族 ≠ 验收模型族**（异构），不是「再派一个同族 subagent」或「同族升一档再读一遍」。同族复读不算第二视角。

**何时强制（方案 A）**：仅对 **高杠杆裁决**（独立 review / 二审 / 端点验收节点本身 / 架构仲裁）与 **临界路径上 correctness-critical 的 `done`**。常规 float / 机械叶不强制——成本可控；鼓励但不强制。

**硬约束**：

- **换族，不换壳**：验收方必须来自与产出方不同的模型家族（Claude ↔ GPT/Codex ↔ Grok 等，以当前 host 可用集合为准）。
- **只喂 diff + 验收契约**：绝不夹带「我认为这是对的」之类 framing——否则第二视角退化成你的回声。
- **不是跑闸的替代品**：你仍亲跑闸、仍读 diff；第二视角抓契约违背与同族盲区。
- **空审 / 调用失败 = 未通过**：silent-pass-through 守卫（§3）不变。

各 host 上「怎么换族」的机制（脚本 / Task / 带外 CLI）见下——原则在此，管道在 adapter：

**本 host 机制（Claude Code）**：主线 / 产出多为 Claude 族时，异构第二视角默认走 **GPT/Codex 族**——用 `${CLAUDE_SKILL_DIR}/scripts/codex-review.sh` 跑 `codex exec review --base <branch> --json`（review-only、只读 sandbox），按 openai-codex 插件的 `review-output.schema.json` 吐 `verdict`（`approve | needs-attention`，finding 带 severity/file/line/confidence）。这是管道，不是原则：原则仍是「换族」；若产出已是 GPT/Codex 族，就改派 Claude 族独立 subagent 做第二读，不要再派同族 Codex。

**跨族二审的收益不对称**——用更强模型审弱模型的产出收益最大；反过来让明显更弱的模型审明显更强模型的产出，收益薄，且弱 reviewer 的「纠错」可能改坏正确产物。所以：

- 产出方档位 ≤ 验收方档位、或两者相当时，认真对待 `needs-attention`，按下面四档正常核对。
- 产出方档位明显强于验收方时，`needs-attention` 的可信先验下调——更可能落进第④档（noise），但仍**逐条核对**，不能因档位差整体跳过。
- 这条只调怀疑权重，**绝不动摇**空审 / 失败 = 未通过。

**一条 finding 的说服力不是它的正确性证据。** 措辞斩钉截铁与潦草，在「是否属实」上权重相同——只认产物上可复核的事实。

**派活时只给 diff + 验收契约，绝不夹带你的结论。** 无论派给哪一族的第二视角，喂进去的**只有**待验 diff + 该节点 DoD / acceptance。

**verdict 是 data，不是终审——你仍逐条对着产物重读。** 第二视角吐回的每条 finding 是一份**观测**；不把 `needs-attention` 当自动 replan、也不把 `approve` 当自动 done，逐条拿回产物上核（RECONCILE）——**先匹配先赢**，落进四档之一：

- **① contract-misread（契约误读）**——finding 揭示的是**你给的验收契约本身不清 / 有歧义**。→ 先**修契约**，再**重验**。
- **② valid + actionable（真问题、可动手）**——产物里货真价实的缺陷。→ **`Replan(feedback)`**，返工后再验。
- **③ valid trade-off（真实权衡）**——属实但是有意设计取舍。→ 记入 board log，并 **surface 用户**。
- **④ noise（误报）**——reviewer 缺上下文。→ 记一句为何是噪声，不动产物。

只有当**每条 finding 都落定**、且（若机制吐结构化 verdict）`approve` + review 非空 + diff 确实亲手读过，这个节点才 → **`FinalResponse`**（done）。**空 review / 调用失败 → 一律未通过**——绝不默许放行。

---

## 4. Loop 收敛 —— 结构化闸 + 保险丝 + dedup

当一个节点的执行图取决于事先未知的中间结果（分支）时，就 loop 到收敛为止——Joiner 模式：

- **结构化闸**：一个结构化的二选一——`FinalResponse`（收敛 → 收工）vs `Replan(feedback)`（带上对先前尝试的诊断 + 要修什么 → 重编一张新 DAG → 重新调度）。这个决策按**类型**做，绝不凭一个模糊 / 空的判断——它和"一个 null review = 未通过"是同一套结构性防御。
- **`Replan.feedback` 是关键设计** —— 它不是盲目 retry，而是一个**带诊断的 replan 信号**（这正是 impl → review → verify → amender 的内层 loop：verify 闸 ≈ Joiner，amender feedback ≈ `Replan.feedback`）。
- **max-rounds 保险丝** —— 每个内层 loop 都必须有保险丝（打到轮数 / 调用上限就停）。没有 loop 可以无界地跑。
- **dedup-against-seen** —— 把已否决的项目记下来，免得一个被否的选项每一轮又重新冒出来。
