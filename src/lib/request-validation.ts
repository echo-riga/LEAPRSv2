export function validateRequestInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid request data.');
  const input = value as Record<string, unknown>;
  if (!Number.isSafeInteger(input.capdevId) || Number(input.capdevId) <= 0) throw new Error('Invalid project.');
  if (input.setting !== 'internal' && input.setting !== 'external') throw new Error('Invalid request setting.');
  const requestedBudget = validateMoney(input.requestedBudget);
  if (typeof input.description !== 'string' || input.description.length > 20000) throw new Error('Invalid description.');
  const additionalInfo = input.additionalInfo;
  if (!additionalInfo || typeof additionalInfo !== 'object' || Array.isArray(additionalInfo) || JSON.stringify(additionalInfo).length > 250000) {
    throw new Error('Invalid request fields.');
  }
  // Explicit allowlist: identity, workflow state, and timestamps never come from clients.
  return { capdevId: Number(input.capdevId), setting: input.setting as 'internal' | 'external',
    requestedBudget, description: input.description, additionalInfo: { ...additionalInfo } as Record<string, unknown> };
}

export function validateMoney(value: unknown): string {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^\d{1,10}(\.\d{1,2})?$/.test(String(value)) || Number(value) <= 0) {
    throw new Error('Enter a positive amount with at most two decimal places.');
  }
  return String(value);
}
