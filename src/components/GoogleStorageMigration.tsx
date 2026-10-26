'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Alert, Box, Button, LinearProgress, Stack, Typography } from '@mui/material';

type Migration = { id: string; status: string; phase: string; error: string | null; total: number; completed: number };
const MigrationContext = createContext<{ migration: Migration | null; retry: () => void; error: string }>({ migration: null, retry: () => {}, error: '' });
export const useGoogleStorageMigration = () => useContext(MigrationContext);

export default function GoogleStorageMigration({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const [migration, setMigration] = useState<Migration | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let retryRequested = attempt > 0;
    const run = async () => {
      let delay = 15000;
      try {
        let response = await fetch('/api/google-storage/migration', { cache: 'no-store' });
        if (!response.ok) throw new Error('Unable to check the file transfer.');
        let data = await response.json() as { migration: Migration | null };
        if (!disposed && data.migration && (data.migration.status === 'running' || retryRequested)) {
          retryRequested = false;
          response = await fetch('/api/google-storage/migration', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ retry: data.migration.status === 'failed' }) });
          if (!response.ok) throw new Error('Unable to continue the file transfer. It will retry automatically.');
          data = await response.json();
        }
        if (!disposed) {
          setMigration(data.migration);
          setError('');
          if (data.migration?.status === 'running') delay = 500;
        }
      } catch (error) {
        if (!disposed) setError(error instanceof Error ? error.message : 'Unable to continue the file transfer.');
      } finally {
        if (!disposed) timer = setTimeout(run, delay);
      }
    };
    void run();
    return () => { disposed = true; clearTimeout(timer); };
  }, [enabled, attempt]);
  const value = { migration: enabled ? migration : null, error: enabled ? error : '', retry: () => setAttempt(value => value + 1) };
  return <MigrationContext.Provider value={value}>
    {children}
    {enabled && migration && migration.status !== 'completed' && <Box sx={{ position: 'fixed', bottom: 20, left: 20, zIndex: 1400, width: { xs: 'calc(100% - 40px)', sm: 340 }, p: 2, bgcolor: 'background.paper', borderRadius: 2, boxShadow: 6 }}>
      <GoogleStorageMigrationProgress />
    </Box>}
  </MigrationContext.Provider>;
}

export function GoogleStorageMigrationProgress() {
  const { migration, retry, error } = useGoogleStorageMigration();
  if (!migration) return null;
  const discovering = migration.phase === 'discovering';
  const finished = migration.status === 'completed';
  return <Stack spacing={1} aria-live="polite" sx={{ textAlign: 'left' }}>
    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{finished ? 'Files transferred' : 'Transferring Drive storage'}</Typography>
    {!finished && <LinearProgress aria-label="Drive storage transfer" variant={discovering ? 'indeterminate' : 'determinate'}
      value={Math.min(99, migration.total ? migration.completed / migration.total * 100 : 0)} />}
    <Typography variant="body2" color="text.secondary">{discovering ? 'Finding files and folders…' : `${migration.completed.toLocaleString()} of ${migration.total.toLocaleString()} files and folders transferred${!finished && migration.phase === 'verifying' ? ' · Checking for remaining files…' : ''}`}</Typography>
    {!finished && <Typography variant="caption" color="text.secondary">Continues while an Admin has the portal open. You can keep working.</Typography>}
    {(migration.error || error) && <Alert severity="error">{migration.error || error}<Button size="small" onClick={retry}>Retry transfer</Button></Alert>}
  </Stack>;
}
