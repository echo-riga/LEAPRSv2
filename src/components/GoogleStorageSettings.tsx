'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, DialogActions, DialogContent, Stack, Typography } from '@mui/material';
import { useGoogleStorageMigration } from '@/components/GoogleStorageMigration';

export default function GoogleStorageSettings({ onClose }: { onClose: () => void }) {
  const { migration } = useGoogleStorageMigration();
  const transferring = migration?.status === 'running';
  const [owner, setOwner] = useState<{ email: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [configured, setConfigured] = useState(false);
  const [cleanup, setCleanup] = useState<Record<string, number>>({});
  const [cleaning, setCleaning] = useState(false);
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/google-storage', { cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to load the storage owner. Please try again.');
      const result = await response.json();
      setOwner(result.owner);
      setConfigured(result.configured);
      setCleanup(result.cleanup || {});
      setError('');
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to load storage settings.'); }
    finally { setLoading(false); }
  }, []);
  const retryCleanup = async () => {
    setCleaning(true);
    try {
      const response = await fetch('/api/google-storage/cleanup', { method: 'POST' });
      if (!response.ok) throw new Error('Unable to retry file cleanup.');
      await load();
    } catch { setError('Unable to retry file cleanup. Please try again.'); }
    finally { setCleaning(false); }
  };
  useEffect(() => {
    void Promise.resolve().then(async () => {
      const status = new URLSearchParams(window.location.search).get('storage');
      if (status === 'connected') setNotice('Storage connection updated.');
      if (status === 'cancelled') setNotice('Account change cancelled.');
      await load();
      if (status === 'connection_failed') setError('Unable to change account. Please try again and allow the requested permissions.');
      if (status === 'configuration_error') setError('Unable to connect to Google. Please check the connection settings.');
    });
  }, [load]);

  return <>
    <DialogContent dividers sx={{ py: 4, textAlign: 'center' }}>
      {loading ? <CircularProgress size={24} aria-label="Loading Google storage" /> : <Stack spacing={2}>
        {notice && <Alert severity="info" onClose={() => setNotice('')}>{notice}</Alert>}
        {error && <Alert severity="error">{error}<Button size="small" onClick={() => void load()}>Retry</Button></Alert>}
        <Box>
          <Typography variant="body2" color="text.secondary">Current storage owner</Typography>
          <Typography sx={{ mt: 0.5, fontWeight: 600, overflowWrap: 'anywhere' }}>{owner ? owner.email || 'Owner unavailable' : 'No account connected'}</Typography>
        </Box>
        {!configured && <Alert severity="warning">Google connection is not configured.</Alert>}
        {cleanup.failed > 0 && <Alert severity="warning">{cleanup.failed.toLocaleString()} file cleanup tasks need retry. Check the storage connection if failures continue.<Button size="small" disabled={cleaning} onClick={() => void retryCleanup()}>{cleaning ? 'Retrying…' : 'Retry cleanup'}</Button></Alert>}
      </Stack>}
    </DialogContent>
    <DialogActions sx={{ p: 2, gap: 1 }}>
      <Button color="inherit" disabled={changing} onClick={onClose}>Close</Button>
      <Box component="form" method="post" action="/api/google-storage/connect" onSubmit={() => setChanging(true)}>
        <Button type="submit" variant="contained" disabled={loading || changing || !configured || transferring}>{changing ? 'Connecting...' : migration?.status === 'failed' ? 'Reconnect or change account' : 'Change account'}</Button>
      </Box>
    </DialogActions>
  </>;
}
