'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Add as AddIcon, AttachFile as AttachFileIcon, ChevronRight as ChevronRightIcon, FilterList as FilterIcon, FolderOpen as CapdevIcon, Search as SearchIcon } from '@mui/icons-material';
import { Alert, Autocomplete, Box, Button, Card, CardContent, Checkbox, Chip, CircularProgress, Container, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Fab, FormControlLabel, Grid, InputAdornment, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { authClient } from '@/lib/auth/client';
import { createCapdev, deleteCapdev, getAllCapdevs, getCapdevBudgetHistory, getCapdevFieldDefinitions, getCurrentUserAccess, updateCapdev, uploadFilesToGoogleDrive, type AppRole, type StatusAttachment } from '@/app/actions';
import DateField from '@/components/DateField';

type DynamicField = { id: number; name: string; type: string; options: string[] | null; isRequired: boolean; section: string; width: string; placeholder: string | null };
type Capdev = { id: number; aipCode: string; description: string; initialBudget: string; budget: string; department: string; updatedById: string; createdAt: Date | string; additionalInfo: Record<string, unknown> };
type CapdevForm = Omit<Capdev, 'id' | 'createdAt' | 'updatedById'>;
type BudgetHistoryEntry = { authorName: string | null; amount: string; createdAt: Date | string };

const EMPTY_FORM: CapdevForm = { aipCode: '', description: '', initialBudget: '', budget: '', department: '', additionalInfo: {} };
const formatCurrency = (value: string) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(Number(value) || 0);
const formatDate = (value: Date | string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
const getAttachments = (value: unknown): StatusAttachment[] => Array.isArray(value) ? value.filter((file): file is StatusAttachment => typeof file === 'object' && file !== null && 'id' in file && 'name' in file && 'url' in file) : [];
const getSectionLabel = (section: string) => section === 'basic' ? 'Basic Information' : section === 'supporting' ? 'Supporting Information' : section;

export default function AdminPage() {
  const router = useRouter();
  const session = authClient.useSession();
  const [projects, setProjects] = useState<Capdev[]>([]);
  const [definitions, setDefinitions] = useState<DynamicField[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({ departments: [] as string[], initialMin: '', initialMax: '', remainingMin: '', remainingMax: '', dateFrom: '', dateTo: '', sort: 'newest' });
  const [draftFilters, setDraftFilters] = useState(filters);
  const [page, setPage] = useState(1);
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleting, setDeleting] = useState<Capdev | null>(null);
  const [editing, setEditing] = useState<Capdev | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [form, setForm] = useState<CapdevForm>(EMPTY_FORM);
  const [pendingFiles, setPendingFiles] = useState<Record<string, File[]>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [budgetHistory, setBudgetHistory] = useState<BudgetHistoryEntry[]>([]);
  const [role, setRole] = useState<AppRole>('employee');

  useEffect(() => { if (session.data) void getCurrentUserAccess().then((access) => { if (access.success) setRole(access.role); }); }, [session.data]);

  const loadData = async () => {
    const [projectData, fieldData] = await Promise.all([getAllCapdevs(), getCapdevFieldDefinitions()]);
    setProjects(projectData.map((project) => ({
      ...project,
      initialBudget: String(project.initialBudget), budget: String(project.budget),
      additionalInfo: (project.additionalInfo && typeof project.additionalInfo === 'object' ? project.additionalInfo : {}) as Record<string, unknown>,
    })));
    setDefinitions(fieldData.map((field) => ({ ...field, options: Array.isArray(field.options) ? field.options.filter((option): option is string => typeof option === 'string') : [] })));
    setLoading(false);
  };

  useEffect(() => { void Promise.resolve().then(loadData); }, []);

  const departments = useMemo(() => Array.from(new Set(projects.map((project) => project.department))).sort(), [projects]);
  const filtered = useMemo(() => projects.filter((project) => {
    const searchText = `${project.aipCode} ${project.description} ${project.updatedById}`.toLowerCase(); const date = new Date(project.createdAt).getTime();
    return searchText.includes(search.toLowerCase()) && (filters.departments.length === 0 || filters.departments.includes(project.department)) && (!filters.initialMin || Number(project.initialBudget) >= Number(filters.initialMin)) && (!filters.initialMax || Number(project.initialBudget) <= Number(filters.initialMax)) && (!filters.remainingMin || Number(project.budget) >= Number(filters.remainingMin)) && (!filters.remainingMax || Number(project.budget) <= Number(filters.remainingMax)) && (!filters.dateFrom || date >= new Date(filters.dateFrom).getTime()) && (!filters.dateTo || date <= new Date(`${filters.dateTo}T23:59:59`).getTime());
  }).sort((a, b) => filters.sort === 'newest' ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()), [filters, projects, search]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 6));
  const visible = filtered.slice((page - 1) * 6, page * 6);
  const requiredDefinitions = definitions.filter((field) => field.isRequired || field.section === 'required');
  const additionalDefinitions = definitions.filter((field) => !field.isRequired && field.section !== 'required');
  const configuredSections = Array.from(new Set(additionalDefinitions.map((field) => field.section || 'Additional Information')));
  const resetPage = () => setPage(1);
  const setValue = (updates: Partial<CapdevForm>) => setForm((current) => ({ ...current, ...updates }));
  const setDynamicValue = (name: string, value: unknown) => setForm((current) => ({ ...current, additionalInfo: { ...current.additionalInfo, [name]: value } }));

  const openCreate = () => { setError(''); setPendingFiles({}); setBudgetHistory([]); setEditing(null); setForm(EMPTY_FORM); setEditorOpen(true); };
  const openEdit = async (project: Capdev) => { setError(''); setPendingFiles({}); setEditing(project); setForm({ ...project, additionalInfo: { ...project.additionalInfo } }); setBudgetHistory(await getCapdevBudgetHistory(project.id)); setEditorOpen(true); };
  const addSelectedFiles = (fieldName: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    setPendingFiles((current) => ({ ...current, [fieldName]: [...(current[fieldName] || []), ...selectedFiles].filter((file, index, files) => files.findIndex((candidate) => candidate.name === file.name && candidate.size === file.size && candidate.lastModified === file.lastModified) === index) }));
    event.target.value = '';
  };
  const removeSelectedFile = (fieldName: string, file: File) => setPendingFiles((current) => ({ ...current, [fieldName]: (current[fieldName] || []).filter((candidate) => candidate !== file) }));
  const hasDynamicValue = (field: DynamicField) => {
    if (field.type === 'file') return getAttachments(form.additionalInfo[field.name]).length > 0 || (pendingFiles[field.name] || []).length > 0;
    const value = form.additionalInfo[field.name];
    return value !== undefined && value !== null && String(value).trim().length > 0;
  };
  const areRequiredFieldsComplete = requiredDefinitions.every(hasDynamicValue);

  const saveProject = async () => {
    if (!session.data || !form.aipCode || !form.description || !form.budget || !form.department) return;
    const missingRequiredFields = requiredDefinitions.filter((field) => !hasDynamicValue(field));
    if (missingRequiredFields.length > 0) { setError(`Complete the required field${missingRequiredFields.length === 1 ? '' : 's'}: ${missingRequiredFields.map((field) => field.name).join(', ')}.`); return; }
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
    const payload = { ...form, additionalInfo, aipCode: form.aipCode.trim(), department: form.department.trim(), updatedById: session.data.user.id };
    const result = editing ? await updateCapdev(editing.id, payload) : await createCapdev(payload);
    if (result.success) { setEditorOpen(false); await loadData(); } else { setError(result.error || 'Unable to save this CapDev project.'); }
    setSaving(false);
  };

  const renderDynamicField = (field: DynamicField) => {
    const isRequired = field.isRequired || field.section === 'required';
    return <Grid key={field.id} size={field.width === 'half' ? { xs: 12, sm: 6 } : 12}>
      {field.type === 'text' && field.options && field.options.length > 0 ? <Autocomplete freeSolo options={field.options} value={String(form.additionalInfo[field.name] || '')} onChange={(_, value) => setDynamicValue(field.name, value || '')} onInputChange={(_, value) => setDynamicValue(field.name, value)} renderInput={(params) => <TextField {...params} required={isRequired} fullWidth label={field.name} placeholder={field.placeholder || 'Select or type...'} />} /> : field.type === 'date' ? <DateField label={field.name} required={isRequired} value={String(form.additionalInfo[field.name] || '')} onChange={(value) => setDynamicValue(field.name, value)} /> : field.type === 'file' ? <Stack spacing={1}><Button component="label" variant="outlined" startIcon={<AttachFileIcon />}>{field.name}{isRequired ? ' *' : ''}<input hidden type="file" multiple onChange={(event) => addSelectedFiles(field.name, event)} /></Button>{getAttachments(form.additionalInfo[field.name]).map((file) => <Button key={file.id} component="a" href={file.url} target="_blank" rel="noreferrer" size="small" startIcon={<AttachFileIcon />} sx={{ width: 'fit-content', textTransform: 'none' }}>{file.name}</Button>)}{(pendingFiles[field.name] || []).length > 0 && <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>{pendingFiles[field.name].map((file) => <Chip key={`${file.name}-${file.lastModified}-${file.size}`} label={file.name} size="small" onDelete={() => removeSelectedFile(field.name, file)} />)}</Stack>}</Stack> : <TextField required={isRequired} fullWidth label={field.name} type={field.type === 'number' ? 'number' : 'text'} value={String(form.additionalInfo[field.name] || '')} placeholder={field.placeholder || ''} onChange={(event) => setDynamicValue(field.name, event.target.value)} />}
    </Grid>;
  };

  const removeProject = async () => {
    if (!deleting) return;
    setSaving(true);
    const result = await deleteCapdev(deleting.id);
    if (result.success) { setDeleting(null); await loadData(); }
    else { setDeleteError(result.error || 'Unable to delete this CapDev project.'); }
    setSaving(false);
  };

  if (session.isPending || loading) return <Box sx={{ display: 'flex', minHeight: 'calc(100vh - 72px)', alignItems: 'center', justifyContent: 'center' }}><CircularProgress color="primary" /></Box>;
  if (!session.data) return null;

  const isAdmin = role === 'admin';
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 72px)' }}>
      <Container maxWidth={false} sx={{ p: 0, width: '100%', flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
          <Typography variant="h4" sx={{ fontWeight: '800', color: 'text.primary', letterSpacing: '-1px' }}>CapDev Projects</Typography>
          <Stack direction="row" spacing={2} sx={{ width: { xs: '100%', sm: 'auto' }, alignItems: 'center' }}>
            <TextField size="small" placeholder="Search projects..." value={search} onChange={(event) => { setSearch(event.target.value); resetPage(); }} slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon color="action" /></InputAdornment> } }} sx={{ bgcolor: '#ffffff', borderRadius: 2, minWidth: { sm: 260 }, '& .MuiOutlinedInput-root': { borderRadius: 2 } }} />
            <Button size="small" sx={{ height: 40 }} variant="outlined" startIcon={<FilterIcon />} onClick={() => { setDraftFilters(filters); setFiltersOpen(true); }}>Filter</Button>
        </Stack>
      </Stack>

        {visible.length === 0 ? <Card variant="outlined" sx={{ borderRadius: 2, minHeight: 300, display: 'grid', placeItems: 'center' }}><Stack spacing={1} sx={{ alignItems: 'center', color: 'text.secondary' }}><CapdevIcon sx={{ fontSize: 42 }} /><Typography>No CapDev projects found</Typography></Stack></Card> :
          <Grid container spacing={3} sx={{ flexGrow: 1, alignContent: 'flex-start' }}>{visible.map((project) => <Grid key={project.id} size={{ xs: 12, sm: 6, md: 4 }} sx={{ position: 'relative', pt: 3 }}>
            <Box sx={{ position: 'absolute', top: 0, left: 0, zIndex: 0, height: 48, p: '1px', bgcolor: 'divider', clipPath: 'polygon(10px 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 10px 100%, 0 50%)' }}><Box sx={{ height: '100%', px: 2, pt: .5, bgcolor: '#fafcfa', clipPath: 'polygon(10px 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 10px 100%, 0 50%)', display: 'flex', alignItems: 'flex-start' }}><Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap', lineHeight: 1.3 }}>Added {formatDate(project.createdAt)}</Typography></Box></Box>
            <Card variant="outlined" sx={{ position: 'relative', zIndex: 1, borderRadius: 2, bgcolor: '#ffffff', height: '100%', display: 'flex', flexDirection: 'column', transition: 'all 0.2s', '&:hover': { boxShadow: '0 4px 12px rgba(0,0,0,0.04)', borderColor: 'primary.main' } }}>
              <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', p: 3 }}>
                <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', mb: 2 }}><Box sx={{ bgcolor: 'rgba(46, 125, 50, 0.08)', p: 1.2, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CapdevIcon color="primary" /></Box><Box sx={{ flexGrow: 1 }}><Typography variant="h6" sx={{ fontWeight: '700', color: 'text.primary', lineHeight: 1.2 }}>{project.aipCode}</Typography><Typography variant="body2" color="text.secondary">{project.department}</Typography></Box></Stack>
                <Typography variant="body2" color="text.secondary" noWrap sx={{ mb: 1.5 }}>{project.description}</Typography><Stack spacing={1.5} sx={{ my: 1 }}><Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Typography variant="body2" color="text.secondary">Initial Budget</Typography><Typography variant="body2" sx={{ fontWeight: '700', color: 'primary.dark' }}>{formatCurrency(project.initialBudget)}</Typography></Stack><Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Typography variant="body2" color="text.secondary">Remaining Budget</Typography><Typography variant="body2" sx={{ fontWeight: '700', color: 'primary.dark' }}>{formatCurrency(project.budget)}</Typography></Stack></Stack>
                <Divider sx={{ my: 2 }} />
                <Stack direction="row" sx={{ mt: 'auto', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}><Button variant="text" color="primary" endIcon={<ChevronRightIcon />} onClick={() => router.push(`/admin/capdev/${project.id}/requests`)} sx={{ p: 0, minWidth: 0, fontWeight: '700', '&:hover': { bgcolor: 'transparent', color: 'primary.dark' } }}>View Requests</Button><Stack direction="row" spacing={3}><Button variant="text" color="primary" onClick={() => openEdit(project)} sx={{ p: 0, minWidth: 0, fontWeight: '700', '&:hover': { bgcolor: 'transparent', color: 'primary.dark' } }}>Details</Button>{isAdmin && <Button variant="text" color="error" onClick={() => { setDeleteError(''); setDeleting(project); }} aria-label={`Delete ${project.aipCode}`} sx={{ p: 0, minWidth: 0, fontWeight: '700', '&:hover': { bgcolor: 'transparent', color: '#b71c1c' } }}>Delete</Button>}</Stack></Stack>
              </CardContent>
            </Card>
          </Grid>)}</Grid>}

      {filtered.length > 6 && <Stack direction="row" spacing={2} sx={{ justifyContent: 'center', alignItems: 'center', mt: 3 }}><Button variant="outlined" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><Typography variant="body2" sx={{ fontWeight: 700 }}>Page {page} of {pageCount}</Typography><Button variant="outlined" disabled={page === pageCount} onClick={() => setPage((value) => value + 1)}>Next</Button></Stack>}
      {isAdmin && <Fab variant="extended" color="primary" onClick={openCreate} sx={{ position: 'fixed', right: 24, bottom: 24, zIndex: 1100, px: 2.5 }}><AddIcon sx={{ mr: 1 }} />Add CapDev</Fab>}

      <Dialog open={editorOpen} onClose={() => !saving && setEditorOpen(false)} fullWidth maxWidth="md">
        <DialogTitle sx={{ fontWeight: 800 }}>{editing ? 'Edit CapDev Project' : 'Add CapDev Project'}</DialogTitle>
        <DialogContent dividers>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 2 }}>Required Information</Typography>
          <Grid container spacing={2.5} sx={{ pt: 0.5 }}>
            <Grid size={{ xs: 12, sm: 6 }}><TextField required fullWidth label="AIP Code" value={form.aipCode} onChange={(event) => setValue({ aipCode: event.target.value })} /></Grid>
            <Grid size={{ xs: 12, sm: 6 }}><TextField required fullWidth label="Department" value={form.department} onChange={(event) => setValue({ department: event.target.value })} /></Grid>
            <Grid size={12}><TextField required fullWidth label="Description" multiline minRows={2} value={form.description} onChange={(event) => setValue({ description: event.target.value })} /></Grid>
            {editing ? <><Grid size={{ xs: 12, sm: 6 }}><Typography variant="body2" color="text.secondary">Initial Budget</Typography><Typography sx={{ fontWeight: 700 }}>{formatCurrency(form.initialBudget)}</Typography></Grid><Grid size={{ xs: 12, sm: 6 }}><Typography variant="body2" color="text.secondary">Remaining Budget</Typography><Typography sx={{ fontWeight: 700, color: 'primary.dark' }}>{formatCurrency(form.budget)}</Typography></Grid></> : <Grid size={12}><TextField required fullWidth label="Initial Budget" type="number" value={form.budget} onChange={(event) => setValue({ budget: event.target.value, initialBudget: event.target.value })} /></Grid>}
            {requiredDefinitions.map(renderDynamicField)}
          </Grid>
          {configuredSections.map((section) => { const fields = additionalDefinitions.filter((field) => (field.section || 'Additional Information') === section); return <React.Fragment key={section}><Divider sx={{ my: 3 }} /><Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 2 }}>{getSectionLabel(section)}</Typography><Grid container spacing={2.5}>{fields.map(renderDynamicField)}</Grid></React.Fragment>; })}
          {editing && <><Divider sx={{ my: 3 }} /><Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 2 }}>Budget History</Typography><Stack spacing={1.25}><Stack direction="row" sx={{ justifyContent: 'space-between' }}><Typography variant="body2">Initial budget</Typography><Typography variant="body2" sx={{ fontWeight: 800 }}>{formatCurrency(form.initialBudget)}</Typography></Stack>{budgetHistory.map((entry, index) => <Stack key={`${String(entry.createdAt)}-${index}`} direction="row" spacing={1} sx={{ pl: 2, alignItems: 'center', color: 'error.main' }}><Typography aria-hidden sx={{ fontWeight: 800 }}>└</Typography><Typography variant="body2" sx={{ flexGrow: 1 }}>Deducted by {entry.authorName || 'Staff member'}</Typography><Typography variant="body2" sx={{ fontWeight: 800 }}>−{formatCurrency(entry.amount)}</Typography></Stack>)}<Divider /><Stack direction="row" sx={{ justifyContent: 'space-between' }}><Typography variant="body2" sx={{ fontWeight: 800 }}>Remaining budget</Typography><Typography variant="body2" sx={{ fontWeight: 800, color: 'primary.dark' }}>{formatCurrency(form.budget)}</Typography></Stack></Stack><Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 3 }}>Added {formatDate(editing.createdAt)}</Typography></>}
        </DialogContent>
        <DialogActions sx={{ p: 2.5 }}><Button onClick={() => setEditorOpen(false)} disabled={saving} color="inherit">Close</Button>{isAdmin && <Button onClick={saveProject} disabled={saving || !form.aipCode || !form.description || !form.budget || !form.department || !areRequiredFieldsComplete} variant="contained">{saving ? 'Saving' : 'Save CapDev'}</Button>}</DialogActions>
      </Dialog>
      <Dialog open={filtersOpen} onClose={() => setFiltersOpen(false)} fullWidth maxWidth="sm"><DialogTitle sx={{ fontWeight: 800 }}>Filter CapDev Projects</DialogTitle><DialogContent dividers><Grid container spacing={2} sx={{ pt: .5 }}><Grid size={12}><Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>Departments</Typography>{departments.map((item) => <FormControlLabel key={item} control={<Checkbox checked={draftFilters.departments.length === 0 || draftFilters.departments.includes(item)} onChange={() => setDraftFilters((current) => ({ ...current, departments: current.departments.length === 0 ? departments.filter((department) => department !== item) : current.departments.includes(item) ? current.departments.filter((department) => department !== item) : [...current.departments, item] }))} />} label={item} sx={{ display: 'flex', width: 'fit-content' }} />)}</Grid><Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="Initial budget from" type="number" value={draftFilters.initialMin} onChange={(e) => setDraftFilters({ ...draftFilters, initialMin: e.target.value })} /></Grid><Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="Initial budget to" type="number" value={draftFilters.initialMax} onChange={(e) => setDraftFilters({ ...draftFilters, initialMax: e.target.value })} /></Grid><Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="Remaining budget from" type="number" value={draftFilters.remainingMin} onChange={(e) => setDraftFilters({ ...draftFilters, remainingMin: e.target.value })} /></Grid><Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="Remaining budget to" type="number" value={draftFilters.remainingMax} onChange={(e) => setDraftFilters({ ...draftFilters, remainingMax: e.target.value })} /></Grid><Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="Date added from" type="date" slotProps={{ inputLabel: { shrink: true } }} value={draftFilters.dateFrom} onChange={(e) => setDraftFilters({ ...draftFilters, dateFrom: e.target.value })} /></Grid><Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="Date added to" type="date" slotProps={{ inputLabel: { shrink: true } }} value={draftFilters.dateTo} onChange={(e) => setDraftFilters({ ...draftFilters, dateTo: e.target.value })} /></Grid><Grid size={12}><Stack direction="row" spacing={1}><Button size="small" onClick={() => { const d = new Date().toISOString().slice(0, 10); setDraftFilters({ ...draftFilters, dateFrom: d, dateTo: d }); }}>Today</Button><Button size="small" onClick={() => { const d = new Date(); setDraftFilters({ ...draftFilters, dateFrom: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`, dateTo: d.toISOString().slice(0,10) }); }}>This month</Button><Button size="small" onClick={() => { const d = new Date(); setDraftFilters({ ...draftFilters, dateFrom: `${d.getFullYear()}-01-01`, dateTo: d.toISOString().slice(0,10) }); }}>This year</Button></Stack></Grid><Grid size={12}><TextField select fullWidth label="Sort" value={draftFilters.sort} onChange={(e) => setDraftFilters({ ...draftFilters, sort: e.target.value })}><MenuItem value="newest">Newest to oldest</MenuItem><MenuItem value="oldest">Oldest to newest</MenuItem></TextField></Grid></Grid></DialogContent><DialogActions sx={{ p: 2.5 }}><Button onClick={() => setDraftFilters({ departments: [], initialMin: '', initialMax: '', remainingMin: '', remainingMax: '', dateFrom: '', dateTo: '', sort: 'newest' })}>Reset</Button><Button variant="contained" onClick={() => { setFilters({ ...draftFilters, departments: [...draftFilters.departments] }); resetPage(); setFiltersOpen(false); }}>Apply Filters</Button></DialogActions></Dialog>
      <Dialog open={Boolean(deleting)} onClose={() => !saving && setDeleting(null)} maxWidth="xs" fullWidth><DialogTitle sx={{ fontWeight: 800 }}>Delete CapDev Project?</DialogTitle><DialogContent><Stack spacing={2}>{deleteError && <Alert severity="error">{deleteError}</Alert>}<Typography>
  This permanently deletes {deleting?.aipCode} and all its requests. This cannot be undone.
</Typography></Stack></DialogContent><DialogActions sx={{ p: 2.5 }}><Button onClick={() => setDeleting(null)} disabled={saving}>Cancel</Button><Button color="error" variant="contained" onClick={removeProject} disabled={saving} sx={{ whiteSpace: 'nowrap' }}>{saving ? 'Deleting' : 'Delete project'}</Button></DialogActions></Dialog>
      </Container>
    </Box>
  );
}
