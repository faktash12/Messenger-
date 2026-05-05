import type { RetentionId } from './types';

const foreverMilliseconds = 100 * 365 * 24 * 60 * 60 * 1000;

export const retentionOptions: Array<{
  id: RetentionId;
  label: string;
  shortLabel: string;
  milliseconds: number;
}> = [
  { id: '1m', label: '1 dakika', shortLabel: '1 dk', milliseconds: 60 * 1000 },
  { id: '10m', label: '10 dakika', shortLabel: '10 dk', milliseconds: 10 * 60 * 1000 },
  { id: '1h', label: '1 saat', shortLabel: '1 saat', milliseconds: 60 * 60 * 1000 },
  { id: '1d', label: '1 gün', shortLabel: '1 gün', milliseconds: 24 * 60 * 60 * 1000 },
  { id: 'forever', label: 'Süresiz', shortLabel: 'Süresiz', milliseconds: foreverMilliseconds },
];

export function getRetention(retentionId: RetentionId) {
  return retentionOptions.find((option) => option.id === retentionId) ?? retentionOptions[0];
}

export function formatRemaining(expiresAt: number, now: number) {
  const remaining = Math.max(0, expiresAt - now);
  if (remaining > foreverMilliseconds / 2) {
    return 'Süresiz';
  }

  const minutes = Math.ceil(remaining / 60000);

  if (minutes < 60) {
    return `${minutes} dk`;
  }

  const hours = Math.ceil(minutes / 60);
  if (hours < 24) {
    return `${hours} sa`;
  }

  const days = Math.ceil(hours / 24);
  return `${days} gün`;
}
