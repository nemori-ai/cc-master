import type { GraphNode } from './types';

export type TaskFilterGroup = 'status' | 'executor' | 'type';

export interface TaskFilterOption {
  key: string;
  label: string;
  count: number;
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
  const normalized = (value ?? '').trim().toLowerCase().replaceAll('_', '-');
  return normalized || 'unknown';
}

export function filterKey(group: TaskFilterGroup, value: string | undefined): string {
  return `${group}:${normalizeFilterValue(value)}`;
}

export function taskFilterValue(node: GraphNode, group: TaskFilterGroup): string {
  if (group === 'status') return normalizeFilterValue(node.status);
  if (group === 'executor') return normalizeFilterValue(node.executor);
  return normalizeFilterValue(node.type ?? 'task');
}

export function taskFilterLabel(value: string): string {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
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
    const value = taskFilterValue(node, group);
    const existing = counts.get(value);
    counts.set(value, {
      label: existing?.label ?? taskFilterLabel(value),
      count: (existing?.count ?? 0) + 1
    });
  }

  return [...counts.entries()]
    .map(([value, option]) => ({
      key: `${group}:${value}`,
      label: option.label,
      count: option.count
    }))
    .sort((left, right) => optionSort(group, left, right));
}

export function nodeMatchesTaskFilters(node: GraphNode, activeFilters: Set<string>): boolean {
  if (activeFilters.has('critical') && node.critical !== true) {
    return false;
  }

  for (const group of ['status', 'executor', 'type'] satisfies TaskFilterGroup[]) {
    const activeValues = [...activeFilters]
      .filter((filter) => filter.startsWith(`${group}:`))
      .map((filter) => filter.slice(group.length + 1));
    if (activeValues.length > 0 && !activeValues.includes(taskFilterValue(node, group))) {
      return false;
    }
  }

  return true;
}
