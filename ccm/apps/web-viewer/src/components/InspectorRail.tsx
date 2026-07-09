import { useState } from 'react';
import type { StatusReportPayload, TaskDetailPayload, ViewModelPayload } from '../types';
import { statusLabel, statusTone } from '../format';

type InspectorTab = 'status' | 'report' | 'diagnostics' | 'dependencies';

interface InspectorRailProps {
  task: TaskDetailPayload;
  viewModel: ViewModelPayload;
  statusReport: StatusReportPayload;
  taskLoading?: boolean;
  onClose?: () => void;
}

const tabs: Array<{ id: InspectorTab; label: string }> = [
  { id: 'status', label: 'Status' },
  { id: 'report', label: 'Report' },
  { id: 'diagnostics', label: 'Diagnostics' },
  { id: 'dependencies', label: 'Dependencies' }
];

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

function clampProgress(value: number): number {
  return Math.max(0, Math.min(Math.round(value), 100));
}

function derivedProgress(task: TaskDetailPayload['task']): number {
  const explicit = typeof task.progress === 'number' ? task.progress : undefined;
  const tone = statusTone(task.status);
  if (tone === 'done') {
    return task.verified === true ? 100 : 95;
  }
  if (explicit !== undefined) {
    return clampProgress(explicit);
  }
  if (tone === 'in-flight') return 60;
  if (tone === 'awaiting-user') return 40;
  if (tone === 'blocked') return 25;
  if (tone === 'ready') return 10;
  if (tone === 'stale') return 0;
  return 5;
}

function recorded(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return 'Not recorded';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return JSON.stringify(value);
}

function joinIds(values: Array<{ id: string; title?: string; status?: string }> | undefined): string {
  if (!values?.length) {
    return 'none';
  }
  return values.map((value) => `${value.id}${value.status ? ` (${value.status})` : ''}`).join(', ');
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre className="raw-schema">{JSON.stringify(value ?? null, null, 2)}</pre>;
}

function EmptyState({ children }: { children: string }) {
  return <p className="empty-state">{children}</p>;
}

export function InspectorRail({ task, viewModel, statusReport, taskLoading = false, onClose }: InspectorRailProps) {
  const [activeTab, setActiveTab] = useState<InspectorTab>('status');
  const progress = derivedProgress(task.task);
  const diagnostics = [
    ...(viewModel.freshness.errors ?? []).map((item) => ({
      severity: 'error',
      message: item.message
    })),
    ...(viewModel.diagnostics?.lint ?? []),
    ...(viewModel.diagnostics?.over_scheduling ?? [])
  ];

  return (
    <aside className="inspector" aria-label="Selected task inspector">
      <div className="inspector-head">
        <div>
          <span className="eyebrow">Selected task</span>
          <h2>{task.task.title}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close details">
          x
        </button>
      </div>

      <div className="task-meta">
        <span data-tone={statusTone(task.task.status)}>{statusLabel(task.task.status)}</span>
        {viewModel.graph.critical_path?.includes(task.task.id) ? <strong>Critical Path</strong> : null}
        {taskLoading ? <strong>Loading detail</strong> : null}
        {task.error ? <strong>Detail error</strong> : null}
      </div>

      <dl className="detail-grid">
        <div>
          <dt>ID</dt>
          <dd>{task.task.id}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{task.task.type ?? 'task'}</dd>
        </div>
        <div>
          <dt>Rank</dt>
          <dd>{task.task.rank ?? '-'}</dd>
        </div>
        <div>
          <dt>Executor</dt>
          <dd>{task.task.executor ?? 'Not recorded'}</dd>
        </div>
        <div>
          <dt>Handle</dt>
          <dd>{task.task.handle ?? 'none'}</dd>
        </div>
      </dl>

      <div className="tabbar" role="tablist" aria-label="Inspector tabs">
        {tabs.map((tab) => (
          <button
            aria-controls={`inspector-panel-${tab.id}`}
            aria-selected={activeTab === tab.id}
            id={`inspector-tab-${tab.id}`}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'status' ? (
        <section
          aria-labelledby="inspector-tab-status"
          className="inspector-panel"
          id="inspector-panel-status"
          role="tabpanel"
        >
          <div className="metric-row">
            <span>Progress</span>
            <strong>{progress}%</strong>
          </div>
          <div className="progress-track" aria-label={`Progress ${progress}%`}>
            <i style={{ width: `${progress}%` }} />
          </div>
          <dl className="time-grid">
            <div>
              <dt>Started</dt>
              <dd>{recorded(task.task.started_at)}</dd>
            </div>
            <div>
              <dt>Finished</dt>
              <dd>{recorded(task.task.finished_at)}</dd>
            </div>
            <div>
              <dt>Elapsed</dt>
              <dd>{recorded(task.task.elapsed)}</dd>
            </div>
            <div>
              <dt>ETA</dt>
              <dd>{recorded(task.task.eta)}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{recorded(task.task.updated_at)}</dd>
            </div>
          </dl>
          <h3>Next actions</h3>
          {(task.task.next_actions ?? []).length ? (
            <ul className="action-list">
              {(task.task.next_actions ?? []).map((action) => (
                <li key={action}>{action}</li>
              ))}
            </ul>
          ) : (
            <EmptyState>No next actions recorded.</EmptyState>
          )}
        </section>
      ) : null}

      {activeTab === 'report' ? (
        <section
          aria-labelledby="inspector-tab-report"
          className="inspector-panel"
          id="inspector-panel-report"
          role="tabpanel"
        >
          <div className="split-panel">
            <div>
              <h3>Report freshness</h3>
              <p>{statusReport.artifact?.freshness ?? viewModel.diagnostics?.report_freshness ?? 'unknown'}</p>
            </div>
            <div>
              <h3>Generated</h3>
              <p>{recorded(statusReport.artifact?.generated_at)}</p>
            </div>
          </div>
          <dl className="schema-grid">
            <div>
              <dt>Total</dt>
              <dd>{recorded(statusReport.progress?.total)}</dd>
            </div>
            <div>
              <dt>Done</dt>
              <dd>{recorded(statusReport.progress?.done)}</dd>
            </div>
            <div>
              <dt>In flight</dt>
              <dd>{recorded(statusReport.progress?.in_flight)}</dd>
            </div>
            <div>
              <dt>Ready</dt>
              <dd>{recorded(statusReport.progress?.ready)}</dd>
            </div>
            <div>
              <dt>Blocked</dt>
              <dd>{recorded(statusReport.progress?.blocked)}</dd>
            </div>
          </dl>
          <h3>Report next actions</h3>
          <p>
            Ready: {joinIds(statusReport.next_actions?.ready_to_dispatch)} / Awaiting user:{' '}
            {joinIds(statusReport.next_actions?.awaiting_user)}
          </p>
        </section>
      ) : null}

      {activeTab === 'diagnostics' ? (
        <section
          aria-labelledby="inspector-tab-diagnostics"
          className="inspector-panel"
          id="inspector-panel-diagnostics"
          role="tabpanel"
        >
          {diagnostics.length ? (
            <ul className="action-list">
              {diagnostics.map((item, index) => (
                <li key={`${item.severity}-${item.message}-${index}`}>
                  {item.severity}: {item.message}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>No diagnostics recorded.</EmptyState>
          )}
          <h3>Freshness</h3>
          <JsonBlock value={viewModel.freshness} />
        </section>
      ) : null}

      {activeTab === 'dependencies' ? (
        <section
          aria-labelledby="inspector-tab-dependencies"
          className="inspector-panel"
          id="inspector-panel-dependencies"
          role="tabpanel"
        >
          <dl className="schema-grid">
            <div>
              <dt>Deps</dt>
              <dd>{(task.task.deps ?? []).join(', ') || 'none'}</dd>
            </div>
            <div>
              <dt>Parent</dt>
              <dd>{task.task.parent ?? 'none'}</dd>
            </div>
            <div>
              <dt>Parents</dt>
              <dd>{(task.task.parents ?? []).join(', ') || 'none'}</dd>
            </div>
            <div>
              <dt>Children</dt>
              <dd>{(task.task.children ?? []).join(', ') || 'none'}</dd>
            </div>
            <div>
              <dt>Dependencies</dt>
              <dd>{joinIds(task.dependencies)}</dd>
            </div>
            <div>
              <dt>Dependents</dt>
              <dd>{joinIds(task.dependents)}</dd>
            </div>
          </dl>
          <h3>Activity</h3>
          {(task.activity ?? []).length ? (
            <ul className="action-list">
              {(task.activity ?? []).map((item, index) => (
                <li key={`${item.at}-${item.text}-${index}`}>
                  {recorded(item.at)}: {item.text}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>No activity recorded.</EmptyState>
          )}
        </section>
      ) : null}

      <section className="inspector-panel text-outline">
        <h3>Task fields</h3>
        <dl className="schema-grid">
          {taskFieldKeys.map((key) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{recorded(task.task[key])}</dd>
            </div>
          ))}
        </dl>
        <h3>Raw schema</h3>
        <JsonBlock value={task.raw_task ?? task.task} />
      </section>
    </aside>
  );
}
