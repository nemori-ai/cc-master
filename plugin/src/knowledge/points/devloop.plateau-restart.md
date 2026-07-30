---
point: devloop.plateau-restart
---

## 权威陈述

<!-- ccm:k:start point:devloop.plateau-restart -->
## 心智锚 5:局部最小值 = 钻牛角尖;解药是 restart / 换方向,不是再下降

当一个方案 **plateau**(你改了又改,loss 却不再真正下降、离验收还差得远)——你陷在一个**局部最小值**里了。此刻"沿同一条沟再走几步"(给补丁打补丁、再 tweak 一下同一个方案)是错的;正确动作是**退一步、换一个方案 restart**(从不同起点重新下降)。

识别自己卡在局部最小值的信号:
- 连续几轮改动**没有真正缩小与验收的距离**(只是换了种方式失败)。
- 你在**给同一个方案的补丁打补丁**,栈越来越深。
- "再改一下就好了"已经说了第三遍。
- 你说不出当前 hypothesis,只能描述"还在修"。
- 测量结果互相矛盾,但你没有先修 instrument。

**这就是"钻牛角尖"的优化学本质**——不是道德缺陷,是**没识别出该 restart 的时刻**。把它当成"该调高学习率 / 换初始点"的信号,而不是"再坚持一下"。沉没成本(已经在这个方案上花了很多)是**局部最小值的引力**,不是继续的理由。

orchestrator 的 restart 不只是一句"继续试":可以换 hypothesis、拆小任务、派 instrumentation builder、换 evaluator、重切 acceptance、或把失败路径记成 artifact。重启是优化动作,不是失败遮羞。

> **board 接地**:换方向不是"失败收场"、它是 board 状态机里的一档,显式记下来比闷头死磕诚实得多。别把"该 restart 的时刻"硬扛在 `in_flight` 里假装还在下降;用 `using-ccm` 选择正确状态转移,并把失败路径 / 新 hypothesis / 下一步 probe 写进 optimization ledger。

---

<!-- ccm:k:end point:devloop.plateau-restart -->
