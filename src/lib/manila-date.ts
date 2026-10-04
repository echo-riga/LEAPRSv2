export function manilaDate(value: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function manilaDateBoundary(value: string, end = false): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid date filter.');
  const date = new Date(`${value}T${end ? '23:59:59.999' : '00:00:00'}+08:00`);
  if (!Number.isFinite(date.getTime()) || manilaDate(date) !== value) throw new Error('Invalid date filter.');
  return date;
}
