export type DynamicFieldIdentity = { id: number; name: string };

export function dynamicFieldStorageKey(field: DynamicFieldIdentity) {
  return `field:${field.id}`;
}

export function getDynamicFieldValue(
  additionalInfo: Record<string, unknown>,
  field: DynamicFieldIdentity,
) {
  const storageKey = dynamicFieldStorageKey(field);
  return Object.prototype.hasOwnProperty.call(additionalInfo, storageKey)
    ? additionalInfo[storageKey]
    : additionalInfo[field.name];
}
