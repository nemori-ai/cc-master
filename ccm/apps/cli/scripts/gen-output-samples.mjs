// gen-output-samples.mjs — 从真实输出捕获 `--schema` 要返回的确定性样例。
//
//   node scripts/gen-output-samples.mjs            # 写 src/generated/output-samples.ts
//   node scripts/gen-output-samples.mjs --check    # 只比对，不写（供本地自查）
//
// 为什么是「捕获」而不是「手写」：手写一份嵌套 schema，是把 using-ccm 的文档副本换成
// TS 副本——换个文件后缀不等于拿到 SSOT。捕获的样例**构造上就是真输出**，不存在
// 「声明与现实分家」这回事；而持续核对由 output-contract-conformance.test.ts 承担。
//
// 确定性怎么保证：每条命令在**两块独立的新鲜板**上各跑一次，净化后不一致的直接**排除**
// 并记下理由。宁可少收一条，不可收一条会飘的——一道会飘的闸很快会被人加 skip。

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'bin', 'ccm.cjs');
const OUT = join(HERE, '..', 'src', 'generated', 'output-samples.ts');

const { REGISTRY } = await import('../src/registry.ts');
const { sanitizeSample } = await import('../src/output-sample-sanitize.ts');
const { SAMPLE_SEED_STEPS, SAMPLE_POSITIONALS } = await import('../src/output-sample-seed.ts');

/** 建一块带内容的新鲜板，返回它的 env。 */
function seedBoard(tag) {
  const home = mkdtempSync(join(tmpdir(), `ccm-sample-${tag}-`));
  const env = { ...process.env, CC_MASTER_HOME: home };
  const q = (a) => execFileSync(process.execPath, [CLI, ...a], { encoding: 'utf8', env });
  for (const step of SAMPLE_SEED_STEPS) q([...step]);
  return { env, home };
}

function capture(env, noun, verb, positionals) {
  try {
    const out = execFileSync(process.execPath, [CLI, noun, verb, ...positionals, '--json'], {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return sanitizeSample(JSON.parse(out).data);
  } catch {
    return undefined;
  }
}

const a = seedBoard('a');
const b = seedBoard('b');

const samples = {};
const excluded = [];
for (const [noun, verbs] of Object.entries(REGISTRY)) {
  for (const [verb, spec] of Object.entries(verbs)) {
    if (!spec.outputSchema) continue;
    const key = `${noun} ${verb}`;
    const pos = [...(SAMPLE_POSITIONALS[key] ?? [])];
    const s1 = capture(a.env, noun, verb, pos);
    const s2 = capture(b.env, noun, verb, pos);
    if (s1 === undefined || s2 === undefined) {
      excluded.push([key, '命令在种子板上跑不通']);
      continue;
    }
    if (JSON.stringify(s1) !== JSON.stringify(s2)) {
      excluded.push([key, '两块独立板上净化后仍不一致（含未被净化的机器/环境相关值）']);
      continue;
    }
    samples[key] = s1;
  }
}
rmSync(a.home, { recursive: true, force: true });
rmSync(b.home, { recursive: true, force: true });

const header = `// 本文件由 scripts/gen-output-samples.mjs 生成——不要手改。
//
// 每条是该命令 \`--json\` 真实输出的 \`data\`，经 output-sample-sanitize.ts 净化（时间/路径/
// 摘要换成自解释占位符，数组只留首元素作形状）。样例的价值是**嵌套结构与字段类型**——
// 那正是 required_keys 这种顶层键声明传达不了的一层。
//
// 收录条件：在两块独立的新鲜板上捕获、净化后逐字节一致。不一致的**不收**，理由见下方
// 注释——宁可少一条，不可收一条会飘的。
//
// 重新生成：node scripts/gen-output-samples.mjs
${excluded.length ? `//\n// 本次排除：\n${excluded.map(([k, why]) => `//   ${k} —— ${why}`).join('\n')}\n` : ''}
export const OUTPUT_SAMPLES: Readonly<Record<string, unknown>> = Object.freeze(${JSON.stringify(samples, null, 2)});
`;

if (process.argv.includes('--check')) {
  const cur = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (cur !== header) {
    console.error(
      'output-samples.ts 与真实输出不一致；跑 node scripts/gen-output-samples.mjs 重新生成',
    );
    process.exit(1);
  }
  console.log(`ok：${Object.keys(samples).length} 条样例与真实输出一致`);
} else {
  writeFileSync(OUT, header);
  console.log(`写入 ${Object.keys(samples).length} 条样例，排除 ${excluded.length} 条`);
  for (const [k, why] of excluded) console.log(`  排除 ${k} —— ${why}`);
}
