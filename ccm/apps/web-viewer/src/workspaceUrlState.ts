import { canonicalTaskFilterKey } from './taskFilters';

export interface WorkspaceUrlState {
  board?: string;
  task: string | null;
  agent: string | null;
  stream: boolean;
  filters: Set<string>;
}

export function readWorkspaceUrlState(value: string): WorkspaceUrlState {
  const url = new URL(value, 'http://localhost/');
  const agent = url.searchParams.get('agent');
  // task/agent selection is at-most-one in the workspace. A hand-crafted deep link carrying
  // both resolves to the agent — matching the right rail's display precedence — and the task
  // param is dropped (the next URL sync writes the reconciled state back).
  return {
    board: url.searchParams.get('board') ?? undefined,
    task: agent ? null : url.searchParams.get('task'),
    agent,
    // The stream drawer is an agent-scoped overlay; `stream=1` only makes sense with an agent.
    stream: !!agent && url.searchParams.get('stream') === '1',
    filters: new Set(
      url.searchParams
        .getAll('filter')
        .map(canonicalTaskFilterKey)
        .filter((filter): filter is string => !!filter),
    ),
  };
}

export function writeWorkspaceUrlState(
  value: string,
  state: Pick<WorkspaceUrlState, 'task' | 'filters'> & { agent?: string | null; stream?: boolean },
): string {
  const url = new URL(value, 'http://localhost/');
  // task and agent are mutually exclusive selections in the workspace; if a caller ever
  // passes both, agent wins (same precedence as the read side) so the URL never carries
  // two selections at once.
  const agent = state.agent ?? null;
  const task = agent ? null : state.task;
  if (task) url.searchParams.set('task', task);
  else url.searchParams.delete('task');
  if (agent) url.searchParams.set('agent', agent);
  else url.searchParams.delete('agent');
  // stream is only meaningful with an agent selected; drop it otherwise so a stale flag never
  // sticks in the URL when the selection clears.
  if (agent && state.stream) url.searchParams.set('stream', '1');
  else url.searchParams.delete('stream');
  url.searchParams.delete('filter');
  for (const filter of [...state.filters].sort()) url.searchParams.append('filter', filter);
  return `${url.pathname}${url.search}${url.hash}`;
}
