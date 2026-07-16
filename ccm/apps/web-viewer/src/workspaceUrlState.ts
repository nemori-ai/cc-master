import { canonicalTaskFilterKey } from './taskFilters';

export interface WorkspaceUrlState {
  board?: string;
  task: string | null;
  filters: Set<string>;
}

export function readWorkspaceUrlState(value: string): WorkspaceUrlState {
  const url = new URL(value, 'http://localhost/');
  return {
    board: url.searchParams.get('board') ?? undefined,
    task: url.searchParams.get('task'),
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
  state: Pick<WorkspaceUrlState, 'task' | 'filters'>
): string {
  const url = new URL(value, 'http://localhost/');
  if (state.task) url.searchParams.set('task', state.task);
  else url.searchParams.delete('task');
  url.searchParams.delete('filter');
  for (const filter of [...state.filters].sort()) url.searchParams.append('filter', filter);
  return `${url.pathname}${url.search}${url.hash}`;
}
