#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import https from 'node:https';

const phase = process.env.CCM_XH_C3_PHASE || 'hook';
const host = process.env.CCM_XH_C3_HOST || 'unknown';
const sessionId = process.env.CCM_XH_C3_SESSION_ID || '';
const home = process.env.CC_MASTER_HOME || process.env.HOME || '';
const ccm = process.env.CCM_BIN || 'ccm';
const capability = 'coordination-inbox';
const counterfeit = process.env.CCM_XH_C3_COUNTERFEIT || '';

readFileSync(0, 'utf8');

function call(args) {
  const result = spawnSync(ccm, args, { encoding: 'utf8', env: process.env, timeout: 10000 });
  if (!result || result.error || result.signal || result.status !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout || '');
    return parsed && parsed.ok === true && parsed.data && typeof parsed.data === 'object' ? parsed.data : null;
  } catch {
    return null;
  }
}

function validSubscription(value, expected, requireState) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  for (const field of ['subscription_id', 'session_id', 'session_epoch', 'origin', 'capability']) {
    if (typeof value[field] !== 'string' || value[field].length === 0) return false;
  }
  if (counterfeit !== 'identity') {
    if (value.session_id !== expected.session_id) return false;
    if (value.origin !== expected.origin) return false;
    if (value.capability !== expected.capability) return false;
    if (expected.subscription_id && value.subscription_id !== expected.subscription_id) return false;
    if (expected.session_epoch && value.session_epoch !== expected.session_epoch) return false;
  }
  if (requireState && value.state !== 'current') return false;
  return true;
}

function bootstrap() {
  const board = join(home, 'boards', `known-good-${process.pid}.board.json`);
  mkdirSync(dirname(board), { recursive: true });
  const initialized = call(['--board', board, 'board', 'init', '--goal', 'transport contract fixture', '--json', '--no-input']);
  if (!initialized || initialized.board_path !== board) return;
  const body = JSON.parse(readFileSync(board, 'utf8'));
  body.owner = body.owner && typeof body.owner === 'object' ? body.owner : {};
  body.owner.active = true;
  body.owner.session_id = sessionId;
  writeFileSync(board, `${JSON.stringify(body, null, 2)}\n`);
  call(['--board', board, 'board', 'stamp-harness', '--json', '--no-input']);
  const data = call([
    'coordination',
    'subscription',
    'register',
    '--board',
    board,
    '--origin',
    host,
    '--session-id',
    sessionId,
    '--capability',
    capability,
    '--json',
    '--no-input',
  ]);
  if (!data) return;
  validSubscription(data.subscription, { session_id: sessionId, origin: host, capability }, true);
}

function nativeOutput(context) {
  if (process.env.CC_MASTER_HOOK_EVENT) return { kind: 'system', context };
  if (host === 'claude-code') {
    return { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: context } };
  }
  if (host === 'codex') return { systemMessage: context };
  if (host === 'cursor') return { followup_message: context };
  return null;
}

function hook() {
  const board = process.env.CCM_XH_C3_BOARD || '';
  const currentData = call([
    'coordination',
    'subscription',
    'current',
    '--board',
    board,
    '--origin',
    host,
    '--session-id',
    sessionId,
    '--capability',
    capability,
    '--json',
    '--no-input',
  ]);
  const current = currentData && currentData.subscription;
  if (!validSubscription(current, { session_id: sessionId, origin: host, capability }, true)) return;
  if (counterfeit === 'ccm-effect') call(['board', 'update', '--board', board, '--json']);
  if (counterfeit === 'provider-effect') spawnSync('cursor-agent', ['--version'], { encoding: 'utf8' });
  if (counterfeit === 'network-effect') https.get('https://example.invalid');
  const listArgs = [
    'coordination',
    'inbox',
    'list',
    '--current-subscription',
    '--board',
    board,
    '--origin',
    host,
    '--session-id',
    sessionId,
    '--session-epoch',
    current.session_epoch,
    '--capability',
    capability,
    '--unconsumed',
    '--json',
    '--no-input',
  ];
  if (counterfeit === 'path') listArgs.splice(listArgs.indexOf('--current-subscription'), 1);
  const listData = call(listArgs);
  const selected = listData && listData.subscription;
  if (
    !validSubscription(
      selected,
      {
        subscription_id: current.subscription_id,
        session_id: current.session_id,
        session_epoch: current.session_epoch,
        origin: current.origin,
        capability: current.capability,
      },
      false,
    )
  ) {
    return;
  }
  const items = listData && Array.isArray(listData.inbox) ? listData.inbox : [];
  const valid = items.filter((item) => {
    const provenance = item && item.delivery_provenance;
    if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) return false;
    for (const field of [
      'subscription_id',
      'session_id',
      'session_epoch',
      'origin',
      'capability',
      'source_policy_revision',
      'consent_provenance_ref',
    ]) {
      if (typeof provenance[field] !== 'string' || provenance[field].length === 0) return false;
    }
    return (
      provenance.subscription_id === current.subscription_id &&
      provenance.session_id === current.session_id &&
      provenance.session_epoch === current.session_epoch &&
      provenance.origin === current.origin &&
      provenance.capability === current.capability
    );
  });
  if (valid.length !== 1) return;
  const envelope = nativeOutput(JSON.stringify(valid[0]));
  if (envelope) process.stdout.write(`${JSON.stringify(envelope)}\n`);
}

if (phase === 'bootstrap') bootstrap();
else hook();
