// service-serializers.test.ts — launchd plist / systemd unit serializer + parser acceptance matrix.
//
// These serializers are independent host adapters over one host-neutral ServiceDefinition. The teeth:
//   · round-trip fidelity: argv / env / workdir / label / paths survive serialize→parse for values
//     containing spaces, Unicode, XML-significant characters, and systemd specifier/escape characters;
//   · structural (non-shell) argv/env serialization: a single argv element carrying shell metacharacters
//     must round-trip as exactly one element (no injection, no split);
//   · golden output snapshots for a Linux systemd fixture and a Darwin launchd fixture;
//   · activation command builders emit structured argv (never a shell string) so a hostile label / unit
//     name cannot inject.
// Tests exercise the built dist barrel (same convention as the rest of the engine suite).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  launchdInstallCommands,
  launchdUninstallCommands,
  parseLaunchdPlist,
  parseSystemdUnit,
  type ServiceDefinition,
  serializeLaunchdPlist,
  serializeSystemdUnit,
  systemdInstallCommands,
  systemdUninstallCommands,
} from '../dist/index.mjs';

const BRACED_HOME = `\${HOME}`;

// A representative definition whose fields deliberately carry hostile / awkward data.
function nastyDef(): ServiceDefinition {
  return {
    label: 'ai.nemori.ccm.monitor & <weird> "q"',
    systemdUnitName: 'ccm-monitor-deadbeef01.service',
    description: 'ccm monitor for 用户 α & β',
    program: {
      executable: '/opt/cc master/ccm',
      args: [
        'monitor',
        'serve',
        '--state',
        '/home/用户/My Project/state & config <v1>.json',
        // one argv element carrying shell metacharacters + a systemd specifier: must stay atomic.
        '; rm -rf / $(whoami) && echo %h | tee %%literal',
      ],
    },
    workingDirectory: '/home/用户/work dir/α',
    environment: {
      CC_MASTER_HOME: '/home/用户/My Project/.cc_master',
      NOISE: 'a b=c "quoted" %s\ttab',
    },
    stdoutPath: '/home/用户/My Project/log & out.txt',
    stderrPath: '/home/用户/My Project/log & out.txt',
    runAtLoad: true,
    keepAlive: true,
  };
}

// A clean fixture used for byte-exact golden snapshots.
function goldenDef(): ServiceDefinition {
  return {
    label: 'ai.nemori.ccm.monitor.deadbeef01',
    systemdUnitName: 'ccm-monitor-deadbeef01.service',
    description: 'ccm monitor',
    program: {
      executable: '/opt/cc master/ccm',
      args: ['monitor', 'serve', '--state', '/home/u/.cc_master/services/monitor/state.json'],
    },
    workingDirectory: null,
    environment: {},
    stdoutPath: '/home/u/.cc_master/services/monitor/log',
    stderrPath: '/home/u/.cc_master/services/monitor/log',
    runAtLoad: true,
    keepAlive: true,
  };
}

test('launchd: round-trips hostile argv/env/paths/label without corruption or injection', () => {
  const def = nastyDef();
  const xml = serializeLaunchdPlist(def);
  // XML-significant characters must be entity-escaped in the emitted document.
  assert.match(xml, /&amp;/);
  assert.match(xml, /&lt;weird&gt;/);
  assert.doesNotMatch(xml, /<weird>/); // raw angle brackets would corrupt the plist
  const parsed = parseLaunchdPlist(xml);
  assert.equal(parsed.label, def.label);
  assert.deepEqual(parsed.argv, [def.program.executable, ...def.program.args]);
  assert.equal(parsed.argv.length, 6, 'the metacharacter argv element stays a single string');
  assert.deepEqual(parsed.environment, def.environment);
  assert.equal(parsed.workingDirectory, def.workingDirectory);
  assert.equal(parsed.stdoutPath, def.stdoutPath);
  assert.equal(parsed.stderrPath, def.stderrPath);
  assert.equal(parsed.runAtLoad, true);
  assert.equal(parsed.keepAlive, true);
});

test('systemd: round-trips hostile argv/env/paths + specifier escaping without injection', () => {
  const def = nastyDef();
  const unit = serializeSystemdUnit(def);
  // Literal '%' must be doubled so systemd does not expand it as a specifier.
  assert.match(unit, /%%h/);
  assert.match(unit, /%%%%literal/);
  const parsed = parseSystemdUnit(unit);
  assert.deepEqual(parsed.argv, [def.program.executable, ...def.program.args]);
  assert.equal(parsed.argv.length, 6, 'the metacharacter argv element stays a single token');
  assert.equal(
    parsed.argv[5],
    '; rm -rf / $(whoami) && echo %h | tee %%literal',
    'shell metacharacters + specifier survive verbatim as one argv element',
  );
  assert.deepEqual(parsed.environment, def.environment);
  assert.equal(parsed.workingDirectory, def.workingDirectory);
  assert.equal(parsed.stdoutPath, def.stdoutPath);
  assert.equal(parsed.stderrPath, def.stderrPath);
  assert.equal(parsed.restartAlways, true);
  assert.equal(parsed.description, def.description);
});

test('systemd: ExecStart escapes literal dollars while Environment keeps them literal', () => {
  const def: ServiceDefinition = {
    ...goldenDef(),
    program: {
      executable: '/bin/echo',
      args: [BRACED_HOME, '$SPLIT', '$UNSET', '$$'],
    },
    environment: {
      SPLIT: 'one two',
      RAW_DOLLARS: `${BRACED_HOME} $SPLIT $UNSET $$`,
    },
  };

  const unit = serializeSystemdUnit(def);
  const execStart = unit.split('\n').find((line) => line.startsWith('ExecStart='));

  // systemd.service expands ${NAME}, whitespace-splits a standalone $NAME, drops an unset $NAME,
  // and requires $$ for one literal dollar. Assert the host grammar itself, not only our inverse.
  assert.equal(execStart, 'ExecStart=/bin/echo $${HOME} $$SPLIT $$UNSET $$$$');
  // systemd.exec gives Environment= a different grammar: '$' is already literal there.
  assert.match(unit, /^Environment="SPLIT=one two"$/m);
  assert.match(unit, /^Environment="RAW_DOLLARS=\$\{HOME\} \$SPLIT \$UNSET \$\$"$/m);

  const parsed = parseSystemdUnit(unit);
  assert.deepEqual(parsed.argv, ['/bin/echo', BRACED_HOME, '$SPLIT', '$UNSET', '$$']);
  assert.deepEqual(parsed.environment, def.environment);
});

test('systemd golden: Linux fixture serializes to an exact expected unit', () => {
  const expected = [
    '[Unit]',
    'Description=ccm monitor',
    '',
    '[Service]',
    'ExecStart="/opt/cc master/ccm" monitor serve --state /home/u/.cc_master/services/monitor/state.json',
    'Restart=always',
    'StandardOutput=append:/home/u/.cc_master/services/monitor/log',
    'StandardError=append:/home/u/.cc_master/services/monitor/log',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
  assert.equal(serializeSystemdUnit(goldenDef()), expected);
});

test('launchd golden: Darwin fixture serializes to an exact expected plist', () => {
  const expected = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.nemori.ccm.monitor.deadbeef01</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/cc master/ccm</string>
    <string>monitor</string>
    <string>serve</string>
    <string>--state</string>
    <string>/home/u/.cc_master/services/monitor/state.json</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/home/u/.cc_master/services/monitor/log</string>
  <key>StandardErrorPath</key>
  <string>/home/u/.cc_master/services/monitor/log</string>
</dict>
</plist>
`;
  assert.equal(serializeLaunchdPlist(goldenDef()), expected);
});

test('launchd/systemd: empty environment and null workingDirectory omit their sections', () => {
  const def = goldenDef();
  const xml = serializeLaunchdPlist(def);
  assert.doesNotMatch(xml, /EnvironmentVariables/);
  assert.doesNotMatch(xml, /WorkingDirectory/);
  const unit = serializeSystemdUnit(def);
  assert.doesNotMatch(unit, /Environment=/);
  assert.doesNotMatch(unit, /WorkingDirectory=/);
});

test('keepAlive:false drops Restart=always / KeepAlive true and round-trips', () => {
  const def = { ...goldenDef(), keepAlive: false };
  const unit = serializeSystemdUnit(def);
  assert.doesNotMatch(unit, /Restart=always/);
  assert.equal(parseSystemdUnit(unit).restartAlways, false);
  const xml = serializeLaunchdPlist(def);
  assert.equal(parseLaunchdPlist(xml).keepAlive, false);
});

test('launchd activation commands are structured argv (no shell string, hostile label cannot inject)', () => {
  const label = 'evil; rm -rf /';
  const cmds = launchdInstallCommands({
    plistPath: '/tmp/a b/x.plist',
    domainTarget: 'gui/501',
    label,
  });
  assert.ok(Array.isArray(cmds) && cmds.length >= 2);
  for (const c of cmds) {
    assert.equal(c.command, 'launchctl');
    assert.ok(Array.isArray(c.args));
  }
  const bootstrap = cmds.find((c) => c.id === 'bootstrap');
  assert.deepEqual(bootstrap?.args, ['bootstrap', 'gui/501', '/tmp/a b/x.plist']);
  // The hostile label is carried as a single positional argument target, never concatenated to a shell.
  const status = cmds.find((c) => c.id === 'status');
  assert.ok(status?.args.includes(`gui/501/${label}`));
  const un = launchdUninstallCommands({ domainTarget: 'gui/501', label });
  assert.deepEqual(un[0]?.args, ['bootout', `gui/501/${label}`]);
});

test('systemd activation commands are structured argv with is-active status truth step', () => {
  const unitName = 'ccm-monitor-deadbeef01.service';
  const cmds = systemdInstallCommands({ unitName });
  for (const c of cmds) {
    assert.equal(c.command, 'systemctl');
    assert.ok(Array.isArray(c.args));
    assert.ok(c.args.includes('--user'));
  }
  assert.ok(cmds.some((c) => c.id === 'daemon-reload'));
  const enable = cmds.find((c) => c.id === 'enable');
  assert.deepEqual(enable?.args, ['--user', 'enable', '--now', unitName]);
  const status = cmds.find((c) => c.id === 'status');
  assert.deepEqual(status?.args, ['--user', 'is-active', unitName]);
  const un = systemdUninstallCommands({ unitName });
  assert.deepEqual(un[0]?.args, ['--user', 'disable', '--now', unitName]);
});
