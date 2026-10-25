const wholeAmount = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 });

export function formatWholeNumber(value: string | number): string {
  return formatAmountInput(String(value));
}

export function formatAmountInput(value: string): string {
  if (!value) return '';
  const amount = Number(value);
  return Number.isFinite(amount) ? wholeAmount.format(amount) : value;
}

export function parseAmountInput(value: string): string | null {
  const amount = value.replace(/,/g, '');
  if (!/^\d*$/.test(amount)) return null;
  return amount.replace(/^0+(?=\d)/, '');
}
