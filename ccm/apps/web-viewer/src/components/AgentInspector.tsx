import { useEffect, useState } from 'react';
import {
  agentElapsed,
  agentIsActive,
  agentStateLamp,
  agentStateText,
  harnessBadge,
  probeLamp,
} from '../agentFormat';
import { useSecondTick } from '../analytics';
import { statusLampVar, statusText } from '../format';
import type { AgentDetailPayload } from '../types';

interface AgentInspectorProps {
  detail: AgentDetailPayload;
  agentLoading?: boolean;
  onClose?: () => void;
  onSelectTask: (taskId: string) => void;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function obj(record: Record<string, unknown> | undefined, key: string): Record<string, unknown> {
  const value = record?.[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * R-A agent drill-down — the right rail's third mode (an agent is selected). Runtime-instance
 * scope: header + live state, a one-click attach-command copy, identity fields, transcript
 * path, the linked-task list (click to jump to a node), and probe observed/as_of/method. All
 * fields are verbatim from `/agent.json`; unknown stays unknown (never derived).
 */
export function AgentInspector({
  detail,
  agentLoading = false,
  onClose,
  onSelectTask,
}: AgentInspectorProps) {
  const record = detail.agent ?? {};
  const compact = detail.compact ?? null;
  const lifecycle = obj(record, 'lifecycle');
  const handle = obj(record, 'handle');
  const launch = obj(record, 'launch');
  const probe = detail.probe ?? null;

  const id = str(record.id) ?? compact?.id ?? 'agent';
  const state = str(lifecycle.state) ?? compact?.state ?? 'unknown';
  const lamp = agentStateLamp(state);
  const intent = str(record.intent) ?? '';
  const attachCmd = str(handle.attach_cmd);
  const transcript = str(handle.transcript_ref);
  const outcome = str(lifecycle.outcome);

  // Live elapsed while the agent is active.
  const active = agentIsActive(state);
  useSecondTick(active);
  const elapsed = compact ? agentElapsed(compact) : null;

  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copyAttach = async () => {
    if (!attachCmd) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(attachCmd);
        setCopied(true);
      }
    } catch {
      /* clipboard blocked — the command text stays visible for manual copy */
    }
  };

  const identityRows: Array<[string, string, boolean]> = [];
  const addIdentity = (key: string, value: unknown, mono = false) => {
    const s = str(value);
    if (s) identityRows.push([key, s, mono]);
  };
  addIdentity('type', record.type);
  addIdentity('harness', harnessBadge(str(record.harness) ?? undefined), true);
  addIdentity('model', record.model, true);
  addIdentity(
    'handle',
    `${str(handle.kind) ?? 'none'}${str(handle.value) ? `:${handle.value}` : ''}`,
    true,
  );
  addIdentity('cwd', launch.cwd, true);
  addIdentity('account ref', record.account_ref, true);
  addIdentity('quota pool ref', record.quota_pool_ref, true);

  const teleRows: Array<[string, string, boolean]> = [];
  const addTele = (key: string, value: unknown, mono = true) => {
    const s = str(value);
    if (s) teleRows.push([key, s, mono]);
  };
  addTele('created', launch.created_at);
  addTele('registered', lifecycle.registered_at);
  addTele('ended', lifecycle.ended_at);
  if (elapsed) teleRows.push(['elapsed', elapsed, true]);

  const linkedTasks = detail.linked_tasks ?? [];

  return (
    <div className="dpanel" data-mode="agent">
      <div className="dhead">
        <span className="lamp" style={{ background: lamp, color: lamp }} />
        <div className="htext">
          <div className="htitle">{intent || id}</div>
          <div className="hmeta">
            <span className="hid mono">{id}</span>
            <span className="hstat" style={{ color: lamp }}>
              {agentStateText(state)}
            </span>
            {agentLoading ? <span className="hload">loading…</span> : null}
            {detail.error ? <span className="herr">detail error</span> : null}
          </div>
        </div>
        <button
          className="dclose"
          onClick={onClose}
          title="back to the mission brief (Esc / click canvas)"
          type="button"
        >
          ✕
        </button>
      </div>

      {attachCmd ? (
        <div className="dsect attach">
          <div className="sl">⎘ attach</div>
          <div className="attach-row">
            <code className="attach-cmd mono">{attachCmd}</code>
            <button className="attach-copy" onClick={copyAttach} type="button">
              {copied ? 'copied' : 'copy'}
            </button>
          </div>
        </div>
      ) : (
        <div className="dsect attach">
          <div className="sl">⎘ attach</div>
          <div className="dim-note">
            no attach command — this agent type exposes no re-attach handle
          </div>
        </div>
      )}

      {identityRows.length ? (
        <div className="dsect">
          <div className="sl">identity</div>
          <div className="kv">
            {identityRows.map(([key, value, mono]) => (
              <div className="row" key={key}>
                <span className="k">{key}</span>
                <span className={`v${mono ? ' mono' : ''}`}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="dsect">
        <div className="sl">probe</div>
        {probe ? (
          <div className="kv">
            <div className="row">
              <span className="k">observed</span>
              <span className="v" style={{ color: probeLamp(probe.observed) }}>
                <span
                  className="lamp"
                  style={{
                    background: probeLamp(probe.observed),
                    color: probeLamp(probe.observed),
                  }}
                />
                {probe.observed ?? 'unknown'}
              </span>
            </div>
            <div className="row">
              <span className="k">as of</span>
              <span className="v mono">{probe.as_of ?? '—'}</span>
            </div>
            <div className="row">
              <span className="k">method</span>
              <span className="v mono">{probe.method ?? 'none'}</span>
            </div>
          </div>
        ) : (
          <div className="dim-note">not probed yet — liveness unknown</div>
        )}
      </div>

      <div className="dsect">
        <div className="sl">linked tasks</div>
        <div className="deplist">
          {linkedTasks.length ? (
            linkedTasks.map((link) => {
              const lampVar = statusLampVar(String(link.status ?? ''));
              return (
                <button
                  className="depitem"
                  disabled={!link.exists}
                  key={link.task_id}
                  onClick={() => link.exists && onSelectTask(link.task_id)}
                  type="button"
                >
                  <span className="lamp" style={{ background: lampVar, color: lampVar }} />
                  <span className="dt">
                    <span className="did">{link.task_id}</span>
                    {link.exists ? (
                      link.title || <span className="untitled">untitled</span>
                    ) : (
                      <span className="untitled">not on this board</span>
                    )}
                  </span>
                  {link.exists ? (
                    <span className="ds" style={{ color: lampVar }}>
                      {statusText(String(link.status ?? ''))}
                    </span>
                  ) : null}
                </button>
              );
            })
          ) : (
            <div className="empty">no linked tasks — not yet associated with any node</div>
          )}
        </div>
      </div>

      {transcript ? (
        <div className="dsect">
          <div className="sl">transcript</div>
          <div className="artifact-box">{transcript}</div>
        </div>
      ) : null}

      {outcome ? (
        <div className="dsect">
          <div className="sl">outcome</div>
          <div className="why-text">{outcome}</div>
        </div>
      ) : null}

      {teleRows.length ? (
        <div className="dsect">
          <div className="sl">telemetry</div>
          <div className="kv">
            {teleRows.map(([key, value, mono]) => (
              <div className="row" key={key}>
                <span className="k">{key}</span>
                <span className={`v${mono ? ' mono' : ''}`}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <details className="dsect rawfold">
        <summary className="sl">agent record · raw json</summary>
        <pre className="raw-schema">{JSON.stringify(record, null, 2)}</pre>
      </details>
    </div>
  );
}
