import { useSecondTick } from '../analytics';
import { fmtElapsed, fmtEstimate, normalizeStatus, recorded, watchdogReadout } from '../format';
import type {
  CadenceIteration,
  InboxNotification,
  JudgmentCall,
  PeersPayload,
  StatusReportPayload,
  ViewModelPayload
} from '../types';

interface BoardBriefProps {
  viewModel: ViewModelPayload;
  statusReport: StatusReportPayload;
  peers?: PeersPayload | null;
  onSelectTask: (taskId: string) => void;
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

/**
 * R-B mission brief — the right rail's DEFAULT mode (no task selected). Board-level
 * intel in board scope: status report -> diagnostics -> judgment-call ledger -> cadence
 * (+ board watchdog) -> peers + coordination inbox. The rail is never empty again;
 * selecting a task swaps this whole panel for the task drill-down, and close/Esc lands
 * back here.
 */
export function BoardBrief({ viewModel, statusReport, peers = null, onSelectTask }: BoardBriefProps) {
  const extras = viewModel.board_extras ?? {};
  const boardWatchdog = watchdogReadout(extras.watchdog);
  // Second ticker drives the board-watchdog countdown (re-renders each second).
  useSecondTick(boardWatchdog != null);

  const diagnostics = [
    ...(viewModel.freshness.errors ?? []).map((item) => ({
      severity: 'error',
      message: item.message
    })),
    ...(viewModel.diagnostics?.lint ?? []),
    ...(viewModel.diagnostics?.over_scheduling ?? [])
  ];

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
    <div className="dpanel" data-mode="brief">
      <div className="dhead brief">
        <div className="htext">
          <div className="htitle">mission brief</div>
          <div className="hmeta">
            <span className="hid">{viewModel.board.id || 'board'}</span>
            <span>board-level intel — select a task to drill down</span>
          </div>
        </div>
      </div>

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
                {healthBody.usage.available ? recorded(healthBody.usage.verdict) : 'not collected'}
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
                  <span className="v mono">
                    {fmtEstimate(cadence.target.ship_every) ?? recorded(cadence.target.ship_every)}
                  </span>
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
                      <span className="cad-id">{iteration.id ?? `iteration ${index + 1}`}</span>
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
                  {typeof entry.note === 'string' && entry.note ? entry.note : (entry.ts ?? '')}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
