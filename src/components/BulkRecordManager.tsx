'use client';

import { useId, useRef, useState } from 'react';
import { ArchiveOutlined, ChecklistOutlined, DeleteOutlined } from '@mui/icons-material';
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, MenuItem, Snackbar, Stack, TextField, Tooltip, Typography } from '@mui/material';
import ActionErrorDialog from '@/components/ActionErrorDialog';
import { formatWholeNumber } from '@/lib/amount-format';

export type BulkOption = { id: string; label: string; detail: string };
type Props = { noun: 'Requests' | 'Users'; action: 'archive' | 'delete'; confirmationMessage: string; loadOptions: () => Promise<{ success: true; records: BulkOption[] } | { success: false; error?: string }>; perform: (ids: string[]) => Promise<{ success: boolean; error?: string }>; onChanged: () => Promise<void> };

export default function BulkRecordManager({ noun, action, confirmationMessage, loadOptions, perform, onChanged }: Props) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [records, setRecords] = useState<BulkOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const sequence = useRef(0);
  const inFlight = useRef(false);
  const label = action === 'delete' ? 'Delete permanently' : 'Archive';
  const ActionIcon = action === 'delete' ? DeleteOutlined : ArchiveOutlined;
  const selected = records.filter(record => selectedIds.includes(record.id));

  const openManager = async () => {
    const current = ++sequence.current;
    setRecords([]);
    setSelectedIds([]);
    setLoadError('');
    setError('');
    setConfirm(false);
    setOpen(true);
    setLoading(true);
    try {
      const result = await loadOptions();
      if (sequence.current !== current) return;
      if (!result.success) { setLoadError(result.error || `Unable to load ${noun.toLowerCase()}.`); return; }
      setRecords(result.records);
    } catch {
      if (sequence.current === current) setLoadError(`Unable to load ${noun.toLowerCase()}. Please try again.`);
    } finally {
      if (sequence.current === current) setLoading(false);
    }
  };
  const close = () => {
    if (inFlight.current) return;
    sequence.current += 1;
    setOpen(false);
    setConfirm(false);
  };
  const submit = async () => {
    if (inFlight.current || !selectedIds.length) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await perform(selectedIds);
      if (!result.success) { setError(result.error || `Unable to update selected ${noun.toLowerCase()}.`); return; }
      setOpen(false);
      setConfirm(false);
      setSuccess(`${formatWholeNumber(selectedIds.length)} ${noun === 'Users' ? 'user' : 'request'}${selectedIds.length === 1 ? '' : 's'} ${action === 'delete' ? 'deleted permanently' : 'archived'}.`);
      await onChanged();
    } catch {
      setError(`Unable to update selected ${noun.toLowerCase()}. Please try again.`);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return <>
    <Tooltip title={`Manage ${noun}`}><IconButton aria-label={`Manage ${noun}`} onClick={() => void openManager()} disabled={busy} color="primary" sx={{ width: 40, height: 40, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}><ChecklistOutlined /></IconButton></Tooltip>
    <Dialog open={open && !confirm && !error} onClose={close} fullWidth maxWidth="sm" aria-labelledby={titleId}>
      <DialogTitle id={titleId} sx={{ fontWeight: 800 }}>Manage {noun}</DialogTitle>
      <DialogContent dividers><Stack spacing={2.5}>
        <TextField select fullWidth label="Action" value={action} disabled={loading || busy}><MenuItem value={action}>{label}</MenuItem></TextField>
        {loadError && <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void openManager()}>Retry</Button>}>{loadError}</Alert>}
        <Box>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>{noun}</Typography>
            <Stack direction="row" spacing={1}>
              <Button size="small" disabled={loading || busy || !records.length} onClick={() => setSelectedIds(records.slice(0, 500).map(record => record.id))}>Select All</Button>
              <Button size="small" color="inherit" disabled={busy || !selectedIds.length} onClick={() => setSelectedIds([])}>Clear</Button>
            </Stack>
          </Stack>
          {records.length > 500 && <Typography variant="body2" color="text.secondary">Select up to 500 {noun.toLowerCase()} at a time.</Typography>}
          <Box sx={{ maxHeight: 300, overflowY: 'auto', pr: 1 }}>
            {loading ? <Typography color="text.secondary" sx={{ py: 2 }} role="status">Loading {noun.toLowerCase()}...</Typography> : records.map(record => <FormControlLabel key={record.id}
              control={<Checkbox disabled={busy || (selectedIds.length >= 500 && !selectedIds.includes(record.id))} checked={selectedIds.includes(record.id)} onChange={() => setSelectedIds(current => current.includes(record.id) ? current.filter(id => id !== record.id) : [...current, record.id])} />}
              label={<Stack><Typography variant="body2" sx={{ fontWeight: 700 }}>{record.label}</Typography><Typography variant="caption" color="text.secondary">{record.detail}</Typography></Stack>}
              sx={{ display: 'flex', width: '100%', m: 0, py: 0.5 }} />)}
            {!loading && !loadError && !records.length && <Typography color="text.secondary" sx={{ py: 2 }}>No eligible {noun.toLowerCase()}.</Typography>}
          </Box>
        </Box>
      </Stack></DialogContent>
      <DialogActions sx={{ p: 2.5 }}><Button color="inherit" disabled={busy} onClick={close}>Cancel</Button><Button variant="contained" color={action === 'delete' ? 'error' : 'warning'} startIcon={<ActionIcon />} disabled={loading || busy || !selectedIds.length || Boolean(loadError)} onClick={() => setConfirm(true)}>{label} ({formatWholeNumber(selectedIds.length)})</Button></DialogActions>
    </Dialog>
    <Dialog open={open && confirm && !error} onClose={() => { if (!inFlight.current) setConfirm(false); }} fullWidth maxWidth="sm" aria-labelledby={`${titleId}-confirm`}>
      <DialogTitle id={`${titleId}-confirm`} sx={{ fontWeight: 800 }}>{action === 'delete' ? `Delete selected ${noun.toLowerCase()} permanently?` : `Archive selected ${noun.toLowerCase()}?`}</DialogTitle>
      <DialogContent dividers>
        <Typography sx={{ mb: 2 }}>{confirmationMessage}</Typography>
        <Box sx={{ maxHeight: 300, overflowY: 'auto' }}>{selected.map(record => <Stack key={record.id} sx={{ mb: 1 }}><Typography variant="body2" sx={{ fontWeight: 700 }}>{record.label}</Typography><Typography variant="caption" color="text.secondary">{record.detail}</Typography></Stack>)}</Box>
      </DialogContent>
      <DialogActions sx={{ p: 2.5 }}><Button autoFocus color="inherit" disabled={busy} onClick={() => setConfirm(false)}>Cancel</Button><Button variant="contained" color={action === 'delete' ? 'error' : 'warning'} startIcon={<ActionIcon />} disabled={busy} onClick={() => void submit()}>{busy ? 'Saving...' : label}</Button></DialogActions>
    </Dialog>
    <ActionErrorDialog open={Boolean(error)} title={`Unable to Manage ${noun}`} message={error} onClose={() => setError('')} />
    <Snackbar open={Boolean(success)} autoHideDuration={6000} onClose={() => setSuccess('')}><Alert severity="success" onClose={() => setSuccess('')}>{success}</Alert></Snackbar>
  </>;
}
