import fs from 'node:fs';
import path from 'node:path';

import { HARDENING_CONTRACT } from './contracts.mjs';
import { buildAndValidateGraph } from './graph.mjs';

const CASE_SCHEMA = 'cc-master/skill-knowledge-behavior-cases/v1';
const RUN_SCHEMA = 'cc-master/skill-knowledge-behavior-run/v1';
const EVIDENCE_SCHEMA = 'cc-master/skill-knowledge-behavior-evidence/v1';
const PROTOCOL_VERSION = 'cc-master/skill-knowledge-router-eval/v1';
const ALLOWED_HARNESSES = new Set(HARDENING_CONTRACT.C9.worker_allowlist);
const CONDITIONS = new Set(['baseline', 'candidate', 'holdout']);
const DEFAULT_EVIDENCE =
  'design_docs/eval/skill-knowledge-router/evidence.json';
const HARNESS_EXECUTION_POSTURE = Object.freeze({
  codex: Object.freeze({
    mode: 'exec',
    permission_mode: 'non_interactive_default',
    sandbox: 'read-only',
    kernel_sandbox_available: true,
    workspace: 'temporary',
    session_persistence: 'ephemeral',
    user_config: 'ignored',
    user_rules: 'ignored',
  }),
  cursor: Object.freeze({
    mode: 'ask',
    permission_mode: 'read_only_ask',
    sandbox: 'disabled',
    kernel_sandbox_available: false,
    kernel_sandbox_unavailable_reason:
      'worker host does not meet Cursor kernel v6.2/AppArmor requirement',
    workspace: 'temporary',
    workspace_trust: 'explicit',
    isolation_equivalence: 'weaker_than_codex_read_only_sandbox',
  }),
});

function repoPath(value) {
  return value.split(path.sep).join('/');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function assertGraph(repoRoot) {
  const built = buildAndValidateGraph({
    repoRoot,
    sourceRoot: 'plugin/src/knowledge',
  });
  if (!built.ok || !built.graph) {
    throw new Error('Behavior eval requires a structurally valid authored knowledge graph.');
  }
  return built.graph;
}

function walkMarkdown(root) {
  const results = [];
  if (!fs.existsSync(root)) return results;
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name.endsWith('.md')) results.push(target);
    }
  };
  visit(root);
  return results.sort();
}

function surfaceBindingPath(bindingPath) {
  const prefix = 'plugin/src/skills/';
  if (!bindingPath.startsWith(prefix)) {
    throw new Error(`Unsupported runtime binding outside plugin/src/skills: ${bindingPath}`);
  }
  return `skills/${bindingPath.slice(prefix.length).replace('/canonical/', '/')}`;
}

function stripRouterArtifacts(text) {
  return text
    .replace(/<a id="ccm-k-point-[^"]+"><\/a>\r?\n?/g, '')
    .replace(
      /<!-- ccm:k:nav:start[^>]*-->[\s\S]*?<!-- ccm:k:nav:end -->\r?\n?/g,
      '',
    )
    .replace(
      /<!-- ccm:k:entry-pin:start -->[\s\S]*?<!-- ccm:k:entry-pin:end -->\r?\n?/g,
      '',
    );
}

function normalizeSurfaceReference(reference) {
  const [file, fragment = ''] = String(reference).split('#', 2);
  return {
    file: repoPath(path.posix.normalize(file.replaceAll('\\', '/')).replace(/^\/+/, '')),
    fragment,
  };
}

function findPointSurface(surfaceRoot, pointId) {
  const anchor = `ccm-k-${pointId.replace(':', '-')}`.replaceAll('.', '-');
  const marker = `<!-- ccm:k:start ${pointId} -->`;
  const matches = [];
  for (const absolute of walkMarkdown(surfaceRoot)) {
    const text = fs.readFileSync(absolute, 'utf8');
    if (text.includes(`id="${anchor}"`) || text.includes(marker)) {
      matches.push(repoPath(path.relative(surfaceRoot, absolute)));
    }
  }
  return { anchor, matches };
}

function safeSurfaceFile(surfaceRoot, relative) {
  const normalized = normalizeSurfaceReference(relative).file;
  const absolute = path.resolve(surfaceRoot, normalized);
  const root = `${path.resolve(surfaceRoot)}${path.sep}`;
  if (absolute !== path.resolve(surfaceRoot) && !absolute.startsWith(root)) return null;
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return null;
  return { absolute, relative: normalized };
}

function markdownLinks(text) {
  const links = [];
  const expression = /\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
  for (const match of text.matchAll(expression)) links.push(match[1]);
  return links;
}

function anchorExists(text, fragment) {
  if (!fragment) return true;
  const decoded = decodeURIComponent(fragment);
  if (text.includes(`id="${decoded}"`) || text.includes(`id='${decoded}'`)) return true;
  // Generated surfaces use explicit HTML ids; this fallback keeps ordinary Markdown
  // route declarations checkable without making heading slug rules the graph SSOT.
  return text.includes(`# ${decoded}`) || text.includes(`## ${decoded}`);
}

function routeIsGrounded(surfaceRoot, route) {
  if (!Array.isArray(route) || route.length < 2) {
    return { grounded: false, hops: null, reason: 'route_too_short' };
  }
  const normalized = route.map(normalizeSurfaceReference);
  if (normalized[0].file !== 'README.md') {
    return { grounded: false, hops: null, reason: 'route_must_start_at_readme' };
  }
  for (let index = 0; index < normalized.length - 1; index += 1) {
    const source = safeSurfaceFile(surfaceRoot, normalized[index].file);
    const destination = safeSurfaceFile(surfaceRoot, normalized[index + 1].file);
    if (!source || !destination) {
      return { grounded: false, hops: null, reason: 'route_file_missing' };
    }
    const sourceText = fs.readFileSync(source.absolute, 'utf8');
    const destinationText = fs.readFileSync(destination.absolute, 'utf8');
    if (!anchorExists(destinationText, normalized[index + 1].fragment)) {
      return { grounded: false, hops: null, reason: 'route_anchor_missing' };
    }
    const linked = markdownLinks(sourceText).some((target) => {
      const [targetFile, targetFragment = ''] = target.split('#', 2);
      if (/^[a-z][a-z0-9+.-]*:/i.test(targetFile)) return false;
      const resolved = repoPath(
        path.posix.normalize(path.posix.join(path.posix.dirname(source.relative), targetFile)),
      );
      return (
        resolved === normalized[index + 1].file &&
        decodeURIComponent(targetFragment) === decodeURIComponent(normalized[index + 1].fragment)
      );
    });
    if (!linked) {
      return { grounded: false, hops: null, reason: 'route_link_missing' };
    }
  }
  return { grounded: true, hops: normalized.length - 1, reason: null };
}

function mean(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rate(runs, selector) {
  if (runs.length === 0) return null;
  return runs.filter(selector).length / runs.length;
}

function summarizeCondition(runs) {
  const hops = runs
    .map((run) => run.metrics.navigation_hops)
    .filter((value) => Number.isInteger(value));
  const providerTotals = runs
    .map((run) => run.metrics.provider_reported_tokens?.total_tokens)
    .filter((value) => Number.isFinite(value));
  return {
    runs: runs.length,
    metrics: {
      point_hit_accuracy: rate(runs, (run) => run.metrics.point_hit),
      owner_accuracy: rate(runs, (run) => run.metrics.owner_correct),
      module_accuracy: rate(runs, (run) => run.metrics.module_correct),
      evidence_grounding_rate: rate(runs, (run) => run.metrics.evidence_grounded),
      wrong_owner_rate: rate(runs, (run) => run.metrics.wrong_owner),
      abstention_rate: rate(runs, (run) => run.metrics.abstained),
      navigation_grounding_rate: rate(runs, (run) => run.metrics.navigation_grounded),
      mean_navigation_hops: mean(hops),
      navigation_hops_measured: hops.length,
      mean_validated_agent_trace_reads: mean(
        runs.map((run) => run.metrics.reads.value),
      ),
      mean_estimated_tokens: mean(
        runs.map((run) => run.metrics.estimated_tokens.value),
      ),
      mean_provider_reported_tokens: mean(providerTotals),
      provider_token_runs: providerTotals.length,
      mean_duration_ms: mean(runs.map((run) => run.metrics.duration_ms)),
    },
  };
}

function conservativeVerdict(conditions) {
  const baseline = conditions.baseline.metrics;
  const candidate = conditions.candidate.metrics;
  const holdout = conditions.holdout.metrics;
  const required = [
    baseline.point_hit_accuracy,
    candidate.point_hit_accuracy,
    holdout.point_hit_accuracy,
    baseline.evidence_grounding_rate,
    candidate.evidence_grounding_rate,
    holdout.evidence_grounding_rate,
  ];
  if (required.some((value) => !Number.isFinite(value))) return 'inconclusive';
  const candidateGain =
    candidate.point_hit_accuracy - baseline.point_hit_accuracy >= 0.05 ||
    candidate.evidence_grounding_rate - baseline.evidence_grounding_rate >= 0.05;
  const holdoutRegression =
    holdout.point_hit_accuracy + 0.05 < candidate.point_hit_accuracy ||
    holdout.evidence_grounding_rate + 0.05 < candidate.evidence_grounding_rate ||
    holdout.wrong_owner_rate > candidate.wrong_owner_rate + 0.05;
  const costRegression =
    Number.isFinite(candidate.mean_estimated_tokens) &&
    Number.isFinite(holdout.mean_estimated_tokens) &&
    holdout.mean_estimated_tokens > candidate.mean_estimated_tokens * 1.5;
  if (holdoutRegression || costRegression) return 'regressed';
  if (candidateGain) return 'improved';
  return 'no_material_change';
}

export function loadBehaviorCases({ repoRoot, split }) {
  if (!['train', 'holdout'].includes(split)) {
    throw new Error(`Unknown behavior eval split: ${split}`);
  }
  const file = path.join(
    repoRoot,
    'design_docs/eval/skill-knowledge-router',
    `cases.${split}.json`,
  );
  const fixture = readJson(file);
  if (fixture.schema !== CASE_SCHEMA || fixture.split !== split || !Array.isArray(fixture.cases)) {
    throw new Error(`Invalid behavior fixture envelope: ${repoPath(path.relative(repoRoot, file))}`);
  }
  const graph = assertGraph(repoRoot);
  const owners = new Set(graph.skills.map((skill) => skill.id));
  const seenOwners = new Set();
  const seenIds = new Set();
  for (const item of fixture.cases) {
    if (!item.id || seenIds.has(item.id)) throw new Error(`Duplicate/missing case id: ${item.id}`);
    seenIds.add(item.id);
    const point = graph.points.find((candidate) => candidate.id === item.expected?.point_id);
    if (
      !point ||
      point.owner_skill !== item.expected.owner_skill ||
      point.module_id !== item.expected.module_id
    ) {
      throw new Error(`Case ${item.id} ground truth does not match explicit graph IDs.`);
    }
    if (item.prompt.includes(item.expected.point_id)) {
      throw new Error(`Case ${item.id} leaks its expected point ID.`);
    }
    seenOwners.add(item.expected.owner_skill);
  }
  if (fixture.cases.length !== owners.size || seenOwners.size !== owners.size) {
    throw new Error(`${split} must cover every runtime skill owner exactly once.`);
  }
  return fixture;
}

export function buildEvalSurface({
  repoRoot,
  surfaceHost = 'claude-code',
  condition,
  destination,
}) {
  if (!CONDITIONS.has(condition)) throw new Error(`Unknown eval condition: ${condition}`);
  if (!HARDENING_CONTRACT.C9.hosts.includes(surfaceHost)) {
    throw new Error(`Unknown product surface host: ${surfaceHost}`);
  }
  const graph = assertGraph(repoRoot);
  const distribution = path.join(repoRoot, 'plugin', 'dist', surfaceHost);
  if (!fs.existsSync(distribution)) {
    throw new Error(`Missing final-host distribution: plugin/dist/${surfaceHost}`);
  }
  fs.mkdirSync(path.join(destination, 'skills'), { recursive: true });
  for (const skill of graph.skills) {
    const source = path.join(distribution, 'skills', skill.name);
    if (!fs.existsSync(source)) {
      throw new Error(`Missing ${surfaceHost} runtime skill projection: ${skill.name}`);
    }
    fs.cpSync(source, path.join(destination, 'skills', skill.name), { recursive: true });
  }
  if (condition !== 'baseline') {
    const knowledge = path.join(distribution, 'knowledge');
    if (!fs.existsSync(knowledge)) {
      throw new Error(`Missing ${surfaceHost} compiled knowledge router.`);
    }
    fs.cpSync(knowledge, path.join(destination, 'knowledge'), { recursive: true });
  } else {
    for (const file of walkMarkdown(path.join(destination, 'skills'))) {
      fs.writeFileSync(file, stripRouterArtifacts(fs.readFileSync(file, 'utf8')));
    }
  }
  const lines = [
    '# Runtime skills',
    '',
    'Read only this isolated surface. Use the links below to locate the single canonical point.',
    '',
  ];
  if (condition !== 'baseline') {
    lines.push('- [Knowledge atlas](knowledge/atlas.md)', '');
  }
  for (const skill of graph.skills) {
    lines.push(`- [${skill.name}](skills/${skill.name}/SKILL.md)`);
  }
  fs.writeFileSync(path.join(destination, 'README.md'), `${lines.join('\n')}\n`);
  return {
    surface_root: destination,
    surface_host: surfaceHost,
    condition,
    skills: graph.skills.map((skill) => skill.id),
    graph_hash: graph.graph_hash,
  };
}

export function buildHarnessInvocation({
  harness,
  prompt,
  cwd,
  outputFile = path.join(cwd, 'response.json'),
  responseSchema,
  model,
}) {
  if (!ALLOWED_HARNESSES.has(harness)) {
    throw new Error('Behavior eval workers are restricted to codex or cursor.');
  }
  if (harness === 'codex') {
    const args = [
      'exec',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--cd',
      cwd,
      '--json',
      '--output-last-message',
      outputFile,
    ];
    if (responseSchema) args.push('--output-schema', responseSchema);
    if (model) args.push('--model', model);
    args.push(prompt);
    return { command: 'codex', args };
  }
  const args = [
    '--print',
    '--output-format',
    'stream-json',
    '--mode',
    'ask',
    '--trust',
    '--sandbox',
    'disabled',
    '--workspace',
    cwd,
    '--model',
    model ?? 'cursor-grok-4.5-high',
    prompt,
  ];
  return { command: 'cursor-agent', args };
}

export function gradeBehaviorRun({
  repoRoot,
  surfaceRoot,
  condition,
  surfaceHost,
  harness,
  caseDefinition,
  response,
  rawTranscript,
  durationMs,
  providerUsage,
  runIndex = 1,
}) {
  if (!CONDITIONS.has(condition)) throw new Error(`Unknown eval condition: ${condition}`);
  if (!ALLOWED_HARNESSES.has(harness)) throw new Error(`Unknown eval harness: ${harness}`);
  const graph = assertGraph(repoRoot);
  const expected = caseDefinition.expected;
  const point = graph.points.find((item) => item.id === expected.point_id);
  const span = graph.spans.find((item) => item.point_id === expected.point_id);
  const located = findPointSurface(surfaceRoot, expected.point_id);
  const evidence = response.evidence_path
    ? safeSurfaceFile(surfaceRoot, response.evidence_path)
    : null;
  const evidenceText = evidence ? fs.readFileSync(evidence.absolute, 'utf8') : '';
  const pointHit = response.point_id === expected.point_id;
  const ownerCorrect = response.owner_skill === expected.owner_skill;
  const moduleCorrect = response.module_id === expected.module_id;
  const quote =
    typeof response.evidence_quote === 'string' ? response.evidence_quote.trim() : '';
  const expectedSurface = surfaceBindingPath(point.binding.path);
  const evidenceGrounded =
    pointHit &&
    ownerCorrect &&
    moduleCorrect &&
    located.matches.length === 1 &&
    evidence?.relative === located.matches[0] &&
    evidence.relative === expectedSurface &&
    quote.length > 0 &&
    span.content.includes(quote) &&
    evidenceText.includes(quote);
  const route = routeIsGrounded(surfaceRoot, response.route);
  const visited = Array.isArray(response.visited_files)
    ? [
        ...new Set(
          response.visited_files
            .map((item) => safeSurfaceFile(surfaceRoot, item)?.relative)
            .filter(Boolean),
        ),
      ]
    : [];
  const transcript = typeof rawTranscript === 'string' ? rawTranscript : '';
  return {
    schema: RUN_SCHEMA,
    protocol_version: PROTOCOL_VERSION,
    graph_hash: graph.graph_hash,
    condition,
    harness,
    surface_host: surfaceHost,
    case_id: caseDefinition.id,
    run_index: runIndex,
    expected: { ...expected },
    observed: response,
    metrics: {
      point_hit: pointHit,
      owner_correct: ownerCorrect,
      module_correct: moduleCorrect,
      wrong_owner:
        response.owner_skill !== null &&
        response.owner_skill !== undefined &&
        !ownerCorrect,
      evidence_grounded: evidenceGrounded,
      prerequisite_grounded:
        route.grounded &&
        response.route.some((item) =>
          String(item).includes(
            `#ccm-k-${expected.module_id.replace(':', '-').replaceAll('.', '-')}`,
          ),
        ),
      navigation_hops: route.grounded ? route.hops : null,
      navigation_grounded: route.grounded,
      navigation_failure: route.reason,
      reads: {
        value: visited.length,
        files: visited,
        measurement_source: 'validated_agent_trace',
        unobserved_reads_possible: true,
      },
      estimated_tokens: {
        value: Math.ceil(Buffer.byteLength(transcript, 'utf8') / 3),
        formula: 'ceil(utf8_transcript_bytes/3)',
        exact_provider_tokenizer: false,
      },
      provider_reported_tokens: providerUsage ?? null,
      duration_ms: durationMs,
      abstained: response.abstained === true,
    },
  };
}

export function aggregateBehaviorRuns({
  repoRoot,
  runs,
  minimumRunsPerCase = 3,
}) {
  const graph = assertGraph(repoRoot);
  const train = loadBehaviorCases({ repoRoot, split: 'train' }).cases;
  const holdout = loadBehaviorCases({ repoRoot, split: 'holdout' }).cases;
  const currentRuns = runs.filter(
    (run) =>
      run.schema === RUN_SCHEMA &&
      run.protocol_version === PROTOCOL_VERSION &&
      run.graph_hash === graph.graph_hash &&
      CONDITIONS.has(run.condition) &&
      ALLOWED_HARNESSES.has(run.harness),
  );
  const conditions = {};
  const coverage = {};
  for (const condition of CONDITIONS) {
    const conditionRuns = currentRuns.filter((run) => run.condition === condition);
    conditions[condition] = summarizeCondition(conditionRuns);
    const expectedCases = condition === 'holdout' ? holdout : train;
    const cells = expectedCases.flatMap((item) =>
      [...ALLOWED_HARNESSES].map((harness) => {
        const count = conditionRuns.filter(
          (run) => run.case_id === item.id && run.harness === harness,
        ).length;
        return { case_id: item.id, harness, count, required: minimumRunsPerCase };
      }),
    );
    coverage[condition] = {
      complete: cells.every((cell) => cell.count >= minimumRunsPerCase),
      cells,
    };
  }
  const complete =
    coverage.baseline.complete &&
    coverage.candidate.complete &&
    coverage.holdout.complete;
  let state = 'not_run';
  if (currentRuns.some((run) => run.condition === 'baseline')) state = 'baseline';
  if (currentRuns.some((run) => run.condition !== 'baseline')) state = 'candidate';
  const result = {
    schema: EVIDENCE_SCHEMA,
    protocol_version: PROTOCOL_VERSION,
    graph_hash: graph.graph_hash,
    behavioral_evidence_status: {
      state: complete ? 'holdout_verdict' : state,
      evidence: [DEFAULT_EVIDENCE],
      ...(complete ? { verdict: conservativeVerdict(conditions) } : {}),
    },
    coverage: {
      complete,
      minimum_runs_per_case: minimumRunsPerCase,
      required_harnesses: [...ALLOWED_HARNESSES],
      required_runtime_skill_owners: graph.skills.map((skill) => skill.id),
      conditions: coverage,
    },
    conditions,
    harness_execution_posture: HARNESS_EXECUTION_POSTURE,
    measurement_notes: {
      reads: 'validated_agent_trace; unobserved reads remain possible',
      estimated_tokens: 'ceil(UTF-8 raw transcript bytes / 3); not provider tokenizer',
      stochastic_gate: false,
    },
  };
  if (
    complete &&
    result.behavioral_evidence_status.verdict === 'improved'
  ) {
    result.improvement_claim = {
      scope: 'router behavioral holdout only',
      evidence: DEFAULT_EVIDENCE,
    };
  }
  return result;
}

export function loadPublishedBehaviorEvidence({
  repoRoot,
  graphHash,
  evidencePath = DEFAULT_EVIDENCE,
}) {
  const file = path.join(repoRoot, evidencePath);
  if (!fs.existsSync(file)) {
    return { state: 'not_run', evidence: [], missing: true };
  }
  let parsed;
  try {
    parsed = readJson(file);
  } catch {
    return { state: 'not_run', evidence: [], invalid: true };
  }
  if (
    parsed.schema !== EVIDENCE_SCHEMA ||
    parsed.protocol_version !== PROTOCOL_VERSION ||
    parsed.graph_hash !== graphHash
  ) {
    return {
      state: 'not_run',
      evidence: [],
      stale: parsed.graph_hash !== graphHash,
      invalid:
        parsed.schema !== EVIDENCE_SCHEMA ||
        parsed.protocol_version !== PROTOCOL_VERSION,
    };
  }
  return { ...parsed.behavioral_evidence_status };
}

export const BEHAVIOR_EVAL = Object.freeze({
  CASE_SCHEMA,
  RUN_SCHEMA,
  EVIDENCE_SCHEMA,
  PROTOCOL_VERSION,
  DEFAULT_EVIDENCE,
  HARNESS_EXECUTION_POSTURE,
  allowed_harnesses: Object.freeze([...ALLOWED_HARNESSES]),
});
