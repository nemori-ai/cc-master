import { perNodeStructure, useSecondTick } from '../analytics';
import {
  endStr,
  fmtDuration,
  fmtElapsed,
  fmtEstimate,
  normalizeStatus,
  startStr,
  startTs,
  statusLampVar,
  statusText,
  taskDuration,
  watchdogReadout
} from '../format';
import type {
  AcceptanceCriterion,
  CadenceIteration,
  CompactTask,
  DecisionEntry,
  DecisionPackage,
  InboxNotification,
  JudgmentCall,
  PeersPayload,
  StatusReportPayload,
  TaskDetailPayload,
  ViewModelPayload
} from '../types';
import { DecisionCard } from './DecisionCard';
import { DiscussHistory } from './DiscussHistory';

interface InspectorRailProps {
  task: TaskDetailPayload;
  viewModel: ViewModelPayload;
  statusReport: StatusReportPayload;
  decisions: DecisionEntry[];
  peers?: PeersPayload | null;
  taskLoading?: boolean;
  onClose?: () => void;
  onSelectTask: (taskId: string) => void;
}

function recorded(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'Not recorded';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return JSON.stringify(value);
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

// cadence member progress: how many member tasks are done, read from the view-model nodes
// (display counting only — no scheduling semantics).
function memberProgress(
  members: string[] | undefined,
  viewModel: ViewModelPayload
): { done: number; total: number } | null {
  if (!Array.isArray(members) || !members.length) return null;
  const byId = new Map(viewModel.graph.nodes.map((node) => [node.id, node]));
  let done = 0;
  for (const id of members) {
    const status = normalizeStatus(String(byId.get(id)?.status ?? ''));
    if (status === 'done' || status === 'verified') done += 1;
  }
  return { done, total: members.length };
}

function jcKey(entry: JudgmentCall, index: number): string {
  return typeof entry.id === 'string' && entry.id ? entry.id : `jc-${index}`;
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
 * The detail rail: legacy block language (badges / identity / why / decision / discuss
 * history / waiting-on / this-blocks / telemetry / artifact / activity) with the newer
 * Report / Diagnostics / fields-grid / raw-JSON information preserved as trailing
 * collapsible blocks. Data source: /task.json (+ /decisions.json for discuss history).
 */
export function InspectorRail({
  task,
  viewModel,
  statusReport,
  decisions,
  peers = null,
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

  const extras = viewModel.board_extras ?? {};
  const taskWatchdog = watchdogReadout(t.watchdog ?? task.raw_task?.watchdog);
  const boardWatchdog = watchdogReadout(extras.watchdog);

  const running = status === 'in_flight' && startTs(t as CompactTask) != null;
  // Second ticker also drives the watchdog countdowns (they re-render each second).
  useSecondTick(running || taskWatchdog != null || boardWatchdog != null);

  const title = (t.title || '').trim();
  const deps = Array.isArray(t.deps) ? t.deps : (task.dependencies ?? []).map((dep) => dep.id);
  const directDown = (task.dependents ?? []).map((dep) => dep.id);
  const transOnly = Math.max(structure.impact - directDown.length, 0);

  const elapsedMs = startTs(t as CompactTask) != null ? Date.now() - (startTs(t as CompactTask) as number) : null;
  const elStr = fmtElapsed(elapsedMs);
  const dur = taskDuration(task.raw_task ? (task.raw_task as CompactTask) : (t as CompactTask));
  const durStr = fmtDuration(dur);

  const decisionPackage =
    t.decision_package && typeof t.decision_package === 'object'
      ? (t.decision_package as DecisionPackage)
      : null;

  const diagnostics = [
    ...(viewModel.freshness.errors ?? []).map((item) => ({
      severity: 'error',
      message: item.message
    })),
    ...(viewModel.diagnostics?.lint ?? []),
    ...(viewModel.diagnostics?.over_scheduling ?? [])
  ];

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

  const rawLog = Array.isArray(task.raw_task?.log) ? (task.raw_task?.log as unknown[]) : [];
  const activity = task.activity ?? [];

  const depPins =
    t.dep_pins && typeof t.dep_pins === 'object' ? Object.entries(t.dep_pins) : [];
  const acceptance = acceptanceView(t.acceptance);

  // ---- status report: the real server nests the body under `report`; fixtures/older
  // shapes carry flat progress/next_actions/health. Read nested first, fall back flat.
  const reportBody = statusReport.report ?? null;
  const summaryBody = reportBody?.summary;
  const progressView = summaryBody
    ? {
        total: summaryBody.total,
        done: summaryBody.done,
        verified_done: summaryBody.verified_done,
        in_flight: summaryBody.in_flight,
        ready: summaryBody.ready,
        blocked: (summaryBody.blocked_on_user ?? 0) + (summaryBody.blocked_on_task ?? 0),
        attention: summaryBody.attention
      }
    : statusReport.progress
      ? {
          total: statusReport.progress.total,
          done: statusReport.progress.done,
          verified_done: undefined as number | undefined,
          in_flight: statusReport.progress.in_flight,
          ready: statusReport.progress.ready,
          blocked: statusReport.progress.blocked,
          attention: undefined as number | undefined
        }
      : null;
  const reportNextActions = reportBody?.next_actions ?? statusReport.next_actions ?? {};
  const operatorActions: string[] = reportBody?.next_actions?.recommended_operator_actions
    ? reportBody.next_actions.recommended_operator_actions.filter(
        (action): action is string => typeof action === 'string'
      )
    : (statusReport.next_actions?.operator_attention ?? []).map(
        (item) => `${item.severity ?? 'attention'} · ${item.title || item.id}`
      );
  const reportRisks = reportBody?.risks ?? statusReport.risks ?? [];
  const healthBody = reportBody?.health;
  const healthList = Array.isArray(statusReport.health) ? statusReport.health : [];
  const reportFreshness =
    statusReport.artifact?.freshness ?? viewModel.diagnostics?.report_freshness ?? 'unknown';

  // ---- board-model blind-spot blocks (board_extras passthrough + /peers.json) ----
  const jcEntries: JudgmentCall[] = Array.isArray(extras.judgment_calls)
    ? extras.judgment_calls
    : [];
  const cadence = extras.cadence ?? null;
  const iterations: CadenceIteration[] = Array.isArray(cadence?.iterations)
    ? cadence.iterations.filter(
        (iteration): iteration is CadenceIteration =>
          !!iteration && typeof iteration === 'object' && !Array.isArray(iteration)
      )
    : [];
  const openIterations = iterations.filter((iteration) => iteration.status === 'open');
  const shippedIterations = iterations.filter((iteration) => iteration.status === 'shipped');
  const inboxEntries: InboxNotification[] = Array.isArray(peers?.inbox)
    ? peers.inbox
    : Array.isArray(extras.coordination?.inbox)
      ? extras.coordination.inbox
      : [];

  return (
    <aside aria-label="Selected task detail" className="dpanel-wrap" id="detail">
      <div className="dpanel">
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
          <button className="dclose" onClick={onClose} title="close (or click canvas)" type="button">
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

        {activity.length || rawLog.length ? (
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

        <div className="dsect report">
          <div className="sl">status report</div>
          <div className="kv">
            <div className="row">
              <span className="k">freshness</span>
              <span className="v mono">{reportFreshness}</span>
            </div>
            <div className="row">
              <span className="k">generated</span>
              <span className="v mono">
                {recorded(statusReport.artifact?.generated_at ?? statusReport.artifact?.created_at)}
              </span>
            </div>
            {progressView ? (
              <div className="row">
                <span className="k">progress</span>
                <span className="v mono">
                  {recorded(progressView.done)}/{recorded(progressView.total)}
                  {progressView.verified_done != null
                    ? ` · verified ${progressView.verified_done}`
                    : ''}{' '}
                  · in flight {recorded(progressView.in_flight)} · ready{' '}
                  {recorded(progressView.ready)} · blocked {recorded(progressView.blocked)}
                  {progressView.attention != null && progressView.attention > 0
                    ? ` · attention ${progressView.attention}`
                    : ''}
                </span>
              </div>
            ) : null}
            {healthBody?.lint ? (
              <div className="row">
                <span className="k">lint</span>
                <span className="v mono">
                  {healthBody.lint.ok === false ? 'errors' : 'ok'}
                  {Array.isArray(healthBody.lint.violations) && healthBody.lint.violations.length
                    ? ` · ${healthBody.lint.violations.length} finding(s)`
                    : ''}
                </span>
              </div>
            ) : null}
            {healthBody?.over_scheduling ? (
              <div className="row">
                <span className="k">wip</span>
                <span className="v mono">
                  {recorded(healthBody.over_scheduling.in_flight)}
                  {healthBody.over_scheduling.wip_limit != null
                    ? ` / ${healthBody.over_scheduling.wip_limit}`
                    : ''}{' '}
                  · {recorded(healthBody.over_scheduling.state)}
                </span>
              </div>
            ) : null}
            {healthBody?.usage ? (
              <div className="row">
                <span className="k">usage</span>
                <span className="v mono">
                  {healthBody.usage.available
                    ? recorded(healthBody.usage.verdict)
                    : 'not collected'}
                </span>
              </div>
            ) : null}
            {healthList.map((item) => (
              <div className="row" key={`hl-${item.id}`}>
                <span className="k">{item.label || item.id}</span>
                <span className="v mono">
                  {item.state}
                  {item.detail ? ` · ${item.detail}` : ''}
                </span>
              </div>
            ))}
          </div>
          {reportRisks.length ? (
            <div className="kv report-actions">
              {reportRisks.map((risk, index) => (
                <div className="row" key={`risk-${risk.kind ?? index}`}>
                  <span className="k">risk</span>
                  <span className="v mono">
                    {recorded(risk.kind)} · {recorded(risk.severity)}
                    {risk.count != null ? ` · ${risk.count}` : ''}
                    {risk.in_flight != null && risk.wip_limit != null
                      ? ` · ${risk.in_flight}/${risk.wip_limit}`
                      : ''}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {(reportNextActions.ready_to_dispatch ?? []).length ||
          (reportNextActions.awaiting_user ?? []).length ||
          operatorActions.length ? (
            <div className="kv report-actions">
              {(reportNextActions.ready_to_dispatch ?? []).map((item, index) => (
                <div className="row" key={`rd-${item.id ?? index}`}>
                  <span className="k">dispatch</span>
                  <span className="v mono">{recorded(item.id)}</span>
                </div>
              ))}
              {(reportNextActions.awaiting_user ?? []).map((item, index) => (
                <div className="row" key={`au-${item.id ?? index}`}>
                  <span className="k">awaiting</span>
                  <span className="v mono">{recorded(item.id)}</span>
                </div>
              ))}
              {operatorActions.map((action) => (
                <div className="row" key={`op-${action}`}>
                  <span className="k">operator</span>
                  <span className="v mono">{action}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="dsect diagnostics">
          <div className="sl">
            diagnostics
            <span className={`freshness-tag ${String(reportFreshness)}`}>{reportFreshness}</span>
          </div>
          {diagnostics.length ? (
            <div className="activity">
              {diagnostics.map((item, index) => (
                <div className="le" key={`${item.severity}-${index}`}>
                  <span className="lehead">{item.severity} · </span>
                  <span className="lesum">{item.message}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="dim-note">no diagnostics recorded</div>
          )}
        </div>

        <div className="dsect jcledger">
          <div className="sl">◔ judgment calls</div>
          {jcEntries.length ? (
            <div className="jc-list">
              {jcEntries.map((entry, index) => {
                const jcStatus = typeof entry.status === 'string' ? entry.status : 'unknown';
                const jcSeverity = typeof entry.severity === 'string' ? entry.severity : 'unknown';
                return (
                  <div
                    className={`jc-item${jcStatus === 'pending_review' ? ' pending' : ''}`}
                    key={jcKey(entry, index)}
                  >
                    <div className="jc-badges">
                      {typeof entry.category === 'string' && entry.category ? (
                        <span className="badge">{entry.category}</span>
                      ) : null}
                      <span className={`badge sev-${jcSeverity}`}>{jcSeverity}</span>
                      <span className={`badge jc-status-${jcStatus}`}>
                        {jcStatus.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="jc-summary">
                      {typeof entry.summary === 'string' && entry.summary
                        ? entry.summary
                        : '(no summary)'}
                    </div>
                    {typeof entry.ts === 'string' && entry.ts ? (
                      <div className="jc-ts">{entry.ts}</div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="dim-note">no judgment calls recorded — nothing self-decided yet</div>
          )}
        </div>

        <div className="dsect cadence">
          <div className="sl">↻ cadence</div>
          {cadence ? (
            <>
              {cadence.target?.ship_every ? (
                <div className="kv">
                  <div className="row">
                    <span className="k">ship every</span>
                    <span className="v mono">{String(cadence.target.ship_every)}</span>
                  </div>
                </div>
              ) : null}
              {openIterations.map((iteration, index) => {
                const progress = memberProgress(iteration.members, viewModel);
                return (
                  <div className="cad-iter open" key={iteration.id ?? `open-${index}`}>
                    <div className="cad-head">
                      <span className="badge cad-open">open</span>
                      <span className="cad-id">{iteration.id ?? `iteration ${index + 1}`}</span>
                      {progress ? (
                        <span className="cad-progress mono">
                          {progress.done}/{progress.total} done
                        </span>
                      ) : null}
                    </div>
                    {iteration.goal ? <div className="cad-goal">{iteration.goal}</div> : null}
                    <div className="kv">
                      {iteration.started_at ? (
                        <div className="row">
                          <span className="k">started</span>
                          <span className="v mono">{iteration.started_at}</span>
                        </div>
                      ) : null}
                      {iteration.deadline ? (
                        <div className="row">
                          <span className="k">timebox</span>
                          <span className="v mono">{iteration.deadline}</span>
                        </div>
                      ) : null}
                    </div>
                    {(iteration.members ?? []).length ? (
                      <div className="cad-members">
                        {(iteration.members ?? []).map((member) => (
                          <button
                            className="pill-id"
                            key={member}
                            onClick={() => onSelectTask(member)}
                            type="button"
                          >
                            {member}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {shippedIterations.length ? (
                <div className="cad-shipped">
                  {shippedIterations.map((iteration, index) => (
                    <div className="cad-iter shipped" key={iteration.id ?? `shipped-${index}`}>
                      <div className="cad-head">
                        <span className="badge cad-done">shipped</span>
                        <span className="cad-id">
                          {iteration.id ?? `iteration ${index + 1}`}
                        </span>
                        <span className="cad-progress mono">
                          {(iteration.members ?? []).length} member(s)
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              {!openIterations.length && !shippedIterations.length ? (
                <div className="dim-note">cadence target set — no iterations opened yet</div>
              ) : null}
            </>
          ) : (
            <div className="dim-note">no cadence — this board runs as a pure DAG</div>
          )}
          {boardWatchdog ? (
            <div className={`wd-line${boardWatchdog.expired ? ' stale' : ''}`}>
              <span className="k">board watchdog</span>
              <span className={`mono${boardWatchdog.expired ? ' wd-expired' : ''}`}>
                {boardWatchdog.text}
              </span>
            </div>
          ) : null}
        </div>

        <div className="dsect peers">
          <div className="sl">⇄ peers</div>
          {peers?.available && peers.peers.length ? (
            <div className="peer-list">
              {peers.peers.map((peer) => (
                <div className="peer-item" key={peer.board_file}>
                  <div className="peer-head">
                    <span className={`peer-dot${peer.active === false ? ' idle' : ''}`} />
                    <span className="peer-goal">{peer.goal || '(untitled board)'}</span>
                    <span className={`badge prio-${peer.priority}`}>{peer.priority}</span>
                  </div>
                  <div className="peer-meta mono">
                    {peer.board_file}
                    {peer.heartbeat_age_sec != null
                      ? ` · hb ${fmtElapsed(peer.heartbeat_age_sec * 1000) ?? '<1m'} ago`
                      : ''}
                    {peer.current?.workload ? ` · ${peer.current.workload}` : ''}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="dim-note">
              {peers ? 'no active peers — this orchestrator runs alone' : 'peer roster unavailable'}
            </div>
          )}
          {inboxEntries.length ? (
            <div className="peer-inbox">
              {inboxEntries.map((entry, index) => (
                <div className="inbox-item" key={`${entry.kind ?? 'note'}-${index}`}>
                  <span className={`badge kind-${entry.kind ?? 'note'}`}>
                    {(entry.kind ?? 'note').replace(/_/g, ' ')}
                  </span>
                  <span className="inbox-note">
                    {typeof entry.note === 'string' && entry.note
                      ? entry.note
                      : (entry.ts ?? '')}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

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
          <pre className="raw-schema">{JSON.stringify(task.raw_task ?? t, null, 2)}</pre>
        </details>
      </div>
    </aside>
  );
}
