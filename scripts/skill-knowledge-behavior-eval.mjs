#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import {
  aggregateBehaviorRuns,
  BEHAVIOR_EVAL,
  buildEvalSurface,
  buildHarnessInvocation,
  gradeBehaviorRun,
  loadBehaviorCases,
} from './skill-knowledge/behavior-eval.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const evalRoot = path.join(
  repoRoot,
  'design_docs/eval/skill-knowledge-router',
);
const defaultRunsRoot = path.join(evalRoot, '.runs');

function usage(message) {
  if (message) process.stderr.write(`${message}\n\n`);
  process.stderr.write(`Usage:
  node scripts/skill-knowledge-behavior-eval.mjs run --condition <baseline|candidate|holdout> --harness <codex|cursor> [--case <id>] [--runs <n>] [--surface-host <host>] [--model <model>] [--dry-run]
  node scripts/skill-knowledge-behavior-eval.mjs aggregate [--runs-root <dir>]
  node scripts/skill-knowledge-behavior-eval.mjs publish [--runs-root <dir>]
`);
  process.exit(message ? 2 : 0);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (!token.startsWith('--') || index + 1 >= rest.length) {
      usage(`Invalid argument: ${token}`);
    }
    options[token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] =
      rest[index + 1];
    index += 1;
  }
  return { command, options };
}

function extractResponse(text) {
  const candidates = [];
  const collect = (value) => {
    if (typeof value === 'string') candidates.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') {
      if (value.type === 'text' && typeof value.text === 'string') candidates.push(value.text);
      for (const nested of Object.values(value)) collect(nested);
    }
  };
  const trimmed = text.trim();
  if (trimmed) candidates.push(trimmed);
  for (const line of trimmed.split('\n')) {
    const value = line.trim();
    if (!value.startsWith('{')) continue;
    try {
      const event = JSON.parse(value);
      collect(event);
    } catch {
      // A provider stream can include non-JSON progress lines.
    }
  }
  const fenced = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  candidates.push(...fenced.map((match) => match[1]));
  const objectMatches = [...trimmed.matchAll(/\{[\s\S]*\}/g)];
  candidates.push(...objectMatches.map((match) => match[0]));
  const parseCandidate = (candidate) => {
    const attempts = [candidate];
    attempts.push(
      ...[...candidate.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map(
        (match) => match[1],
      ),
    );
    const firstObject = candidate.indexOf('{');
    const lastObject = candidate.lastIndexOf('}');
    if (firstObject >= 0 && lastObject > firstObject) {
      attempts.push(candidate.slice(firstObject, lastObject + 1));
    }
    for (const attempt of attempts) {
      try {
        const parsed = JSON.parse(attempt);
        if (
          parsed &&
          typeof parsed === 'object' &&
          Object.hasOwn(parsed, 'case_id') &&
          Object.hasOwn(parsed, 'point_id')
        ) {
          return parsed;
        }
      } catch {
        // Keep looking for the final response object.
      }
    }
    return null;
  };
  for (const candidate of candidates.reverse()) {
    const parsed = parseCandidate(candidate);
    if (parsed) return parsed;
  }
  throw new Error('Harness output did not contain the required response JSON object.');
}

function extractUsage(text) {
  let input = null;
  let output = null;
  let total = null;
  for (const line of text.split('\n')) {
    try {
      const value = JSON.parse(line);
      const stack = [value];
      while (stack.length) {
        const item = stack.pop();
        if (!item || typeof item !== 'object') continue;
        for (const [key, nested] of Object.entries(item)) {
          const normalized = key.toLowerCase();
          if (Number.isFinite(nested)) {
            if (['input_tokens', 'inputtokens'].includes(normalized)) input = nested;
            if (['output_tokens', 'outputtokens'].includes(normalized)) output = nested;
            if (['total_tokens', 'totaltokens'].includes(normalized)) total = nested;
          } else if (nested && typeof nested === 'object') stack.push(nested);
        }
      }
    } catch {
      // Provider usage is optional.
    }
  }
  if (input === null && output === null && total === null) return null;
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: total ?? (input ?? 0) + (output ?? 0),
  };
}

function promptFor(item) {
  return `你正在一个完全隔离的 runtime knowledge surface 中做知识定位评测。

约束：
1. 只能读取当前工作目录内文件；从 README.md 开始。
2. 定位回答问题的唯一 canonical knowledge point。不要浏览父目录、网络或任何仓库元数据。
3. point_id 必须抄成 marker 中的完整 \`point:...\`；module_id / owner_skill 只在 surface
   明示时填写完整 \`module:...\` / \`skill:...\`，不可从目录名猜造。evidence_quote 必须逐字
   摘自该 point 正文；evidence_path 是当前目录相对路径。
4. visited_files 列出你实际读过的文件。route 每项只写 \`path#anchor\`（不要 Markdown
   label），首项必须是 \`README.md\`，后续每项必须由前一文件的真实 Markdown link 可达；
   没有可复验链路就给空数组。
5. 输出严格 JSON，字段只有 case_id, point_id, module_id, owner_skill, evidence_path, evidence_quote, answer, visited_files, route, abstained。
6. 找不到就 abstained=true，ID 与证据可为 null；禁止猜造引用。

case_id: ${item.id}
问题：${item.prompt}`;
}

function loadRuns(runsRoot) {
  if (!fs.existsSync(runsRoot)) return [];
  return fs
    .readdirSync(runsRoot)
    .filter((name) => name.endsWith('.run.json'))
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(runsRoot, name), 'utf8')));
}

function writeRun(runsRoot, graded, transcript, invocation, exitCode) {
  fs.mkdirSync(runsRoot, { recursive: true });
  const stem = [
    graded.graph_hash.slice(0, 12),
    graded.condition,
    graded.harness,
    graded.case_id,
    String(graded.run_index),
    new Date().toISOString().replaceAll(':', '').replaceAll('.', ''),
  ].join('.');
  fs.writeFileSync(
    path.join(runsRoot, `${stem}.run.json`),
    `${JSON.stringify(graded, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(runsRoot, `${stem}.raw.json`),
    `${JSON.stringify(
      {
        schema: 'cc-master/skill-knowledge-behavior-raw/v1',
        invocation,
        exit_code: exitCode,
        transcript,
      },
      null,
      2,
    )}\n`,
  );
}

function runCommand(options) {
  const condition = options.condition;
  const harness = options.harness;
  if (!['baseline', 'candidate', 'holdout'].includes(condition)) {
    usage('run requires --condition baseline|candidate|holdout');
  }
  if (!BEHAVIOR_EVAL.allowed_harnesses.includes(harness)) {
    usage('run requires --harness codex|cursor');
  }
  const split = condition === 'holdout' ? 'holdout' : 'train';
  let cases = loadBehaviorCases({ repoRoot, split }).cases;
  if (options.case) cases = cases.filter((item) => item.id === options.case);
  if (cases.length === 0) usage(`No ${split} case matched: ${options.case}`);
  const runCount = Number(options.runs ?? 1);
  if (!Number.isInteger(runCount) || runCount < 1) usage('--runs must be a positive integer');
  const runsRoot = path.resolve(repoRoot, options.runsRoot ?? defaultRunsRoot);
  for (const item of cases) {
    for (let runIndex = 1; runIndex <= runCount; runIndex += 1) {
      const surfaceRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), `ccm-skg-${condition}-${harness}-`),
      );
      buildEvalSurface({
        repoRoot,
        surfaceHost: options.surfaceHost ?? 'claude-code',
        condition,
        destination: surfaceRoot,
      });
      const responseFile = path.join(surfaceRoot, '.response.json');
      const prompt = promptFor(item);
      const invocation = buildHarnessInvocation({
        harness,
        prompt,
        cwd: surfaceRoot,
        outputFile: responseFile,
        responseSchema: path.join(evalRoot, 'response.schema.json'),
        model: options.model,
      });
      if (options.dryRun) {
        process.stdout.write(
          `${JSON.stringify({ surface_root: surfaceRoot, item, invocation }, null, 2)}\n`,
        );
        continue;
      }
      const started = Date.now();
      const result = spawnSync(invocation.command, invocation.args, {
        cwd: surfaceRoot,
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
      });
      const durationMs = Date.now() - started;
      const transcript = [result.stdout ?? '', result.stderr ?? ''].join('\n');
      if (result.error) throw result.error;
      if (result.status !== 0) {
        process.stderr.write(transcript);
        throw new Error(`${harness} exited ${result.status}`);
      }
      const responseText =
        harness === 'codex' && fs.existsSync(responseFile)
          ? fs.readFileSync(responseFile, 'utf8')
          : transcript;
      let response;
      try {
        response = extractResponse(responseText);
      } catch (error) {
        fs.mkdirSync(runsRoot, { recursive: true });
        fs.writeFileSync(
          path.join(
            runsRoot,
            `${condition}.${harness}.${item.id}.${runIndex}.parse-failed.raw.txt`,
          ),
          transcript,
        );
        throw error;
      }
      const graded = gradeBehaviorRun({
        repoRoot,
        surfaceRoot,
        condition,
        surfaceHost: options.surfaceHost ?? 'claude-code',
        harness,
        caseDefinition: item,
        response,
        rawTranscript: transcript,
        durationMs,
        providerUsage: extractUsage(transcript),
        runIndex,
      });
      writeRun(runsRoot, graded, transcript, invocation, result.status);
      process.stdout.write(
        `${JSON.stringify({
          case_id: item.id,
          condition,
          harness,
          metrics: graded.metrics,
        })}\n`,
      );
      fs.rmSync(surfaceRoot, { recursive: true, force: true });
    }
  }
}

function aggregateCommand(options, publish) {
  const runsRoot = path.resolve(repoRoot, options.runsRoot ?? defaultRunsRoot);
  const aggregate = aggregateBehaviorRuns({
    repoRoot,
    runs: loadRuns(runsRoot),
    minimumRunsPerCase: Number(options.minimumRunsPerCase ?? 3),
  });
  if (publish) {
    fs.writeFileSync(
      path.join(evalRoot, 'evidence.json'),
      `${JSON.stringify(aggregate, null, 2)}\n`,
    );
  }
  process.stdout.write(`${JSON.stringify(aggregate, null, 2)}\n`);
}

const { command, options } = parseArgs(process.argv.slice(2));
try {
  if (command === 'run') runCommand(options);
  else if (command === 'aggregate') aggregateCommand(options, false);
  else if (command === 'publish') aggregateCommand(options, true);
  else usage(command ? `Unknown command: ${command}` : undefined);
} catch (error) {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exit(1);
}
