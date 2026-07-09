import type { StatusTone } from './types';

export function statusTone(status: string | undefined): StatusTone {
  const normalized = status?.toLowerCase().replaceAll('_', '-');
  if (normalized === 'ready') return 'ready';
  if (normalized === 'in-flight' || normalized === 'running') return 'in-flight';
  if (normalized === 'awaiting-user' || normalized === 'user-blocked') return 'awaiting-user';
  if (normalized === 'blocked') return 'blocked';
  if (normalized === 'stale' || normalized === 'error' || normalized === 'stale-error') return 'stale';
  if (normalized === 'done' || normalized === 'verified' || normalized === 'done-verified') return 'done';
  return 'neutral';
}

export function statusLabel(status: string | undefined): string {
  const tone = statusTone(status);
  switch (tone) {
    case 'ready':
      return 'Ready';
    case 'in-flight':
      return 'In Flight';
    case 'awaiting-user':
      return 'Awaiting User';
    case 'blocked':
      return 'Blocked';
    case 'stale':
      return 'Stale / Error';
    case 'done':
      return 'Done';
    case 'neutral':
      return status ?? 'Unknown';
  }
}

export function shortTime(value: string | undefined): string {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
