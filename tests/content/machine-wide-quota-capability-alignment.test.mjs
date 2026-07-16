import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const card = readFileSync(
  new URL('../../design_docs/harnesses/capabilities/machine-wide-quota-notification.md', import.meta.url),
  'utf8',
);
const readContract = (hook) => readFileSync(
  new URL(`../../plugin/src/hooks/${hook}/CONTRACT.md`, import.meta.url),
  'utf8',
);

test('machine-wide quota capability records the merged three-origin Track-B delivery', () => {
  for (const host of ['claude-code', 'codex', 'cursor']) {
    assert.match(card, new RegExp(`\\| ${host} \\| implemented-track-b \\|`, 'u'));
  }
  assert.doesNotMatch(card, /contract-red|plugin hook migration.*(?:still|仍)|production RED/iu);
  assert.match(card, /PR #145[\s\S]*PR #148/u);
});

test('only executable machine-wide quota hook rules are promoted to PARITY anchors', () => {
  const inbox = readContract('coordination-inbox');
  for (const rule of [
    'rule-coordination-inbox-machine-quota-delta',
    'rule-coordination-inbox-machine-quota-scope-dedup',
    'rule-coordination-inbox-machine-quota-read-boundary',
    'rule-coordination-inbox-machine-quota-no-account-mutation',
  ]) {
    assert.match(inbox, new RegExp(`- rule: ${rule}\\n  required_hosts: \\[claude-code, codex, cursor\\]`, 'u'));
  }

  const context = readContract('orchestrator-context');
  assert.match(
    context,
    /- rule: rule-orchestrator-context-machine-quota-summary\n  required_hosts: \[claude-code, codex, cursor\]/u,
  );

  const pacing = readContract('usage-pacing');
  assert.doesNotMatch(`${inbox}\n${context}\n${pacing}`, /production RED|executable RED/iu);
  assert.match(
    pacing,
    /- rule: rule-usage-pacing-machine-wide-dedup\n  required_hosts: \[codex, cursor\]/u,
  );
  assert.match(pacing, /Claude Code uses `ccm usage advise --json`[\s\S]*Codex\/Cursor use `ccm quota status --machine-wide --json`/u);
  assert.match(
    pacing,
    /- rule: rule-usage-pacing-dual-delivery\n  required_hosts: \[claude-code\]/u,
  );
  assert.match(
    pacing,
    /Stop fallback surfaces only `uncoveredChanges`:[\s\S]*`fanout_covered:false`[\s\S]*target harness matches the origin/u,
  );
  assert.match(
    pacing,
    /emits `kind:system` only when `uncoveredChanges` returns one or more validated[\s\S]*empty selection[\s\S]*silent/u,
  );
  assert.match(pacing, /`advisory\('usage-pacing', 'strong', body\)`[\s\S]*does not reuse Claude Code's verdict strength table/u);
  assert.doesNotMatch(
    pacing,
    /surfaces hold\/throttle\/stop_billing_period|emits kind:system on throttle\/stop_billing_period|same\s+rule-usage-pacing-strength-mapping table/iu,
  );
});
