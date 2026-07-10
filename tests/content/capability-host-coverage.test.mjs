import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const ROOT = join(import.meta.dirname, '..', '..');
const KNOWN_HOSTS = ['claude-code', 'codex', 'cursor'];

function parseYamlList(filePath, listKey) {
  const yaml = readFileSync(filePath, 'utf8');
  const items = [];
  let inList = false;
  let cur = null;
  for (const line of yaml.split(/\r?\n/)) {
    if (line.startsWith(`${listKey}:`)) {
      inList = true;
      continue;
    }
    if (!inList) continue;
    const idMatch = line.match(/^\s*-\s+id:\s*(.+?)\s*$/);
    if (idMatch) {
      cur = { id: idMatch[1], required: false };
      items.push(cur);
      continue;
    }
    if (!cur) continue;
    const reqMatch = line.match(/^\s+required:\s*(true|false)\s*$/);
    if (reqMatch) cur.required = reqMatch[1] === 'true';
  }
  return items;
}

function commandStrategyPath(commandId, host) {
  return join(ROOT, 'plugin/src/commands', commandId, 'adapters', host, 'strategy.yaml');
}

function skillStrategyPath(skillId, host) {
  return join(ROOT, 'plugin/src/skills', skillId, 'adapters', host, 'strategy.yaml');
}

function listSkillIds() {
  const skillsRoot = join(ROOT, 'plugin/src/skills');
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .filter((name) => existsSync(join(skillsRoot, name.name, 'canonical', 'SKILL.md')))
    .map((e) => e.name)
    .sort();
}

function readMode(strategyPath) {
  const text = readFileSync(strategyPath, 'utf8');
  const match = text.match(/^\s*mode:\s*([A-Za-z0-9_-]+)\s*$/m);
  return match ? match[1] : '';
}

test('required commands have adapters/<host>/strategy.yaml for all known hosts (ADR-031)', () => {
  const commands = parseYamlList(join(ROOT, 'plugin/src/commands/_manifest/commands.yaml'), 'commands').filter(
    (c) => c.required,
  );
  assert.ok(commands.length > 0, 'expected at least one required command');
  for (const cmd of commands) {
    for (const host of KNOWN_HOSTS) {
      const p = commandStrategyPath(cmd.id, host);
      assert.ok(existsSync(p), `${cmd.id}: missing ${host} strategy at ${p}`);
    }
  }
});

test('Cursor command adapters are all host_native (full slash-command parity)', () => {
  const commands = parseYamlList(join(ROOT, 'plugin/src/commands/_manifest/commands.yaml'), 'commands').filter(
    (c) => c.required,
  );
  for (const cmd of commands) {
    const p = commandStrategyPath(cmd.id, 'cursor');
    const mode = readMode(p);
    assert.equal(mode, 'host_native', `${cmd.id} cursor mode must be host_native`);
  }
});

test('distributed runtime skills have adapters/<host>/strategy.yaml for all known hosts (ADR-031)', () => {
  const skills = listSkillIds();
  assert.ok(skills.length > 0, 'expected at least one skill with canonical/SKILL.md');
  for (const skill of skills) {
    for (const host of KNOWN_HOSTS) {
      const p = skillStrategyPath(skill, host);
      assert.ok(existsSync(p), `${skill}: missing ${host} strategy at ${p}`);
    }
  }
});

test('hooks.yaml lists host_coverage for all known hosts on each hook (ADR-031)', () => {
  const hooks = parseYamlList(join(ROOT, 'plugin/src/hooks/_manifest/hooks.yaml'), 'hooks');
  const yaml = readFileSync(join(ROOT, 'plugin/src/hooks/_manifest/hooks.yaml'), 'utf8');
  for (const hook of hooks) {
    for (const host of KNOWN_HOSTS) {
      const re = new RegExp(`id:\\s*${hook.id}[\\s\\S]*?host_coverage:[\\s\\S]*?${host}:\\s*\\S+`);
      assert.ok(re.test(yaml), `hook ${hook.id}: missing host_coverage.${host} in hooks.yaml`);
    }
  }
});

test('host capability envelopes never mark a known-broken event as verified', () => {
  let checkedKnownBroken = 0;
  for (const host of KNOWN_HOSTS) {
    const p = join(ROOT, 'plugin/src/skills/_hosts', host, 'capabilities.yaml');
    if (!existsSync(p)) continue;
    const yaml = readFileSync(p, 'utf8');
    for (const match of yaml.matchAll(/^ {6}([a-z_]+):\n((?: {8}.+\n?)*)/gm)) {
      const envelope = match[1];
      const body = match[2];
      const parseInlineList = (key) => {
        const value = body.match(new RegExp(`^ {8}${key}:\\s*\\[([^\\]]*)\\]\\s*$`, 'm'))?.[1] ?? '';
        return value.split(',').map((item) => item.trim()).filter(Boolean);
      };
      const verified = new Set(parseInlineList('verified_events'));
      const broken = parseInlineList('known_broken_events');
      for (const event of broken) {
        checkedKnownBroken += 1;
        assert.ok(!verified.has(event), `${host}.${envelope}: ${event} cannot be both verified and known-broken`);
      }
    }
  }
  assert.ok(checkedKnownBroken > 0, 'expected at least one declared known-broken capability event');
});
