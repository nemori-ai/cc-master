import {
  AGENT_STATE_ORDER,
  agentElapsed,
  agentIsActive,
  agentStateLamp,
  agentStateText,
  harnessBadge,
  probeLamp,
} from '../agentFormat';
import { useSecondTick } from '../analytics';
import { shortTime } from '../format';
import type { CompactAgent, ViewModelPayload } from '../types';

interface AgentRosterProps {
  viewModel: ViewModelPayload;
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
}

function stateRank(state: string | undefined): number {
  const index = AGENT_STATE_ORDER.indexOf(state ?? '');
  return index === -1 ? AGENT_STATE_ORDER.length : index;
}

/**
 * Agent roster — the fifth stage view. One row per board-scoped runtime agent (server
 * `agents[]`): a live state lamp, harness badge, type, intent, how many nodes it is linked
 * to, live elapsed since it registered, and probe freshness. Rows sort active-first. Click a
 * row to open the agent drill-down in the right rail (agent mode). Everything here is a
 * verbatim render of the server projection — no client joins.
 */
export function AgentRoster({ viewModel, selectedAgentId, onSelectAgent }: AgentRosterProps) {
  const agents = viewModel.agents ?? [];
  const insights = viewModel.agent_insights;
  // Second ticker keeps the elapsed column live while any agent is active.
  useSecondTick(agents.some((agent) => agentIsActive(agent.state)));

  if (!agents.length) {
    return (
      <div className="agent-roster empty" data-view="agents">
        <div className="agent-roster-empty">
          no agents registered — nothing dispatched has been logged to this board yet
        </div>
      </div>
    );
  }

  const sorted = [...agents].sort((a, b) => {
    const byState = stateRank(a.state) - stateRank(b.state);
    return byState !== 0 ? byState : a.id.localeCompare(b.id);
  });

  return (
    <div className="agent-roster" data-view="agents">
      <div className="agent-roster-head">
        <span className="arh-count">{agents.length} agents</span>
        {insights ? (
          <span className="arh-summary mono">
            {insights.running} running · {insights.active} active
          </span>
        ) : null}
      </div>
      <div className="agent-table">
        <div className="agent-row agent-row-head">
          <span className="ac-state">state</span>
          <span className="ac-id">agent</span>
          <span className="ac-harness">harness</span>
          <span className="ac-intent">intent</span>
          <span className="ac-links">tasks</span>
          <span className="ac-elapsed">elapsed</span>
          <span className="ac-probe">probe</span>
        </div>
        {sorted.map((agent: CompactAgent) => {
          const elapsed = agentElapsed(agent);
          const observed = agent.probe?.observed ?? 'unknown';
          const linkCount = agent.links?.length ?? 0;
          return (
            <button
              className="agent-row"
              data-selected={agent.id === selectedAgentId ? 'true' : undefined}
              key={agent.id}
              onClick={() => onSelectAgent(agent.id)}
              type="button"
            >
              <span className="ac-state">
                <span
                  className="lamp"
                  style={{
                    background: agentStateLamp(agent.state),
                    color: agentStateLamp(agent.state),
                  }}
                />
                <span className="ac-state-text">{agentStateText(agent.state)}</span>
              </span>
              <span className="ac-id" title={`${agent.id} · ${agent.type ?? 'unknown'}`}>
                <span className="ac-id-code mono">{agent.id}</span>
                <span className="ac-type">{agent.type ?? 'unknown'}</span>
              </span>
              <span
                className="ac-harness"
                title={`${harnessBadge(agent.harness)}${agent.model ? ` · ${agent.model}` : ''}`}
              >
                <span className="harness-badge">{harnessBadge(agent.harness)}</span>
                <span className="ac-model mono">{agent.model ?? '—'}</span>
              </span>
              <span className="ac-intent" title={agent.intent || ''}>
                {agent.intent || <span className="dim">no intent recorded</span>}
              </span>
              <span className="ac-links mono">{linkCount}</span>
              <span className="ac-elapsed mono">{elapsed ?? '—'}</span>
              <span className="ac-probe">
                <span
                  className="lamp"
                  style={{ background: probeLamp(observed), color: probeLamp(observed) }}
                />
                <span className="ac-probe-text">{observed}</span>
                {agent.probe?.as_of ? (
                  <span className="ac-probe-asof mono">{shortTime(agent.probe.as_of)}</span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
