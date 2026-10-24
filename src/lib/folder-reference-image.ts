export const MAX_REFERENCE_IMAGE_BYTES = 4 * 1024 * 1024;

export async function validateFolderReferenceImage(value: FormDataEntryValue | null): Promise<File> {
  if (!(value instanceof File) || !value.size || value.size > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error('Choose one PDF, JPG, PNG, or WebP file up to 4 MB.');
  }
  const bytes = new Uint8Array(await value.slice(0, 12).arrayBuffer());
  const matches = value.type === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : value.type === 'image/png' ? [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
    : value.type === 'image/webp' ? String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
    : value.type === 'application/pdf' ? String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-'
    : false;
  if (!matches) throw new Error('Choose a valid PDF, JPG, PNG, or WebP file.');
  return value;
}
