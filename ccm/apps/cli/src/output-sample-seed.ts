// output-sample-seed.ts — 捕获与核对输出样例时共用的那一块种子板。
//
// 为什么要共享：样例是在某块板上捕获的，核对时必须在**同一块板**上重跑，否则对不上的
// 原因可能只是「两边种得不一样」——那会让闸红得毫无信息量，很快被人加 skip。
//
// 这已经是本轮第三次同型的坑（净化器、种子板、判据），共性都一样：**两份「等价」的
// 实现会各自漂移，然后你核对的是两个都错的东西。** 所以定义只留一份。

/** 种子板的建板与填充步骤（每项是一次 ccm 调用的 argv，不含全局 flag）。 */
export const SAMPLE_SEED_STEPS: readonly (readonly string[])[] = Object.freeze([
  Object.freeze(['board', 'init', '--goal', 'output sample seed board']),
  Object.freeze(['task', 'add', 'T1', '--title', 'seed task', '--estimate', '2h']),
  Object.freeze(['task', 'add', 'T2', '--title', 'downstream', '--deps', 'T1']),
  Object.freeze(['task', 'start', 'T1']),
  Object.freeze(['log', 'add', 'seed log', '--kind', 'note']),
  Object.freeze(['jc', 'add', 'seed call', '--category', 'other', '--severity', 'low']),
]);

/** 需要位置参数的 verb，在种子板上填什么。 */
export const SAMPLE_POSITIONALS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'task show': Object.freeze(['T1']),
});
