'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Add as AddIcon,
  AttachFile as AttachFileIcon,
  Assignment as RequestIcon,
  CalendarMonth as CalendarIcon,
  ChevronRight as ChevronRightIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import {
  Alert, Autocomplete, Box, Button, Card, CardContent, Chip, CircularProgress, Container, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, Fab, Grid, InputAdornment, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth/client';
import DateField from '@/components/DateField';
import {
  createRequest, deleteRequest, getCapdevById, getRequestFieldDefinitions, getRequestsByCapdev, updateRequest, uploadFilesToGoogleDrive, type StatusAttachment,
} from '@/app/actions';

type RequestRecord = {
  id: number;
  capdevId: number;
  userId: string;
  requestorName: string | null;
  createdAt: Date | string;
  isComplete: boolean;
  setting: string;
  requestedBudget: string;
  startDate: string;
  endDate: string;
  additionalInfo: Record<string, unknown>;
};
type DynamicField = { id: number; name: string; type: string; options: string[] | null; isRequired: boolean; width: string; placeholder: string | null };
type RequestForm = Pick<RequestRecord, 'setting' | 'requestedBudget' | 'startDate' | 'endDate' | 'additionalInfo'>;
type CapdevSummary = { id: number; aipCode: string; department: string };

const EMPTY_FORM: RequestForm = { setting: 'internal', requestedBudget: '', startDate: '', endDate: '', additionalInfo: {} };
const dateValue = (value: string) => value ? value.slice(0, 10) : '';
const formatCurrency = (value: string) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(Number(value) || 0);
const formatDisplayDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(year, month - 1, day));
};
const formatCreatedDate = (value: Date | string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
const getAttachments = (value: unknown): StatusAttachment[] => Array.isArray(value) ? value.filter((file): file is StatusAttachment => typeof file === 'object' && file !== null && 'id' in file && 'name' in file && 'url' in file) : [];

export default function RequestsPage({ capdevId }: { capdevId: number }) {
  const router = useRouter();
  const session = authClient.useSession();
  const [capdev, setCapdev] = useState<CapdevSummary | null>(null);
  const [requests, setRequests] = useState<RequestRecord[]>([]);
  const [definitions, setDefinitions] = useState<DynamicField[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<RequestRecord | null>(null);
  const [deleting, setDeleting] = useState<RequestRecord | null>(null);
  const [form, setForm] = useState<RequestForm>(EMPTY_FORM);
  const [pendingFiles, setPendingFiles] = useState<Record<string, File[]>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    const [projectData, requestData, fieldData] = await Promise.all([
      getCapdevById(capdevId), getRequestsByCapdev(capdevId), getRequestFieldDefinitions(),
    ]);
    setCapdev(projectData ? { id: projectData.id, aipCode: projectData.aipCode, department: projectData.department } : null);
    setRequests(requestData.map((request) => ({
      ...request,
      requestedBudget: String(request.requestedBudget),
      startDate: dateValue(String(request.startDate)),
      endDate: dateValue(String(request.endDate)),
      additionalInfo: (request.additionalInfo && typeof request.additionalInfo === 'object' ? request.additionalInfo : {}) as Record<string, unknown>,
    })));
    setDefinitions(fieldData.map((field) => ({ ...field, options: Array.isArray(field.options) ? field.options.filter((option): option is string => typeof option === 'string') : [] })));
    setLoading(false);
  }, [capdevId]);

  useEffect(() => { void Promise.resolve().then(loadData); }, [loadData]);

  const filtered = useMemo(() => requests.filter((request) => request.setting.toLowerCase().includes(search.toLowerCase())), [requests, search]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 6));
  const visible = filtered.slice((page - 1) * 6, page * 6);
  const setValue = (updates: Partial<RequestForm>) => setForm((current) => ({ ...current, ...updates }));
  const setDynamicValue = (name: string, value: unknown) => setForm((current) => ({ ...current, additionalInfo: { ...current.additionalInfo, [name]: value } }));
  const resetPage = () => setPage(1);

  const openCreate = () => { setError(''); setPendingFiles({}); setEditing(null); setForm(EMPTY_FORM); setEditorOpen(true); };
  const openEdit = (request: RequestRecord) => { setError(''); setPendingFiles({}); setEditing(request); setForm({ setting: request.setting, requestedBudget: request.requestedBudget, startDate: request.startDate, endDate: request.endDate, additionalInfo: { ...request.additionalInfo } }); setEditorOpen(true); };
  const addSelectedFiles = (fieldName: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    setPendingFiles((current) => ({ ...current, [fieldName]: [...(current[fieldName] || []), ...selectedFiles].filter((file, index, files) => files.findIndex((candidate) => candidate.name === file.name && candidate.size === file.size && candidate.lastModified === file.lastModified) === index) }));
    event.target.value = '';
  };
  const removeSelectedFile = (fieldName: string, file: File) => setPendingFiles((current) => ({ ...current, [fieldName]: (current[fieldName] || []).filter((candidate) => candidate !== file) }));
  const saveRequest = async () => {
    if (!session.data || !form.requestedBudget || !form.startDate || !form.endDate) return;
    setSaving(true);
    setError('');
    const additionalInfo = { ...form.additionalInfo };
    for (const [fieldName, files] of Object.entries(pendingFiles)) {
      if (files.length === 0) continue;
      const uploadData = new FormData();
      files.forEach((file) => uploadData.append('files', file));
      const uploaded = await uploadFilesToGoogleDrive(uploadData);
      if (!uploaded.success) { setError(uploaded.error || `Unable to upload ${fieldName}.`); setSaving(false); return; }
      additionalInfo[fieldName] = [...(Array.isArray(additionalInfo[fieldName]) ? additionalInfo[fieldName] : []), ...uploaded.files];
    }
    const data = { ...form, additionalInfo, capdevId, userId: editing?.userId || session.data.user.id, updatedById: session.data.user.id };
    const result = editing ? await updateRequest(editing.id, data) : await createRequest(data);
    if (result.success) { setEditorOpen(false); await loadData(); }
    setSaving(false);
  };
  const removeRequest = async () => {
    if (!deleting) return;
    setSaving(true);
    const result = await deleteRequest(deleting.id);
    if (result.success) { setDeleting(null); await loadData(); }
    setSaving(false);
  };

  if (session.isPending || loading) return <Box sx={{ display: 'flex', minHeight: 'calc(100vh - 72px)', alignItems: 'center', justifyContent: 'center' }}><CircularProgress color="primary" /></Box>;
  if (!session.data) return null;
  if (!capdev) return <Box sx={{ py: 8, textAlign: 'center' }}><Typography variant="h6" color="text.secondary">CapDev project not found.</Typography></Box>;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 72px)' }}>
      <Container maxWidth={false} sx={{ p: 0, width: '100%', flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
          <Box><Typography variant="h4" sx={{ fontWeight: '800', color: 'text.primary', letterSpacing: '-1px' }}>Requests</Typography><Typography variant="body2" color="text.secondary">{capdev.aipCode} · {capdev.department}</Typography></Box>
          <TextField size="small" placeholder="Search requests..." value={search} onChange={(event) => { setSearch(event.target.value); resetPage(); }} slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon color="action" /></InputAdornment> } }} sx={{ bgcolor: '#ffffff', borderRadius: 2, minWidth: { sm: 260 }, '& .MuiOutlinedInput-root': { borderRadius: 2 } }} />
        </Stack>

        {visible.length === 0 ? <Card variant="outlined" sx={{ borderRadius: 2, minHeight: 300, display: 'grid', placeItems: 'center' }}><Stack spacing={1} sx={{ alignItems: 'center', color: 'text.secondary' }}><RequestIcon sx={{ fontSize: 42 }} /><Typography>No requests found</Typography></Stack></Card> :
          <Grid container spacing={3} sx={{ flexGrow: 1, alignContent: 'flex-start' }}>{visible.map((request) => <Grid key={request.id} size={{ xs: 12, sm: 6, md: 4 }}>
            <Card variant="outlined" sx={{ borderRadius: 2, bgcolor: '#ffffff', height: '100%', display: 'flex', flexDirection: 'column', transition: 'all 0.2s', '&:hover': { boxShadow: '0 4px 12px rgba(0,0,0,0.04)', borderColor: 'primary.main' } }}>
              <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', p: 3 }}>
                <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', mb: 2 }}><Box sx={{ bgcolor: 'rgba(46, 125, 50, 0.08)', p: 1.2, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><RequestIcon color="primary" /></Box><Box sx={{ flexGrow: 1 }}><Typography variant="h6" sx={{ fontWeight: '700', color: 'text.primary', lineHeight: 1.2 }}>Request #{request.id}</Typography><Typography variant="body2" color="text.secondary">{request.setting === 'internal' ? 'Internal' : 'External'}</Typography></Box><Chip label={request.isComplete ? 'Complete' : 'In progress'} color={request.isComplete ? 'success' : 'primary'} size="small" sx={{ fontWeight: 700 }} /></Stack>
                <Stack spacing={1.5} sx={{ my: 1 }}><Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Typography variant="body2" color="text.secondary">Requestor</Typography><Typography variant="body2" sx={{ fontWeight: 700 }}>{request.requestorName || 'Requestor'}</Typography></Stack><Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Typography variant="body2" color="text.secondary">Date requested</Typography><Typography variant="body2">{formatCreatedDate(request.createdAt)}</Typography></Stack><Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Typography variant="body2" color="text.secondary">Requested budget</Typography><Typography variant="body2" sx={{ fontWeight: '700', color: 'primary.dark' }}>{formatCurrency(request.requestedBudget)}</Typography></Stack><Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1 }}><Typography variant="body2" color="text.secondary">Schedule</Typography><Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}><CalendarIcon fontSize="small" color="action" /><Typography variant="body2">{formatDisplayDate(request.startDate)} to {formatDisplayDate(request.endDate)}</Typography></Stack></Stack></Stack>
                <Divider sx={{ my: 2 }} />
                <Stack direction="row" spacing={3} sx={{ mt: 'auto', flexWrap: 'wrap', rowGap: 1 }}><Button variant="text" color="primary" endIcon={<ChevronRightIcon />} onClick={() => router.push(`/admin/capdev/${capdevId}/requests/${request.id}/status`)} sx={{ p: 0, minWidth: 0, fontWeight: '700', '&:hover': { bgcolor: 'transparent', color: 'primary.dark' } }}>View Status</Button><Button variant="text" color="primary" onClick={() => openEdit(request)} sx={{ p: 0, minWidth: 0, fontWeight: '700', '&:hover': { bgcolor: 'transparent', color: 'primary.dark' } }}>Edit Request</Button><Button variant="text" color="error" onClick={() => setDeleting(request)} sx={{ p: 0, minWidth: 0, fontWeight: '700', '&:hover': { bgcolor: 'transparent', color: '#b71c1c' } }}>Delete</Button></Stack>
              </CardContent>
            </Card>
          </Grid>)}</Grid>}

        {filtered.length > 6 && <Stack direction="row" spacing={2} sx={{ justifyContent: 'center', alignItems: 'center', mt: 4, mb: 2 }}><Button variant="outlined" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Previous</Button><Typography variant="body2" sx={{ fontWeight: '700', color: 'text.secondary' }}>Page {page} of {pageCount}</Typography><Button variant="outlined" disabled={page === pageCount} onClick={() => setPage((current) => current + 1)}>Next</Button></Stack>}
      </Container>

      <Fab variant="extended" color="primary" onClick={openCreate} sx={{ position: 'fixed', right: 24, bottom: 24, zIndex: 1100, px: 2.5, boxShadow: '0 4px 14px rgba(46, 125, 50, 0.4)' }}><AddIcon sx={{ mr: 1 }} />Add Request</Fab>

      <Dialog open={editorOpen} onClose={() => !saving && setEditorOpen(false)} fullWidth maxWidth="md">
        <DialogTitle sx={{ fontWeight: 800 }}>{editing ? 'Edit Request' : 'Add Request'}</DialogTitle>
        <DialogContent dividers>{error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}<Grid container spacing={2.5} sx={{ pt: 0.5 }}>
          {editing && <><Grid size={{ xs: 12, sm: 6 }}><Typography variant="body2" color="text.secondary">Requestor</Typography><Typography sx={{ fontWeight: 700 }}>{editing.requestorName || 'Requestor'}</Typography></Grid><Grid size={{ xs: 12, sm: 6 }}><Typography variant="body2" color="text.secondary">Date requested</Typography><Typography sx={{ fontWeight: 700 }}>{formatCreatedDate(editing.createdAt)}</Typography></Grid></>}
          <Grid size={12}><TextField select required fullWidth label="Setting" value={form.setting} onChange={(event) => setValue({ setting: event.target.value })}><MenuItem value="internal">Internal</MenuItem><MenuItem value="external">External</MenuItem></TextField></Grid>
          <Grid size={{ xs: 12, sm: 4 }}><TextField required fullWidth label="Requested Budget" type="number" value={form.requestedBudget} onChange={(event) => setValue({ requestedBudget: event.target.value })} /></Grid>
          <Grid size={{ xs: 12, sm: 4 }}><DateField label="Start Date" required value={form.startDate} onChange={(value) => setValue({ startDate: value })} /></Grid>
          <Grid size={{ xs: 12, sm: 4 }}><DateField label="End Date" required value={form.endDate} onChange={(value) => setValue({ endDate: value })} /></Grid>
          {definitions.length > 0 && <><Grid size={12}><Divider sx={{ my: 0.5 }} /><Typography variant="subtitle1" sx={{ fontWeight: 800, mt: 2 }}>Additional Information</Typography></Grid>{definitions.map((field) => <Grid key={field.id} size={field.width === 'half' ? { xs: 12, sm: 6 } : 12}>{field.type === 'text' && field.options && field.options.length > 0 ? <Autocomplete freeSolo options={field.options} value={String(form.additionalInfo[field.name] || '')} onChange={(_, value) => setDynamicValue(field.name, value || '')} onInputChange={(_, value) => setDynamicValue(field.name, value)} renderInput={(params) => <TextField {...params} required={field.isRequired} fullWidth label={field.name} placeholder={field.placeholder || 'Select or type...'} />} /> : field.type === 'date' ? <DateField label={field.name} required={field.isRequired} value={String(form.additionalInfo[field.name] || '')} onChange={(value) => setDynamicValue(field.name, value)} /> : field.type === 'file' ? <Stack spacing={1}><Button component="label" variant="outlined" startIcon={<AttachFileIcon />}>{field.name}<input hidden type="file" multiple onChange={(event) => addSelectedFiles(field.name, event)} /></Button>{getAttachments(form.additionalInfo[field.name]).map((file) => <Button key={file.id} component="a" href={file.url} target="_blank" rel="noreferrer" size="small" startIcon={<AttachFileIcon />} sx={{ width: 'fit-content', textTransform: 'none' }}>{file.name}</Button>)}{(pendingFiles[field.name] || []).length > 0 && <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>{pendingFiles[field.name].map((file) => <Chip key={`${file.name}-${file.lastModified}-${file.size}`} label={file.name} size="small" onDelete={() => removeSelectedFile(field.name, file)} />)}</Stack>}</Stack> : <TextField required={field.isRequired} fullWidth label={field.name} type={field.type === 'number' ? 'number' : 'text'} value={String(form.additionalInfo[field.name] || '')} placeholder={field.placeholder || ''} onChange={(event) => setDynamicValue(field.name, event.target.value)} />}</Grid>)}</>}
        </Grid></DialogContent>
        <DialogActions sx={{ p: 2.5 }}><Button onClick={() => setEditorOpen(false)} disabled={saving} color="inherit">Cancel</Button><Button onClick={saveRequest} disabled={saving || !form.requestedBudget || !form.startDate || !form.endDate} variant="contained">{saving ? 'Saving' : 'Save Request'}</Button></DialogActions>
      </Dialog>
      <Dialog open={Boolean(deleting)} onClose={() => !saving && setDeleting(null)} maxWidth="xs" fullWidth><DialogTitle sx={{ fontWeight: 800 }}>Delete Request?</DialogTitle><DialogContent><Typography>This permanently removes Request #{deleting?.id}.</Typography></DialogContent><DialogActions sx={{ p: 2.5 }}><Button onClick={() => setDeleting(null)} disabled={saving}>Cancel</Button><Button color="error" variant="contained" onClick={removeRequest} disabled={saving}>{saving ? 'Deleting' : 'Delete'}</Button></DialogActions></Dialog>
    </Box>
  );
}
