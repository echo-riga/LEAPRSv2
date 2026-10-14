import { dynamicFieldStorageKey, type DynamicFieldIdentity } from './dynamic-fields';

type AttachmentLike = {
  id?: unknown;
  pendingUploadId?: unknown;
};

function storedFieldValues(additionalInfo: Record<string, unknown>, field: DynamicFieldIdentity) {
  const canonicalKey = dynamicFieldStorageKey(field);
  const values: unknown[] = [];
  if (Object.prototype.hasOwnProperty.call(additionalInfo, canonicalKey)) values.push(additionalInfo[canonicalKey]);
  if (field.name !== canonicalKey && Object.prototype.hasOwnProperty.call(additionalInfo, field.name)) values.push(additionalInfo[field.name]);
  return values;
}

export function hasStoredDynamicFieldValue(
  additionalInfo: Record<string, unknown>,
  field: DynamicFieldIdentity,
) {
  return Object.prototype.hasOwnProperty.call(additionalInfo, dynamicFieldStorageKey(field))
    || Object.prototype.hasOwnProperty.call(additionalInfo, field.name);
}

export function getDynamicFieldAttachmentIds(
  additionalInfo: Record<string, unknown>,
  field: DynamicFieldIdentity,
) {
  const ids = new Set<string>();
  for (const value of storedFieldValues(additionalInfo, field)) {
    if (!Array.isArray(value)) continue;
    for (const item of value as AttachmentLike[]) {
      if (item && typeof item === 'object' && typeof item.id === 'string' && item.id.trim()) ids.add(item.id.trim());
    }
  }
  return [...ids];
}

export function removeDynamicFieldValue(
  additionalInfo: Record<string, unknown>,
  field: DynamicFieldIdentity,
) {
  const cleaned = { ...additionalInfo };
  delete cleaned[dynamicFieldStorageKey(field)];
  delete cleaned[field.name];
  return cleaned;
}
