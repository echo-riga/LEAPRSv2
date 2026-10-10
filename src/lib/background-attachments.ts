export type PendingAttachment = { pendingUploadId: string; pending: true; name: string; mimeType: string; size: number; uploadedById?: string };
export type UploadTarget = { kind: 'capdev' | 'request' | 'status'; id: number; requestId?: number };
export type AttachmentJobInput = { uploadId: string; fieldKey: string; file: File };

export function isPendingAttachment(value: unknown): value is PendingAttachment {
  return !!value && typeof value === 'object' && 'pending' in value && value.pending === true && 'pendingUploadId' in value;
}

// Pending descriptors contain no file bytes or fabricated Drive links.
export function validatePendingAttachments(info: Record<string, unknown>, userId: string) {
  const result = { ...info };
  for (const [key, value] of Object.entries(result)) {
    if (!Array.isArray(value)) continue;
    const pending = value.filter(isPendingAttachment);
    if (pending.length > 10 || pending.reduce((sum, item) => sum + item.size, 0) > 100 * 1024 * 1024) throw new Error('Attach up to 10 files totaling 100 MB per field.');
    result[key] = value.map(item => {
      if (!isPendingAttachment(item)) return item;
      if (!/^[a-f0-9-]{36}$/i.test(item.pendingUploadId) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 255 || !Number.isSafeInteger(item.size) || item.size <= 0 || typeof item.mimeType !== 'string') throw new Error('One or more selected files are invalid.');
      return { pending: true, pendingUploadId: item.pendingUploadId, name: item.name, size: item.size, mimeType: item.mimeType, uploadedById: item.uploadedById || userId };
    });
  }
  return result;
}

export function stageAttachments(info: Record<string, unknown>, fields: Record<string, File[]>, definitions: { id: number; name: string }[] = []) {
  const additionalInfo = { ...info };
  const jobs: AttachmentJobInput[] = [];
  for (const [fieldKey, files] of Object.entries(fields)) {
    if (!files.length) continue;
    if (files.length > 10 || files.reduce((sum, file) => sum + file.size, 0) > 100 * 1024 * 1024) throw new Error('Attach up to 10 files totaling 100 MB per field.');
    const field = definitions.find(field => `field:${field.id}` === fieldKey);
    const existing = Object.hasOwn(additionalInfo, fieldKey) ? additionalInfo[fieldKey] : field ? additionalInfo[field.name] : undefined;
    const values = Array.isArray(existing) ? [...existing] : [];
    const selectedIds = new Set<string>();
    for (const file of files) {
      if (!file.size || !file.name.trim()) throw new Error('One or more selected files are invalid.');
      const prior = values.find(item => isPendingAttachment(item) && !selectedIds.has(item.pendingUploadId) && item.name === file.name && item.size === file.size && item.mimeType === file.type);
      const uploadId = isPendingAttachment(prior) ? prior.pendingUploadId : crypto.randomUUID();
      selectedIds.add(uploadId);
      jobs.push({ uploadId, fieldKey, file });
      if (!prior) values.push({ pending: true as const, pendingUploadId: uploadId, name: file.name, mimeType: file.type, size: file.size });
    }
    additionalInfo[fieldKey] = values;
  }
  return { additionalInfo, jobs };
}

export function replacePendingAttachment(info: Record<string, unknown>, uploadId: string, attachment: { id: string; name: string; mimeType: string; url: string }) {
  const result = { ...info };
  for (const [key, value] of Object.entries(result)) {
    if (Array.isArray(value)) result[key] = value.map(item => isPendingAttachment(item) && item.pendingUploadId === uploadId ? attachment : item);
  }
  return result;
}

// An editor may have opened while a file was pending and saved after it finished.
// Resolve its stale placeholder instead of overwriting the finished attachment.
export function reconcilePendingAttachments(incoming: Record<string, unknown>, current: Record<string, unknown>) {
  const completed = new Map<string, unknown>();
  for (const value of Object.values(current)) if (Array.isArray(value)) for (const item of value) {
    if (item && typeof item === 'object' && typeof item.backgroundUploadId === 'string' && item.id) completed.set(item.backgroundUploadId, item);
  }
  const result = { ...incoming };
  for (const [key, value] of Object.entries(result)) if (Array.isArray(value)) result[key] = value.map(item => isPendingAttachment(item) ? completed.get(item.pendingUploadId) || item : item);
  return result;
}
