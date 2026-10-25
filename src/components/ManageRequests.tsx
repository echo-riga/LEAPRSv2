'use client';

import { useRef, useState } from 'react';
import { ArchiveOutlined, ChecklistOutlined, DeleteOutlined } from '@mui/icons-material';
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, MenuItem, Snackbar, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { bulkManageRequests, getManageRequestOptions } from '@/app/actions';
import ActionErrorDialog from '@/components/ActionErrorDialog';
import { formatWholeNumber } from '@/lib/amount-format';

type RequestOption = { id: number; requestorName: string | null; description: string; setting: string; createdAt: Date | string };
type Props = { capdevId: number; archived: boolean; parentArchived: boolean; onChanged: () => Promise<void> };
const formatDate = (value: Date | string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));

export default function ManageRequests({ capdevId, archived, parentArchived, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [records, setRecords] = useState<RequestOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const sequence = useRef(0);
  const inFlight = useRef(false);
  const action = archived || parentArchived ? 'delete' : 'archive';
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
      const result = await getManageRequestOptions(capdevId, archived);
      if (sequence.current !== current) return;
      if (!result.success) { setLoadError(result.error || 'Unable to load requests.'); return; }
      setRecords(result.records);
    } catch {
      if (sequence.current === current) setLoadError('Unable to load requests. Please try again.');
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
      const result = await bulkManageRequests({ capdevId, requestIds: selectedIds, action });
      if (!result.success) { setError(result.error || 'Unable to update selected requests.'); return; }
      setOpen(false);
      setConfirm(false);
      setSuccess(`${formatWholeNumber(selectedIds.length)} request${selectedIds.length === 1 ? '' : 's'} ${action === 'delete' ? 'deleted permanently' : 'archived'}.`);
      await onChanged();
    } catch {
      setError('Unable to update selected requests. Please try again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return <>
    <Tooltip title="Manage Requests"><IconButton aria-label="Manage Requests" onClick={() => void openManager()} disabled={busy} color="primary" sx={{ width: 40, height: 40, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}><ChecklistOutlined /></IconButton></Tooltip>
    <Dialog open={open && !confirm && !error} onClose={close} fullWidth maxWidth="sm" aria-labelledby="manage-requests-title">
      <DialogTitle id="manage-requests-title" sx={{ fontWeight: 800 }}>Manage Requests</DialogTitle>
      <DialogContent dividers><Stack spacing={2.5}>
        <TextField select fullWidth label="Action" value={action} disabled={loading || busy}><MenuItem value={action}>{label}</MenuItem></TextField>
        {loadError && <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void openManager()}>Retry</Button>}>{loadError}</Alert>}
        <Box>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>Requests</Typography>
            <Stack direction="row" spacing={1}>
              <Button size="small" disabled={loading || busy || !records.length} onClick={() => setSelectedIds(records.slice(0, 500).map(record => record.id))}>Select All</Button>
              <Button size="small" color="inherit" disabled={busy || !selectedIds.length} onClick={() => setSelectedIds([])}>Clear</Button>
            </Stack>
          </Stack>
          {records.length > 500 && <Typography variant="body2" color="text.secondary">Select up to 500 requests at a time.</Typography>}
          <Box sx={{ maxHeight: 300, overflowY: 'auto', pr: 1 }}>
            {loading ? <Typography color="text.secondary" sx={{ py: 2 }} role="status">Loading requests...</Typography> : records.map(record => <FormControlLabel key={record.id}
              control={<Checkbox disabled={busy || (selectedIds.length >= 500 && !selectedIds.includes(record.id))} checked={selectedIds.includes(record.id)} onChange={() => setSelectedIds(current => current.includes(record.id) ? current.filter(id => id !== record.id) : [...current, record.id])} />}
              label={<Stack><Typography variant="body2" sx={{ fontWeight: 700 }}>{record.requestorName || 'Requestor'}</Typography><Typography variant="caption" color="text.secondary">{record.description || 'Untitled request'} / {record.setting === 'internal' ? 'In-House' : 'External'} / Added {formatDate(record.createdAt)}</Typography></Stack>}
              sx={{ display: 'flex', width: '100%', m: 0, py: 0.5 }} />)}
            {!loading && !loadError && !records.length && <Typography color="text.secondary" sx={{ py: 2 }}>No eligible requests.</Typography>}
          </Box>
        </Box>
      </Stack></DialogContent>
      <DialogActions sx={{ p: 2.5 }}><Button color="inherit" disabled={busy} onClick={close}>Cancel</Button><Button variant="contained" color={action === 'delete' ? 'error' : 'warning'} startIcon={<ActionIcon />} disabled={loading || busy || !selectedIds.length || Boolean(loadError)} onClick={() => setConfirm(true)}>{label} ({formatWholeNumber(selectedIds.length)})</Button></DialogActions>
    </Dialog>
    <Dialog open={open && confirm && !error} onClose={() => { if (!inFlight.current) setConfirm(false); }} fullWidth maxWidth="sm" aria-labelledby="confirm-manage-requests-title">
      <DialogTitle id="confirm-manage-requests-title" sx={{ fontWeight: 800 }}>{action === 'delete' ? 'Delete selected requests permanently?' : 'Archive selected requests?'}</DialogTitle>
      <DialogContent dividers>
        <Typography sx={{ mb: 2 }}>{action === 'delete' ? 'Their progress, notifications, and managed attachments will also be deleted. This cannot be undone.' : 'Selected requests and their history will become read-only.'}</Typography>
        <Box sx={{ maxHeight: 300, overflowY: 'auto' }}>{selected.map(record => <Stack key={record.id} sx={{ mb: 1 }}><Typography variant="body2" sx={{ fontWeight: 700 }}>{record.requestorName || 'Requestor'}</Typography><Typography variant="caption" color="text.secondary">{record.description || 'Untitled request'} / Added {formatDate(record.createdAt)}</Typography></Stack>)}</Box>
      </DialogContent>
      <DialogActions sx={{ p: 2.5 }}><Button autoFocus color="inherit" disabled={busy} onClick={() => setConfirm(false)}>Cancel</Button><Button variant="contained" color={action === 'delete' ? 'error' : 'warning'} startIcon={<ActionIcon />} disabled={busy} onClick={() => void submit()}>{busy ? 'Saving...' : label}</Button></DialogActions>
    </Dialog>
    <ActionErrorDialog open={Boolean(error)} title="Unable to Manage Requests" message={error} onClose={() => setError('')} />
    <Snackbar open={Boolean(success)} autoHideDuration={6000} onClose={() => setSuccess('')}><Alert severity="success" onClose={() => setSuccess('')}>{success}</Alert></Snackbar>
  </>;
}
