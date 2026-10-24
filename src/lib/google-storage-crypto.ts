import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

function key() {
  const secret = process.env.GOOGLE_STORAGE_ENCRYPTION_KEY || process.env.NEON_AUTH_COOKIE_SECRET;
  if (!secret || secret.length < 32) throw new Error('Google storage encryption is not configured.');
  return Buffer.from(hkdfSync('sha256', secret, 'leaprs', 'google-storage-v1', 32));
}

export function encryptGoogleSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decryptGoogleSecret(value: string) {
  const [version, iv, tag, data, extra] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !data || extra) throw new Error('Invalid Google storage credential.');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
