'use client';

import React, { useState } from 'react';
import { Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, FormGroup, Skeleton, Stack, Typography } from '@mui/material';
import { ChevronRight, MailOutlined } from '@mui/icons-material';
import { getEmailNotificationPreferences, saveEmailNotificationPreferences } from '@/app/actions';
import { DEFAULT_EMAIL_TYPES, NOTIFICATION_FILTERS, type NotificationFilterType } from '@/lib/notification-types';
import ActionErrorDialog from '@/components/ActionErrorDialog';

export default function EmailNotificationSettings() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<NotificationFilterType[]>(DEFAULT_EMAIL_TYPES);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const all = selected.length === NOTIFICATION_FILTERS.length;

  const handleOpen = async () => {
    setOpen(true); setLoading(true); setLoaded(false); setError('');
    try {
      const result = await getEmailNotificationPreferences();
      if (!result.success) { setError(result.error); return; }
      setSelected(result.enabledTypes); setLoaded(true);
    } catch { setError('Unable to load email preferences.'); }
    finally { setLoading(false); }
  };
  const save = async () => {
    if (!loaded || saving) return;
    setSaving(true);
    try {
      const result = await saveEmailNotificationPreferences(selected);
      if (!result.success) { setError(result.error); return; }
      setOpen(false);
    } catch { setError('Unable to save email preferences.'); }
    finally { setSaving(false); }
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
        Configure Email Notifications
      </Button>
      <Dialog open={open} onClose={() => { if (!saving) setOpen(false); }} fullWidth maxWidth="sm" aria-labelledby="email-notification-settings-title">
        <DialogTitle id="email-notification-settings-title" sx={{ fontWeight: 800 }}>Email Notifications</DialogTitle>
        <DialogContent dividers sx={{ py: 3 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start', mb: 2 }}>
            <MailOutlined color="primary" sx={{ mt: 0.25, flexShrink: 0 }} />
            <Typography variant="body2" color="text.secondary">Choose which notifications you receive at your account email.</Typography>
          </Stack>
          {loading ? <Stack spacing={1}>{NOTIFICATION_FILTERS.map(item => <Skeleton key={item.type} height={42} />)}</Stack> :
            <FormGroup>
              <FormControlLabel label="All" control={<Checkbox checked={all} indeterminate={!all && selected.length > 0}
                disabled={!loaded || saving} onChange={(_, checked) => setSelected(checked ? [...DEFAULT_EMAIL_TYPES] : [])} />} />
              {NOTIFICATION_FILTERS.map(item => <FormControlLabel key={item.type} label={item.label} control={<Checkbox
                disabled={!loaded || saving} checked={selected.includes(item.type)} onChange={(_, checked) =>
                  setSelected(previous => checked ? [...previous, item.type] : previous.filter(type => type !== item.type))} />} />)}
            </FormGroup>}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button color="inherit" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={!loaded || loading || saving} onClick={() => void save()}>{saving ? 'Saving...' : 'Save'}</Button>
        </DialogActions>
      </Dialog>
      <ActionErrorDialog open={Boolean(error)} title="Email Notifications" message={error} onClose={() => setError('')} />
    </>
  );
}
