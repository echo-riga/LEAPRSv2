'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';

export default function GoogleStorageSettings() {
  const [owner, setOwner] = useState<{ email: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [configured, setConfigured] = useState(false);
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/google-storage', { cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to load the storage owner. Please try again.');
      const result = await response.json();
      setOwner(result.owner);
      setConfigured(result.configured);
      setError('');
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to load storage settings.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void Promise.resolve().then(async () => {
      const status = new URLSearchParams(window.location.search).get('storage');
      if (status === 'connected') setNotice('Storage account changed.');
      if (status === 'cancelled') setNotice('Account change cancelled.');
      await load();
      if (status === 'connection_failed') setError('Unable to change account. Please try again and allow the requested permissions.');
      if (status === 'configuration_error') setError('Unable to connect to Google. Please check the connection settings.');
    });
  }, [load]);

  if (loading) return <CircularProgress size={24} aria-label="Loading Google storage" />;
  return <Stack spacing={2} sx={{ mt: 2 }}>
    {notice && <Alert severity="info" onClose={() => setNotice('')}>{notice}</Alert>}
    {error && <Alert severity="error">{error}<Button size="small" onClick={() => void load()}>Retry</Button></Alert>}
    <Box>
      <Typography variant="body2" color="text.secondary">Current storage owner</Typography>
      <Typography sx={{ mt: 0.5, fontWeight: 600, overflowWrap: 'anywhere' }}>{owner ? owner.email || 'Owner unavailable' : 'No account connected'}</Typography>
    </Box>
    <Box component="form" method="post" action="/api/google-storage/connect" onSubmit={() => setChanging(true)}>
      <Button type="submit" variant="contained" disabled={changing || !configured}>{changing ? 'Connecting...' : 'Change account'}</Button>
    </Box>
    {!configured && <Alert severity="warning">Google connection is not configured.</Alert>}
  </Stack>;
}
