export function validateRequestInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid request data.');
  const input = value as Record<string, unknown>;
  if (!Number.isSafeInteger(input.capdevId) || Number(input.capdevId) <= 0) throw new Error('Invalid project.');
  if (input.setting !== 'internal' && input.setting !== 'external') throw new Error('Invalid request setting.');
  const requestedBudget = validateMoney(input.requestedBudget);
  if (typeof input.description !== 'string' || input.description.length > 20000) throw new Error('Invalid description.');
  if (typeof input.eventDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.eventDate)) throw new Error('Event Date is required.');
  const eventDate = new Date(`${input.eventDate}T00:00:00Z`);
  if (!Number.isFinite(eventDate.getTime()) || eventDate.toISOString().slice(0, 10) !== input.eventDate) throw new Error('Invalid Event Date.');
  const additionalInfo = input.additionalInfo;
  if (!additionalInfo || typeof additionalInfo !== 'object' || Array.isArray(additionalInfo) || JSON.stringify(additionalInfo).length > 250000) {
    throw new Error('Invalid request fields.');
  }
  // Explicit allowlist: identity, workflow state, and timestamps never come from clients.
  return { capdevId: Number(input.capdevId), setting: input.setting as 'internal' | 'external',
    requestedBudget, description: input.description, eventDate: input.eventDate, additionalInfo: { ...additionalInfo } as Record<string, unknown> };
}

export function validateMoney(value: unknown, { allowZero = false }: { allowZero?: boolean } = {}): string {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^\d{1,10}(\.0{1,2})?$/.test(String(value)) || (allowZero ? Number(value) < 0 : Number(value) <= 0)) {
    throw new Error(allowZero ? 'Enter a whole amount of zero or greater.' : 'Enter a whole amount greater than zero.');
  }
  return String(value);
}
