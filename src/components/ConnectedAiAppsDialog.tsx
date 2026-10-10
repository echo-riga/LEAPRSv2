'use client';

import { useState } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Skeleton, Stack, Typography } from '@mui/material';
import { ChevronRight } from '@mui/icons-material';
import { getConnectedAiApps, revokeAiApp } from '@/app/mcp-connection-actions';
import ActionErrorDialog from '@/components/ActionErrorDialog';

type App = { clientId: string; name: string; origins: string[] };

export default function ConnectedAiAppsDialog() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [apps, setApps] = useState<App[]>([]);
  const [selected, setSelected] = useState<App | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const show = async () => {
    setOpen(true); setLoading(true); setError('');
    try {
      const result = await getConnectedAiApps();
      if (!result.success) { setError(result.error); return; }
      setApps(result.apps);
    } catch { setError('Unable to load connected apps.'); }
    finally { setLoading(false); }
  };
  const revoke = async () => {
    if (!selected || saving) return;
    setSaving(true);
    try {
      const result = await revokeAiApp(selected.clientId);
      if (!result.success) { setError(result.error); return; }
      setApps(previous => previous.filter(app => app.clientId !== selected.clientId));
      setSelected(null);
    } catch { setError('Unable to revoke app access.'); }
    finally { setSaving(false); }
  };
  return <>
    <Button endIcon={<ChevronRight />} onClick={() => void show()} sx={{ p: 0, fontWeight: 700 }}>Connected AI Apps</Button>
    <Dialog open={open} onClose={() => { if (!saving) setOpen(false); }} fullWidth maxWidth="sm" aria-labelledby="connected-ai-apps-title">
      <DialogTitle id="connected-ai-apps-title" sx={{ fontWeight: 800 }}>Connected AI Apps</DialogTitle>
      <DialogContent dividers>
        {loading ? <Skeleton height={80} /> : !apps.length ? <Typography color="text.secondary">No connected apps.</Typography> :
          <Stack spacing={2}>{apps.map(app => <Box key={app.clientId} sx={{ borderBottom: 1, borderColor: 'divider', pb: 2 }}>
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{app.name}</Typography>
                {app.origins.map(origin => <Typography key={origin} variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{origin}</Typography>)}
              </Box>
              <Button color="error" onClick={() => setSelected(app)} sx={{ flexShrink: 0 }}>Revoke access</Button>
            </Stack>
          </Box>)}</Stack>}
      </DialogContent>
      <DialogActions sx={{ p: 2 }}><Button color="inherit" onClick={() => setOpen(false)} disabled={saving}>Close</Button></DialogActions>
    </Dialog>
    <Dialog open={Boolean(selected)} onClose={() => { if (!saving) setSelected(null); }} fullWidth maxWidth="xs" aria-labelledby="revoke-ai-app-title">
      <DialogTitle id="revoke-ai-app-title" sx={{ fontWeight: 800 }}>Revoke access?</DialogTitle>
      <DialogContent dividers><Typography>{selected?.name} will need your approval to connect again.</Typography></DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button color="inherit" disabled={saving} onClick={() => setSelected(null)}>Cancel</Button>
        <Button variant="contained" color="error" disabled={saving} onClick={() => void revoke()}>{saving ? 'Revoking...' : 'Revoke access'}</Button>
      </DialogActions>
    </Dialog>
    <ActionErrorDialog open={Boolean(error)} title="Connected AI Apps" message={error} onClose={() => setError('')} />
  </>;
}
