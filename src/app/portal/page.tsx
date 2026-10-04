'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Add as AddIcon, ChevronRight as ChevronRightIcon, DeleteOutlined as DeleteIcon, FilterList as FilterIcon, FolderOpen as CapdevIcon, Search as SearchIcon, VisibilityOutlined as VisibilityIcon } from '@mui/icons-material';
import { Alert, Autocomplete, Box, Button, Card, CardContent, Checkbox, Container, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Fab, FormControlLabel, Grid, IconButton, InputAdornment, MenuItem, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { authClient } from '@/lib/auth/client';
import { createCapdev, deleteCapdev, getCapdevPage, getCapdevBudgetHistory, getCapdevFieldDefinitions, getCurrentUserAccess, getDepartmentOptions, updateCapdev, type AppRole, type StatusAttachment } from '@/app/actions';
import { manilaDate } from '@/lib/manila-date';
import DateField from '@/components/DateField';
import SelectionCombobox from '@/components/SelectionCombobox';
import DynamicTableField from '@/components/DynamicTableField';
import { ResourceGridSkeleton } from '@/components/Skeletons';
import DepartmentCombobox from '@/components/DepartmentCombobox';
import { dynamicFieldStorageKey, getDynamicFieldValue } from '@/lib/dynamic-fields';
import { uploadFilesDirectlyToGoogleDrive } from '@/lib/google-drive-client';
import ActionErrorDialog from '@/components/ActionErrorDialog';
import { getHalfFieldLayout } from '@/components/FieldReorder';
import FileFieldChecklist from '@/components/FileFieldChecklist';

type DynamicField = { id: number; name: string; type: string; options: string[] | null; isRequired: boolean; section: string; width: string; columnPosition: string; placeholder: string | null };
type Capdev = { id: number; aipCode: string; description: string; initialBudget: string; budget: string; department: string; updatedById: string; createdAt: Date | string; additionalInfo: Record<string, unknown> };
type CapdevForm = Omit<Capdev, 'id' | 'createdAt' | 'updatedById'>;
type BudgetHistoryEntry = { authorName: string | null; amount: string; createdAt: Date | string };

const EMPTY_FORM: CapdevForm = { aipCode: '', description: '', initialBudget: '', budget: '', department: '', additionalInfo: {} };
const formatCurrency = (value: string) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(Number(value) || 0);
const formatDate = (value: Date | string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
const getAttachments = (value: unknown): StatusAttachment[] => Array.isArray(value) ? value.filter((file): file is StatusAttachment => typeof file === 'object' && file !== null && 'id' in file && 'name' in file && 'url' in file) : [];
const formatAipCode = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 17);
  const groupLengths = [4, 3, 1, 1, 2, 3, 3];
  const groups: string[] = [];
  let offset = 0;
  for (const length of groupLengths) {
    const group = digits.slice(offset, offset + length);
    if (!group) break;
    groups.push(group);
    offset += length;
  }
  return groups.join('-');
};

export default function PortalPage() {
  const router = useRouter();
  const session = authClient.useSession();
  const [projects, setProjects] = useState<Capdev[]>([]);
  const [total, setTotal] = useState(0);
  const [departments, setDepartments] = useState<string[]>([]);
  const [loadError, setLoadError] = useState('');
  const loadSequence = useRef(0);
  const [departmentOptions, setDepartmentOptions] = useState<string[]>([]);
  const [departmentIsOther, setDepartmentIsOther] = useState(false);
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
  const [notificationFocus, setNotificationFocus] = useState<{ targetId: string; nonce: number } | null>(null);
  const filtersInitialized = useRef(false);
  const saveProjectInFlight = useRef(false);

  useEffect(() => { if (session.data) void getCurrentUserAccess().then((access) => { if (access.success) setRole(access.role); }); }, [session.data]);

  useEffect(() => {
    const focusTarget = (targetId: string) => {
      if (/^capdev-record-\d+$/.test(targetId)) setNotificationFocus({ targetId, nonce: Date.now() });
    };
    const focusFromHash = () => {
      const targetId = decodeURIComponent(window.location.hash.slice(1));
      if (targetId) focusTarget(targetId);
    };
    const handleNotificationFocus = (event: Event) => {
      const detail = (event as CustomEvent<{ targetId?: string }>).detail;
      if (detail?.targetId) focusTarget(detail.targetId);
    };

    window.addEventListener('hashchange', focusFromHash);
    window.addEventListener('leaprs:notification-focus', handleNotificationFocus);
    focusFromHash();
    return () => {
      window.removeEventListener('hashchange', focusFromHash);
      window.removeEventListener('leaprs:notification-focus', handleNotificationFocus);
    };
  }, []);

  const userId = session.data?.user.id;
  const loadData = useCallback(async () => {
    if (!userId) return;
    const sequence = ++loadSequence.current;
    try {
      const result = await getCapdevPage({ page, search, filters,
        focusId: notificationFocus ? Number(notificationFocus.targetId.replace('capdev-record-', '')) : undefined });
      if (sequence !== loadSequence.current) return;
      if (!result.success) { setLoadError(result.error); return; }
      setLoadError('');
      setProjects(result.records.map((project) => ({ ...project, initialBudget: String(project.initialBudget), budget: String(project.budget),
        additionalInfo: project.additionalInfo as Record<string, unknown> })));
      setTotal(result.total);
      setDepartments(result.departments);
      setPage(result.page);
      if (!filtersInitialized.current || notificationFocus) {
        const next = { ...filters, departments: result.departments };
        if (notificationFocus) {
          Object.assign(next, { initialMin: '', initialMax: '', remainingMin: '', remainingMax: '', dateFrom: '', dateTo: '', sort: 'newest' });
          setSearch('');
        }
        if (JSON.stringify(next) !== JSON.stringify(filters)) setFilters(next);
        setDraftFilters(next);
        filtersInitialized.current = true;
      }
    } catch {
      if (sequence === loadSequence.current) setLoadError('Unable to load projects. Please try again.');
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [userId, page, search, filters, notificationFocus]);

  useEffect(() => {
    let active = true;
    const sequenceRef = loadSequence;
    void Promise.resolve().then(() => { if (active) return loadData(); });
    return () => { active = false; sequenceRef.current++; };
  }, [loadData]);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    void Promise.all([getCapdevFieldDefinitions(), getDepartmentOptions()]).then(([fields, options]) => {
      if (!active) return;
      setDefinitions(fields.map((field) => ({ ...field, options: Array.isArray(field.options) ? field.options.filter((option): option is string => typeof option === 'string') : [] })));
      setDepartmentOptions(options);
    }).catch(() => { if (active) setLoadError('Unable to load project configuration.'); });
    return () => { active = false; };
  }, [userId]);

  const pageCount = Math.max(1, Math.ceil(total / 6));
  const visible = projects;

  useEffect(() => {
    if (!notificationFocus || loading) return;
    const target = document.getElementById(notificationFocus.targetId);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const timeoutId = window.setTimeout(() => {
      setNotificationFocus((current) => current?.nonce === notificationFocus.nonce ? null : current);
    }, 1400);
    return () => window.clearTimeout(timeoutId);
  }, [loading, notificationFocus, projects]);
  const requiredDefinitions = definitions.filter((field) => field.isRequired || field.section === 'required');
  const allDefinitions = definitions;
  const rightAlignedFieldIds = getHalfFieldLayout(allDefinitions.map((field) => ({ ...field, key: field.id }))).before;
  const resetPage = () => setPage(1);
  const setValue = (updates: Partial<CapdevForm>) => setForm((current) => ({ ...current, ...updates }));
  const setDynamicValue = (field: DynamicField, value: unknown) => setForm((current) => ({ ...current, additionalInfo: { ...current.additionalInfo, [dynamicFieldStorageKey(field)]: value } }));

  const openCreate = () => { setError(''); setPendingFiles({}); setBudgetHistory([]); setEditing(null); setForm(EMPTY_FORM); setDepartmentIsOther(false); setEditorOpen(true); };
  const openEdit = async (project: Capdev) => { setError(''); setPendingFiles({}); setEditing(project); setForm({ ...project, department: (project.department && project.department !== 'None') ? project.department : '', additionalInfo: { ...project.additionalInfo } }); setDepartmentIsOther(false); setBudgetHistory(await getCapdevBudgetHistory(project.id)); setEditorOpen(true); };
  const addSelectedFiles = (fieldName: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    setPendingFiles((current) => ({ ...current, [fieldName]: [...(current[fieldName] || []), ...selectedFiles].filter((file, index, files) => files.findIndex((candidate) => candidate.name === file.name && candidate.size === file.size && candidate.lastModified === file.lastModified) === index) }));
    event.target.value = '';
  };
  const removeSelectedFile = (fieldName: string, file: File) => setPendingFiles((current) => ({ ...current, [fieldName]: (current[fieldName] || []).filter((candidate) => candidate !== file) }));
  const removeExistingAttachment = (field: DynamicField, fileId: string) => {
    const current = getDynamicFieldValue(form.additionalInfo, field);
    const updated = Array.isArray(current)
      ? current.filter((item: unknown) => (typeof item === 'object' && item && 'id' in item ? (item as { id: string }).id !== fileId : true))
      : [];
    setDynamicValue(field, updated);
  };
  const hasDynamicValue = (field: DynamicField) => {
    const storageKey = dynamicFieldStorageKey(field);
    const value = getDynamicFieldValue(form.additionalInfo, field);
    if (field.type === 'file') return getAttachments(value).length > 0 || (pendingFiles[storageKey] || []).length > 0;
    if (field.type === 'table') {
      if (Array.isArray(value) && value.length > 0) {
        return value.some((row) => Array.isArray(row) && row.some((cell) => String(cell || '').trim().length > 0));
      }
      return false;
    }
    return value !== undefined && value !== null && String(value).trim().length > 0;
  };
  const areRequiredFieldsComplete = requiredDefinitions.every(hasDynamicValue);

  const saveProject = async () => {
    if (saveProjectInFlight.current || !session.data || !form.aipCode || !form.budget) return;
    const aipCodePattern = /^\d{4}-\d{3}-\d-\d-\d{2}-\d{3}-\d{3}$/;
    if (!aipCodePattern.test(form.aipCode.trim())) {
      setError('AIP Code must follow the format: 0000-000-0-0-00-000-000');
      return;
    }
    const missingRequiredFields = requiredDefinitions.filter((field) => !hasDynamicValue(field));
    if (missingRequiredFields.length > 0) { setError(`Complete the required field${missingRequiredFields.length === 1 ? '' : 's'}: ${missingRequiredFields.map((field) => field.name).join(', ')}.`); return; }
    saveProjectInFlight.current = true;
    setSaving(true);
    setError('');
    try {
      const additionalInfo = { ...form.additionalInfo };
      for (const [fieldName, files] of Object.entries(pendingFiles)) {
        if (files.length === 0) continue;
        const field = definitions.find((definition) => dynamicFieldStorageKey(definition) === fieldName);
        const uploaded = await uploadFilesDirectlyToGoogleDrive(files);
        if (!uploaded.success) {
          setError(uploaded.error || `Unable to upload ${field?.name || 'attachment'}.`);
          return;
        }
        const existingFiles = field ? getDynamicFieldValue(additionalInfo, field) : additionalInfo[fieldName];
        additionalInfo[fieldName] = [...(Array.isArray(existingFiles) ? existingFiles : []), ...uploaded.files];
      }
      const payload = { ...form, additionalInfo, aipCode: form.aipCode.trim(), department: (form.department && form.department.trim() !== 'None') ? form.department.trim() : '', updatedById: session.data.user.id };
      const result = editing ? await updateCapdev(editing.id, payload) : await createCapdev(payload);
      if (result.success) {
        setEditorOpen(false);
        const projectDept = payload.department?.trim() || 'None';
        setFilters((current) => ({
          ...current,
          departments: current.departments.includes(projectDept) ? current.departments : [...current.departments, projectDept],
        }));
        setPage(1);
        await loadData();
      } else {
        setError(result.error || 'Unable to save this CapDev project.');
      }
    } catch (error) {
      console.error('Failed to save CapDev project:', error);
      setError('Unable to save this CapDev project. Please try again.');
    } finally {
      saveProjectInFlight.current = false;
      setSaving(false);
    }
  };

  const renderDynamicField = (field: DynamicField) => {
    const isRequired = field.isRequired || field.section === 'required';
    const storageKey = dynamicFieldStorageKey(field);
    const fieldValue = getDynamicFieldValue(form.additionalInfo, field);
    return (
      <Grid
        key={field.id}
        size={field.type === 'table' ? 12 : field.width === 'half' ? { xs: 12, sm: 6 } : 12}
        offset={rightAlignedFieldIds.has(field.id) ? { xs: 0, sm: 6 } : undefined}
      >
        {field.type === 'combobox' ? (
          <SelectionCombobox
            label={field.name}
            required={field.isRequired}
            options={field.options}
            value={String(fieldValue || '')}
            placeholder={field.placeholder || undefined}

            onChange={(value) => setDynamicValue(field, value)}
          />
        ) : ((field.type === 'text' || field.type === 'textarea') && field.options && field.options.length > 0) ? (
          <Autocomplete
            freeSolo
            options={field.options}
            value={String(fieldValue || '')}
            inputValue={String(fieldValue || '')}
            onChange={(_, value, reason) => {
              if (reason === 'selectOption' && typeof value === 'string') {
                const current = String(fieldValue || '').trim();
                const concatenated = current ? `${current} ${value.trim()}` : value.trim();
                setDynamicValue(field, concatenated);
              } else if (reason === 'clear') {
                setDynamicValue(field, '');
              } else if (typeof value === 'string') {
                setDynamicValue(field, value);
              }
            }}
            onInputChange={(_, value, reason) => {
              if (reason === 'input') {
                setDynamicValue(field, value);
              }
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                required={isRequired}
                fullWidth
                label={field.name}
                placeholder={field.placeholder || 'Select or type...'}
              />
            )}
          />
        ) : (field.type === 'text' || field.type === 'textarea') ? (
          <TextField
            required={isRequired}
            fullWidth
            multiline
            minRows={1}
            label={field.name}
            placeholder={field.placeholder || ''}
            value={String(fieldValue || '')}
            onChange={(event) => setDynamicValue(field, event.target.value)}
          />
        ) : field.type === 'table' ? (
          <DynamicTableField
            label={field.name}
            required={isRequired}
            value={fieldValue}
            template={field.options?.[0]}
            showDimensionControls={false}
            onChange={(val) => setDynamicValue(field, val)}
          />
        ) : field.type === 'date' ? (
          <DateField
            label={field.name}
            required={isRequired}
            value={String(fieldValue || '')}
            onChange={(value) => setDynamicValue(field, value)}
          />
        ) : field.type === 'file' ? (
          <FileFieldChecklist
            label={field.name}
            required={isRequired}
            existingFiles={getAttachments(fieldValue)}
            pendingFiles={pendingFiles[storageKey] || []}
            editable={isAdmin}
            onSelectFiles={(event) => addSelectedFiles(storageKey, event)}
            onRemoveExisting={(fileId) => removeExistingAttachment(field, fileId)}
            onRemovePending={(file) => removeSelectedFile(storageKey, file)}
          />
        ) : (
          <TextField
            required={isRequired}
            fullWidth
            label={field.name}
            type={field.type === 'number' ? 'number' : 'text'}
            value={String(fieldValue || '')}
            placeholder={field.placeholder || ''}
            onChange={(event) => setDynamicValue(field, event.target.value)}
          />
        )}
      </Grid>
    );
  };

  const removeProject = async () => {
    if (!deleting) return;
    setSaving(true);
    const result = await deleteCapdev(deleting.id);
    if (result.success) { setDeleting(null); await loadData(); }
    else { setDeleteError(result.error || 'Unable to delete this CapDev project.'); }
    setSaving(false);
  };

  if (session.isPending || loading) return <ResourceGridSkeleton titleWidth={220} />;
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

        {loadError && <Alert severity="error" sx={{ mb: 2 }}>{loadError}<Button onClick={() => void loadData()}>Retry</Button></Alert>}
        {visible.length === 0 ? <Card variant="outlined" sx={{ borderRadius: 2, minHeight: 300, display: 'grid', placeItems: 'center' }}><Stack spacing={1} sx={{ alignItems: 'center', color: 'text.secondary' }}><CapdevIcon sx={{ fontSize: 42 }} /><Typography>No CapDev projects found</Typography></Stack></Card> :
          <Grid container spacing={3} sx={{ flexGrow: 1, alignContent: 'flex-start' }}>{visible.map((project) => <Grid id={`capdev-record-${project.id}`} key={project.id} size={{ xs: 12, sm: 6, md: 4 }} sx={{ position: 'relative', pt: 3, scrollMarginTop: 96 }}>
            <Box sx={{ position: 'absolute', top: 0, left: 0, zIndex: 0, height: 48, p: '1px', bgcolor: 'divider', clipPath: 'polygon(10px 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 10px 100%, 0 50%)' }}><Box sx={{ height: '100%', px: 2, pt: .5, bgcolor: '#fafcfa', clipPath: 'polygon(10px 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 10px 100%, 0 50%)', display: 'flex', alignItems: 'flex-start' }}><Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap', lineHeight: 1.3 }}>Added {formatDate(project.createdAt)}</Typography></Box></Box>
            <Card variant="outlined" sx={{ position: 'relative', zIndex: 1, borderRadius: 2, bgcolor: '#ffffff', height: '100%', display: 'flex', flexDirection: 'column', transition: 'all 0.2s', animation: notificationFocus?.targetId === `capdev-record-${project.id}` ? 'capdevNotificationFocus 900ms ease-in-out' : 'none', '@keyframes capdevNotificationFocus': { '0%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(46, 125, 50, 0)' }, '30%': { transform: 'scale(0.975)', boxShadow: '0 0 0 3px rgba(46, 125, 50, 0.22)' }, '65%': { transform: 'scale(1.025)', boxShadow: '0 8px 24px rgba(46, 125, 50, 0.2)' }, '100%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(46, 125, 50, 0)' } }, '&:hover': { boxShadow: '0 4px 12px rgba(0,0,0,0.04)', borderColor: 'primary.main' } }}>
              <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', p: 3 }}>
                <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', mb: 2 }}><Box sx={{ bgcolor: 'rgba(46, 125, 50, 0.08)', p: 1.2, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CapdevIcon color="primary" /></Box><Box sx={{ flexGrow: 1 }}><Typography variant="h6" sx={{ fontWeight: '700', color: 'text.primary', lineHeight: 1.2 }}>{project.aipCode}</Typography>{project.department && project.department !== 'None' && <Typography variant="body2" color="text.secondary">{project.department}</Typography>}</Box></Stack>
                <Stack spacing={1.5} sx={{ my: 1 }}><Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Typography variant="body2" color="text.secondary">Initial Balance</Typography><Typography variant="body2" sx={{ fontWeight: '700', color: 'primary.dark' }}>{formatCurrency(project.initialBudget)}</Typography></Stack><Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Typography variant="body2" color="text.secondary">Remaining Balance</Typography><Typography variant="body2" sx={{ fontWeight: '700', color: Number(project.budget) <= 0 ? 'error.main' : 'primary.dark' }}>{formatCurrency(project.budget)}</Typography></Stack></Stack>
                <Divider sx={{ my: 2 }} />
                <Stack direction="row" sx={{ mt: 'auto', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                  <Button variant="text" color="primary" endIcon={<ChevronRightIcon />} onClick={() => router.push(`/portal/capdev/${project.id}/requests`)} sx={{ p: 0, minWidth: 0, fontWeight: '700', '&:hover': { bgcolor: 'transparent', color: 'primary.dark' } }}>
                    View Requests
                  </Button>
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                    <Tooltip title="View & Edit Details">
                      <IconButton size="small" color="primary" onClick={() => openEdit(project)} aria-label={`View details for ${project.aipCode}`}>
                        <VisibilityIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {isAdmin && (
                      <Tooltip title="Delete Project">
                        <IconButton size="small" color="error" onClick={() => { setDeleteError(''); setDeleting(project); }} aria-label={`Delete ${project.aipCode}`}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          </Grid>)}</Grid>}

      {total > 6 && <Stack direction="row" spacing={2} sx={{ justifyContent: 'center', alignItems: 'center', mt: 3 }}><Button variant="outlined" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><Typography variant="body2" sx={{ fontWeight: 700 }}>Page {page} of {pageCount}</Typography><Button variant="outlined" disabled={page === pageCount} onClick={() => setPage((value) => value + 1)}>Next</Button></Stack>}
      {isAdmin && <Fab variant="extended" color="primary" onClick={openCreate} sx={{ position: 'fixed', right: 24, bottom: 24, zIndex: 1100, px: 2.5 }}><AddIcon sx={{ mr: 1 }} />Add CapDev</Fab>}

      <Dialog open={editorOpen} onClose={() => !saving && setEditorOpen(false)} fullWidth maxWidth="md">
        <DialogTitle sx={{ fontWeight: 800 }}>{editing ? 'Edit CapDev Project' : 'Add CapDev Project'}</DialogTitle>
        <DialogContent dividers>
          <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 2 }}>Capacity Development</Typography>
          <Grid container spacing={2.5} sx={{ pt: 0.5 }}>
            <Grid size={{ xs: 12, sm: 6 }}><TextField required fullWidth label="AIP Code" placeholder="0000-000-0-0-00-000-000" value={form.aipCode} onChange={(event) => setValue({ aipCode: formatAipCode(event.target.value) })} /></Grid>
            <Grid size={{ xs: 12, sm: 6 }}><DepartmentCombobox options={departmentOptions} value={form.department} onChange={(department) => setValue({ department })} otherSelected={departmentIsOther} onOtherSelectedChange={setDepartmentIsOther} /></Grid>
            {editing ? <><Grid size={{ xs: 12, sm: 6 }}><Typography variant="body2" color="text.secondary">Initial Balance</Typography><Typography sx={{ fontWeight: 700 }}>{formatCurrency(form.initialBudget)}</Typography></Grid><Grid size={{ xs: 12, sm: 6 }}><Typography variant="body2" color="text.secondary">Remaining Balance</Typography><Typography sx={{ fontWeight: 700, color: Number(form.budget) <= 0 ? 'error.main' : 'primary.dark' }}>{formatCurrency(form.budget)}</Typography></Grid></> : <Grid size={12}><TextField required fullWidth label="Initial Balance" type="number" value={form.budget} onChange={(event) => setValue({ budget: event.target.value, initialBudget: event.target.value })} /></Grid>}
            {allDefinitions.map(renderDynamicField)}
          </Grid>
          {editing && <><Divider sx={{ my: 3 }} /><Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 2 }}>Balance History</Typography><Stack spacing={1.25}><Stack direction="row" sx={{ justifyContent: 'space-between' }}><Typography variant="body2">Initial balance</Typography><Typography variant="body2" sx={{ fontWeight: 800 }}>{formatCurrency(form.initialBudget)}</Typography></Stack>{budgetHistory.map((entry, index) => <Stack key={`${String(entry.createdAt)}-${index}`} direction="row" spacing={1} sx={{ pl: 2, alignItems: 'center', color: 'error.main' }}><Typography aria-hidden sx={{ fontWeight: 800 }}>└</Typography><Typography variant="body2" sx={{ flexGrow: 1 }}>Deducted by {entry.authorName || 'Staff member'}</Typography><Typography variant="body2" sx={{ fontWeight: 800 }}>−{formatCurrency(entry.amount)}</Typography></Stack>)}<Divider /><Stack direction="row" sx={{ justifyContent: 'space-between' }}><Typography variant="body2" sx={{ fontWeight: 800 }}>Remaining balance</Typography><Typography variant="body2" sx={{ fontWeight: 800, color: Number(form.budget) <= 0 ? 'error.main' : 'primary.dark' }}>{formatCurrency(form.budget)}</Typography></Stack></Stack><Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 3 }}>Added {formatDate(editing.createdAt)}</Typography></>}
        </DialogContent>
        <DialogActions sx={{ p: 2.5 }}><Button onClick={() => setEditorOpen(false)} disabled={saving} color="inherit">Close</Button>{isAdmin && <Button onClick={saveProject} disabled={saving || !form.aipCode || !form.budget || !areRequiredFieldsComplete} variant="contained">{saving ? 'Saving' : 'Save CapDev'}</Button>}</DialogActions>
      </Dialog>
      <ActionErrorDialog open={Boolean(error)} title="Unable to Save CapDev" message={error} onClose={() => setError('')} />
      <Dialog open={filtersOpen} onClose={() => setFiltersOpen(false)} fullWidth maxWidth="sm"><DialogTitle sx={{ fontWeight: 800 }}>Filter CapDev Projects</DialogTitle><DialogContent dividers><Grid container spacing={2} sx={{ pt: .5 }}><Grid size={12}><Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>Departments</Typography>{departments.map((item) => <FormControlLabel key={item} control={<Checkbox checked={draftFilters.departments.includes(item)} onChange={() => setDraftFilters((current) => ({ ...current, departments: current.departments.includes(item) ? current.departments.filter((department) => department !== item) : [...current.departments, item] }))} />} label={item} sx={{ display: 'flex', width: 'fit-content' }} />)}</Grid><Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="Initial balance from" type="number" value={draftFilters.initialMin} onChange={(e) => setDraftFilters({ ...draftFilters, initialMin: e.target.value })} /></Grid><Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="Initial balance to" type="number" value={draftFilters.initialMax} onChange={(e) => setDraftFilters({ ...draftFilters, initialMax: e.target.value })} /></Grid><Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="Remaining balance from" type="number" value={draftFilters.remainingMin} onChange={(e) => setDraftFilters({ ...draftFilters, remainingMin: e.target.value })} /></Grid><Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="Remaining balance to" type="number" value={draftFilters.remainingMax} onChange={(e) => setDraftFilters({ ...draftFilters, remainingMax: e.target.value })} /></Grid><Grid size={{ xs: 12, sm: 6 }}><DateField label="Date added from" value={draftFilters.dateFrom} onChange={(val) => setDraftFilters({ ...draftFilters, dateFrom: val })} /></Grid><Grid size={{ xs: 12, sm: 6 }}><DateField label="Date added to" value={draftFilters.dateTo} onChange={(val) => setDraftFilters({ ...draftFilters, dateTo: val })} /></Grid><Grid size={12}><Stack direction="row" spacing={1}><Button size="small" onClick={() => { const d = manilaDate(); setDraftFilters({ ...draftFilters, dateFrom: d, dateTo: d }); }}>Today</Button><Button size="small" onClick={() => { const d = manilaDate(); setDraftFilters({ ...draftFilters, dateFrom: d.slice(0, 7) + '-01', dateTo: d }); }}>This month</Button><Button size="small" onClick={() => { const d = manilaDate(); setDraftFilters({ ...draftFilters, dateFrom: d.slice(0, 4) + '-01-01', dateTo: d }); }}>This year</Button></Stack></Grid><Grid size={12}><TextField select fullWidth label="Sort" value={draftFilters.sort} onChange={(e) => setDraftFilters({ ...draftFilters, sort: e.target.value })}><MenuItem value="newest">Newest to oldest</MenuItem><MenuItem value="oldest">Oldest to newest</MenuItem></TextField></Grid></Grid></DialogContent><DialogActions sx={{ p: 2.5 }}><Button onClick={() => setDraftFilters({ departments: [...departments], initialMin: '', initialMax: '', remainingMin: '', remainingMax: '', dateFrom: '', dateTo: '', sort: 'newest' })}>Reset</Button><Button variant="contained" onClick={() => { setFilters({ ...draftFilters, departments: [...draftFilters.departments] }); resetPage(); setFiltersOpen(false); }}>Apply Filters</Button></DialogActions></Dialog>
      <Dialog open={Boolean(deleting)} onClose={() => !saving && setDeleting(null)} maxWidth="xs" fullWidth><DialogTitle sx={{ fontWeight: 800 }}>Delete CapDev Project?</DialogTitle><DialogContent><Stack spacing={2}>{deleteError && <Alert severity="error">{deleteError}</Alert>}<Typography>
  This permanently deletes {deleting?.aipCode} and all its requests. This cannot be undone.
</Typography></Stack></DialogContent><DialogActions sx={{ p: 2.5 }}><Button onClick={() => setDeleting(null)} disabled={saving}>Cancel</Button><Button color="error" variant="contained" onClick={removeProject} disabled={saving} sx={{ whiteSpace: 'nowrap' }}>{saving ? 'Deleting' : 'Delete project'}</Button></DialogActions></Dialog>
      </Container>
    </Box>
  );
}
