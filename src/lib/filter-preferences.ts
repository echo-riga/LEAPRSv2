import { manilaDate } from '@/lib/manila-date';

export type DateFilterPreset = 'today' | 'month' | 'year';

export function getDateFilterPresetRange(preset: DateFilterPreset) {
  const today = manilaDate();
  if (preset === 'today') return { dateFrom: today, dateTo: today };
  if (preset === 'month') return { dateFrom: `${today.slice(0, 7)}-01`, dateTo: today };
  return { dateFrom: `${today.slice(0, 4)}-01-01`, dateTo: `${today.slice(0, 4)}-12-31` };
}

export function getActiveDateFilterPreset(dateFrom: string, dateTo: string): DateFilterPreset | null {
  for (const preset of ['today', 'month', 'year'] as const) {
    const range = getDateFilterPresetRange(preset);
    if (dateFrom === range.dateFrom && dateTo === range.dateTo) return preset;
  }
  return null;
}

export const filterPreferenceStorageKey = (page: 'capdev' | 'requests' | 'users', userId: string) =>
  `leaprs:${page}-filters:${userId}`;
