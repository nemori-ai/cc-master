import { fmtElapsed, parseTs } from './format';
import type { CompactAgent } from './types';

// Agent Registry presentation helpers. Pure formatting / palette mapping over the
// server-projected compact agent — no joins, no derivation (those live on the server).

// Display order for agent lifecycle states (active first, terminal last) — shared by the
// roster sort and the left rail's state buckets.
export const AGENT_STATE_ORDER = ['running', 'starting', 'uncertain', 'orphaned', 'terminal'];

// Lifecycle state -> a status-lamp CSS var, reusing the board status palette semantics so
// running reads like in-flight, orphaned like failed, terminal like done, etc.
export function agentStateLamp(state: string | undefined): string {
  switch (state) {
    case 'running':
      return 'var(--inflight)';
    case 'starting':
      return 'var(--ready)';
    case 'uncertain':
      return 'var(--uncertain)';
    case 'orphaned':
      return 'var(--failed)';
    case 'terminal':
      return 'var(--done)';
    default:
      return 'var(--ink-faint)';
  }
}

export function agentStateText(state: string | undefined): string {
  return (state ?? 'unknown').replace(/_/g, ' ');
}

// probe observed -> a lamp var (unknown-faithful: unknown stays a faint dot, never green).
export function probeLamp(observed: string | undefined): string {
  switch (observed) {
    case 'alive':
      return 'var(--done)';
    case 'silent':
      return 'var(--uncertain)';
    case 'gone':
      return 'var(--failed)';
    default:
      return 'var(--ink-faint)';
  }
}

// Live elapsed from the agent's registered_at anchor (or its final span if terminal). Returns
// a formatted string or null when the anchor is absent — never fabricates a duration.
export function agentElapsed(agent: CompactAgent, nowMs = Date.now()): string | null {
  const startMs = parseTs(agent.registered_at);
  if (startMs == null) return null;
  const endMs = agent.ended_at ? parseTs(agent.ended_at) : null;
  const span = (endMs ?? nowMs) - startMs;
  return fmtElapsed(Math.max(0, span));
}

// An agent is "in flight" (live-ticking) while in an active lifecycle state.
export function agentIsActive(state: string | undefined): boolean {
  return state === 'starting' || state === 'running' || state === 'uncertain';
}

export function harnessBadge(harness: string | undefined): string {
  return (harness ?? 'unknown').replace(/-agent$/, '');
}
