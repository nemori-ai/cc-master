---
point: workflow.pattern-pipeline
---

## 权威陈述

<!-- ccm:k:start point:workflow.pattern-pipeline -->
## pipeline-by-default

**何时：** 多阶段工作，stage 之间**无须**同步——item A 可以走到 stage 2，而 item B 还在
stage 1。这是任何多阶段形状的**默认**；只有当某个 stage 真的要拿整批前一阶段的集合时，才
升级到 barrier（见 `mechanism.md` §3 的 smell-test）。

```js
const out = await pipeline(items,
  (it) => agent(`stage 1 for ${it}`),
  (prev, it) => agent(`stage 2 for ${it} using ${JSON.stringify(prev)}`),
)
```

**由谁演示：** `assets/templates/pipeline.js`（裸的流式形状）。

---

<!-- ccm:k:end point:workflow.pattern-pipeline -->

## 失效类型

`capability_gap`（主体：事实方法） —— 模型已知流水线优于整批同步的通用道理，但不知道本项目把它设为多阶段默认策略、也不知道要调用哪个具体 API，会误用整批同步写法或调用不存在的接口。

主体是「多阶段无须同步就用流式 pipeline、只有真需要整批才升级为 barrier」的选型判据。

## 失败形态

代码表面用了看似流式的写法——比如先把 stage 1 结果整批 `Promise.all` 收集成数组，再统一 map 进 stage 2——命名和外观像 pipeline，但实际语义是等全部 item 走完 stage 1 才进 stage 2：一个伪装成流水线的隐藏 barrier，没有任何 item 能提前进入下一阶段。
