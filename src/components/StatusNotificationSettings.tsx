'use client';

import React, { useState } from 'react';
import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, Stack, TextField, Typography, Skeleton,
} from '@mui/material';
import { Add, Remove, ChevronRight, NotificationsActiveOutlined } from '@mui/icons-material';

import { getRequestInactivitySettings, saveRequestInactivitySettings } from '@/app/actions';
import ActionErrorDialog from '@/components/ActionErrorDialog';

export default function StatusNotificationSettings() {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(7);
  const [draftDays, setDraftDays] = useState('7');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const value = Number(draftDays);
  const valid = draftDays.trim() !== '' && Number.isInteger(value) && value >= 1 && value <= 365;

  const handleOpen = async () => {
    setOpen(true);
    setLoading(true);
    setLoaded(false);
    try {
      const result = await getRequestInactivitySettings();
      if (!result.success) { setError(result.error || 'Unable to load notification settings.'); return; }
      setDays(result.days);
      setDraftDays(String(result.days));
      setLoaded(true);
    } catch { setError('Unable to load notification settings.'); }
    finally { setLoading(false); }
  };

  const handleSave = async () => {
    if (!valid || !loaded) return;
    setSaving(true);
    try {
      const result = await saveRequestInactivitySettings(value);
      if (!result.success) { setError(result.error || 'Unable to save notification settings.'); return; }
      setDays(value);
      setOpen(false);
      window.dispatchEvent(new Event('leaprs:reminder-settings-changed'));
    } catch { setError('Unable to save notification settings.'); }
    finally { setSaving(false); }
  };

  const changeDays = (change: number) => {
    setDraftDays(String(Math.min(365, Math.max(1, (valid ? value : days) + change))));
  };

  return (
    <>
      <Button
        variant="text"
        color="primary"
        endIcon={<ChevronRight />}
        onClick={() => void handleOpen()}
        sx={{ p: 0, minWidth: 0, fontWeight: 700, '&:hover': { bgcolor: 'transparent', color: 'primary.dark' } }}
      >
        Configure Inactivity Reminders
      </Button>
      <Dialog open={open} onClose={() => { if (!saving) setOpen(false); }} fullWidth maxWidth="sm" aria-labelledby="status-notification-settings-title">
        <DialogTitle id="status-notification-settings-title" sx={{ fontWeight: 800 }}>
          Inactivity Reminders
        </DialogTitle>
        <DialogContent dividers sx={{ py: 3 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start', mb: 3 }}>
            <NotificationsActiveOutlined color="primary" sx={{ mt: 0.25, flexShrink: 0 }} />
            <Typography variant="body2" color="text.secondary">
              Set when to remind admins and people involved in a request if there are no new status updates.
            </Typography>
          </Stack>
          {loading ? <Skeleton variant="rounded" height={56} /> : <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
            <IconButton aria-label="Decrease notification days" onClick={() => changeDays(-1)} disabled={saving || !loaded || (valid && value === 1)} color="primary" sx={{ width: 48, height: 56 }}>
              <Remove />
            </IconButton>
            <TextField
              label="Days Without a Status Update"
              type="number"
              disabled={saving || !loaded}
              value={draftDays}
              onChange={(event) => setDraftDays(event.target.value)}
              error={!valid}
              helperText={!valid ? 'Enter a whole number from 1 to 365.' : undefined}
              fullWidth
              slotProps={{ htmlInput: { min: 1, max: 365, step: 1 } }}
            />
            <IconButton aria-label="Increase notification days" onClick={() => changeDays(1)} disabled={saving || !loaded || (valid && value === 365)} color="primary" sx={{ width: 48, height: 56 }}>
              <Add />
            </IconButton>
          </Stack>}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button color="inherit" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={!valid || !loaded || loading || saving} onClick={() => void handleSave()}>{saving ? 'Saving...' : 'Save'}</Button>
        </DialogActions>
      </Dialog>
      <ActionErrorDialog open={Boolean(error)} title="Inactivity Reminders" message={error} onClose={() => setError('')} />
    </>
  );
}
