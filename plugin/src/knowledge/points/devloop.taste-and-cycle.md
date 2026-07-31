---
point: devloop.taste-and-cycle
---

## 权威陈述

<!-- ccm:k:start point:devloop.taste-and-cycle -->
## Taste:好 loop 的手感

好的 dev loop 像稳定训练:objective 清楚、instrument 可信、hypothesis 小、反馈短、失败可读、重启不拖、收敛即停。坏 loop 像失控训练:目标漂移、测量假绿、补丁栈变深、同形失败反复出现、"再改一下"替代 hypothesis、验收已绿还继续镀金。

与敏捷 / 排期 / 持续交付的关系是正交互补: 切出小 batch,排程和验收训练 run,本 skill 管每片里的优化形状,每一步的工程质量。持续交付就是高频 validation checkpoint,防止最后才发现泛化失败。

---

## 一图流:一轮 dev 的优化循环

```
读目标函数(验收)──► 它清楚吗?── 不清 ──► 先锐化(锚 1)
        │ 清楚
        ▼
   过 spec 硬闸了吗?(命中值得 SDD 的场景且用户已认可 spec?)── 未过 ──► 先产出/引用 spec
        │ 已过或不命中
        ▼
   架/读测量(测试·锚 3)
        ▼
   propose 一个改动(早期 explore / 近收敛 exploit·锚 4)
        ▼
   测量 → 读梯度(失败=方向信息·锚 3)
        ▼
   loss 在降吗?── 否,且 plateau ──► 你在局部最小值:restart 换方向(锚 5)
        │ 在降
        ▼
   验收达标?── 否 ──► 回到 propose(小步迭代·锚 2)
        │ 达标
        ▼
   收敛:停(别过拟合·锚 6)。检查:拟合的是意图非用例(锚 7)、方案最简(锚 8)
```

---
<!-- ccm:k:end point:devloop.taste-and-cycle -->

## 失效类型

`capability_gap`（主体：事实方法） —— 删掉后,各心智锚仍分别存在,但把它们串成可执行顺序的『一图流』没有了——新上下文里容易凭感觉决定步骤顺序或漏掉某个检查点,而不是照固定顺序走一遍。

主体是好 loop 与坏 loop 的对照 taste 加一张完整的优化循环流程图，缺的是判断自己 loop 健康度的方法。
