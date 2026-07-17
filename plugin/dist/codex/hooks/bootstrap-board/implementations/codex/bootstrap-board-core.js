#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function readJson() {
  const raw = fs.readFileSync(0, 'utf8');
  return raw ? JSON.parse(raw) : {};
}

function say(kind, message) {
  process.stdout.write(`${JSON.stringify({ kind, context: message, message })}\n`);
}

function stampNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function resolveHome(env) {
  return env.CC_MASTER_HOME || path.join(env.HOME || '', '.cc_master');
}

function ccmCommand() {
  return process.env.CCM_BIN || 'ccm';
}

// PARITY: rule-bootstrap-ccm-hard-precheck
function ccmPresent() {
  const override = process.env.CCM_BIN || '';
  if (override) {
    try {
      fs.accessSync(override, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  const res = spawnSync('command', ['-v', 'ccm'], { encoding: 'utf8', shell: true });
  return !!res && !res.error && res.status === 0;
}

function ccmMissingDirective() {
  return '<directive source="bootstrap-board">cc-master requires the external `ccm` CLI. No board was created or re-armed. Install `ccm`, verify `ccm --version`, then retry as-master-orchestrator.</directive>';
}

function resetStopAllowUntil(home) {
  const boardPath = process.env.CC_MASTER_BOARD || '';
  if (!boardPath || !path.isAbsolute(boardPath) || !boardPath.endsWith('.board.json')) return false;
  try {
    const res = spawnSync('ccm', [
      'board',
      'set-param',
      'stop_allow_until',
      '1970-01-01T00:00:00Z',
      '--board',
      boardPath,
      '--home',
      home,
      '--json',
      '--no-input',
    ], {
      encoding: 'utf8',
      env: { ...process.env, CC_MASTER_HOME: home },
      timeout: 10000,
    });
    return !!res && !res.error && !res.signal && res.status === 0;
  } catch (_) {
    return false;
  }
}

function parseInvocation(prompt) {
  const lines = String(prompt || '').split(/\r?\n/);
  const first = lines.find((line) => line.trim() !== '') || '';

  const commandMatch = first.match(
    /^\s*(?:\$(?:cc-master:cc-master-as-master-orchestrator|cc-master-as-master-orchestrator|cc-master:as-master-orchestrator)|cc-master:cc-master-as-master-orchestrator|cc-master:as-master-orchestrator|cc-master-as-master-orchestrator)\b(.*)$/
  );
  if (commandMatch) return { matched: true, args: commandMatch[1].trim(), marker: 'raw-command' };

  if (first.trim() === '<!-- cc-master:bootstrap:v1 -->') {
    const argsLine = lines.find((line) => {
      return /^\s*<!--\s*cc-master:args:\s*.*-->$/.test(line);
    });
    if (argsLine) {
      const argsRaw = argsLine.replace(/^\s*<!--\s*cc-master:args:\s*/i, '').replace(/\s*-->\s*$/, '').trim();
      return { matched: true, args: argsRaw, marker: 'expanded-args' };
    }
    return { matched: true, args: '', marker: 'expanded-marker' };
  }
  return { matched: false, args: '', marker: '' };
}

function tokenize(input) {
  const out = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  let match;
  while ((match = re.exec(input))) {
    out.push((match[1] || match[2] || match[3] || '').replace(/\\(["'])/g, '$1'));
  }
  return out;
}

function parseArgs(args) {
  const tokens = tokenize(args);
  const flags = {};
  const goal = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const longEq = token.match(/^--([^=\s]+)=(.*)$/);
    if (longEq) {
      const name = String(longEq[1] || '').trim();
      const value = longEq[2] ?? '';
      if (name === 'resume') {
        flags.resume = true;
        if (value) flags.resumeSelector = value;
      } else if (name === 'priority') {
        flags.priority = value;
      } else if (name === 'wip') {
        flags.wip = value;
      } else if (name === 'owner-wip') {
        flags.ownerWip = value;
      } else if (name === 'policy-switch') {
        flags.policySwitch = value;
      } else if (name === 'github-issue') {
        flags.githubIssue = value;
      } else if (name === 'ddl') {
        flags.ddl = value;
      } else if (!name.startsWith('no-')) {
        const next = tokens[i + 1];
        if (next && !next.startsWith('--')) i += 1;
      }
    } else if (token === '--resume') {
      flags.resume = true;
      const next = tokens[i + 1];
      if (next && !next.startsWith('--')) flags.resumeSelector = tokens[++i];
    } else if (token === '--priority') {
      flags.priority = tokens[++i] || '';
    } else if (token === '--wip') {
      flags.wip = tokens[++i] || '';
    } else if (token === '--owner-wip') {
      flags.ownerWip = tokens[++i] || '';
    } else if (token === '--policy-switch') {
      flags.policySwitch = tokens[++i] || '';
    } else if (token === '--github-issue') {
      flags.githubIssue = tokens[++i] || '';
    } else if (token === '--ddl') {
      flags.ddl = tokens[++i] || '';
    } else if (token === '-p') {
      flags.priority = tokens[++i] || '';
    } else if (token === '-w') {
      flags.wip = tokens[++i] || '';
    } else if (token === '-o') {
      flags.ownerWip = tokens[++i] || '';
    } else if (token === '-s') {
      flags.policySwitch = tokens[++i] || '';
    } else if (token.startsWith('--')) {
      const next = tokens[i + 1];
      if (next && !next.startsWith('--')) i += 1;
    } else {
      goal.push(token);
    }
  }
  return { flags, goal: goal.join(' ').trim() };
}

function run(cmd, args, options = {}) {
  const resolvedCmd = cmd === 'ccm' ? ccmCommand() : cmd;
  const res = spawnSync(resolvedCmd, args, {
    encoding: 'utf8',
    env: process.env,
    ...options,
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    const stderr = (res.stderr || '').trim();
    throw new Error(`${cmd} ${args.join(' ')} failed with ${res.status}${stderr ? `: ${stderr}` : ''}`);
  }
  return res;
}

function registerCoordinationSubscription(home, boardPath, sessionId) {
  try {
    // PARITY: rule-bootstrap-subscription-register
    const res = run('ccm', [
      'coordination',
      'subscription',
      'register',
      '--board',
      boardPath,
      '--origin',
      'codex',
      '--session-id',
      sessionId,
      '--capability',
      'coordination-inbox',
      '--json',
      '--no-input',
    ], { env: { ...process.env, CC_MASTER_HOME: home } });
    // PARITY: rule-bootstrap-subscription-registration-response
    const envelope = JSON.parse(res.stdout || '{}');
    const value = envelope && envelope.ok === true && envelope.data && envelope.data.subscription;
    return !!(
      value &&
      typeof value.subscription_id === 'string' && value.subscription_id &&
      typeof value.session_epoch === 'string' && value.session_epoch &&
      value.session_id === sessionId &&
      value.origin === 'codex' &&
      value.capability === 'coordination-inbox' &&
      value.state === 'current'
    );
  } catch {
    // PARITY: rule-bootstrap-subscription-registration-failure
    return false;
  }
}

// PARITY: rule-bootstrap-structured-path-capability
function requireBootstrapCapabilities(home) {
  const res = run('ccm', ['board', 'init', '--capabilities', '--json', '--no-input'], {
    env: { ...process.env, CC_MASTER_HOME: home, CC_MASTER_NO_AUTOINSTALL: '1' },
  });
  const envelope = JSON.parse(res.stdout || '{}');
  const capabilities = envelope && envelope.ok === true && envelope.data && envelope.data.capabilities;
  const required = ['board-init/structured-board-path-v1', 'goal-contract/v1'];
  if (!Array.isArray(capabilities) || required.some((item) => !capabilities.includes(item))) {
    throw new Error(`ccm lacks required bootstrap capabilities: ${required.join(', ')}`);
  }
}

function isPositiveInteger(value) {
  return /^[1-9][0-9]*$/.test(String(value || ''));
}

function isPriority(value) {
  return /^(urgent|high|normal|low|trivial)$/.test(String(value || ''));
}

function isPolicySwitch(value) {
  return /^(allow|deny)$/.test(String(value || ''));
}

function isGithubIssueUrl(value) {
  return /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/[0-9]+(?:[?#].*)?$/.test(
    String(value || '').trim()
  );
}

// isISOUTC — strict ISO-8601 UTC shape (YYYY-MM-DDTHH:MM:SSZ), same as the engine's ISO_UTC_RE.
// bootstrap does shape-only validation for --ddl; it never parses NL dates / timezones (semantics
// belong to the agent). A date-only or relative/ambiguous value fails this and is kept as evidence.
function isISOUTC(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(String(value || '').trim());
}

function restampOwner(boardPath, sessionId) {
  const board = JSON.parse(fs.readFileSync(boardPath, 'utf8'));
  board.owner = board.owner && typeof board.owner === 'object' ? board.owner : {};
  board.owner.active = true;
  board.owner.session_id = sessionId || '';
  board.owner.heartbeat = stampNow();
  fs.writeFileSync(boardPath, `${JSON.stringify(board, null, 2)}\n`);
  return board;
}

function stampHarness(boardPath) {
  run('ccm', ['--board', boardPath, 'board', 'stamp-harness', '--json', '--no-input']);
}

function boardStem(boardPath) {
  return path.basename(boardPath).replace(/\.board\.json$/i, '');
}

function sessionStatePath(home, sessionId) {
  if (!sessionId) return '';
  const safe = encodeURIComponent(sessionId).replace(/%/g, '_');
  return path.join(home, 'sessions', `${safe}.json`);
}

function writeSessionState(home, sessionId, boardPath, invocation, mode) {
  if (!sessionId || !boardPath) return;
  const statePath = sessionStatePath(home, sessionId);
  if (!statePath) return;
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const state = {
    schema: 'cc-master-codex-session/v1',
    harness: 'codex',
    session_id: sessionId,
    board_path: boardPath,
    board_stem: boardStem(boardPath),
    command: 'cc-master:as-master-orchestrator',
    command_marker: invocation && invocation.marker ? invocation.marker : '',
    command_args: invocation && invocation.args ? invocation.args : '',
    mode,
    armed_at: stampNow(),
  };
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function readBoardCandidate(boardPath) {
  try {
    const board = JSON.parse(fs.readFileSync(boardPath, 'utf8'));
    return { path: boardPath, board };
  } catch (_) {
    return null;
  }
}

function listBoards(boardsDir) {
  if (!fs.existsSync(boardsDir)) return [];
  return fs
    .readdirSync(boardsDir)
    .filter((name) => name.endsWith('.board.json'))
    .sort()
    .map((name) => readBoardCandidate(path.join(boardsDir, name)))
    .filter(Boolean);
}

function compactGoal(goal) {
  const text = String(goal || '').replace(/\s+/g, ' ').trim();
  if (text.length <= 72) return text || '(empty goal)';
  return `${text.slice(0, 69)}...`;
}

function describeBoard(candidate) {
  const owner = candidate.board && candidate.board.owner && typeof candidate.board.owner === 'object' ? candidate.board.owner : {};
  const active = owner.active === true ? 'active' : 'inactive';
  const session = owner.session_id ? ` session=${owner.session_id}` : '';
  return `- ${boardStem(candidate.path)} ${active}${session} goal=${compactGoal(candidate.board && candidate.board.goal)}`;
}

function selectorMatches(candidate, selector) {
  const needle = String(selector || '').trim();
  if (!needle) return false;
  const basename = path.basename(candidate.path);
  const stem = boardStem(candidate.path);
  if (needle === basename || needle === stem || candidate.path === needle) return true;
  if (path.isAbsolute(needle) && path.resolve(needle) === path.resolve(candidate.path)) return true;
  const goal = String((candidate.board && candidate.board.goal) || '');
  return goal.toLowerCase().includes(needle.toLowerCase());
}

function chooseResumeBoard(boards, selector) {
  if (selector) {
    const matches = boards.filter((candidate) => selectorMatches(candidate, selector));
    if (matches.length === 1) return { ok: true, board: matches[0] };
    if (matches.length === 0) {
      return {
        ok: false,
        message: `cc-master resume: no board matched "${selector}".\nAvailable boards:\n${boards.map(describeBoard).join('\n') || '(none)'}`,
      };
    }
    return {
      ok: false,
      message: `cc-master resume: selector "${selector}" matched multiple boards; retry with the exact board stem.\n${matches.map(describeBoard).join('\n')}`,
    };
  }

  if (boards.length === 1) return { ok: true, board: boards[0] };
  return {
    ok: false,
    message:
      boards.length === 0
        ? 'cc-master resume: no existing boards found.'
        : `cc-master resume: multiple boards found; retry with --resume <board-stem>.\n${boards.map(describeBoard).join('\n')}`,
  };
}

function resumeBoard(home, boardsDir, flags, sessionId, invocation) {
  const boards = listBoards(boardsDir);
  const choice = chooseResumeBoard(boards, flags.resumeSelector || '');
  if (!choice.ok) {
    say('context', choice.message);
    return;
  }

  const boardPath = choice.board.path;
  const board = choice.board.board;
  const owner = board && board.owner && typeof board.owner === 'object' ? board.owner : {};
  if (owner.active === true && owner.session_id && owner.session_id !== sessionId) {
    say(
      'context',
      [
        `cc-master resume: refused to steal active board ${boardPath}`,
        `current_session_id=${sessionId || '(empty)'}`,
        `board_session_id=${owner.session_id}`,
        'Ask the user to stop/archive the other session or choose another board.',
      ].join('\n')
    );
    return;
  }

  const resumed = restampOwner(boardPath, sessionId);
  let harnessNote = '';
  try {
    stampHarness(boardPath);
  } catch (error) {
    harnessNote = `\nharness_stamp_advisory=ccm board stamp-harness failed: ${error.message}`;
  }
  writeSessionState(home, sessionId, boardPath, invocation, 'resume');
  registerCoordinationSubscription(home, boardPath, sessionId);
  say(
    'context',
    [
      `cc-master resume: armed Codex orchestration board at ${boardPath}`,
      `session_id=${sessionId || '(empty)'}`,
      `goal=${compactGoal(resumed.goal)}`,
      `Before dispatching: run ccm goal check --board ${boardPath} --json, read the current Goal Brief when present, then reconcile tasks, blocked items, decision_package entries, and latest log entries.${harnessNote}`,
    ].join('\n')
  );
}

function main() {
  const payload = readJson();
  if (payload.event !== 'user-prompt-submit') return;
  const sessionId = payload.session && payload.session.id ? payload.session.id : '';
  const home = resolveHome(process.env);
  resetStopAllowUntil(home);
  const prompt = payload.prompt && payload.prompt.text ? payload.prompt.text : '';
  const invocation = parseInvocation(prompt);
  if (!invocation.matched) return;

  if (!ccmPresent()) {
    say('block', ccmMissingDirective());
    return;
  }

  const { flags, goal: rawRequest } = parseArgs(invocation.args);
  const boardsDir = path.join(home, 'boards');
  try {
    requireBootstrapCapabilities(home);
  } catch (error) {
    say(
      'block',
      `<directive source="bootstrap-board">cc-master refused to arm: ${error.message}. Upgrade ccm to a build that advertises goal-contract/v1, then retry.</directive>`
    );
    return;
  }

  if (flags.resume) {
    resumeBoard(home, boardsDir, flags, sessionId, invocation);
    return;
  }

  const stamp = stampNow().replace(/[:-]/g, '');
  const boardPath = path.join(boardsDir, `${stamp}-${process.pid}.board.json`);
  fs.mkdirSync(boardsDir, { recursive: true });

  // PARITY: rule-bootstrap-raw-request-is-evidence
  // rawRequest is source evidence for the agent to refine; board init deliberately creates goal=""
  // plus a pending ccm/goal-contract/v1 skeleton. Never forward raw text through --goal.
  const initArgs = ['--board', boardPath, 'board', 'init', '--json', '--no-input'];
  if (flags.githubIssue && isGithubIssueUrl(flags.githubIssue)) {
    initArgs.push('--github-issue', String(flags.githubIssue).trim());
  }
  run('ccm', initArgs);
  restampOwner(boardPath, sessionId);
  try {
    stampHarness(boardPath);
  } catch (error) {
    // Keep ARM usable; ccm peers will treat missing harness as an unknown singleton pool.
  }
  writeSessionState(home, sessionId, boardPath, invocation, 'fresh');
  registerCoordinationSubscription(home, boardPath, sessionId);

  const updateArgs = ['--board', boardPath, 'board', 'update', '--json', '--no-input'];
  const applied = [];
  const notes = [];
  if (flags.priority) {
    if (isPriority(flags.priority)) {
      updateArgs.push('--priority', flags.priority);
      applied.push(`priority=${flags.priority}`);
    } else {
      notes.push(`--priority value ${flags.priority} is invalid; skipped`);
    }
  }
  if (flags.wip) {
    if (isPositiveInteger(flags.wip)) {
      updateArgs.push('--wip-limit', flags.wip);
      applied.push(`wip=${flags.wip}`);
    } else {
      notes.push(`--wip value ${flags.wip} is not a positive integer; skipped`);
    }
  }
  if (flags.ownerWip) {
    if (isPositiveInteger(flags.ownerWip)) {
      updateArgs.push('--owner-wip', flags.ownerWip);
      applied.push(`owner_wip=${flags.ownerWip}`);
    } else {
      notes.push(`--owner-wip value ${flags.ownerWip} is not a positive integer; skipped`);
    }
  }
  if (updateArgs.length > 6) {
    try {
      run('ccm', updateArgs);
    } catch (error) {
      notes.push(`ccm board update failed; priority/wip flags may need manual repair: ${error.message}`);
      applied.length = 0;
    }
  }
  if (flags.policySwitch) {
    if (isPolicySwitch(flags.policySwitch)) {
      try {
        run('ccm', [
          '--board',
          boardPath,
          'policy',
          'set',
          '--autonomous-account-switch',
          flags.policySwitch,
          '--user-authorized',
          '--json',
        ]);
        applied.push(`policy_switch=${flags.policySwitch}`);
      } catch (error) {
      notes.push(`ccm policy set failed; policy flag may need manual repair: ${error.message}`);
      }
    } else {
      notes.push(`--policy-switch value ${flags.policySwitch} is invalid; skipped`);
    }
  }

  if (flags.githubIssue) {
    const issueRef = String(flags.githubIssue || '').trim();
    if (isGithubIssueUrl(issueRef)) {
      applied.push('github_issue=board_source');
    } else {
      notes.push(`--github-issue value ${issueRef} is not a valid GitHub issue URL; skipped`);
    }
  }

  // PARITY: rule-bootstrap-ddl-flag
  // --ddl (delivery deadline·issue #149): shape-only validation, best-effort ccm goal deadline set.
  //   valid ISO-8601 UTC → set asserted (source cli-flag); invalid/failed → keep raw as evidence for
  //   the agent to normalize/confirm during Goal Framing. Never blocks arming; never guesses NL dates.
  let ddlEvidence = '';
  if (flags.ddl) {
    const ddl = String(flags.ddl).trim();
    if (isISOUTC(ddl)) {
      try {
        run('ccm', [
          '--board', boardPath, 'goal', 'deadline', 'set',
          '--at', ddl, '--source', 'cli-flag', '--assurance', 'asserted', '--json', '--no-input',
        ], { env: { ...process.env, CC_MASTER_HOME: home } });
        applied.push(`ddl=${ddl}(asserted)`);
        ddlEvidence = `delivery_deadline=${ddl} preset asserted from --ddl; during Goal Framing confirm it with the user via ccm goal deadline confirm --user-authorized so ccm goal check returns ok (not deadline_pending) before DAG dispatch`;
      } catch (error) {
        notes.push(`ccm goal deadline set failed; --ddl ${ddl} not landed (ccm may be too old to support goal deadline; upgrade recommended). Raw value kept as evidence: ${error.message}`);
        ddlEvidence = `delivery_deadline_intent=${ddl} (from --ddl) — ccm could not land it (possibly an old ccm); during Goal Framing run ccm goal deadline set --at ${ddl} --source cli-flag yourself, and prompt the user to upgrade ccm if goal deadline stays unsupported`;
      }
    } else {
      notes.push(`--ddl value ${ddl} is not strict ISO-8601 UTC (YYYY-MM-DDTHH:MM:SSZ); not landed, kept as evidence`);
      ddlEvidence = `delivery_deadline_intent="${ddl}" (from --ddl) is not unambiguous ISO-8601 UTC; bootstrap does not parse NL dates/timezones. During Goal Framing normalize it to UTC, then ccm goal deadline set --at <ISO-UTC> --source cli-flag [--precision day --tz-input <IANA>]; if it is date-only with no timezone evidence, treat it as ambiguous, ask the user, and keep the deadline pending`;
    }
  }

  const bits = [
    `cc-master fresh: created and armed Codex orchestration board at ${boardPath}`,
    'MANDATORY NEXT STEP: the raw request is source evidence, not the canonical goal. Invoke master-orchestrator-guide, clarify/refine an unambiguous Goal Contract, persist it with ccm goal set --board <board> --summary <refined-goal> [--brief-file <file>] --assurance asserted, then run ccm goal check --board <board> --json. Only after that may you decompose the settled goal into a DAG. An armed fresh board with a pending Goal Contract and zero tasks is not a runnable orchestration.',
    `Use this exact board path for ccm writes: --board ${boardPath}`,
    `session_id=${sessionId || '(empty)'}`,
  ];
  if (rawRequest) bits.push('raw_request_present=true (kept as evidence; not copied into board.goal)');
  if (applied.length > 0) bits.push(`bootstrap_applied=${applied.join(' ')}`);
  if (notes.length > 0) bits.push(`bootstrap_advisory=${notes.join('; ')}`);
  if (ddlEvidence) bits.push(`<advisory source="bootstrap-board" strength="strong">${ddlEvidence}</advisory>`);
  say('context', bits.join('\n'));
}

try {
  main();
} catch (error) {
  say('context', `cc-master Codex bootstrap failed: ${error && error.message ? error.message : String(error)}`);
}
