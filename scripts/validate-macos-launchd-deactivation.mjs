#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, normalize } from 'node:path';

function usage() {
  process.stderr.write(
    'usage: validate-macos-launchd-deactivation.mjs <launchd-uninstall.json> <darwin-arm64|darwin-x64> <trusted-identity.json>\n',
  );
}

function fail(message) {
  throw new Error(`launchd deactivation evidence invalid: ${message}`);
}

const [evidencePath, contract, identityPath] = process.argv.slice(2);
if (!evidencePath || !identityPath || !['darwin-arm64', 'darwin-x64'].includes(contract)) {
  usage();
  process.exit(2);
}

try {
  const doc = JSON.parse(readFileSync(evidencePath, 'utf8'));
  const trusted = JSON.parse(readFileSync(identityPath, 'utf8'));
  const expectedArch = contract === 'darwin-arm64' ? 'arm64' : 'x64';
  if (
    trusted.schema !== 'ccm/macos-launchd-qualification-identity/v1' ||
    trusted.contract !== contract ||
    trusted.platform !== 'darwin' ||
    trusted.arch !== expectedArch
  ) {
    fail(`trusted identity must bind the darwin/${expectedArch} qualification contract`);
  }
  if (
    typeof trusted.plist_path !== 'string' ||
    !isAbsolute(trusted.plist_path) ||
    normalize(trusted.plist_path) !== trusted.plist_path ||
    typeof trusted.label !== 'string' ||
    !/^ai\.nemori\.ccm\.monitor\.[a-f0-9]{10}$/.test(trusted.label) ||
    basename(trusted.plist_path) !== `${trusted.label}.plist` ||
    basename(dirname(trusted.plist_path)) !== 'LaunchAgents' ||
    basename(dirname(dirname(trusted.plist_path))) !== 'Library'
  ) {
    fail('trusted identity must name one absolute managed LaunchAgent plist');
  }
  if (typeof trusted.gui_uid !== 'string' || !/^(0|[1-9][0-9]*)$/.test(trusted.gui_uid)) {
    fail('trusted identity gui_uid must be one canonical numeric uid');
  }
  if (trusted.launchctl_target !== `gui/${trusted.gui_uid}/${trusted.label}`) {
    fail('trusted identity launchctl_target must bind its uid and label exactly');
  }
  if (doc.ok !== true || doc.uninstalled !== true || doc.stopped !== true) {
    fail('top-level uninstall outcome must be successful and stopped');
  }
  if (doc.kind !== 'launchd' || doc.deactivation?.kind !== 'launchd') {
    fail('service and deactivation kinds must both be launchd');
  }
  if (doc.deactivation.ok !== true || doc.deactivation.state !== 'inactive') {
    fail('successful bootout must project deactivation.state="inactive"');
  }
  if (doc.platform !== 'darwin' || doc.arch !== expectedArch) {
    fail(`evidence platform/arch must be darwin/${expectedArch}`);
  }
  if (doc.path !== trusted.plist_path) {
    fail('uninstall path must exactly match the independently trusted plist path');
  }
  const observedLabel = basename(doc.path, '.plist');
  if (observedLabel !== trusted.label) {
    fail('uninstall label must exactly match the independently trusted label');
  }
  const removal = doc.unit_removal;
  if (
    removal?.ok !== true ||
    removal?.result !== 'removed' ||
    removal?.path !== trusted.plist_path ||
    removal?.error !== null
  ) {
    fail('live install→uninstall evidence requires successful LaunchAgent removal');
  }
  const steps = doc.deactivation.steps;
  if (!Array.isArray(steps) || steps.length !== 1 || steps[0]?.id !== 'bootout') {
    fail('deactivation must contain exactly one bootout step');
  }
  const step = steps[0];
  const allowedResults = new Set(['succeeded', 'already-absent', 'failed']);
  if (!allowedResults.has(step.result)) {
    fail('bootout result must be one of succeeded/already-absent/failed');
  }
  if (step.result !== 'succeeded' || step.ok !== true || step.code !== 0 || step.error !== null) {
    fail('live install→uninstall evidence requires result=succeeded, ok=true, code=0, error=null');
  }
  if (
    step.command !== 'launchctl' ||
    !Array.isArray(step.args) ||
    step.args.length !== 2 ||
    step.args[0] !== 'bootout' ||
    step.args[1] !== trusted.launchctl_target
  ) {
    fail('bootout must use exact structured launchctl argv for the independently trusted target');
  }
  process.stdout.write(`${JSON.stringify({ contract, deactivation: doc.deactivation }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
