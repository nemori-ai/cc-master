import { canonicalTaskFilterKey } from './taskFilters';

export interface WorkspaceUrlState {
  board?: string;
  task: string | null;
  agent: string | null;
  filters: Set<string>;
}

export function readWorkspaceUrlState(value: string): WorkspaceUrlState {
  const url = new URL(value, 'http://localhost/');
  return {
    board: url.searchParams.get('board') ?? undefined,
    task: url.searchParams.get('task'),
    agent: url.searchParams.get('agent'),
    filters: new Set(
      url.searchParams
        .getAll('filter')
        .map(canonicalTaskFilterKey)
        .filter((filter): filter is string => !!filter)
    )
  };
}

export function writeWorkspaceUrlState(
  value: string,
  state: Pick<WorkspaceUrlState, 'task' | 'filters'> & { agent?: string | null }
): string {
  const url = new URL(value, 'http://localhost/');
  // task and agent are mutually exclusive selections in the workspace, but both are written
  // defensively so the URL always reflects current state (at most one is non-null).
  if (state.task) url.searchParams.set('task', state.task);
  else url.searchParams.delete('task');
  if (state.agent) url.searchParams.set('agent', state.agent);
  else url.searchParams.delete('agent');
  url.searchParams.delete('filter');
  for (const filter of [...state.filters].sort()) url.searchParams.append('filter', filter);
  return `${url.pathname}${url.search}${url.hash}`;
}
