'use client';

import { useRef, useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import ActionErrorDialog from '@/components/ActionErrorDialog';

type Props = {
  open: boolean;
  title: string;
  recordLabel: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
};

export default function DeleteConfirmationDialog({ open, title, recordLabel, confirmLabel = 'Delete', onClose, onConfirm }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);

  const confirm = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to delete this record.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return <>
    <Dialog open={open && !error} onClose={() => { if (!inFlight.current) onClose(); }} maxWidth="xs" fullWidth aria-labelledby="delete-confirmation-title" slotProps={{ paper: { sx: { bgcolor: '#fafcfa', borderRadius: 2 } } }}>
      <DialogTitle id="delete-confirmation-title" sx={{ fontWeight: 800 }}>{title}</DialogTitle>
      <DialogContent dividers><Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{recordLabel}</Typography></DialogContent>
      <DialogActions sx={{ p: 2.5 }}>
        <Button onClick={onClose} disabled={busy} autoFocus>Cancel</Button>
        <Button onClick={() => void confirm()} color="error" variant="contained" disabled={busy}>{busy ? 'Deleting...' : confirmLabel}</Button>
      </DialogActions>
    </Dialog>
    <ActionErrorDialog open={Boolean(error)} title="Unable to Delete" message={error} onClose={() => setError('')} />
  </>;
}
