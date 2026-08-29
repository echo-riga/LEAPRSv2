'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Add as AddIcon,
  Assignment as RequestIcon,
  AttachFile as AttachFileIcon,
  CheckCircle as CheckCircleIcon,
  Payments as PaymentsIcon,
} from '@mui/icons-material';
import {
  Alert, Box, Button, Card, CardContent, Checkbox, Chip, CircularProgress, Container, Dialog, DialogActions,
  DialogContent, DialogTitle, Fab, FormControlLabel, Stack, TextField, Typography,
} from '@mui/material';
import { authClient } from '@/lib/auth/client';
import { createRequestStatusUpdate, getRequestById, getRequestStatusUpdates, uploadFilesToGoogleDrive, type StatusAttachment } from '@/app/actions';

type RequestSummary = { id: number; capdevId: number; setting: string; requestedBudget: string };
type StatusUpdate = { id: number; requestId: number; authorName: string | null; statusUpdate: string; remarks: string | null; files: unknown; markAsComplete: boolean; subtractsRequestedAmount: boolean; createdAt: Date | string };
type StatusForm = { statusUpdate: string; remarks: string; files: File[]; markAsComplete: boolean; subtractsRequestedAmount: boolean };

const EMPTY_FORM: StatusForm = { statusUpdate: '', remarks: '', files: [], markAsComplete: false, subtractsRequestedAmount: false };
const formatDateTime = (value: Date | string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));

// Single-path SVG connectors: one solid shape for the line + arrowhead together,
// avoids the anti-aliasing / dashed-look artifacts you get from combining a
// border-box with a separate icon glyph.
function ConnectorDown() {
  return (
    <Box sx={{ display: { xs: 'none', md: 'flex' }, position: 'absolute', bottom: -25, right: 20, color: 'primary.main', zIndex: 1 }}>
      <svg width="16" height="26" viewBox="0 0 16 26" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 0V19" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <path d="M8 25L2 17H14L8 25Z" fill="currentColor" />
      </svg>
    </Box>
  );
}

function ConnectorRight() {
  return (
    <Box sx={{ display: { xs: 'none', md: 'flex' }, position: 'absolute', top: '50%', right: -24, transform: 'translateY(-50%)', color: 'primary.main', zIndex: 1 }}>
      <svg width="24" height="16" viewBox="0 0 24 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M0 8H17" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <path d="M24 8L16 2V14L24 8Z" fill="currentColor" />
      </svg>
    </Box>
  );
}

function ConnectorLeft() {
  return (
    <Box sx={{ display: { xs: 'none', md: 'flex' }, position: 'absolute', top: '50%', left: -24, transform: 'translateY(-50%)', color: 'primary.main', zIndex: 1 }}>
      <svg width="24" height="16" viewBox="0 0 24 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M24 8H7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <path d="M0 8L8 2V14L0 8Z" fill="currentColor" />
      </svg>
    </Box>
  );
}

export default function StatusTimelinePage({ capdevId, requestId }: { capdevId: number; requestId: number }) {
  const session = authClient.useSession();
  const [request, setRequest] = useState<RequestSummary | null>(null);
  const [updates, setUpdates] = useState<StatusUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<StatusForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    const [requestData, updateData] = await Promise.all([getRequestById(requestId), getRequestStatusUpdates(requestId)]);
    if (requestData?.capdevId === capdevId) {
      setRequest({ id: requestData.id, capdevId: requestData.capdevId, setting: requestData.setting, requestedBudget: String(requestData.requestedBudget) });
      setUpdates(updateData.map((update) => ({ ...update, files: Array.isArray(update.files) ? update.files : [] })));
    }
    setLoading(false);
  }, [capdevId, requestId]);

  useEffect(() => { void Promise.resolve().then(loadData); }, [loadData]);

  const isComplete = useMemo(() => updates.some((update) => update.markAsComplete), [updates]);
  const hasDeductedBudget = useMemo(() => updates.some((update) => update.subtractsRequestedAmount), [updates]);
  const openAdd = () => { setError(''); setForm(EMPTY_FORM); setDialogOpen(true); };
  const addSelectedFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    setForm((current) => {
      const files = [...current.files, ...selectedFiles];
      return { ...current, files: files.filter((file, index) => files.findIndex((candidate) => candidate.name === file.name && candidate.size === file.size && candidate.lastModified === file.lastModified) === index) };
    });
    event.target.value = '';
  };
  const removeSelectedFile = (file: File) => setForm((current) => ({ ...current, files: current.files.filter((candidate) => candidate !== file) }));
  const saveUpdate = async () => {
    if (!session.data || !form.statusUpdate.trim()) return;
    setSaving(true);
    setError('');
    const uploadData = new FormData();
    form.files.forEach((file) => uploadData.append('files', file));
    const uploaded = await uploadFilesToGoogleDrive(uploadData);
    if (!uploaded.success) { setError(uploaded.error || 'Unable to upload the selected files.'); setSaving(false); return; }
    const result = await createRequestStatusUpdate({ requestId, userId: session.data.user.id, statusUpdate: form.statusUpdate.trim(), remarks: form.remarks.trim(), files: uploaded.files, markAsComplete: form.markAsComplete, subtractsRequestedAmount: form.subtractsRequestedAmount });
    if (result.success) { setDialogOpen(false); await loadData(); } else { setError(result.error || 'Unable to save this status update.'); }
    setSaving(false);
  };

  if (session.isPending || loading) return <Box sx={{ display: 'flex', minHeight: 'calc(100vh - 72px)', alignItems: 'center', justifyContent: 'center' }}><CircularProgress color="primary" /></Box>;
  if (!session.data) return null;
  if (!request) return <Box sx={{ py: 8, textAlign: 'center' }}><Typography variant="h6" color="text.secondary">Request not found.</Typography></Box>;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 72px)' }}>
      <Container maxWidth={false} sx={{ p: 0, width: '100%', flexGrow: 1 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', mb: 3 }}>
          <Box><Typography variant="h4" sx={{ fontWeight: '800', color: 'text.primary', letterSpacing: '-1px' }}>Request Status</Typography><Typography variant="body2" color="text.secondary">Request #{request.id} · {request.setting === 'internal' ? 'Internal' : 'External'} · ₱{request.requestedBudget}</Typography></Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Chip label={isComplete ? 'Complete' : 'In progress'} color={isComplete ? 'success' : 'primary'} size="small" sx={{ fontWeight: 700 }} />{hasDeductedBudget && <Chip label="Budget deducted" color="success" variant="outlined" size="small" />}</Stack>
        </Stack>

        {updates.length === 0 ? <Card variant="outlined" sx={{ borderRadius: 2, minHeight: 300, display: 'grid', placeItems: 'center' }}><Stack spacing={1} sx={{ alignItems: 'center', color: 'text.secondary' }}><RequestIcon sx={{ fontSize: 42 }} /><Typography>No status updates yet</Typography></Stack></Card> :
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }, gap: 3, pb: 12 }}>{updates.map((update, index) => {
            const row = Math.floor(index / 3);
            const column = row % 2 === 0 ? (index % 3) + 1 : 3 - (index % 3);
            const isRowEnd = (index + 1) % 3 === 0;
            const files = Array.isArray(update.files) ? update.files.filter((file): file is StatusAttachment => typeof file === 'object' && file !== null && 'name' in file && 'url' in file) : [];
            return <Box key={update.id} sx={{ gridColumn: { md: column }, gridRow: { md: row + 1 }, position: 'relative' }}>
              <Card variant="outlined" sx={{ borderRadius: 2, bgcolor: '#ffffff', height: '100%', minHeight: 210, transition: 'all 0.2s', '&:hover': { boxShadow: '0 4px 12px rgba(0,0,0,0.04)', borderColor: 'primary.main' } }}><CardContent sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column' }}>
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start', mb: 2 }}><Box sx={{ bgcolor: 'rgba(46, 125, 50, 0.08)', p: 1.1, borderRadius: 2, display: 'flex' }}><RequestIcon color="primary" /></Box><Box sx={{ flexGrow: 1 }}><Typography variant="h6" sx={{ fontWeight: '700', lineHeight: 1.2 }}>Update {index + 1}</Typography><Typography variant="body2" color="text.secondary">{update.authorName || 'Staff member'} · {formatDateTime(update.createdAt)}</Typography></Box></Stack>
                <Typography variant="body1" sx={{ fontWeight: 600, mb: update.remarks ? 1 : 0 }}>{update.statusUpdate}</Typography>{update.remarks && <Typography variant="body2" color="text.secondary">{update.remarks}</Typography>}
                {files.length > 0 && <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mt: 1.5, flexWrap: 'wrap' }}><AttachFileIcon fontSize="small" color="action" />{files.map((file) => <Button key={file.id} component="a" href={file.url} target="_blank" rel="noreferrer" size="small" sx={{ minWidth: 0, px: 0.5, textTransform: 'none' }}>{file.name}</Button>)}</Stack>}
                <Stack direction="row" spacing={1} sx={{ mt: 'auto', pt: 2, flexWrap: 'wrap', rowGap: 0.5 }}>{update.markAsComplete && <Chip icon={<CheckCircleIcon />} label="Completed" color="success" size="small" />}{update.subtractsRequestedAmount && <Chip icon={<PaymentsIcon />} label="Budget deducted" color="success" variant="outlined" size="small" />}</Stack>
              </CardContent></Card>
              {index < updates.length - 1 && (isRowEnd ? <ConnectorDown /> : row % 2 === 0 ? <ConnectorRight /> : <ConnectorLeft />)}
            </Box>;
          })}</Box>}
      </Container>

      {!isComplete && <Fab variant="extended" color="primary" onClick={openAdd} sx={{ position: 'fixed', right: 24, bottom: 24, zIndex: 1100, px: 2.5, boxShadow: '0 4px 14px rgba(46, 125, 50, 0.4)' }}><AddIcon sx={{ mr: 1 }} />Add Status</Fab>}

      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} fullWidth maxWidth="sm"><DialogTitle sx={{ fontWeight: 800 }}>Add Status Update</DialogTitle><DialogContent dividers><Stack spacing={2.5} sx={{ pt: 0.5 }}>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField required autoFocus fullWidth multiline minRows={2} label="Status Update" value={form.statusUpdate} onChange={(event) => setForm((current) => ({ ...current, statusUpdate: event.target.value }))} />
        <TextField fullWidth multiline minRows={2} label="Remarks" value={form.remarks} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))} />
        <Button component="label" variant="outlined" startIcon={<AttachFileIcon />}>Attach Files<input hidden type="file" multiple onChange={addSelectedFiles} /></Button>
        {form.files.length > 0 && <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>{form.files.map((file) => <Chip key={`${file.name}-${file.lastModified}-${file.size}`} label={file.name} size="small" onDelete={() => removeSelectedFile(file)} />)}</Stack>}
        <FormControlLabel control={<Checkbox checked={form.markAsComplete} onChange={(event) => setForm((current) => ({ ...current, markAsComplete: event.target.checked }))} />} label="Mark this request as complete" />
        <FormControlLabel control={<Checkbox checked={form.subtractsRequestedAmount} onChange={(event) => setForm((current) => ({ ...current, subtractsRequestedAmount: event.target.checked }))} />} label="Subtract the requested amount from the CapDev budget" />
      </Stack></DialogContent><DialogActions sx={{ p: 2.5 }}><Button onClick={() => setDialogOpen(false)} disabled={saving} color="inherit">Cancel</Button><Button variant="contained" onClick={saveUpdate} disabled={saving || !form.statusUpdate.trim()}>{saving ? 'Saving' : 'Save Status'}</Button></DialogActions></Dialog>
    </Box>
  );
}
