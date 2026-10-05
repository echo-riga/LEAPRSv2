'use client';

import { useRef, useState } from 'react';
import { ArchiveOutlined, DeleteOutlined, RestoreOutlined } from '@mui/icons-material';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Tooltip, Typography } from '@mui/material';
import DeleteConfirmationDialog from '@/components/DeleteConfirmationDialog';
import ActionErrorDialog from '@/components/ActionErrorDialog';

type Result = { success: boolean; error?: string };
type Props = {
  label: string;
  archived: boolean;
  parentArchived?: boolean;
  onArchive: () => Promise<Result>;
  onRestore: () => Promise<Result>;
  onDelete: () => Promise<Result>;
  onChanged: () => Promise<void>;
  deleteMessage?: string;
};

export default function ArchiveActions({ label, archived, parentArchived, onArchive, onRestore, onDelete, onChanged, deleteMessage }: Props) {
  const [confirmation, setConfirmation] = useState<'archive' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const perform = async (action: () => Promise<Result>) => {
    const result = await action();
    if (!result.success) throw new Error(result.error || 'Unable to update this record.');
    await onChanged();
  };
  const change = async (action: () => Promise<Result>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try { await perform(action); setConfirmation(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to update this record.'); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <>
    {archived || parentArchived ? <>
      {!parentArchived && <Tooltip title="Restore"><IconButton size="small" color="info" disabled={busy} onClick={() => void change(onRestore)} aria-label={`Restore ${label}`}><RestoreOutlined fontSize="small" /></IconButton></Tooltip>}
      <Tooltip title="Delete Permanently"><IconButton size="small" color="error" disabled={busy} onClick={() => setConfirmation('delete')} aria-label={`Permanently delete ${label}`}><DeleteOutlined fontSize="small" /></IconButton></Tooltip>
    </> : <Tooltip title="Archive"><IconButton size="small" color="warning" disabled={busy} onClick={() => setConfirmation('archive')} aria-label={`Archive ${label}`}><ArchiveOutlined fontSize="small" /></IconButton></Tooltip>}
    <Dialog open={confirmation === 'archive'} onClose={() => { if (!inFlight.current) setConfirmation(null); }} maxWidth="xs" fullWidth slotProps={{ paper: { sx: { bgcolor: '#fafcfa', borderRadius: 2 } } }}>
      <DialogTitle sx={{ fontWeight: 800 }}>Archive?</DialogTitle>
      <DialogContent dividers><Typography>Are you sure you want to archive {label}?</Typography></DialogContent>
      <DialogActions sx={{ p: 2.5 }}><Button autoFocus disabled={busy} onClick={() => setConfirmation(null)}>Cancel</Button><Button color="warning" variant="contained" disabled={busy} onClick={() => void change(onArchive)}>{busy ? 'Archiving...' : 'Archive'}</Button></DialogActions>
    </Dialog>
    <DeleteConfirmationDialog open={confirmation === 'delete'} title="Delete Permanently?" confirmLabel="Delete Permanently" recordLabel={deleteMessage || `Are you sure you want to permanently delete ${label}? This cannot be undone.`} onClose={() => setConfirmation(null)} onConfirm={() => perform(onDelete)} />
    <ActionErrorDialog open={Boolean(error)} title="Unable to Update Record" message={error} onClose={() => setError('')} />
  </>;
}
