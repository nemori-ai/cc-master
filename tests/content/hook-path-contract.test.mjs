import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(path, 'utf8');

test('Claude hook registrations quote the complete plugin-rooted command', () => {
  const manifest = JSON.parse(read('plugin/src/hooks/_hosts/claude-code/hooks.json'));
  const commands = Object.values(manifest.hooks)
    .flat()
    .flatMap((registration) => registration.hooks || [])
    .map((hook) => hook.command);

  assert.ok(commands.length > 0);
  for (const command of commands) {
    assert.match(command, /^"\$\{CLAUDE_PLUGIN_ROOT\}\/[^"]+"$/);
  }
});

test('Claude fresh bootstrap consumes board init JSON instead of scraping human path text', () => {
  const source = read('plugin/src/hooks/bootstrap-board/implementations/claude-code/bootstrap-board.sh');
  assert.match(source, /board init[^\n]*--json/);
  assert.match(source, /board init[^\n]*--capabilities[^\n]*--json/);
  assert.match(
    source,
    /CC_MASTER_NO_AUTOINSTALL=1[^\n]*board init[^\n]*--capabilities[^\n]*--json[^\n]*--no-input/,
  );
  assert.match(source, /CC_MASTER_NO_AUTOINSTALL=1[^\n]*--version/);
  assert.match(source, /board-init\/structured-board-path-v1/);
  assert.match(source, /0\.21\.0/);
  assert.match(source, /data\.board_path/);
  assert.doesNotMatch(source, /grep -oE/);
  const probe = source.indexOf('--capabilities');
  const runtime = source.indexOf('HOME_DIR="$(cc_master_home)"');
  const firstMigrationCall = source.indexOf('\n  migrate_legacy_boards ', runtime);
  const firstMkdir = source.indexOf('\nmkdir -p ', runtime);
  assert.ok(probe >= 0 && probe < firstMigrationCall, 'fresh probe precedes legacy migration');
  assert.ok(probe < firstMkdir, 'fresh probe precedes mkdir');
});

test('using-ccm documents board init structured-path capability and dry-run omission', () => {
  const catalog = read('plugin/src/skills/using-ccm/canonical/references/command-catalog.md');
  assert.match(catalog, /board-init\/structured-board-path-v1/);
  assert.match(catalog, /data\.board_path/);
  assert.match(catalog, /--dry-run[^\n]*(?:不含|缺少|省略)[^\n]*board_path/);
});

test('path-token Capability Card pins the side-effect-free capabilities handshake', () => {
  const card = read('design_docs/harnesses/capabilities/path-token-resolution.md');
  assert.match(card, /`ccm board init --capabilities --json --no-input`/);
  assert.doesNotMatch(card, /through\s+`ccm board init --dry-run --json`/);
  assert.match(card, /(?:separate|distinct|分离|独立)[^\n]*(?:dry-run|discovery|capability)/i);
});

test('installed Codex launcher fallback climbs from hooks/_hosts/codex to plugin root', () => {
  const source = read('plugin/src/hooks/_hosts/codex/launcher.js');
  assert.match(
    source,
    /path\.resolve\(__dirname, ['"]\.\.['"], ['"]\.\.['"], ['"]\.\.['"]\)/,
  );
});

test('host launchers preserve the plugin to ccm process boundary', () => {
  for (const host of ['codex', 'cursor']) {
    const source = read(`plugin/src/hooks/_hosts/${host}/launcher.js`);
    assert.doesNotMatch(source, /(?:require|from)\s*\(?['"]@ccm\/engine/);
  }
});
