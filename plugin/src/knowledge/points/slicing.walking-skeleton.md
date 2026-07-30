---
point: slicing.walking-skeleton
---

## 权威陈述

<!-- ccm:k:start point:slicing.walking-skeleton -->
## 心智锚 2:walking skeleton —— 地基切到最小可用子集,而非一次定全

第一片不是"地基层",是一根**最薄的端到端线**(walking skeleton):穿过所有层、但每层都只做让这一根线跑起来的最小量。它一举两得——**早早打通集成**(最贵的风险:各层接不上,提前暴露)+ **立起共享脊椎**(后续纵切都挂在它上面)。

- 共享 schema:第一片只定**这根线用到的最小字段**;后续每片**按自己所需**给 schema 加列——schema 随纵切**增量生长**,不在 T2 一次定全。
- 前置依赖**只放不可再薄的共享核心**(脊椎),让尽可能多的纵切片在脊椎就绪后**立刻并行铺开**。前置得越多,并行度被掐得越死。

---

<!-- ccm:k:end point:slicing.walking-skeleton -->
