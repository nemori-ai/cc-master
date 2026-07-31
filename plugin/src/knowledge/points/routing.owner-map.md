---
point: routing.owner-map
---

## 权威陈述

<!-- ccm:k:start point:routing.owner-map -->
每个承重不变量只有一个 owner——它的完整定义只写在一处，其它地方只留一句摘要和一个精确指针。八段路由顺序、executor 与 target 的正交关系、effect floor 表、资格硬门、同档 fallback、handle gate、terminal ≠ done，这一整组的 owner 是同一处：派发时直达它一次就够，不必沿途拼凑。
<!-- ccm:k:end point:routing.owner-map -->

## 失效类型

`environment_fact`（主体：事实方法） —— 模型知道「每个承重只有一个 owner」的原则，但不知道当前项目里每个承重的具体 owner 和文件位置

主体是本项目文档的 owner 归属与 drill 指针表，属项目组织约定。
