// service-serializers.ts — launchd plist / systemd user-unit serializers + parsers (portability slice 5).
//
// One host-neutral ServiceDefinition, two independent host adapters. Each adapter owns its own
//   serialization grammar; neither builds a shell command line. The invariants pinned by the matrix:
//   · argv / env / working directory / label / paths are serialized STRUCTURALLY — a single argv element
//     is always one launchd <string> / one systemd token, so shell metacharacters cannot inject or split;
//   · every text value round-trips through parse∘serialize regardless of spaces, Unicode, XML-significant
//     characters (& < > " '), or systemd specifier/escape characters (%);
//   · launchd values are XML-entity escaped; systemd values use systemd's real quoting + C-escape + '%%'
//     specifier escaping (the documented mechanisms), so parse is the exact inverse of serialize.
//   · activation is expressed as structured argv commands (ServiceCommand[]) executed elsewhere — activation
//     truth comes from the executor's real result, never from having written the unit file.
//
// Scope honesty: the parsers are the exact inverse of these serializers (constraint parity for the
//   round-trip property). Live `launchctl` / `systemctl` grammar qualification on a real host is a
//   separate slice (Darwin live qualification / systemd user session); this module does not fake it.
//
// 红线1 / ADR-006: node/JS only, pure stdlib (no fs/os/process/child_process here), zero dependencies.

// A host-neutral supervised-service description. Executable + args are kept apart from any string join.
export interface ServiceProgram {
  executable: string; // absolute path to the program to exec (its own argv[0])
  args: string[]; // remaining argv, each element atomic (never shell-split)
}

export interface ServiceDefinition {
  label: string; // launchd Label (also the reverse-dns-ish identity)
  systemdUnitName: string; // systemd unit file base name, e.g. ccm-monitor-<hex>.service
  description: string; // human description ([Unit] Description)
  program: ServiceProgram;
  workingDirectory: string | null; // null → omit
  environment: Record<string, string>; // empty → omit
  stdoutPath: string;
  stderrPath: string;
  runAtLoad: boolean; // launchd RunAtLoad (systemd start is driven by enable --now)
  keepAlive: boolean; // launchd KeepAlive / systemd Restart=always
}

// Parsed launchd view (inverse of serializeLaunchdPlist).
export interface ParsedLaunchdService {
  label: string | null;
  argv: string[];
  environment: Record<string, string>;
  workingDirectory: string | null;
  stdoutPath: string | null;
  stderrPath: string | null;
  runAtLoad: boolean;
  keepAlive: boolean;
}

// Parsed systemd view (inverse of serializeSystemdUnit).
export interface ParsedSystemdService {
  description: string | null;
  argv: string[];
  environment: Record<string, string>;
  workingDirectory: string | null;
  stdoutPath: string | null;
  stderrPath: string | null;
  restartAlways: boolean;
  wantedBy: string | null;
}

// A single structured activation command. `command` is an executable; `args` is its literal argv.
//   Callers spawn it directly (argv form, no shell), so hostile labels/unit names cannot inject.
export interface ServiceCommand {
  id: string;
  command: string;
  args: string[];
}

// ── launchd (XML plist) ───────────────────────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&'); // ampersand last so decoded text is not re-decoded
}

export function serializeLaunchdPlist(def: ServiceDefinition): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${escapeXml(def.label)}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
  ];
  for (const arg of [def.program.executable, ...def.program.args]) {
    lines.push(`    <string>${escapeXml(arg)}</string>`);
  }
  lines.push('  </array>');

  const envKeys = Object.keys(def.environment);
  if (envKeys.length > 0) {
    lines.push('  <key>EnvironmentVariables</key>', '  <dict>');
    for (const k of envKeys) {
      lines.push(
        `    <key>${escapeXml(k)}</key>`,
        `    <string>${escapeXml(def.environment[k] ?? '')}</string>`,
      );
    }
    lines.push('  </dict>');
  }

  if (def.workingDirectory !== null) {
    lines.push(
      '  <key>WorkingDirectory</key>',
      `  <string>${escapeXml(def.workingDirectory)}</string>`,
    );
  }

  lines.push('  <key>RunAtLoad</key>', `  <${def.runAtLoad ? 'true' : 'false'}/>`);
  lines.push('  <key>KeepAlive</key>', `  <${def.keepAlive ? 'true' : 'false'}/>`);
  lines.push('  <key>StandardOutPath</key>', `  <string>${escapeXml(def.stdoutPath)}</string>`);
  lines.push('  <key>StandardErrorPath</key>', `  <string>${escapeXml(def.stderrPath)}</string>`);
  lines.push('</dict>', '</plist>', '');
  return lines.join('\n');
}

// A tiny, deterministic parser for the exact plist subset serializeLaunchdPlist emits.
//   Not a general XML parser: it walks the top-level dict, and for each <key> consumes the single value
//   node that follows (advancing past any nested <array>/<dict> so their inner keys are not rescanned).
export function parseLaunchdPlist(xml: string): ParsedLaunchdService {
  const out: ParsedLaunchdService = {
    label: null,
    argv: [],
    environment: {},
    workingDirectory: null,
    stdoutPath: null,
    stderrPath: null,
    runAtLoad: false,
    keepAlive: false,
  };
  const dictMatch = xml.match(/<dict>([\s\S]*)<\/dict>/);
  const body = dictMatch?.[1] ?? '';
  const keyRe = /<key>([\s\S]*?)<\/key>/g;

  let cursor = 0;
  while (cursor < body.length) {
    keyRe.lastIndex = cursor;
    const km = keyRe.exec(body);
    if (!km) break;
    const key = unescapeXml(km[1] ?? '');
    let after = km.index + km[0].length;
    while (after < body.length && /\s/.test(body.charAt(after))) after += 1;
    const rest = body.slice(after);

    const boolMatch = /^<(true|false)\/>/.exec(rest);
    const stringMatch = /^<string>([\s\S]*?)<\/string>/.exec(rest);
    const arrayMatch = /^<array>([\s\S]*?)<\/array>/.exec(rest);
    const nestedDictMatch = /^<dict>([\s\S]*?)<\/dict>/.exec(rest);

    if (key === 'ProgramArguments' && arrayMatch) {
      const inner = arrayMatch[1] ?? '';
      out.argv = Array.from(inner.matchAll(/<string>([\s\S]*?)<\/string>/g)).map((m) =>
        unescapeXml(m[1] ?? ''),
      );
      cursor = after + arrayMatch[0].length;
    } else if (key === 'EnvironmentVariables' && nestedDictMatch) {
      const inner = nestedDictMatch[1] ?? '';
      for (const m of inner.matchAll(/<key>([\s\S]*?)<\/key>\s*<string>([\s\S]*?)<\/string>/g)) {
        out.environment[unescapeXml(m[1] ?? '')] = unescapeXml(m[2] ?? '');
      }
      cursor = after + nestedDictMatch[0].length;
    } else if ((key === 'RunAtLoad' || key === 'KeepAlive') && boolMatch) {
      const value = boolMatch[1] === 'true';
      if (key === 'RunAtLoad') out.runAtLoad = value;
      else out.keepAlive = value;
      cursor = after + boolMatch[0].length;
    } else if (stringMatch) {
      const value = unescapeXml(stringMatch[1] ?? '');
      if (key === 'Label') out.label = value;
      else if (key === 'WorkingDirectory') out.workingDirectory = value;
      else if (key === 'StandardOutPath') out.stdoutPath = value;
      else if (key === 'StandardErrorPath') out.stderrPath = value;
      cursor = after + stringMatch[0].length;
    } else {
      cursor = after;
    }
  }
  return out;
}

// ── systemd (INI-style user unit) ──────────────────────────────────────────────────────────────────

// Escape a value that lives in a multi-token context (ExecStart argv element, Environment assignment).
//   Quote when it contains whitespace / quotes / backslash / control chars / is empty; always double '%'.
function escapeSystemdArg(s: string): string {
  const pct = s.replace(/%/g, '%%');
  const needsQuote = s === '' || /[\s"'\\\n\r\t]/.test(s);
  if (!needsQuote) return pct;
  const inner = pct
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${inner}"`;
}

// Escape a value that is the entire remainder of a line (Description, WorkingDirectory, path settings).
//   Internal spaces are safe unquoted here; only double '%' and quote when control chars / edge whitespace
//   / an embedded quote would make the value ambiguous.
function escapeSystemdLineValue(s: string): string {
  const pct = s.replace(/%/g, '%%');
  const needsQuote = s === '' || /[\n\r\t"]/.test(s) || /^\s|\s$/.test(s);
  if (!needsQuote) return pct;
  const inner = pct
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${inner}"`;
}

// Unescape one systemd token (inverse of the escapers above). If quoted, strip quotes + C-escapes; then
//   collapse the '%%' specifier escape back to a literal '%'.
function unescapeSystemdToken(tok: string): string {
  let out: string;
  if (tok.length >= 2 && tok.startsWith('"') && tok.endsWith('"')) {
    const inner = tok.slice(1, -1);
    out = '';
    for (let i = 0; i < inner.length; i += 1) {
      const c = inner[i];
      if (c === '\\' && i + 1 < inner.length) {
        const n = inner[i + 1];
        i += 1;
        out += n === 'n' ? '\n' : n === 'r' ? '\r' : n === 't' ? '\t' : (n ?? '');
      } else {
        out += c;
      }
    }
  } else {
    out = tok;
  }
  return out.replace(/%%/g, '%');
}

// Split a systemd command-line value into tokens, honoring double-quoted regions (whitespace-separated).
function tokenizeSystemd(value: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = value.length;
  while (i < n) {
    while (i < n && /\s/.test(value[i] ?? '')) i += 1;
    if (i >= n) break;
    let tok = '';
    if (value[i] === '"') {
      tok += '"';
      i += 1;
      while (i < n) {
        const c = value[i];
        tok += c;
        if (c === '\\' && i + 1 < n) {
          tok += value[i + 1];
          i += 2;
          continue;
        }
        i += 1;
        if (c === '"') break;
      }
    } else {
      while (i < n && !/\s/.test(value[i] ?? '')) {
        tok += value[i];
        i += 1;
      }
    }
    tokens.push(tok);
  }
  return tokens;
}

export function serializeSystemdUnit(def: ServiceDefinition): string {
  const execTokens = [def.program.executable, ...def.program.args].map(escapeSystemdArg);
  const lines: string[] = ['[Unit]', `Description=${escapeSystemdLineValue(def.description)}`, ''];
  lines.push('[Service]', `ExecStart=${execTokens.join(' ')}`);
  if (def.workingDirectory !== null) {
    lines.push(`WorkingDirectory=${escapeSystemdLineValue(def.workingDirectory)}`);
  }
  for (const k of Object.keys(def.environment)) {
    lines.push(`Environment=${escapeSystemdArg(`${k}=${def.environment[k] ?? ''}`)}`);
  }
  if (def.keepAlive) lines.push('Restart=always');
  lines.push(`StandardOutput=append:${escapeSystemdLineValue(def.stdoutPath)}`);
  lines.push(`StandardError=append:${escapeSystemdLineValue(def.stderrPath)}`);
  lines.push('', '[Install]', 'WantedBy=default.target', '');
  return lines.join('\n');
}

// Parse a single line-value setting (the remainder after `Key=`), possibly a single quoted token.
function parseSystemdLineValue(raw: string): string {
  const t = raw.trim();
  if (t.startsWith('"')) return unescapeSystemdToken(tokenizeSystemd(t)[0] ?? '""');
  return t.replace(/%%/g, '%');
}

export function parseSystemdUnit(text: string): ParsedSystemdService {
  const out: ParsedSystemdService = {
    description: null,
    argv: [],
    environment: {},
    workingDirectory: null,
    stdoutPath: null,
    stderrPath: null,
    restartAlways: false,
    wantedBy: null,
  };
  for (const line of text.split('\n')) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1);
    switch (key) {
      case 'Description':
        out.description = parseSystemdLineValue(value);
        break;
      case 'ExecStart':
        out.argv = tokenizeSystemd(value.trim()).map(unescapeSystemdToken);
        break;
      case 'WorkingDirectory':
        out.workingDirectory = parseSystemdLineValue(value);
        break;
      case 'Environment': {
        const assignment = unescapeSystemdToken(tokenizeSystemd(value.trim())[0] ?? '');
        const idx = assignment.indexOf('=');
        if (idx !== -1) out.environment[assignment.slice(0, idx)] = assignment.slice(idx + 1);
        break;
      }
      case 'Restart':
        out.restartAlways = value.trim() === 'always';
        break;
      case 'StandardOutput':
        out.stdoutPath = parseSystemdLineValue(value.trim().replace(/^append:/, ''));
        break;
      case 'StandardError':
        out.stderrPath = parseSystemdLineValue(value.trim().replace(/^append:/, ''));
        break;
      case 'WantedBy':
        out.wantedBy = value.trim();
        break;
      default:
        break;
    }
  }
  return out;
}

// systemd-escape (path semantics): '/' → '-', and non-portable bytes → \xNN. Deterministic + reversible
//   enough to build a valid unit file name from arbitrary input without shell/path injection.
export function systemdEscapeUnitName(raw: string): string {
  const bytes = Buffer.from(raw, 'utf8');
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i] ?? 0;
    const c = String.fromCharCode(b);
    if (b === 0x2f) out += '-';
    else if (/[A-Za-z0-9_.]/.test(c)) out += c;
    else out += `\\x${b.toString(16).padStart(2, '0')}`;
  }
  return out;
}

// ── activation command builders (pure; structured argv, executed by an external executor) ────────────

export function launchdInstallCommands(o: {
  plistPath: string;
  domainTarget: string;
  label: string;
}): ServiceCommand[] {
  const serviceTarget = `${o.domainTarget}/${o.label}`;
  return [
    { id: 'bootstrap', command: 'launchctl', args: ['bootstrap', o.domainTarget, o.plistPath] },
    { id: 'kickstart', command: 'launchctl', args: ['kickstart', '-k', serviceTarget] },
    { id: 'status', command: 'launchctl', args: ['print', serviceTarget] },
  ];
}

export function launchdUninstallCommands(o: {
  domainTarget: string;
  label: string;
}): ServiceCommand[] {
  return [
    { id: 'bootout', command: 'launchctl', args: ['bootout', `${o.domainTarget}/${o.label}`] },
  ];
}

export function systemdInstallCommands(o: { unitName: string }): ServiceCommand[] {
  return [
    { id: 'daemon-reload', command: 'systemctl', args: ['--user', 'daemon-reload'] },
    { id: 'enable', command: 'systemctl', args: ['--user', 'enable', '--now', o.unitName] },
    { id: 'status', command: 'systemctl', args: ['--user', 'is-active', o.unitName] },
  ];
}

export function systemdUninstallCommands(o: { unitName: string }): ServiceCommand[] {
  return [
    { id: 'disable', command: 'systemctl', args: ['--user', 'disable', '--now', o.unitName] },
  ];
}
