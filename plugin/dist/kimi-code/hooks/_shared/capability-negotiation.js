'use strict';
// capability-negotiation.js — host-neutral ccm capability version negotiation helper (issue #167).
//
// Consumers declare the capability ids they can work with; ccm `capability negotiate` returns the
// highest mutually compatible version or a non-zero exit (caller degrades gracefully).
// RED LINE 1: node/JS only + spawnSync `ccm` (process boundary, never import @ccm/engine).
// RED LINE 5: ccm missing / negotiate failure → null (fail-safe degrade, never throw).

const { spawnSync } = require('child_process');

// goal-deadline consumer accept set: v1 is current; v2 is forward-declared for skew testing only.
const GOAL_DEADLINE_CONSUMER_ACCEPTS = Object.freeze(['goal-deadline/v1', 'goal-deadline/v2']);

const negotiationCache = new Map();

function spawnNegotiateJson(ccmBin, family, accepts, homeDir, timeoutMs) {
  const args = ['capability', 'negotiate', family, '--json'];
  for (const id of accepts) args.push('--accept', id);
  const env = Object.assign({}, process.env, { CC_MASTER_HOME: homeDir });
  let r;
  try {
    r = spawnSync(ccmBin, args, { encoding: 'utf8', timeout: timeoutMs, env });
  } catch (_e) {
    return null;
  }
  if (!r || r.error || r.signal || r.status !== 0) return null;
  let parsed;
  try {
    parsed = JSON.parse(typeof r.stdout === 'string' ? r.stdout : '');
  } catch (_e) {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || parsed.ok !== true) return null;
  const data = parsed.data && typeof parsed.data === 'object' ? parsed.data : null;
  if (!data || data.negotiated !== true || typeof data.capability !== 'string') return null;
  return data.capability;
}

// negotiateGoalDeadlineCapability(cfg) → negotiated id string | null (cached per ccmBin+homeDir).
// cfg = { ccmBin, homeDir, timeoutMs? }
function negotiateGoalDeadlineCapability(cfg) {
  const ccmBin = cfg && cfg.ccmBin ? String(cfg.ccmBin) : 'ccm';
  const homeDir = cfg && cfg.homeDir ? String(cfg.homeDir) : '';
  const cacheKey = `${ccmBin}\0${homeDir}`;
  if (negotiationCache.has(cacheKey)) return negotiationCache.get(cacheKey);
  const timeoutMs =
    cfg && Number.isFinite(cfg.timeoutMs) && cfg.timeoutMs > 0 ? cfg.timeoutMs : 10000;
  const negotiated = spawnNegotiateJson(
    ccmBin,
    'goal-deadline',
    GOAL_DEADLINE_CONSUMER_ACCEPTS,
    homeDir,
    timeoutMs,
  );
  negotiationCache.set(cacheKey, negotiated);
  return negotiated;
}

module.exports = {
  GOAL_DEADLINE_CONSUMER_ACCEPTS,
  negotiateGoalDeadlineCapability,
};
