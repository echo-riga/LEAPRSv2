'use client';

import { createGoogleDriveUploadSessions, type StatusAttachment, type RequestUploadContext } from '@/app/actions';

export async function uploadFilesDirectlyToGoogleDrive(files: File[], context?: RequestUploadContext) {
  try {
    const prepared = await createGoogleDriveUploadSessions(
      files.map((file) => ({ name: file.name, mimeType: file.type, size: file.size })),
      context
    );
    if (!prepared.success) return { success: false as const, error: prepared.error || 'Unable to prepare file uploads.', files: [] as StatusAttachment[] };

    const uploadedFiles = await Promise.all(prepared.sessions.map(async (session, index) => {
      const file = files[index];
      const response = await fetch(session.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || session.mimeType },
        body: file,
      });
      if (!response.ok) throw new Error(`Google Drive could not upload “${file.name}”.`);
      const uploaded = await response.json() as { id?: string; name?: string; mimeType?: string; webViewLink?: string };
      if (!uploaded.id || !uploaded.name) throw new Error(`Google Drive did not return a file for “${file.name}”.`);
      return {
        id: uploaded.id,
        name: uploaded.name,
        mimeType: uploaded.mimeType || file.type || session.mimeType,
        url: uploaded.webViewLink || `https://drive.google.com/open?id=${uploaded.id}`,
      };
    }));
    return { success: true as const, files: uploadedFiles, folderId: prepared.folderId };
  } catch (error) {
    console.error('Direct Google Drive upload failed:', error);
    return { success: false as const, error: error instanceof Error ? error.message : 'File upload failed.', files: [] as StatusAttachment[], folderId: undefined };
  }
}
