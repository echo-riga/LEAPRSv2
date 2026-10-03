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

export function getInvalidComboboxFields(
  fields: Array<DynamicFieldIdentity & { type: string; options: unknown; isRequired?: boolean }>,
  additionalInfo: Record<string, unknown>,
) {
  return fields.filter((field) => {
    if (field.type !== 'combobox') return false;
    const value = getDynamicFieldValue(additionalInfo, field);
    if (value === undefined || value === null || value === '') return Boolean(field.isRequired);
    return typeof value !== 'string' || !Array.isArray(field.options) || !field.options.includes(value);
  }).map((field) => field.name);
}

export function hasComboboxOptions(type: string, options: unknown) {
  return type !== 'combobox' || (
    Array.isArray(options) && options.length > 0 &&
    options.every((option) => typeof option === 'string' && option.trim().length > 0)
  );
}
