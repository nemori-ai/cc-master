#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');

const DENY_BODY = [
  '直接 file-edit board 被拦（board-guard·rule:board-write-single-path）。',
  'why：board 的 schema / 状态机 / 锁不变式只在走 ccm 时才被强制。手改 board JSON 会绕过写关卡，',
  '让 deps 图 / 状态机转移 / hook 读到的窄腰状态静默腐蚀。',
  'fix：改用 ccm verb：ccm task start|done|block|set-status|unblock、ccm task update、ccm task add、ccm board update。',
].join('\n');

// PARITY: rule-board-guard-directive-tag — ADR-018 标签协议（ambient/advisory/directive）在 codex 侧的
// 等价包装（无共享 hook-common 可 require，故本文件本地复刻同形 wrapper，与 claude-code board-guard.js
// 的 `directive(source, body)` 语义/格式一致：真硬闸用 <directive>，含 source + why + fix）。
function directive(source, body) {
  return `<directive source="${source}">\n${String(body)}\n</directive>`;
}

function readJson() {
  const raw = fs.readFileSync(0, 'utf8');
  return raw ? JSON.parse(raw) : {};
}

function resolveHome(env) {
  return env.CC_MASTER_HOME || path.join(env.HOME || os.homedir(), '.cc_master');
}

function boardsDir(home) {
  return path.resolve(path.join(home, 'boards'));
}

function boardMatches(board, sessionId) {
  const owner = board && typeof board === 'object' && board.owner && typeof board.owner === 'object'
    ? board.owner
    : {};
  if (owner.active !== true) return false;
  if (!sessionId) return true;
  return owner.session_id === sessionId;
}

function isArmed(home, sessionId) {
  const dir = boardsDir(home);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.board.json')) continue;
    let board;
    try {
      board = JSON.parse(fs.readFileSync(path.join(dir, entry.name), 'utf8'));
    } catch {
      continue;
    }
    if (boardMatches(board, sessionId)) return true;
  }
  return false;
}

function pathIsBoard(filePath, home) {
  if (!filePath) return false;
  const resolved = path.resolve(String(filePath));
  const dir = boardsDir(home);
  if (resolved !== dir && !resolved.startsWith(`${dir}${path.sep}`)) return false;
  return path.basename(resolved).endsWith('.board.json');
}

const WRITE_OP_RE = />>?|(^|\s)sed\s+[^|]*-i|(^|\s)tee(\s|$)|(^|\s)cp(\s|$)|(^|\s)mv(\s|$)|(^|\s)dd(\s|$)|(^|\s)truncate(\s|$)/;
const BOARD_PATH_RE = /\.board\.json/;
// BOARD_TOKEN_RE — 从一个 command segment 里抓取形似路径的 token（含 `.board.json` 的非空白串，允许
// 包一层引号）。与 claude-code board-guard.js 的 BOARD_TOKEN_RE 字节级一致（PARITY: rule-board-guard-segment-touches-real-board）。
const BOARD_TOKEN_RE = /["']?[^\s"']*\.board\.json[^\s"']*["']?/g;

const SHELL_WRITE_COMMANDS = new Set(['tee', 'cp', 'mv', 'dd', 'truncate']);
const SHELL_ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const MAX_NESTED_SHELL_DEPTH = 4;

// PARITY: rule-board-guard-nested-shell-command
// A bounded shell-word lexer: quotes produce one argv word, while only unquoted separators and
// redirections are syntax. This is intentionally not an expansion engine or a general shell AST.
function lexShellCommands(command) {
  const commands = [];
  let words = [];
  let word = '';
  let wordStarted = false;
  let hasRedirection = false;
  let quote = null;
  let escaped = false;

  const pushWord = () => {
    if (!wordStarted) return;
    words.push(word);
    word = '';
    wordStarted = false;
  };
  const pushCommand = () => {
    pushWord();
    if (words.length > 0 || hasRedirection) commands.push({ words, hasRedirection });
    words = [];
    hasRedirection = false;
  };

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (escaped) {
      word += ch;
      wordStarted = true;
      escaped = false;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (ch === '\\' && quote === '"') {
        escaped = true;
      } else {
        word += ch;
      }
      wordStarted = true;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      wordStarted = true;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      wordStarted = true;
      continue;
    }
    if (ch === '#' && !wordStarted) {
      while (i + 1 < command.length && command[i + 1] !== '\n') i += 1;
      continue;
    }
    if (ch === ';' || ch === '\n' || ch === '|'
      || (ch === '&' && command[i + 1] === '&')) {
      pushCommand();
      if ((ch === '|' && command[i + 1] === '|') || ch === '&') i += 1;
      continue;
    }
    if (/\s/u.test(ch)) {
      pushWord();
      continue;
    }
    if (ch === '>') {
      pushWord();
      hasRedirection = true;
      if (command[i + 1] === '>') i += 1;
      continue;
    }
    word += ch;
    wordStarted = true;
  }
  if (quote || escaped) return null;
  pushCommand();
  return commands;
}

function commandWordIndex(words) {
  let index = 0;
  while (index < words.length && SHELL_ASSIGNMENT_RE.test(words[index])) index += 1;
  return index;
}

function nestedShellCommand(command) {
  const index = commandWordIndex(command.words);
  const executable = command.words[index];
  if (!executable || !['bash', 'sh'].includes(path.basename(executable))) return null;
  const optionIndex = command.words.indexOf('-c', index + 1);
  if (optionIndex < 0 || optionIndex + 1 >= command.words.length) return null;
  const optionPrefix = command.words.slice(index + 1, optionIndex);
  if (!optionPrefix.every((arg) => arg.startsWith('-') && arg !== '--')) return null;
  return command.words[optionIndex + 1];
}

function commandWritesBoard(command, home) {
  const index = commandWordIndex(command.words);
  const executable = command.words[index];
  if (!executable) return false;
  const name = path.basename(executable);
  const writes = command.hasRedirection
    || (name !== 'ccm' && (
      SHELL_WRITE_COMMANDS.has(name)
      || (name === 'sed' && command.words.slice(index + 1).some((arg) => /^-i(?:$|.)/u.test(arg)))
    ));
  return writes && segmentTouchesRealBoard(command.words, home);
}

// segmentTouchesRealBoard(segment, home) → 该 segment 里含 `.board.json` 的 token 是否指向一块**真板**
// （落在 boardsDir(home) 下，对齐 Write/Edit 分支的 pathIsBoard() 语义），而不是任意同名字符串（scratch
// 假板 / 文档示例 / /tmp 下的测试夹具）。与 claude-code board-guard.js 字字对齐（PARITY:
// rule-board-guard-segment-touches-real-board·HOOKPAR-DEC 分叉修复：codex 侧此前缺失该检查，且额外带一条
// 「整条命令兜底」fallback 分支，两者叠加会对形似 `echo hi > /tmp/scratch.txt; cat notes.board.json` 这类
// 命令误报 deny——本轮对齐 claude-code 逻辑，删除兜底分支）。
function segmentTouchesRealBoard(segmentOrWords, home) {
  const tokens = Array.isArray(segmentOrWords)
    ? segmentOrWords.filter((word) => BOARD_PATH_RE.test(word))
    : (segmentOrWords.match(BOARD_TOKEN_RE) || []);
  for (const raw of tokens) {
    const token = raw.replace(/^["']|["']$/g, '');
    if (token.includes('$')) return true; // 变量展开，拿不准就保守偏拦
    if (pathIsBoard(path.resolve(token), home)) return true;
  }
  return false;
}

// bashWritesBoard(command, home) → 该 Bash 命令是否**启发式命中**「手改 board」。须同一个 command segment
// 内同时含 .board.json 路径（且 resolve 到真板）+ 写操作符。command word 是 ccm 也不豁免 shell
// 重定向：普通无重定向的 ccm --board 调用因没有写操作符而自然放行。
// PARITY: rule-board-guard-segment-touches-real-board — 与 claude-code board-guard.js 的 bashWritesBoard()
// 判定表字节级对齐；不再有「整条命令」兜底分支（该分支是 HOOKPAR §2.5 host-convention-divergence 的根因）。
// PARITY: rule-board-guard-bash-heuristic
function bashWritesBoard(command, home, depth = 0) {
  if (typeof command !== 'string' || !command) return false;
  if (!BOARD_PATH_RE.test(command)) return false;
  const commands = lexShellCommands(command);
  if (!commands) return false;
  for (const candidate of commands) {
    const nested = nestedShellCommand(candidate);
    if (nested !== null) {
      if (depth >= MAX_NESTED_SHELL_DEPTH) {
        if (BOARD_PATH_RE.test(nested) && WRITE_OP_RE.test(nested)) return true;
      } else if (bashWritesBoard(nested, home, depth + 1)) {
        return true;
      }
    }
    if (commandWritesBoard(candidate, home)) return true;
  }
  return false;
}

const INPUT_PATH_ALIASES = ['file_path', 'path', 'filename'];

// All recognized aliases form one declared target set. Any board target wins. Multiple aliases must
// all be valid strings and normalize to the same path; otherwise the tool target is ambiguous and the
// armed guard fails closed. A single legal alias preserves the existing host compatibility surface.
function structuredWriteShouldBlock(input, home) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const entries = INPUT_PATH_ALIASES
    .filter((key) => Object.prototype.hasOwnProperty.call(input, key))
    .map((key) => ({ key, value: input[key] }));
  if (entries.length === 0) return false;

  const valid = entries.filter(({ value }) => (
    typeof value === 'string' && value.length > 0 && !value.includes('\0') && !value.includes('\r')
  ));
  if (valid.some(({ value }) => pathIsBoard(value, home))) return true;
  if (entries.length === 1) return false;
  if (valid.length !== entries.length) return true;

  const resolved = new Set(valid.map(({ value }) => path.resolve(value)));
  return resolved.size !== 1;
}

// PARITY: rule-board-guard-apply-patch-targets
// Parse only apply_patch control headers. Hunk text is file content, never target-path evidence.
// Returning null means the target set is ambiguous, so the PreToolUse guard must fail closed.
const APPLY_PATCH_CONTROL_CONTEXT = Object.freeze({
  TOP_LEVEL: 'top-level',
  UPDATE: 'update',
});

const APPLY_PATCH_PARSE_STATE = Object.freeze({
  EXPECT_FILE: 'expect-file',
  ADD_BODY: 'add-body',
  DELETE_BOUNDARY: 'delete-boundary',
  UPDATE_MOVE: 'update-move',
  UPDATE_BODY: 'update-body',
});

function rustCharIsWhitespace(codeUnit) {
  // Rust `char::is_whitespace` / Unicode White_Space, expressed explicitly so JavaScript's
  // different trim table (notably U+0085, and its extra U+FEFF) cannot change parser parity.
  return (codeUnit >= 0x0009 && codeUnit <= 0x000d)
    || codeUnit === 0x0020
    || codeUnit === 0x0085
    || codeUnit === 0x00a0
    || codeUnit === 0x1680
    || (codeUnit >= 0x2000 && codeUnit <= 0x200a)
    || codeUnit === 0x2028
    || codeUnit === 0x2029
    || codeUnit === 0x202f
    || codeUnit === 0x205f
    || codeUnit === 0x3000;
}

function trimStartRustWhitespace(value) {
  let start = 0;
  while (start < value.length && rustCharIsWhitespace(value.charCodeAt(start))) start += 1;
  return value.slice(start);
}

function trimEndRustWhitespace(value) {
  let end = value.length;
  while (end > 0 && rustCharIsWhitespace(value.charCodeAt(end - 1))) end -= 1;
  return value.slice(0, end);
}

function trimRustWhitespace(value) {
  return trimEndRustWhitespace(trimStartRustWhitespace(value));
}

function normalizeApplyPatchPhysicalLine(line) {
  // Rust `lines()` consumes one CR and the streaming patch parser consumes one more. Normalize at
  // most those two terminator bytes; a third suffix CR remains raw hunk data and is rejected there.
  let end = line.length;
  if (end > 0 && line[end - 1] === '\r') end -= 1;
  if (end > 0 && line[end - 1] === '\r') end -= 1;
  return line.slice(0, end);
}

function lexApplyPatchControl(rawLine, context) {
  // The installed parser normalizes both sides only while it expects a top-level control. Once an
  // Update hunk is active it normalizes the right side only, so a raw leading space remains the hunk
  // context prefix. Never hand an unqualified, globally-trimmed line to target classification.
  const line = context === APPLY_PATCH_CONTROL_CONTEXT.UPDATE
    ? trimEndRustWhitespace(rawLine)
    : trimRustWhitespace(rawLine);

  if (line === '*** Begin Patch') return { kind: 'begin' };
  if (line === '*** End Patch') return { kind: 'end' };
  if (line === '*** End of File') return { kind: 'end-of-file' };
  if (/^@@(?: |$)/u.test(line)) return { kind: 'hunk' };

  for (const operation of ['Add', 'Delete', 'Update']) {
    const prefix = `*** ${operation} File: `;
    if (line.startsWith(prefix) && line.length > prefix.length) {
      // Slice instead of `.` matching: CR/U+2028 are legal target bytes at this grammar layer.
      // NUL was rejected before lexing and LF is the physical-line delimiter.
      return { kind: 'file', operation, target: line.slice(prefix.length) };
    }
  }

  const movePrefix = '*** Move to: ';
  if (line.startsWith(movePrefix) && line.length > movePrefix.length) {
    return { kind: 'move', target: line.slice(movePrefix.length) };
  }

  const environmentPrefix = '*** Environment ID:';
  if (line.startsWith(environmentPrefix)) {
    return {
      kind: 'environment',
      value: trimRustWhitespace(line.slice(environmentPrefix.length)),
    };
  }

  return { kind: 'other' };
}

function parseApplyPatchTargets(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.patch !== 'string') {
    return null;
  }

  const physicalLines = input.patch.split('\n');
  if (physicalLines.some((line) => line.includes('\0'))) return null;
  // Normalize only the parser's bounded physical-line CR handling. A CR elsewhere remains target or
  // hunk data and stays available to the context lexer / effect-path classifier.
  const rawLines = physicalLines.map(normalizeApplyPatchPhysicalLine);

  // The installed entrypoint strips whitespace outside the patch envelope. Consume only those outer
  // blank physical lines here; never trim a line after Begin or before End, where its raw prefix can
  // be Update hunk data. Outer blankness follows Rust whitespace, not JavaScript trim semantics.
  let envelopeStart = 0;
  let envelopeEnd = rawLines.length;
  while (envelopeStart < envelopeEnd
    && trimRustWhitespace(rawLines[envelopeStart]) === '') envelopeStart += 1;
  while (envelopeEnd > envelopeStart
    && trimRustWhitespace(rawLines[envelopeEnd - 1]) === '') envelopeEnd -= 1;
  const lines = rawLines.slice(envelopeStart, envelopeEnd);
  if (lines.length < 3
    || lexApplyPatchControl(lines[0], APPLY_PATCH_CONTROL_CONTEXT.TOP_LEVEL).kind !== 'begin'
    || lexApplyPatchControl(lines[lines.length - 1], APPLY_PATCH_CONTROL_CONTEXT.TOP_LEVEL).kind !== 'end') {
    return null;
  }

  const end = lines.length - 1;
  const targets = [];
  let i = 1;
  let state = APPLY_PATCH_PARSE_STATE.EXPECT_FILE;
  let canReadEnvironment = true;
  let sawHunkLine = false;
  let currentHunkLines = 0;
  let awaitingHunkLine = false;
  let afterEndOfFile = false;

  while (i < end) {
    const rawLine = lines[i];

    if (state === APPLY_PATCH_PARSE_STATE.EXPECT_FILE) {
      const control = lexApplyPatchControl(rawLine, APPLY_PATCH_CONTROL_CONTEXT.TOP_LEVEL);
      if (canReadEnvironment && control.kind === 'environment') {
        if (!control.value) return null;
        canReadEnvironment = false;
        i += 1;
        continue;
      }
      canReadEnvironment = false;
      if (control.kind !== 'file') return null;
      targets.push(control.target);
      i += 1;
      if (control.operation === 'Add') state = APPLY_PATCH_PARSE_STATE.ADD_BODY;
      if (control.operation === 'Delete') state = APPLY_PATCH_PARSE_STATE.DELETE_BOUNDARY;
      if (control.operation === 'Update') {
        state = APPLY_PATCH_PARSE_STATE.UPDATE_MOVE;
        sawHunkLine = false;
        currentHunkLines = 0;
        awaitingHunkLine = false;
        afterEndOfFile = false;
      }
      continue;
    }

    if (state === APPLY_PATCH_PARSE_STATE.ADD_BODY) {
      // Add content is raw data. A present body line must carry '+'. Any other byte begins the next
      // top-level control slot and is re-lexed there with full outer-whitespace normalization.
      if (rawLine.startsWith('+')) {
        i += 1;
        continue;
      }
      state = APPLY_PATCH_PARSE_STATE.EXPECT_FILE;
      continue;
    }

    if (state === APPLY_PATCH_PARSE_STATE.DELETE_BOUNDARY) {
      // Delete has no body; do not consume the next line before the top-level lexer sees it.
      state = APPLY_PATCH_PARSE_STATE.EXPECT_FILE;
      continue;
    }

    if (state === APPLY_PATCH_PARSE_STATE.UPDATE_MOVE) {
      // Move is nested in Update state. The real parser strips suffix whitespace only; a leading
      // space is therefore hunk context, not a destination header.
      const control = lexApplyPatchControl(rawLine, APPLY_PATCH_CONTROL_CONTEXT.UPDATE);
      if (control.kind === 'move') {
        targets.push(control.target);
        i += 1;
      }
      state = APPLY_PATCH_PARSE_STATE.UPDATE_BODY;
      continue;
    }

    const control = lexApplyPatchControl(rawLine, APPLY_PATCH_CONTROL_CONTEXT.UPDATE);
    if (control.kind === 'file') {
      if (!sawHunkLine || awaitingHunkLine) return null;
      state = APPLY_PATCH_PARSE_STATE.EXPECT_FILE;
      continue;
    }
    if (control.kind === 'hunk') {
      if (awaitingHunkLine || (!afterEndOfFile && sawHunkLine && currentHunkLines === 0)) return null;
      currentHunkLines = 0;
      awaitingHunkLine = true;
      afterEndOfFile = false;
      i += 1;
      continue;
    }
    if (control.kind === 'end-of-file') {
      if (awaitingHunkLine || currentHunkLines === 0) return null;
      currentHunkLines = 0;
      afterEndOfFile = true;
      i += 1;
      continue;
    }
    if (afterEndOfFile && trimEndRustWhitespace(rawLine) === '') {
      // This separator allowance exists only after a valid End-of-File marker. Treating blank lines
      // globally as controls would erase meaningful empty Update context lines.
      i += 1;
      continue;
    }
    if (afterEndOfFile) return null;

    // Hunk bytes are classified from their raw prefix. In particular, ` *** Update File:` is a
    // context line even though a global trim would make it look like a board target header.
    if (rawLine !== ''
      && !rawLine.startsWith(' ')
      && !rawLine.startsWith('+')
      && !rawLine.startsWith('-')) return null;
    sawHunkLine = true;
    currentHunkLines += 1;
    awaitingHunkLine = false;
    i += 1;
  }

  const validTerminalState = state === APPLY_PATCH_PARSE_STATE.ADD_BODY
    || state === APPLY_PATCH_PARSE_STATE.DELETE_BOUNDARY
    || (state === APPLY_PATCH_PARSE_STATE.UPDATE_BODY && sawHunkLine && !awaitingHunkLine);
  return validTerminalState && targets.length > 0 ? targets : null;
}

function resolveApplyPatchTargetForEffect(target) {
  // Codex 0.144.2 classifies rootedness from the raw target before removing TAB/CR bytes. Resolve
  // first to preserve that decision: `\t/absolute-looking` and `\r/absolute-looking` stay relative
  // shadows under the patch cwd, while a genuinely absolute target remains absolute. Only then
  // mirror the observed byte removal; other control/Unicode characters stay literal.
  return path.resolve(target).replace(/[\t\r]/gu, '');
}

function resolveExistingFilesystemEffect(effectPath) {
  // Follow the same existing filesystem objects the native parser will touch. Add/Move may name a
  // not-yet-existing leaf (or parent chain), so resolve the deepest existing ancestor and append the
  // absent suffix. An existing-but-unresolvable object (broken/looping symlink, ENOTDIR, EACCES, …)
  // is not equivalent to absence: return null so the armed guard fails closed on an opaque effect.
  let cursor = path.resolve(effectPath);
  const absentSuffix = [];

  while (true) {
    try {
      fs.lstatSync(cursor);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') return null;
      const parent = path.dirname(cursor);
      if (parent === cursor) return null;
      absentSuffix.unshift(path.basename(cursor));
      cursor = parent;
      continue;
    }

    let realExistingPath;
    try {
      realExistingPath = fs.realpathSync.native(cursor);
    } catch {
      return null;
    }
    return path.resolve(realExistingPath, ...absentSuffix);
  }
}

function applyPatchTouchesBoard(input, home) {
  const targets = parseApplyPatchTargets(input);
  if (!targets) return true;
  const realBoardsDirectory = resolveExistingFilesystemEffect(boardsDir(home));
  if (!realBoardsDirectory) return true;
  return targets.some((target) => {
    const effectPath = resolveApplyPatchTargetForEffect(target);
    const realEffectPath = resolveExistingFilesystemEffect(effectPath);
    if (!realEffectPath) return true;
    if (realEffectPath !== realBoardsDirectory
      && !realEffectPath.startsWith(`${realBoardsDirectory}${path.sep}`)) return false;
    return path.basename(realEffectPath).endsWith('.board.json');
  });
}

function block() {
  process.stdout.write(`${JSON.stringify({ kind: 'block', message: directive('board-guard', DENY_BODY) })}\n`);
}

function main() {
  const payload = readJson();
  if (payload.event !== 'pre-tool-use') return;
  const sessionId = payload.session && payload.session.id ? payload.session.id : '';
  const home = resolveHome(process.env);
  if (!isArmed(home, sessionId)) return;

  const tool = payload.tool || {};
  const name = tool.name || '';
  const input = tool.input || {};
  if (name === 'Write' || name === 'Edit' || name === 'MultiEdit') {
    if (structuredWriteShouldBlock(input, home)) block();
    return;
  }
  if (name === 'apply_patch') {
    if (applyPatchTouchesBoard(input, home)) block();
    return;
  }
  if (name === 'Bash') {
    const command = input && typeof input.command === 'string' ? input.command : '';
    if (bashWritesBoard(command, home)) block();
  }
}

try {
  main();
} catch {
  process.exit(0);
}
