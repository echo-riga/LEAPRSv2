import { after } from 'next/server';
import { processDriveCleanup } from '@/lib/drive-cleanup';

export function scheduleDriveCleanup() {
  try {
    after(async () => {
      try { await processDriveCleanup(10); }
      catch { console.error('Drive cleanup remains queued for retry.'); }
    });
  } catch {
    // CLI/tests have no request lifecycle. Durable jobs remain for the cron runner.
  }
}
