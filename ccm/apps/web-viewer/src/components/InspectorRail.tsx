import { perNodeStructure, useSecondTick } from '../analytics';
import {
  endStr,
  fmtDuration,
  fmtElapsed,
  fmtEstimate,
  normalizeStatus,
  recorded,
  startStr,
  startTs,
  statusLampVar,
  statusText,
  taskDuration,
  watchdogReadout
} from '../format';
import type {
  AcceptanceCriterion,
  CompactTask,
  DecisionEntry,
  DecisionPackage,
  TaskDetailPayload,
  ViewModelPayload
} from '../types';
import { DecisionCard } from './DecisionCard';
import { DiscussHistory } from './DiscussHistory';

interface InspectorRailProps {
  task: TaskDetailPayload;
  viewModel: ViewModelPayload;
  decisions: DecisionEntry[];
  taskLoading?: boolean;
  onClose?: () => void;
  onSelectTask: (taskId: string) => void;
}

interface DepItemProps {
  id: string;
  viewModel: ViewModelPayload;
  onSelectTask: (taskId: string) => void;
}

function DepItem({ id, viewModel, onSelectTask }: DepItemProps) {
  const node = viewModel.graph.nodes.find((candidate) => candidate.id === id);
  const status = normalizeStatus(String(node?.status ?? ''));
  const lamp = statusLampVar(status);
  const title = (node?.title ?? '').trim();
  return (
    <button className="depitem" onClick={() => onSelectTask(id)} type="button">
      <span className="lamp" style={{ background: lamp, color: lamp }} />
      <span className="dt">
        <span className="did">{id}</span>
        {title || <span className="untitled">untitled</span>}
      </span>
      <span className="ds" style={{ color: lamp }}>
        {statusText(status)}
      </span>
    </button>
  );
}

// ---- acceptance normalization (presentation only) ---------------------------------------
// string -> one prose row; string[] -> prose rows; {criteria:[...]} -> structured table.
interface AcceptanceView {
  prose: string[];
  criteria: AcceptanceCriterion[];
}

function acceptanceView(acceptance: unknown): AcceptanceView | null {
  if (typeof acceptance === 'string' && acceptance.trim()) {
    return { prose: [acceptance.trim()], criteria: [] };
  }
  if (Array.isArray(acceptance)) {
    const prose = acceptance.filter((c): c is string => typeof c === 'string' && !!c.trim());
    return prose.length ? { prose, criteria: [] } : null;
  }
  if (acceptance && typeof acceptance === 'object') {
    const criteria = (acceptance as { criteria?: unknown }).criteria;
    if (Array.isArray(criteria)) {
      const rows = criteria.filter(
        (c): c is AcceptanceCriterion => !!c && typeof c === 'object' && !Array.isArray(c)
      );
      return rows.length ? { prose: [], criteria: rows } : null;
    }
  }
  return null;
}

function acceptanceLamp(status: string | undefined): string {
  if (status === 'met') return 'var(--done)';
  if (status === 'failed') return 'var(--failed)';
  return 'var(--ink-faint)';
}

const taskFieldKeys = [
  'id',
  'title',
  'status',
  'type',
  'executor',
  'handle',
  'deps',
  'parent',
  'blocked_on',
  'estimate',
  'acceptance',
  'artifact',
  'verified',
  'created_at',
  'started_at',
  'finished_at',
  'updated_at',
  'decision_package'
];

/**
 * R-T task drill-down — the right rail's SELECTED mode. Task-scope blocks only (the
 * board-level intel lives on the mission brief): header -> badges -> decision needed
 * (FIRST when this is a user gate — M2 is its whole reason to exist) -> discuss history
 * -> identity -> why -> waiting-on -> this-blocks -> acceptance -> telemetry -> notes ->
 * artifact -> activity -> raw fold. close / Esc / canvas click returns to the brief.
 */
export function InspectorRail({
  task,
  viewModel,
  decisions,
  taskLoading = false,
  onClose,
  onSelectTask
}: InspectorRailProps) {
  const t = task.task;
  const status = normalizeStatus(String(t.status ?? ''));
  const node = viewModel.graph.nodes.find((candidate) => candidate.id === t.id);
  const userGate = node?.awaiting_user === true;
  const lamp = userGate ? 'var(--alert)' : statusLampVar(status);
  const isCrit = (viewModel.graph.critical_path ?? []).includes(t.id);
  const isBneck = viewModel.insights?.bottleneck?.id === t.id;
  const structure = perNodeStructure(viewModel.insights, t.id);

  const taskWatchdog = watchdogReadout(t.watchdog);

  const running = status === 'in_flight' && startTs(t as CompactTask) != null;
  // Second ticker also drives the watchdog countdown (re-renders each second).
  useSecondTick(running || taskWatchdog != null);

  const title = (t.title || '').trim();
  const deps = Array.isArray(t.deps) ? t.deps : (task.dependencies ?? []).map((dep) => dep.id);
  const directDown = (task.dependents ?? []).map((dep) => dep.id);
  const transOnly = Math.max(structure.impact - directDown.length, 0);

  const elapsedMs =
    startTs(t as CompactTask) != null ? Date.now() - (startTs(t as CompactTask) as number) : null;
  const elStr = fmtElapsed(elapsedMs);
  const dur = taskDuration(t as CompactTask);
  const durStr = fmtDuration(dur);

  const decisionPackage =
    t.decision_package && typeof t.decision_package === 'object'
      ? (t.decision_package as DecisionPackage)
      : null;

  const identityRows: Array<[string, string, boolean]> = [];
  const addIdentity = (key: string, value: unknown, mono = false) => {
    if (value == null || value === '') return;
    identityRows.push([key, String(value), mono]);
  };
  addIdentity('type', t.type);
  addIdentity('role', t.role);
  addIdentity('executor', t.executor, true);
  addIdentity('mechanism', t.mechanism, true);
  addIdentity('handle', t.handle, true);
  addIdentity('rank', t.rank, true);
  addIdentity('impact', `${structure.impact} downstream`);
  addIdentity('fan-in', `${structure.inDeg} direct deps`);
  if (Array.isArray(t.tags) && t.tags.length) addIdentity('tags', t.tags.join(', '), true);

  const teleRows: Array<[string, string, boolean]> = [];
  const addTele = (key: string, value: string | null | undefined, mono = true) => {
    if (value == null || value === '') return;
    teleRows.push([key, value, mono]);
  };
  addTele('created', typeof t.created_at === 'string' ? t.created_at : null);
  addTele('started', startStr(t as CompactTask));
  addTele('finished', endStr(t as CompactTask));
  if (elStr != null) addTele('elapsed', elStr);
  if (durStr != null) addTele(dur?.running ? 'runtime' : 'duration', durStr);
  addTele('estimate', fmtEstimate(t.estimate));
  if (typeof t.hitl_rounds === 'number' && t.hitl_rounds > 0)
    addTele('hitl rounds', String(t.hitl_rounds));
  if (userGate) {
    addTele('awaiting', `user${elStr != null ? ` · ${elStr}` : ''}`, false);
  } else if (t.blocked_on && t.blocked_on !== 'user') {
    addTele('blocked on', String(t.blocked_on));
  }
  if (t.verified === true) addTele('verified', 'yes', false);
  else if (t.verified === false) addTele('verified', 'no', false);

  const activity = task.activity ?? [];

  const depPins = t.dep_pins && typeof t.dep_pins === 'object' ? Object.entries(t.dep_pins) : [];
  const acceptance = acceptanceView(t.acceptance);
  const execution = t.execution;
  const planning = execution?.planning;
  const route = execution?.route;
  const selectedRoute = route?.selected;

  return (
    <div className="dpanel" data-mode="task">
      <div className="dhead">
        <span className="lamp" style={{ background: lamp, color: lamp }} />
        <div className="htext">
          <div className={`htitle${title ? '' : ' empty'}`}>{title || 'untitled'}</div>
          <div className="hmeta">
            <span className="hid">{t.id}</span>
            <span className="hstat" style={{ color: lamp }}>
              {statusText(status)}
            </span>
            {taskLoading ? <span className="hload">loading…</span> : null}
            {task.error ? <span className="herr">detail error</span> : null}
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

      {isCrit || isBneck || t.verified === true ? (
        <div className="dsect">
          <div className="badge-row">
            {isCrit ? <span className="badge crit">⟋ critical path</span> : null}
            {isBneck ? <span className="badge bneck">⚠ bottleneck</span> : null}
            {t.verified === true ? <span className="badge verified">✓ verified</span> : null}
          </div>
        </div>
      ) : null}

      {execution ? (
        <div className="dsect execution-contract">
          <div className="sl">cross-harness execution</div>
          <div className="kv">
            <div className="row">
              <span className="k">state</span>
              <span className="v mono">{execution.state}</span>
            </div>
            {route ? (
              <div className="row">
                <span className="k">outcome</span>
                <span className="v mono">{route.outcome}</span>
              </div>
            ) : null}
            {selectedRoute ? (
              <>
                <div className="row">
                  <span className="k">selected</span>
                  <span className="v mono">
                    {selectedRoute.harness} · {selectedRoute.surface_label}
                  </span>
                </div>
                <div className="row">
                  <span className="k">model</span>
                  <span className="v mono">
                    {selectedRoute.model ?? 'unknown'}
                    {selectedRoute.role_grades.length
                      ? ` · ${selectedRoute.role_grades.join('/')}`
                      : ''}
                  </span>
                </div>
              </>
            ) : null}
            {route?.reason_codes.length ? (
              <div className="row">
                <span className="k">reasons</span>
                <span className="v mono">{route.reason_codes.join(', ')}</span>
              </div>
            ) : null}
            {route ? (
              <div className="row">
                <span className="k">fallback</span>
                <span className="v mono">
                  ample {route.chains.ample.join(' → ') || '—'} · tight{' '}
                  {route.chains.tight.join(' → ') || '—'}
                </span>
              </div>
            ) : null}
            {route?.fallback.on.length ? (
              <div className="row">
                <span className="k">fallback on</span>
                <span className="v mono">
                  {route.fallback.on.join(', ')}
                  {route.fallback.exhaustion ? ` · ${route.fallback.exhaustion}` : ''}
                </span>
              </div>
            ) : null}
          </div>

          {route?.candidates.length ? (
            <div className="contract-subblock">
              <div className="contract-label">candidate routes</div>
              {route.candidates.map((candidate) => (
                <div className="candidate-row" data-selected={candidate.id === selectedRoute?.id} key={candidate.id}>
                  <span className="mono">{candidate.id}</span>
                  <span>{candidate.surface_label}</span>
                  <span className="mono">
                    {candidate.model ?? 'unknown'}
                    {candidate.role_grades.length ? ` · ${candidate.role_grades.join('/')}` : ''}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {planning ? (
            <div className="contract-subblock">
              <div className="contract-label">planning</div>
              <div className="contract-grid">
                {Object.entries(planning.dimensions).map(([key, value]) => (
                  <span className="contract-pill" key={key}>
                    {key}: {value}
                  </span>
                ))}
              </div>
              <div className="contract-note mono">
                floor {planning.quality.effect_floor ?? 'unknown'} · budget{' '}
                {planning.budget.posture ?? 'unknown'} · max attempts{' '}
                {planning.budget.max_attempts ?? '—'}
              </div>
              {planning.capabilities.required.length ? (
                <div className="contract-note mono">
                  required: {planning.capabilities.required.join(', ')}
                </div>
              ) : null}
              {planning.capabilities.preferred.length ? (
                <div className="contract-note mono">
                  preferred: {planning.capabilities.preferred.join(', ')}
                </div>
              ) : null}
              {planning.capabilities.forbidden.length ? (
                <div className="contract-note mono">
                  forbidden: {planning.capabilities.forbidden.join(', ')}
                </div>
              ) : null}
            </div>
          ) : null}

          {execution.attempts.length ? (
            <div className="contract-subblock">
              <div className="contract-label">attempt lifecycle</div>
              {execution.attempts.map((attempt) => (
                <div className="attempt-row" key={attempt.id}>
                  <span className="mono">{attempt.id}</span>
                  <span>
                    {attempt.state ?? 'unknown'}
                    {attempt.terminal_class ? ` · ${attempt.terminal_class}` : ''}
                  </span>
                  <span
                    className="mono"
                    title={attempt.terminal_at ?? attempt.started_at ?? undefined}
                  >
                    {attempt.candidate_id ?? 'unassigned'}
                    {attempt.terminal_at || attempt.started_at
                      ? ` · ${attempt.terminal_at ?? attempt.started_at}`
                      : ''}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {userGate && decisionPackage ? (
        <div className="dsect decision">
          <div className="sl">◈ decision needed</div>
          <DecisionCard pkg={decisionPackage} />
        </div>
      ) : null}

      {decisions.length ? (
        <div className="dsect dischist">
          <div className="sl">💬 discuss history</div>
          <DiscussHistory items={decisions} />
        </div>
      ) : null}

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

      <div className="dsect why">
        <div className="sl">◆ why this exists</div>
        {t.justification || depPins.length ? (
          <>
            {t.justification ? <div className="why-text">{String(t.justification)}</div> : null}
            {depPins.length ? (
              <div className="kv pins">
                {depPins.map(([key, value]) => (
                  <div className="row" key={key}>
                    <span className="k">pin {key}</span>
                    <span className="v mono">{String(value)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <div className="dim-note">no justification recorded</div>
        )}
      </div>

      <div className="dsect">
        <div className="sl">waiting on</div>
        <div className="deplist">
          {deps.length ? (
            deps.map((dep) => (
              <DepItem id={dep} key={dep} onSelectTask={onSelectTask} viewModel={viewModel} />
            ))
          ) : (
            <div className="empty">no upstream dependencies — a root task</div>
          )}
        </div>
      </div>

      <div className="dsect">
        <div className="sl">this blocks</div>
        <div className="deplist">
          {directDown.length ? (
            directDown.map((dep) => (
              <DepItem id={dep} key={dep} onSelectTask={onSelectTask} viewModel={viewModel} />
            ))
          ) : (
            <div className="empty">gates nothing — a leaf task</div>
          )}
          {directDown.length && transOnly > 0 ? (
            <div className="transitive-head">+ {transOnly} transitive</div>
          ) : null}
        </div>
      </div>

      {acceptance ? (
        <div className="dsect">
          <div className="sl">acceptance</div>
          {acceptance.prose.map((line) => (
            <div className="why-text acc-prose" key={line}>
              {line}
            </div>
          ))}
          {acceptance.criteria.length ? (
            <div className="acc-table">
              {acceptance.criteria.map((criterion, index) => {
                const critStatus =
                  typeof criterion.status === 'string' ? criterion.status : 'pending';
                const critLamp = acceptanceLamp(critStatus);
                return (
                  <div
                    className="acc-row"
                    data-status={critStatus}
                    key={`${criterion.desc ?? 'criterion'}-${index}`}
                  >
                    <span className="lamp" style={{ background: critLamp, color: critLamp }} />
                    <span className="acc-desc">
                      {typeof criterion.desc === 'string' && criterion.desc
                        ? criterion.desc
                        : `criterion ${index + 1}`}
                    </span>
                    {typeof criterion.kind === 'string' && criterion.kind ? (
                      <span className="acc-kind">{criterion.kind}</span>
                    ) : null}
                    <span className="acc-status" style={{ color: critLamp }}>
                      {critStatus}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {teleRows.length || taskWatchdog ? (
        <div className="dsect">
          <div className="sl">telemetry</div>
          <div className="kv">
            {teleRows.map(([key, value, mono]) => (
              <div className="row" key={key}>
                <span className="k">{key}</span>
                <span className={`v${mono ? ' mono' : ''}`}>{value}</span>
              </div>
            ))}
            {taskWatchdog ? (
              <div className="row" key="watchdog">
                <span className="k">watchdog</span>
                <span className={`v mono${taskWatchdog.expired ? ' wd-expired' : ''}`}>
                  {taskWatchdog.text}
                </span>
              </div>
            ) : null}
          </div>
          {taskWatchdog?.expired ? (
            <div className="wd-stale">
              ⚠ watchdog fire_at has passed — the wakeup may have fired or gone stale
            </div>
          ) : null}
        </div>
      ) : null}

      {t.notes ? (
        <div className="dsect">
          <div className="sl">notes</div>
          <div className="why-text">{String(t.notes)}</div>
        </div>
      ) : null}

      {t.artifact ? (
        <div className="dsect">
          <div className="sl">artifact</div>
          <div className="artifact-box">
            {typeof t.artifact === 'string' ? t.artifact : JSON.stringify(t.artifact)}
          </div>
        </div>
      ) : null}

      {activity.length ? (
        <div className="dsect">
          <div className="sl">activity</div>
          <div className="activity">
            {activity.map((item, index) => (
              <div className="le" key={`${item.at}-${index}`}>
                {item.at ? <span className="lehead">{item.at} · </span> : null}
                <span className="lesum">{item.text}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <details className="dsect rawfold">
        <summary className="sl">task fields · raw json</summary>
        <div className="kv">
          {taskFieldKeys.map((key) => (
            <div className="row" key={key}>
              <span className="k">{key}</span>
              <span className="v mono">{recorded(t[key])}</span>
            </div>
          ))}
        </div>
        <pre className="raw-schema">{JSON.stringify(t, null, 2)}</pre>
      </details>
    </div>
  );
}
