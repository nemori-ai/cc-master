import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  nodeMatchesTaskFilters,
  normalizeTaskFilters,
  taskFilterOptions,
} from '../src/taskFilters';
import { readWorkspaceUrlState, writeWorkspaceUrlState } from '../src/workspaceUrlState';

const nodes = [
  {
    id: 'codex-task',
    title: 'Codex task',
    status: 'ready',
    harness: 'codex',
    surface: 'cli-headless',
    surface_label: 'Codex CLI',
    route_outcome: 'other-harness-cli',
    model: 'gpt-5.6-sol',
    role_grades: ['T1'],
  },
  {
    id: 'cursor-task',
    title: 'Cursor task',
    status: 'ready',
    harness: 'cursor',
    surface: 'host-native',
    surface_label: 'Cursor IDE',
    route_outcome: 'same-native',
    model: 'grok-4.5',
    role_grades: ['T2'],
  },
];

test('cross-harness filters share one matcher across graph and list consumers', () => {
  const filters = new Set(['harness:codex', 'model-tier:t1', 'route-outcome:other-harness-cli']);
  assert.equal(nodeMatchesTaskFilters(nodes[0], filters), true);
  assert.equal(nodeMatchesTaskFilters(nodes[1], filters), false);
  assert.deepEqual(
    taskFilterOptions(nodes, 'surface').map((option) => option.label),
    ['Codex CLI', 'Cursor IDE'],
  );
});

test('workspace URL state round-trips task and stable filters while ignoring unknown keys', () => {
  const path = writeWorkspaceUrlState('http://127.0.0.1:5173/?token=keep&board=board.json#stage', {
    task: 'codex-task',
    filters: new Set(['model-tier:t1', 'harness:codex']),
  });
  assert.equal(
    path,
    '/?token=keep&board=board.json&task=codex-task&filter=harness%3Acodex&filter=model-tier%3At1#stage',
  );
  const restored = readWorkspaceUrlState(path.replace('#stage', '&filter=not-a-real-filter#stage'));
  assert.equal(restored.task, 'codex-task');
  assert.deepEqual([...restored.filters], ['harness:codex', 'model-tier:t1']);
});

test('stale known-prefix filter values are dropped against current board options', () => {
  const restored = readWorkspaceUrlState(
    '/?filter=harness%3Aretired&filter=surface%3Acursor-ide&filter=route-outcome%3Aother-harness-cli',
  );
  assert.deepEqual([...normalizeTaskFilters(nodes, restored.filters)].sort(), [
    'route-outcome:other-harness-cli',
    'surface:cursor-ide',
  ]);
});

test('looksLikeShellCommand: conservative split between runnable commands and internal handles', async () => {
  const { looksLikeShellCommand } = await import('../src/agentFormat');
  // Runnable shell commands — lowercase binary/path head.
  for (const cmd of [
    'claude --resume 9f2c-abc',
    'codex resume 019f2c74',
    'cursor-agent attach x',
    'tmux attach -t worker',
    './scripts/attach.sh',
    '~/bin/attach worker-1',
    '/usr/local/bin/ccm attach',
  ]) {
    assert.equal(looksLikeShellCommand(cmd), true, `command form: ${cmd}`);
  }
  // Internal semantic handles / non-commands — must render as info line, never COPY+cd.
  for (const handle of [
    'SendMessage to a94c182d71804bad4',
    'SendMessage with the agent id',
    'Use the Task tool to continue',
    '',
    '   ',
  ]) {
    assert.equal(looksLikeShellCommand(handle), false, `info line: ${JSON.stringify(handle)}`);
  }
});
