'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Add as AddIcon,
  AttachFile as AttachFileIcon,
  Assignment as RequestIcon,
  ChevronRight as ChevronRightIcon,
  Payments as PaymentsIcon,
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
  createRequest, deleteRequest, getCapdevById, getCurrentUserAccess, getRequestFieldDefinitions, getRequestStatusUpdates, getRequestsByCapdev, updateRequest, uploadFilesToGoogleDrive, type AppRole, type StatusAttachment,
} from '@/app/actions';

type RequestRecord = {
  id: number;
  capdevId: number;
  userId: string;
  requestorName: string | null;
  createdAt: Date | string;
  isComplete: boolean;
  hasDeductedBudget: boolean;
  setting: string;
  description: string;
  requestedBudget: string;
  additionalInfo: Record<string, unknown>;
};
type DynamicField = { id: number; name: string; type: string; options: string[] | null; isRequired: boolean; width: string; placeholder: string | null };
type RequestForm = Pick<RequestRecord, 'setting' | 'description' | 'requestedBudget' | 'additionalInfo'>;
type CapdevSummary = { id: number; aipCode: string; department: string; budget: string };

const EMPTY_FORM: RequestForm = { setting: 'internal', description: '', requestedBudget: '', additionalInfo: {} };
const formatDate = (value: Date | string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
const formatCurrency = (value: string) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(Number(value) || 0);
const getAttachments = (value: unknown): StatusAttachment[] => Array.isArray(value) ? value.filter((file): file is StatusAttachment => typeof file === 'object' && file !== null && 'id' in file && 'name' in file && 'url' in file) : [];

export default function RequestsPage({ capdevId }: { capdevId: number }) {
  const router = useRouter();
  const session = authClient.useSession();
  const [capdev, setCapdev] = useState<CapdevSummary | null>(null);
  const [requests, setRequests] = useState<RequestRecord[]>([]);
  const [definitions, setDefinitions] = useState<DynamicField[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({ setting: '', min: '', max: '', dateFrom: '', dateTo: '', sort: 'newest' });
  const [draftFilters, setDraftFilters] = useState(filters);
  const [page, setPage] = useState(1);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<RequestRecord | null>(null);
  const [deleting, setDeleting] = useState<RequestRecord | null>(null);
  const [form, setForm] = useState<RequestForm>(EMPTY_FORM);
  const [pendingFiles, setPendingFiles] = useState<Record<string, File[]>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [role, setRole] = useState<AppRole>('employee');

  useEffect(() => { if (session.data) void getCurrentUserAccess().then((access) => { if (access.success) setRole(access.role); }); }, [session.data]);

  const loadData = useCallback(async () => {
    const [projectData, requestData, fieldData] = await Promise.all([
      getCapdevById(capdevId), getRequestsByCapdev(capdevId), getRequestFieldDefinitions(),
    ]);
    const statusUpdatesByRequest = await Promise.all(requestData.map((request) => getRequestStatusUpdates(request.id)));
    setCapdev(projectData ? { id: projectData.id, aipCode: projectData.aipCode, department: projectData.department, budget: String(projectData.budget) } : null);
    setRequests(requestData.map((request, index) => ({
      ...request,
      isComplete: statusUpdatesByRequest[index].some((update) => update.markAsComplete),
      hasDeductedBudget: statusUpdatesByRequest[index].some((update) => update.subtractsRequestedAmount),
      requestedBudget: String(request.requestedBudget),
      additionalInfo: (request.additionalInfo && typeof request.additionalInfo === 'object' ? request.additionalInfo : {}) as Record<string, unknown>,
    })));
    setDefinitions(fieldData.map((field) => ({ ...field, options: Array.isArray(field.options) ? field.options.filter((option): option is string => typeof option === 'string') : [] })));
    setLoading(false);
  }, [capdevId]);

  useEffect(() => { void Promise.resolve().then(loadData); }, [loadData]);
  useEffect(() => {
    const refreshRequests = () => { void loadData(); };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshRequests();
    };
    window.addEventListener('focus', refreshRequests);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refreshRequests);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [loadData]);

  const filtered = useMemo(() => requests.filter((request) => { const date = new Date(request.createdAt).getTime(); return `${request.requestorName} ${request.description}`.toLowerCase().includes(search.toLowerCase()) && (!filters.setting || request.setting === filters.setting) && (!filters.min || Number(request.requestedBudget) >= Number(filters.min)) && (!filters.max || Number(request.requestedBudget) <= Number(filters.max)) && (!filters.dateFrom || date >= new Date(filters.dateFrom).getTime()) && (!filters.dateTo || date <= new Date(`${filters.dateTo}T23:59:59`).getTime()); }).sort((a,b) => filters.sort === 'newest' ? new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime() : new Date(a.createdAt).getTime()-new Date(b.createdAt).getTime()), [filters, requests, search]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 6));
  const visible = filtered.slice((page - 1) * 6, page * 6);
  const setValue = (updates: Partial<RequestForm>) => setForm((current) => ({ ...current, ...updates }));
  const setDynamicValue = (name: string, value: unknown) => setForm((current) => ({ ...current, additionalInfo: { ...current.additionalInfo, [name]: value } }));
  const resetPage = () => setPage(1);

  const openCreate = () => { setError(''); setPendingFiles({}); setEditing(null); setForm(EMPTY_FORM); setEditorOpen(true); };
  const openEdit = (request: RequestRecord) => { setError(''); setPendingFiles({}); setEditing(request); setForm({ setting: request.setting, description: request.description, requestedBudget: request.requestedBudget, additionalInfo: { ...request.additionalInfo } }); setEditorOpen(true); };
  const addSelectedFiles = (fieldName: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    setPendingFiles((current) => ({ ...current, [fieldName]: [...(current[fieldName] || []), ...selectedFiles].filter((file, index, files) => files.findIndex((candidate) => candidate.name === file.name && candidate.size === file.size && candidate.lastModified === file.lastModified) === index) }));
    event.target.value = '';
  };
  const removeSelectedFile = (fieldName: string, file: File) => setPendingFiles((current) => ({ ...current, [fieldName]: (current[fieldName] || []).filter((candidate) => candidate !== file) }));
  const saveRequest = async () => {
    if (!session.data || !form.description || !form.requestedBudget) return;
    if (!editing?.hasDeductedBudget && Number(form.requestedBudget) > Number(capdev?.budget)) { setError('Requested budget exceeds the remaining CapDev budget.'); return; }
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
  const canManageRequest = role === 'admin' || role === 'employee';
  const currentUserId = session.data.user.id;
  const canEditRequest = (request: RequestRecord) => role === 'admin' || (role === 'employee' && request.userId === currentUserId);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 72px)' }}>
      <Container maxWidth={false} sx={{ p: 0, width: '100%', flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
          <Box><Typography variant="h4" sx={{ fontWeight: '800', color: 'text.primary', letterSpacing: '-1px' }}>Requests</Typography><Typography variant="body2" color="text.secondary">{capdev.aipCode} · {capdev.department}</Typography></Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><TextField size="small" placeholder="Search requestor or description..." value={search} onChange={(event) => { setSearch(event.target.value); resetPage(); }} slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon color="action" /></InputAdornment> } }} sx={{ bgcolor: '#ffffff', borderRadius: 2, minWidth: { sm: 260 }, '& .MuiOutlinedInput-root': { borderRadius: 2 } }} /><Button size="small" sx={{ height: 40 }} variant="outlined" onClick={() => { setDraftFilters(filters); setFiltersOpen(true); }}>Filter</Button></Stack>
        </Stack>

        {visible.length === 0 ? <Card variant="outlined" sx={{ borderRadius: 2, minHeight: 300, display: 'grid', placeItems: 'center' }}><Stack spacing={1} sx={{ alignItems: 'center', color: 'text.secondary' }}><RequestIcon sx={{ fontSize: 42 }} /><Typography>No requests found</Typography></Stack></Card> :
          <Grid container spacing={3} sx={{ flexGrow: 1, alignContent: 'flex-start' }}>{visible.map((request) => <Grid key={request.id} size={{ xs: 12, sm: 6, md: 4 }} sx={{ position: 'relative', pt: 3 }}>
            <Box sx={{ position: 'absolute', top: 0, left: 0, zIndex: 0, height: 48, p: '1px', bgcolor: 'divider', clipPath: 'polygon(10px 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 10px 100%, 0 50%)' }}><Box sx={{ height: '100%', px: 2, pt: .5, bgcolor: '#fafcfa', clipPath: 'polygon(10px 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 10px 100%, 0 50%)', display: 'flex', alignItems: 'flex-start' }}><Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap', lineHeight: 1.3 }}>Added {formatDate(request.createdAt)}</Typography></Box></Box>
            <Card variant="outlined" sx={{ position: 'relative', zIndex: 1, borderRadius: 2, bgcolor: '#ffffff', height: '100%', display: 'flex', flexDirection: 'column', transition: 'all 0.2s', '&:hover': { boxShadow: '0 4px 12px rgba(0,0,0,0.04)', borderColor: 'primary.main' } }}>
              <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', p: 3 }}>
                <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', mb: 2 }}><Box sx={{ bgcolor: 'rgba(46, 125, 50, 0.08)', p: 1.2, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><RequestIcon color="primary" /></Box><Box sx={{ flexGrow: 1, minWidth: 0 }}><Typography variant="h6" noWrap sx={{ fontWeight: '700', color: 'text.primary', lineHeight: 1.2 }}>{request.description}</Typography><Typography variant="body2" color="text.secondary">{request.setting === 'internal' ? 'Internal' : 'External'}</Typography></Box><Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexShrink: 0 }}><Chip label={request.isComplete ? 'Complete' : 'In progress'} color={request.isComplete ? 'success' : 'primary'} size="small" sx={{ fontWeight: 700 }} />{request.hasDeductedBudget && <Chip icon={<PaymentsIcon />} label="Budget deducted" color="success" variant="outlined" size="small" sx={{ fontWeight: 700 }} />}</Stack></Stack>
                <Stack spacing={1.5} sx={{ my: 1 }}><Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Typography variant="body2" color="text.secondary">Requestor</Typography><Typography variant="body2" sx={{ fontWeight: 700 }}>{request.requestorName || 'Requestor'}</Typography></Stack><Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Typography variant="body2" color="text.secondary">Requested budget</Typography><Typography variant="body2" sx={{ fontWeight: '700', color: 'primary.dark' }}>{formatCurrency(request.requestedBudget)}</Typography></Stack></Stack>
                <Divider sx={{ my: 2 }} />
                <Stack direction="row" sx={{ mt: 'auto', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}><Button variant="text" color="primary" endIcon={<ChevronRightIcon />} onClick={() => router.push(`/admin/capdev/${capdevId}/requests/${request.id}/status`)} sx={{ p: 0, minWidth: 0, fontWeight: '700', '&:hover': { bgcolor: 'transparent', color: 'primary.dark' } }}>Track Progress</Button><Stack direction="row" spacing={3}><Button variant="text" color="primary" onClick={() => openEdit(request)} sx={{ p: 0, minWidth: 0, fontWeight: '700', '&:hover': { bgcolor: 'transparent', color: 'primary.dark' } }}>Details</Button>{canEditRequest(request) && <Button variant="text" color="error" onClick={() => setDeleting(request)} sx={{ p: 0, minWidth: 0, fontWeight: '700', '&:hover': { bgcolor: 'transparent', color: '#b71c1c' } }}>Delete</Button>}</Stack></Stack>
              </CardContent>
            </Card>
          </Grid>)}</Grid>}

        {filtered.length > 6 && <Stack direction="row" spacing={2} sx={{ justifyContent: 'center', alignItems: 'center', mt: 4, mb: 2 }}><Button variant="outlined" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>Previous</Button><Typography variant="body2" sx={{ fontWeight: '700', color: 'text.secondary' }}>Page {page} of {pageCount}</Typography><Button variant="outlined" disabled={page === pageCount} onClick={() => setPage((current) => current + 1)}>Next</Button></Stack>}
      </Container>

      {canManageRequest && <Fab variant="extended" color="primary" onClick={openCreate} sx={{ position: 'fixed', right: 24, bottom: 24, zIndex: 1100, px: 2.5, boxShadow: '0 4px 14px rgba(46, 125, 50, 0.4)' }}><AddIcon sx={{ mr: 1 }} />Add Request</Fab>}

      <Dialog open={editorOpen} onClose={() => !saving && setEditorOpen(false)} fullWidth maxWidth="md">
        <DialogTitle sx={{ fontWeight: 800 }}>{editing ? 'Edit Request' : 'Add Request'}</DialogTitle>
        <DialogContent dividers>{error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}<Grid container spacing={2.5} sx={{ pt: 0.5 }}>
          {editing && <Grid size={12}><Typography variant="body2" color="text.secondary">Requestor</Typography><Typography sx={{ fontWeight: 700 }}>{editing.requestorName || 'Requestor'}</Typography></Grid>}
          <Grid size={12}><TextField select required fullWidth label="Setting" value={form.setting} onChange={(event) => setValue({ setting: event.target.value })}><MenuItem value="internal">Internal</MenuItem><MenuItem value="external">External</MenuItem></TextField></Grid>
          <Grid size={12}><TextField required fullWidth label="Description" multiline minRows={2} value={form.description} onChange={(event) => setValue({ description: event.target.value })} /></Grid>
          <Grid size={12}><TextField required fullWidth label="Requested Budget" type="number" value={form.requestedBudget} onChange={(event) => setValue({ requestedBudget: event.target.value })} helperText={`Remaining CapDev budget: ${formatCurrency(capdev.budget)}`} disabled={editing?.hasDeductedBudget} /></Grid>
          {definitions.length > 0 && <><Grid size={12}><Divider sx={{ my: 0.5 }} /><Typography variant="subtitle1" sx={{ fontWeight: 800, mt: 2 }}>Additional Information</Typography></Grid>{definitions.map((field) => <Grid key={field.id} size={field.width === 'half' ? { xs: 12, sm: 6 } : 12}>{field.type === 'text' && field.options && field.options.length > 0 ? <Autocomplete freeSolo options={field.options} value={String(form.additionalInfo[field.name] || '')} onChange={(_, value) => setDynamicValue(field.name, value || '')} onInputChange={(_, value) => setDynamicValue(field.name, value)} renderInput={(params) => <TextField {...params} required={field.isRequired} fullWidth label={field.name} placeholder={field.placeholder || 'Select or type...'} />} /> : field.type === 'date' ? <DateField label={field.name} required={field.isRequired} value={String(form.additionalInfo[field.name] || '')} onChange={(value) => setDynamicValue(field.name, value)} /> : field.type === 'file' ? <Stack spacing={1}><Button component="label" variant="outlined" startIcon={<AttachFileIcon />}>{field.name}<input hidden type="file" multiple onChange={(event) => addSelectedFiles(field.name, event)} /></Button>{getAttachments(form.additionalInfo[field.name]).map((file) => <Button key={file.id} component="a" href={file.url} target="_blank" rel="noreferrer" size="small" startIcon={<AttachFileIcon />} sx={{ width: 'fit-content', textTransform: 'none' }}>{file.name}</Button>)}{(pendingFiles[field.name] || []).length > 0 && <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>{pendingFiles[field.name].map((file) => <Chip key={`${file.name}-${file.lastModified}-${file.size}`} label={file.name} size="small" onDelete={() => removeSelectedFile(field.name, file)} />)}</Stack>}</Stack> : <TextField required={field.isRequired} fullWidth label={field.name} type={field.type === 'number' ? 'number' : 'text'} value={String(form.additionalInfo[field.name] || '')} placeholder={field.placeholder || ''} onChange={(event) => setDynamicValue(field.name, event.target.value)} />}</Grid>)}</>}
        </Grid>{editing && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 3 }}>Added {formatDate(editing.createdAt)}</Typography>}</DialogContent>
        <DialogActions sx={{ p: 2.5 }}><Button onClick={() => setEditorOpen(false)} disabled={saving} color="inherit">Close</Button>{(!editing || canEditRequest(editing)) && canManageRequest && <Button onClick={saveRequest} disabled={saving || !form.description || !form.requestedBudget} variant="contained">{saving ? 'Saving' : 'Save Request'}</Button>}</DialogActions>
      </Dialog>
      <Dialog open={filtersOpen} onClose={() => setFiltersOpen(false)} fullWidth maxWidth="sm"><DialogTitle sx={{ fontWeight: 800 }}>Filter Requests</DialogTitle><DialogContent dividers><Grid container spacing={2} sx={{ pt: .5 }}><Grid size={12}><TextField select fullWidth label="Setting" value={draftFilters.setting} onChange={(e) => setDraftFilters({...draftFilters, setting:e.target.value})}><MenuItem value="">All settings</MenuItem><MenuItem value="internal">Internal</MenuItem><MenuItem value="external">External</MenuItem></TextField></Grid><Grid size={{xs:12,sm:6}}><TextField fullWidth type="number" label="Requested budget from" value={draftFilters.min} onChange={(e)=>setDraftFilters({...draftFilters,min:e.target.value})}/></Grid><Grid size={{xs:12,sm:6}}><TextField fullWidth type="number" label="Requested budget to" value={draftFilters.max} onChange={(e)=>setDraftFilters({...draftFilters,max:e.target.value})}/></Grid><Grid size={{xs:12,sm:6}}><TextField fullWidth type="date" label="Date added from" slotProps={{inputLabel:{shrink:true}}} value={draftFilters.dateFrom} onChange={(e)=>setDraftFilters({...draftFilters,dateFrom:e.target.value})}/></Grid><Grid size={{xs:12,sm:6}}><TextField fullWidth type="date" label="Date added to" slotProps={{inputLabel:{shrink:true}}} value={draftFilters.dateTo} onChange={(e)=>setDraftFilters({...draftFilters,dateTo:e.target.value})}/></Grid><Grid size={12}><TextField select fullWidth label="Sort" value={draftFilters.sort} onChange={(e)=>setDraftFilters({...draftFilters,sort:e.target.value})}><MenuItem value="newest">Newest to oldest</MenuItem><MenuItem value="oldest">Oldest to newest</MenuItem></TextField></Grid></Grid></DialogContent><DialogActions sx={{p:2.5}}><Button onClick={()=>setDraftFilters({setting:'',min:'',max:'',dateFrom:'',dateTo:'',sort:'newest'})}>Reset</Button><Button variant="contained" onClick={()=>{setFilters(draftFilters);resetPage();setFiltersOpen(false)}}>Apply Filters</Button></DialogActions></Dialog>
      <Dialog open={Boolean(deleting)} onClose={() => !saving && setDeleting(null)} maxWidth="xs" fullWidth><DialogTitle sx={{ fontWeight: 800 }}>Delete Request?</DialogTitle><DialogContent><Typography>This permanently removes Request #{deleting?.id}.</Typography></DialogContent><DialogActions sx={{ p: 2.5 }}><Button onClick={() => setDeleting(null)} disabled={saving}>Cancel</Button><Button color="error" variant="contained" onClick={removeRequest} disabled={saving}>{saving ? 'Deleting' : 'Delete'}</Button></DialogActions></Dialog>
    </Box>
  );
}
