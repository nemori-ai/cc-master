/**
 * 「尚未分配给任何 skill 的知识」这一个判据的唯一定义。
 *
 * 知识的存在性与它是否被分发，是两件正交的事：做一道菜可以备一批食材，不强制每样都用上。
 * 所以图上允许存在无人消费的模块——但只允许**显式声明过**的那种（`lifecycle.state:"draft"`），
 * 因为有意留作备料的知识和忘了接线的知识，在图上长得一模一样。
 *
 * 这个判据在四个地方各自起作用，且必须是同一个：
 *
 *   - 准入检查    accepted 且无人消费 → 报错；draft 且无人消费 → 放行（它是备料）
 *   - 路由预算    不在任何 entry 的路由表上，就不该被计入路由成本
 *   - 编译        不属于任何 skill，就不该出现在任何 host 产物里
 *   - 报告        放行不等于可以消失，必须持续列出来
 *
 * 各写一份的代价已经现形过：同一个根因在不同批次里被撞到四次，每次症状完全不同——孤儿
 * 报错 / 路由预算超限 / 编译落位失败 / 发布物引用 repo-only 路由页 / 拓扑校验 H1–H4 崩。
 * 判据只有一份，才谈得上「改一次全部对齐」。
 *
 * ## 发布链有三个入口，每个都要自己收窄一次
 *
 * 这不是没抽干净，是三个都是**外部可直接调用的公开函数**，谁也不是谁的下游：
 *
 *   1. `runCompile`              入口处把图收窄成发布集；hop 校验与预算读的是这张收窄后的图
 *   2. `buildHostArtifacts`      受信投影的策略构建器直接调它，不经 runCompile
 *   3. `buildEntryPinBlock`      受信投影的规划器直接调它，不经前两者
 *
 * 曾经试过「只在 1 收窄，2 和 3 靠上游保证」——跑起来 2 和 3 各自炸一次，因为那个上游
 * 假设在它们的调用路径上根本不成立。**三个都收窄，但判据只在本文件定义一次。**
 */

/** 这个模块是不是「有意留作备料、尚未分配给任何 skill」。 */
export function isUnassignedModule(moduleDoc) {
  if (!moduleDoc) return false;
  const declaredDraft =
    (moduleDoc.lifecycle?.state ?? moduleDoc.data?.lifecycle?.state) === 'draft';
  if (!declaredDraft) return false;
  return (moduleDoc.consumers ?? []).length === 0;
}

/**
 * 备料模块的 id 集合。
 *
 * 消费者信息在有些调用点不挂在模块对象上（构图过程中另行累积），故允许传入
 * `consumersOf` 覆盖读法；不传时读模块自己的 `consumers`。
 */
export function unassignedModuleIds(modules, consumersOf = null) {
  const ids = new Set();
  for (const moduleDoc of modules ?? []) {
    const state = moduleDoc.lifecycle?.state ?? moduleDoc.data?.lifecycle?.state;
    if (state !== 'draft') continue;
    const consumers = consumersOf ? consumersOf(moduleDoc) : (moduleDoc.consumers ?? []);
    if ((consumers ?? []).length === 0) ids.add(moduleDoc.id);
  }
  return ids;
}
