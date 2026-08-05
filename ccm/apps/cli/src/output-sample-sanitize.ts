// output-sample-sanitize.ts — 输出样例的确定性净化。
//
// 为什么需要它：`--schema` 要返回一份**从真实输出捕获、且被测试持续核对**的样例。
// 真实输出里混着每次都变的东西——绝对路径、时间戳、pid、epoch 秒。不净化，样例每跑
// 一次都不同，核对用例天天飘红，很快就会被人加 skip——**一道会飘的闸等于没有闸**。
//
// 净化后剩下的正是样例的价值所在：**嵌套结构与字段类型**。那恰好是 required_keys
// 这种顶层键声明传达不了的一层，也是文档里那些样例 JSON 唯一不可替代的部分。
//
// 生成器与核对用例共用本文件的同一个函数。写两份等价实现是本轮反复踩到的坑：
// 两份「等价」的实现会各自漂移，然后核对的是两个都错的东西。

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const ABS_PATH = /^\/(?:[^/\0]+\/)*[^/\0]*$/;
const SHA_LIKE = /^[0-9a-f]{16,}$/i;

/** epoch 秒 / 毫秒的合理区间（2001-09 ~ 2286-11），避免把普通计数误判成时间。 */
function looksLikeEpoch(n: number): boolean {
  if (!Number.isFinite(n) || n <= 0) return false;
  const asSec = n > 1e12 ? n / 1000 : n;
  return asSec > 1_000_000_000 && asSec < 1e10;
}

/** 已知承载时刻的字段名——只在这些键上把数字当 epoch，避免误伤计数字段。 */
const TIME_KEYS = new Set([
  'as_of',
  'captured_at',
  'resets_at',
  'observed_at',
  'valid_until',
  'created_at',
  'started_at',
  'finished_at',
  'updated_at',
  'ts',
  'armed_at',
  'fire_at',
  't0',
]);

/**
 * 把一份真实输出净化成确定性样例。
 *
 * 替换的东西一律换成**自解释的占位符**（`<iso-utc>` 而不是 `""`）——占位符本身要告诉
 * 读者这里原本是什么类型，否则净化的同时也把类型信息抹掉了，样例就退化成了空壳。
 */
export function sanitizeSample(value: unknown, key?: string): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) {
    // 数组只保留首元素作形状样例：长度随板上数据变，留全量既飘又没有额外信息。
    return value.length === 0 ? [] : [sanitizeSample(value[0], key)];
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeSample(v, k);
    }
    return out;
  }
  if (typeof value === 'number') {
    if (key && TIME_KEYS.has(key) && looksLikeEpoch(value)) return '<epoch>';
    return value;
  }
  if (typeof value === 'string') {
    if (ISO_UTC.test(value)) return '<iso-utc>';
    if (SHA_LIKE.test(value)) return '<sha>';
    if (ABS_PATH.test(value) && value.length > 1) return '<abs-path>';
    return value;
  }
  return value;
}
