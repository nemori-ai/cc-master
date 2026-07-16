import type { GraphNode } from './types';

export type TaskFilterGroup =
  | 'status'
  | 'executor'
  | 'type'
  | 'harness'
  | 'surface'
  | 'model-tier'
  | 'route-outcome';

export interface TaskFilterOption {
  key: string;
  label: string;
  count: number;
}

export const TASK_FILTER_GROUPS: TaskFilterGroup[] = [
  'status',
  'executor',
  'type',
  'harness',
  'surface',
  'model-tier',
  'route-outcome'
];

export function canonicalTaskFilterKey(value: string): string | null {
  if (value === 'critical') return value;
  const separator = value.indexOf(':');
  if (separator <= 0) return null;
  const group = value.slice(0, separator) as TaskFilterGroup;
  if (!TASK_FILTER_GROUPS.includes(group)) return null;
  return `${group}:${normalizeFilterValue(value.slice(separator + 1))}`;
}

export function isTaskFilterKey(value: string): boolean {
  return canonicalTaskFilterKey(value) !== null;
}

const statusOrder = [
  'ready',
  'in-flight',
  'in_flight',
  'blocked',
  'awaiting-user',
  'awaiting_user',
  'done',
  'stale',
  'failed',
  'uncertain',
  'escalated'
];

export function normalizeFilterValue(value: string | undefined): string {
  const normalized = (value ?? '').trim().toLowerCase().replaceAll('_', '-').replaceAll(/\s+/g, '-');
  return normalized || 'unknown';
}

export function filterKey(group: TaskFilterGroup, value: string | undefined): string {
  return `${group}:${normalizeFilterValue(value)}`;
}

export function taskFilterValues(node: GraphNode, group: TaskFilterGroup): string[] {
  if (group === 'status') return [normalizeFilterValue(node.status)];
  if (group === 'executor') return [normalizeFilterValue(node.executor)];
  if (group === 'type') return [normalizeFilterValue(node.type ?? 'task')];
  if (group === 'harness') return [normalizeFilterValue(node.harness)];
  if (group === 'surface') return [normalizeFilterValue(node.surface_label ?? node.surface)];
  if (group === 'route-outcome') return [normalizeFilterValue(node.route_outcome)];
  const grades = node.role_grades?.length ? node.role_grades : ['unknown'];
  return grades.map((grade) => normalizeFilterValue(grade));
}

export function taskFilterLabel(value: string): string {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) =>
      ['cli', 'ide', 't1', 't2', 't3'].includes(part)
        ? part.toUpperCase()
        : part[0]?.toUpperCase() + part.slice(1)
    )
    .join(' ');
}

function optionSort(group: TaskFilterGroup, left: TaskFilterOption, right: TaskFilterOption): number {
  if (group === 'status') {
    const leftIndex = statusOrder.indexOf(left.key.replace(/^status:/, ''));
    const rightIndex = statusOrder.indexOf(right.key.replace(/^status:/, ''));
    if (leftIndex !== rightIndex) {
      return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
    }
  }
  return left.label.localeCompare(right.label);
}

export function taskFilterOptions(nodes: GraphNode[], group: TaskFilterGroup): TaskFilterOption[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const node of nodes) {
    for (const value of new Set(taskFilterValues(node, group))) {
      const existing = counts.get(value);
      counts.set(value, {
        label: existing?.label ?? taskFilterLabel(value),
        count: (existing?.count ?? 0) + 1
      });
    }
  }

  return [...counts.entries()]
    .map(([value, option]) => ({
      key: `${group}:${value}`,
      label: option.label,
      count: option.count
    }))
    .sort((left, right) => optionSort(group, left, right));
}

export function normalizeTaskFilters(nodes: GraphNode[], filters: Set<string>): Set<string> {
  const available = new Set<string>(['critical']);
  for (const group of TASK_FILTER_GROUPS) {
    for (const option of taskFilterOptions(nodes, group)) available.add(option.key);
  }
  return new Set(
    [...filters]
      .map(canonicalTaskFilterKey)
      .filter((filter): filter is string => !!filter && available.has(filter))
  );
}

export function nodeMatchesTaskFilters(node: GraphNode, activeFilters: Set<string>): boolean {
  if (activeFilters.has('critical') && node.critical !== true) {
    return false;
  }

  for (const group of TASK_FILTER_GROUPS) {
    const activeValues = [...activeFilters]
      .filter((filter) => filter.startsWith(`${group}:`))
      .map((filter) => filter.slice(group.length + 1));
    if (
      activeValues.length > 0 &&
      !taskFilterValues(node, group).some((value) => activeValues.includes(value))
    ) {
      return false;
    }
  }

  return true;
}
