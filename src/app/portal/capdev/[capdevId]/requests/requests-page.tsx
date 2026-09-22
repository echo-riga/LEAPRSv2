'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Add as AddIcon,
  AttachFile as AttachFileIcon,
  Assignment as RequestIcon,
  ChevronRight as ChevronRightIcon, Close as CloseIcon,
  DeleteOutlined as DeleteIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  Payments as PaymentsIcon,
  Search as SearchIcon,
  VisibilityOutlined as VisibilityIcon,
  WarningAmber as WarningIcon,
} from '@mui/icons-material';
import {
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Fab,
  Fade,
  Grid,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth/client';
import DateField from '@/components/DateField';
import DynamicTableField from '@/components/DynamicTableField';
import { ResourceGridSkeleton } from '@/components/Skeletons';
import { dynamicFieldStorageKey, getDynamicFieldValue } from '@/lib/dynamic-fields';
import {
  createRequest,
  deleteRequest,
  getCapdevById,
  getCapdevFieldDefinitions,
  getCurrentUserAccess,
  getRequestFieldDefinitions,
  getRequestsByCapdev,
  updateRequest,
  type AppRole,
  type StatusAttachment,
} from '@/app/actions';
import { uploadFilesDirectlyToGoogleDrive } from '@/lib/google-drive-client';
import ActionErrorDialog from '@/components/ActionErrorDialog';
import { getHalfFieldLayout } from '@/components/FieldReorder';

type RequestRecord = {
  id: number;
  capdevId: number;
  userId: string;
  requestorName: string | null;
  createdAt: Date | string;
  status: string;
  isComplete: boolean;
  hasDeductedBudget: boolean;
  setting: string;
  description: string;
  requestedBudget: string;
  additionalInfo: Record<string, unknown>;
};
type DynamicField = { id: number; name: string; type: string; options: string[] | null; isRequired: boolean; width: string; columnPosition: string; placeholder: string | null; section?: string };
type RequestForm = Pick<RequestRecord, 'setting' | 'description' | 'requestedBudget' | 'additionalInfo'>;
type CapdevDetail = {
  id: number;
  aipCode: string;
  department: string;
  description: string;
  initialBudget: string;
  budget: string;
  additionalInfo: Record<string, unknown>;
  createdAt: Date | string;
};

const EMPTY_FORM: RequestForm = { setting: 'internal', description: '', requestedBudget: '', additionalInfo: {} };
const formatDate = (value: Date | string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
const formatCurrency = (value: string | number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(Number(value) || 0);
const getAttachments = (value: unknown): StatusAttachment[] => Array.isArray(value) ? value.filter((file): file is StatusAttachment => typeof file === 'object' && file !== null && 'id' in file && 'name' in file && 'url' in file) : [];

const disabledFieldSx = {
  '& .MuiOutlinedInput-root': {
    bgcolor: '#f5f5f5',
    borderRadius: 2,
    '&.Mui-disabled': {
      bgcolor: '#f5f5f5',
      '& .MuiOutlinedInput-notchedOutline': {
        borderColor: 'rgba(0, 0, 0, 0.2)',
      },
    },
  },
  '& .MuiInputBase-input.Mui-disabled': {
    WebkitTextFillColor: 'rgba(0, 0, 0, 0.7)',
    fontWeight: 600,
  },
  '& .MuiInputLabel-root.Mui-disabled': {
    color: 'rgba(0, 0, 0, 0.65)',
    fontWeight: 600,
  },
};

export default function RequestsPage({ capdevId }: { capdevId: number }) {
  const router = useRouter();
  const session = authClient.useSession();
  const [capdev, setCapdev] = useState<CapdevDetail | null>(null);
  const [capdevDefinitions, setCapdevDefinitions] = useState<DynamicField[]>([]);
  const [requests, setRequests] = useState<RequestRecord[]>([]);
  const [definitions, setDefinitions] = useState<DynamicField[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({ setting: 'all', min: '', max: '', dateFrom: '', dateTo: '', sort: 'newest' });
  const [draftFilters, setDraftFilters] = useState(filters);
  const [page, setPage] = useState(1);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<RequestRecord | null>(null);
  const [deleting, setDeleting] = useState<RequestRecord | null>(null);
  const [form, setForm] = useState<RequestForm>(EMPTY_FORM);
  const [pendingFiles, setPendingFiles] = useState<Record<string, File[]>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [budgetValidationOpen, setBudgetValidationOpen] = useState(false);
  const [budgetValidationMessage, setBudgetValidationMessage] = useState('');
  const [role, setRole] = useState<AppRole>('employee');
  const [showScrollArrow, setShowScrollArrow] = useState(true);
  const [notificationFocus, setNotificationFocus] = useState<{ targetId: string; nonce: number } | null>(null);
  const capdevSectionRef = React.useRef<HTMLDivElement>(null);
  const activityDesignRef = React.useRef<HTMLDivElement>(null);

  const scrollToActivityDesign = () => {
    activityDesignRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setShowScrollArrow(false);
  };

  useEffect(() => { if (session.data) void getCurrentUserAccess().then((access) => { if (access.success) setRole(access.role); }); }, [session.data]);

  useEffect(() => {
    const focusTarget = (targetId: string) => {
      if (/^request-record-\d+$/.test(targetId)) setNotificationFocus({ targetId, nonce: Date.now() });
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

  const loadData = useCallback(async () => {
    const [projectData, requestData, fieldData, capdevFieldData] = await Promise.all([
      getCapdevById(capdevId),
      getRequestsByCapdev(capdevId),
      getRequestFieldDefinitions(),
      getCapdevFieldDefinitions(),
    ]);
    setCapdev(
      projectData
        ? {
            id: projectData.id,
            aipCode: projectData.aipCode,
            department: projectData.department,
            description: projectData.description,
            initialBudget: String(projectData.initialBudget),
            budget: String(projectData.budget),
            additionalInfo: (projectData.additionalInfo && typeof projectData.additionalInfo === 'object' ? projectData.additionalInfo : {}) as Record<string, unknown>,
            createdAt: projectData.createdAt,
          }
        : null
    );
    setCapdevDefinitions(
      capdevFieldData.map((field) => ({
        ...field,
        options: Array.isArray(field.options) ? field.options.filter((option): option is string => typeof option === 'string') : [],
      }))
    );
    setRequests(
      requestData.map((request) => {
        const isComplete = Boolean(request.isComplete || request.status === 'completed');
        const reqStatus = request.status || (isComplete ? 'completed' : 'in_progress');
        return {
          ...request,
          status: reqStatus,
          isComplete,
          hasDeductedBudget: Boolean(request.hasDeductedBudget),
          requestedBudget: String(request.requestedBudget),
          additionalInfo: (request.additionalInfo && typeof request.additionalInfo === 'object' ? request.additionalInfo : {}) as Record<string, unknown>,
        };
      })
    );
    setDefinitions(
      fieldData.map((field) => ({
        ...field,
        options: Array.isArray(field.options) ? field.options.filter((option): option is string => typeof option === 'string') : [],
      }))
    );
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

  const filtered = useMemo(() => requests.filter((request) => {
    const date = new Date(request.createdAt).getTime();
    return (
      (request.requestorName || '').toLowerCase().includes(search.toLowerCase()) &&
      (filters.setting === 'all' || request.setting === filters.setting) &&
      (!filters.min || Number(request.requestedBudget) >= Number(filters.min)) &&
      (!filters.max || Number(request.requestedBudget) <= Number(filters.max)) &&
      (!filters.dateFrom || date >= new Date(filters.dateFrom).getTime()) &&
      (!filters.dateTo || date <= new Date(`${filters.dateTo}T23:59:59`).getTime())
    );
  }).sort((a, b) => filters.sort === 'newest' ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()), [filters, requests, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / 6));
  const visible = filtered.slice((page - 1) * 6, page * 6);

  useEffect(() => {
    if (!notificationFocus || loading) return;
    const requestIdToFocus = Number(notificationFocus.targetId.replace('request-record-', ''));
    const filteredIndex = filtered.findIndex((request) => request.id === requestIdToFocus);

    if (filteredIndex < 0 && requests.some((request) => request.id === requestIdToFocus)) {
      const resetTimeoutId = window.setTimeout(() => {
        setSearch('');
        setFilters({ setting: 'all', min: '', max: '', dateFrom: '', dateTo: '', sort: 'newest' });
      }, 0);
      return () => window.clearTimeout(resetTimeoutId);
    }
    if (filteredIndex < 0) return;

    const targetPage = Math.floor(filteredIndex / 6) + 1;
    if (page !== targetPage) {
      const pageTimeoutId = window.setTimeout(() => setPage(targetPage), 0);
      return () => window.clearTimeout(pageTimeoutId);
    }

    const target = document.getElementById(notificationFocus.targetId);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const timeoutId = window.setTimeout(() => {
      setNotificationFocus((current) => current?.nonce === notificationFocus.nonce ? null : current);
    }, 1400);
    return () => window.clearTimeout(timeoutId);
  }, [filtered, loading, notificationFocus, page, requests]);
  const requiredDefinitions = definitions.filter((field) => field.isRequired || field.section === 'required');
  const allDefinitions = definitions;
  const rightAlignedFieldIds = getHalfFieldLayout(allDefinitions.map((field) => ({ ...field, key: field.id }))).before;
  const rightAlignedCapdevFieldIds = getHalfFieldLayout(capdevDefinitions.map((field) => ({ ...field, key: field.id }))).before;
  const setValue = (updates: Partial<RequestForm>) => setForm((current) => ({ ...current, ...updates }));
  const setDynamicValue = (field: DynamicField, value: unknown) => setForm((current) => ({ ...current, additionalInfo: { ...current.additionalInfo, [dynamicFieldStorageKey(field)]: value } }));
  const resetPage = () => setPage(1);

  const openCreate = () => { setError(''); setPendingFiles({}); setEditing(null); setForm(EMPTY_FORM); setShowScrollArrow(true); setEditorOpen(true); };
  const openEdit = (request: RequestRecord) => { setError(''); setPendingFiles({}); setEditing(request); setForm({ setting: request.setting, description: request.description, requestedBudget: request.requestedBudget, additionalInfo: { ...request.additionalInfo } }); setShowScrollArrow(true); setEditorOpen(true); };
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

  const saveRequest = async () => {
    if (!session.data || !form.requestedBudget) return;

    const missingRequiredFields = requiredDefinitions.filter((field) => !hasDynamicValue(field));
    if (missingRequiredFields.length > 0) {
      setError(`Complete the required field${missingRequiredFields.length === 1 ? '' : 's'}: ${missingRequiredFields.map((field) => field.name).join(', ')}.`);
      return;
    }

    const requestedAmount = Number(form.requestedBudget);
    const availableBudget = Number(capdev?.budget || 0);

    // Validation check for requested budget vs remaining CapDev budget
    if (!editing?.hasDeductedBudget && requestedAmount > availableBudget) {
      setBudgetValidationMessage(
        `The requested amount of ${formatCurrency(requestedAmount)} exceeds the available CapDev balance of ${formatCurrency(availableBudget)}. Please adjust the requested amount.`
      );
      setBudgetValidationOpen(true);
      return;
    }

    setSaving(true);
    setError('');
    const additionalInfo = { ...form.additionalInfo };
    let currentFolderId = typeof additionalInfo.googleDriveFolderId === 'string' ? additionalInfo.googleDriveFolderId : undefined;
    const requestContext = {
      requestId: editing?.id,
      folderId: currentFolderId,
      requestorName: editing?.requestorName?.trim() || session.data.user.name || undefined,
      dateRequested: editing?.createdAt ? new Date(editing.createdAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    };
    for (const [fieldName, files] of Object.entries(pendingFiles)) {
      if (files.length === 0) continue;
      const field = definitions.find((definition) => dynamicFieldStorageKey(definition) === fieldName);
      const uploaded = await uploadFilesDirectlyToGoogleDrive(files, { ...requestContext, folderId: currentFolderId });
      if (!uploaded.success) { setError(uploaded.error || `Unable to upload ${field?.name || 'attachment'}.`); setSaving(false); return; }
      if (uploaded.folderId) {
        currentFolderId = uploaded.folderId;
        additionalInfo.googleDriveFolderId = uploaded.folderId;
      }
      const existingFiles = field ? getDynamicFieldValue(additionalInfo, field) : additionalInfo[fieldName];
      additionalInfo[fieldName] = [...(Array.isArray(existingFiles) ? existingFiles : []), ...uploaded.files];
    }
    const data = { ...form, additionalInfo, capdevId, userId: editing?.userId || session.data.user.id, updatedById: session.data.user.id };
    const result = editing ? await updateRequest(editing.id, data) : await createRequest(data);
    if (result.success) {
      setEditorOpen(false);
      await loadData();
    } else {
      if (result.error && result.error.toLowerCase().includes('budget')) {
        setBudgetValidationMessage(result.error);
        setBudgetValidationOpen(true);
      } else {
        setError(result.error || 'Unable to save request.');
      }
    }
    setSaving(false);
  };

  const removeRequest = async () => {
    if (!deleting) return;
    setSaving(true);
    const result = await deleteRequest(deleting.id);
    if (result.success) { setDeleting(null); await loadData(); }
    setSaving(false);
  };

  const renderDynamicField = (field: DynamicField) => {
    const storageKey = dynamicFieldStorageKey(field);
    const fieldValue = getDynamicFieldValue(form.additionalInfo, field);
    const canEdit = !editing || role === 'admin' || role === 'employee-department' || (role === 'employee' && editing.userId === session.data?.user?.id);
    return <Grid
      key={field.id}
      size={field.type === 'table' ? 12 : field.width === 'half' ? { xs: 12, sm: 6 } : 12}
      offset={rightAlignedFieldIds.has(field.id) ? { xs: 0, sm: 6 } : undefined}
    >
      {((field.type === 'text' || field.type === 'textarea') && field.options && field.options.length > 0) ? (
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
              required={field.isRequired}
              fullWidth
              label={field.name}
              placeholder={field.placeholder || 'Select or type...'}
            />
          )}
        />
      ) : (field.type === 'text' || field.type === 'textarea') ? (
        <TextField
          required={field.isRequired}
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
          required={field.isRequired}
          value={fieldValue}
          template={field.options?.[0]}
          showDimensionControls={false}
          onChange={(val) => setDynamicValue(field, val)}
        />
      ) : field.type === 'date' ? (
        <DateField
          label={field.name}
          required={field.isRequired}
          value={String(fieldValue || '')}
          onChange={(value) => setDynamicValue(field, value)}
        />
      ) : field.type === 'file' ? (
        <Stack spacing={1}>
          {canEdit && (
            <Button component="label" variant="outlined" startIcon={<AttachFileIcon />}>
              {field.name}
              {field.isRequired && <span style={{ color: '#d32f2f', fontWeight: 'bold' }}> *</span>}
              <input hidden type="file" multiple onChange={(event) => addSelectedFiles(storageKey, event)} />
            </Button>
          )}
          {getAttachments(fieldValue).map((file) => (
              <Stack
                key={file.id}
                direction="row"
                spacing={1}
                sx={{
                  alignItems: 'center',
                  bgcolor: 'rgba(0,0,0,0.03)',
                  px: 1.5,
                  py: 0.5,
                  borderRadius: 1.5,
                  width: 'fit-content',
                  maxWidth: '100%',
                }}
              >
                <Button
                  component="a"
                  href={file.url}
                  target="_blank"
                  rel="noreferrer"
                  size="small"
                  startIcon={<AttachFileIcon />}
                  sx={{
                    textTransform: 'none',
                    p: 0,
                    minWidth: 0,
                    fontWeight: 600,
                    color: 'primary.main',
                    textAlign: 'left',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {file.name}
                </Button>
                {canEdit && (
                  <IconButton
                    size="small"
                    onClick={() => removeExistingAttachment(field, file.id)}
                    aria-label={`Remove ${file.name}`}
                    sx={{ p: 0.25, color: 'text.secondary', '&:hover': { color: 'error.main' } }}
                  >
                    <CloseIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                )}
              </Stack>
            ))}
          {(pendingFiles[storageKey] || []).length > 0 && (
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
              {pendingFiles[storageKey].map((file) => (
                <Chip
                  key={`${file.name}-${file.lastModified}-${file.size}`}
                  label={file.name}
                  size="small"
                  onDelete={() => removeSelectedFile(storageKey, file)}
                />
              ))}
            </Stack>
          )}
        </Stack>
      ) : (
        <TextField
          required={field.isRequired}
          fullWidth
          label={field.name}
          type={field.type === 'number' ? 'number' : 'text'}
          value={String(fieldValue || '')}
          placeholder={field.placeholder || ''}
          onChange={(event) => setDynamicValue(field, event.target.value)}
        />
      )}
    </Grid>;
  };

  if (session.isPending || loading) return <ResourceGridSkeleton titleWidth={220} />;
  if (!session.data) return null;
  if (!capdev) return <Box sx={{ py: 8, textAlign: 'center' }}><Typography variant="h6" color="text.secondary">CapDev project not found.</Typography></Box>;
  const canManageRequest = role === 'admin' || role === 'employee' || role === 'employee-department';
  const currentUserId = session.data.user.id;
  const canEditRequest = (request: RequestRecord) => role === 'admin' || role === 'employee-department' || (role === 'employee' && request.userId === currentUserId);
  const isCapdevBudgetDepleted = Number(capdev.budget) <= 0;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 72px)' }}>
      <Container maxWidth={false} sx={{ p: 0, width: '100%', flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: '800', color: 'text.primary', letterSpacing: '-1px' }}>
              Requests
            </Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 0.5 }}>
              <Typography variant="body2" color="text.secondary">
                {capdev.aipCode}{capdev.department && capdev.department !== 'None' ? ` · ${capdev.department}` : ''}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 700, color: isCapdevBudgetDepleted ? 'error.main' : 'primary.dark' }}>
                (Remaining: {formatCurrency(capdev.budget)})
              </Typography>
            </Stack>
          </Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <TextField
              size="small"
              placeholder="Search requestor..."
              value={search}
              onChange={(event) => { setSearch(event.target.value); resetPage(); }}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon color="action" /></InputAdornment> } }}
              sx={{ bgcolor: '#ffffff', borderRadius: 2, minWidth: { sm: 260 }, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
            />
            <Button size="small" sx={{ height: 40 }} variant="outlined" onClick={() => { setDraftFilters(filters); setFiltersOpen(true); }}>
              Filter
            </Button>
          </Stack>
        </Stack>

        {visible.length === 0 ? (
          <Card variant="outlined" sx={{ borderRadius: 2, minHeight: 300, display: 'grid', placeItems: 'center' }}>
            <Stack spacing={1} sx={{ alignItems: 'center', color: 'text.secondary' }}>
              <RequestIcon sx={{ fontSize: 42 }} />
              <Typography>No requests found</Typography>
            </Stack>
          </Card>
        ) : (
          <Grid container spacing={3} sx={{ flexGrow: 1, alignContent: 'flex-start' }}>
            {visible.map((request) => (
              <Grid id={`request-record-${request.id}`} key={request.id} size={{ xs: 12, sm: 6, md: 4 }} sx={{ position: 'relative', pt: 3, scrollMarginTop: 96 }}>
                <Box sx={{ position: 'absolute', top: 0, left: 0, zIndex: 0, height: 48, p: '1px', bgcolor: 'divider', clipPath: 'polygon(10px 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 10px 100%, 0 50%)' }}>
                  <Box sx={{ height: '100%', px: 2, pt: .5, bgcolor: '#fafcfa', clipPath: 'polygon(10px 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 10px 100%, 0 50%)', display: 'flex', alignItems: 'flex-start' }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
                      Added {formatDate(request.createdAt)}
                    </Typography>
                  </Box>
                </Box>
                <Card
                  variant="outlined"
                  sx={{
                    position: 'relative',
                    zIndex: 1,
                    borderRadius: 2,
                    bgcolor: '#ffffff',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    transition: 'all 0.2s',
                    animation: notificationFocus?.targetId === `request-record-${request.id}`
                      ? 'requestNotificationFocus 900ms ease-in-out'
                      : 'none',
                    '@keyframes requestNotificationFocus': {
                      '0%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(46, 125, 50, 0)' },
                      '30%': { transform: 'scale(0.975)', boxShadow: '0 0 0 3px rgba(46, 125, 50, 0.22)' },
                      '65%': { transform: 'scale(1.025)', boxShadow: '0 8px 24px rgba(46, 125, 50, 0.2)' },
                      '100%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(46, 125, 50, 0)' },
                    },
                    '&:hover': { boxShadow: '0 4px 12px rgba(0,0,0,0.04)', borderColor: 'primary.main' },
                  }}
                >
                  <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', p: 3 }}>
                    <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', mb: 2 }}>
                      <Box sx={{ bgcolor: 'rgba(46, 125, 50, 0.08)', p: 1.2, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <RequestIcon color="primary" />
                      </Box>
                      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                        <Typography variant="h6" noWrap sx={{ fontWeight: '700', color: 'text.primary', lineHeight: 1.2 }}>
                          Request #{request.id}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {request.setting === 'internal' ? 'Internal' : 'External'}
                        </Typography>
                      </Box>
                      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexShrink: 0 }}>
                        <Chip
                          label={request.status === 'completed' || request.isComplete ? 'Complete' : request.status === 'denied' ? 'Denied' : 'In progress'}
                          color={request.status === 'completed' || request.isComplete ? 'success' : request.status === 'denied' ? 'error' : 'primary'}
                          size="small"
                          sx={{ fontWeight: 700 }}
                        />
                        {request.hasDeductedBudget && <Chip icon={<PaymentsIcon />} label="Amount deducted" color="success" variant="outlined" size="small" sx={{ fontWeight: 700 }} />}
                      </Stack>
                    </Stack>
                    <Stack spacing={1.5} sx={{ my: 1 }}>
                      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" color="text.secondary">Requestor</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>{request.requestorName || 'Requestor'}</Typography>
                      </Stack>
                      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" color="text.secondary">Requested amount</Typography>
                        <Typography variant="body2" sx={{ fontWeight: '700', color: 'primary.dark' }}>{formatCurrency(request.requestedBudget)}</Typography>
                      </Stack>
                    </Stack>
                    <Divider sx={{ my: 2 }} />
                    <Stack direction="row" sx={{ mt: 'auto', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                      <Button variant="text" color="primary" endIcon={<ChevronRightIcon />} onClick={() => router.push(`/portal/capdev/${capdevId}/requests/${request.id}/status`)} sx={{ p: 0, minWidth: 0, fontWeight: '700', '&:hover': { bgcolor: 'transparent', color: 'primary.dark' } }}>
                        Track Progress
                      </Button>
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                        <Tooltip title="View & Edit Details">
                          <IconButton size="small" color="primary" onClick={() => openEdit(request)} aria-label="View request details">
                            <VisibilityIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        {canEditRequest(request) && (
                          <Tooltip title="Delete Request">
                            <IconButton size="small" color="error" onClick={() => setDeleting(request)} aria-label="Delete request">
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Stack>
                    </Stack>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}

        {filtered.length > 6 && (
          <Stack direction="row" spacing={2} sx={{ justifyContent: 'center', alignItems: 'center', mt: 4, mb: 2 }}>
            <Button variant="outlined" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>
              Previous
            </Button>
            <Typography variant="body2" sx={{ fontWeight: '700', color: 'text.secondary' }}>
              Page {page} of {pageCount}
            </Typography>
            <Button variant="outlined" disabled={page === pageCount} onClick={() => setPage((current) => current + 1)}>
              Next
            </Button>
          </Stack>
        )}
      </Container>

      {canManageRequest && (
        <Fab variant="extended" color="primary" onClick={openCreate} sx={{ position: 'fixed', right: 24, bottom: 24, zIndex: 1100, px: 2.5, boxShadow: '0 4px 14px rgba(46, 125, 50, 0.4)' }}>
          <AddIcon sx={{ mr: 1 }} />
          Add Request
        </Fab>
      )}

      {/* Add / Edit Request Dialog */}
      <Dialog open={editorOpen} onClose={() => !saving && setEditorOpen(false)} fullWidth maxWidth="md">
        <DialogTitle sx={{ fontWeight: 800 }}>{editing ? 'Edit Request' : 'Add Request'}</DialogTitle>
        <DialogContent
          dividers
          sx={{ position: 'relative' }}
          onScroll={(e) => {
            setShowScrollArrow(e.currentTarget.scrollTop < 120);
          }}
        >

          {/* Section: CapDev Information */}
          {capdev && (
            <Box ref={capdevSectionRef}>
              <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 2 }}>
                CapDev Information
              </Typography>
              <Grid container spacing={2.5} sx={{ pt: 0.5 }}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField fullWidth label="AIP Code" value={capdev.aipCode || '—'} disabled slotProps={{ inputLabel: { shrink: true } }} sx={disabledFieldSx} />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField fullWidth label="Department" value={(capdev.department && capdev.department !== 'None') ? capdev.department : '—'} disabled slotProps={{ inputLabel: { shrink: true } }} sx={disabledFieldSx} />
                </Grid>
                <Grid size={12}>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField fullWidth label="Initial Balance" value={formatCurrency(capdev.initialBudget)} disabled slotProps={{ inputLabel: { shrink: true } }} sx={disabledFieldSx} />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField fullWidth label="Balance" value={formatCurrency(capdev.budget)} disabled slotProps={{ inputLabel: { shrink: true } }} sx={disabledFieldSx} />
                </Grid>

                {/* Dynamic CapDev Fields */}
                {capdevDefinitions.map((field) => {
                  const fieldValue = getDynamicFieldValue(capdev.additionalInfo, field);
                  return <Grid
                    key={field.id}
                    size={field.type === 'table' ? 12 : field.width === 'half' ? { xs: 12, sm: 6 } : 12}
                    offset={rightAlignedCapdevFieldIds.has(field.id) ? { xs: 0, sm: 6 } : undefined}
                  >
                    {field.type === 'file' ? (
                      <Stack spacing={0.5}>
                        <Typography variant="caption" color="text.secondary">{field.name}</Typography>
                        {getAttachments(fieldValue).length === 0 ? (
                          <Typography variant="body2" color="text.secondary">—</Typography>
                        ) : (
                          getAttachments(fieldValue).map((file) => (
                            <Button key={file.id} component="a" href={file.url} target="_blank" rel="noreferrer" size="small" startIcon={<AttachFileIcon />} sx={{ width: 'fit-content', textTransform: 'none' }}>
                              {file.name}
                            </Button>
                          ))
                        )}
                      </Stack>
                    ) : field.type === 'table' ? (
                      <DynamicTableField
                        label={field.name}
                        disabled
                        template={field.options?.[0]}
                        showDimensionControls={false}
                        value={fieldValue}
                      />
                    ) : field.type === 'textarea' ? (
                      <TextField fullWidth multiline minRows={2} label={field.name} value={String(fieldValue ?? '—')} disabled slotProps={{ inputLabel: { shrink: true } }} sx={disabledFieldSx} />
                    ) : (
                      <TextField fullWidth label={field.name} value={String(fieldValue ?? '—')} disabled slotProps={{ inputLabel: { shrink: true } }} sx={disabledFieldSx} />
                    )}
                  </Grid>;
                })}
              </Grid>
              <Divider sx={{ my: 3 }} />
            </Box>
          )}

          {/* Activity Design Section Anchor */}
          <Box ref={activityDesignRef} sx={{ scrollMarginTop: '16px' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 2 }}>
              Activity Design
            </Typography>
            <Grid container spacing={2.5} sx={{ pt: 0.5 }}>
              {editing && (
                <Grid size={12}>
                  <Typography variant="body2" color="text.secondary">Requestor</Typography>
                  <Typography sx={{ fontWeight: 700 }}>{editing.requestorName || 'Requestor'}</Typography>
                </Grid>
              )}
              <Grid size={12}>
                <TextField select required fullWidth label="Setting" value={form.setting} onChange={(event) => setValue({ setting: event.target.value })}>
                  <MenuItem value="internal">Internal</MenuItem>
                  <MenuItem value="external">External</MenuItem>
                </TextField>
              </Grid>
              <Grid size={12}>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  required
                  fullWidth
                  label="Amount"
                  type="number"
                  value={form.requestedBudget}
                  onChange={(event) => setValue({ requestedBudget: event.target.value })}
                  disabled={editing?.hasDeductedBudget}
                  sx={editing?.hasDeductedBudget ? disabledFieldSx : undefined}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  label="Balance"
                  value={capdev ? formatCurrency(capdev.budget) : '₱0.00'}
                  disabled
                  slotProps={{ inputLabel: { shrink: true } }}
                  sx={disabledFieldSx}
                />
              </Grid>
              {allDefinitions.map(renderDynamicField)}
            </Grid>
          </Box>
          {editing && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 3 }}>
              Added {formatDate(editing.createdAt)}
            </Typography>
          )}

          {/* Subtle floating down arrow when CapDev section is on screen */}
          <Fade in={showScrollArrow}>
            <Box
              sx={{
                position: 'sticky',
                bottom: 12,
                display: 'flex',
                justifyContent: 'center',
                width: '100%',
                zIndex: 10,
                pointerEvents: showScrollArrow ? 'auto' : 'none',
              }}
            >
              <Tooltip title="Scroll down to Activity Design">
                <IconButton
                  size="small"
                  onClick={scrollToActivityDesign}
                  sx={{
                    bgcolor: 'primary.main',
                    color: '#ffffff',
                    boxShadow: '0 4px 14px rgba(46, 125, 50, 0.4)',
                    '&:hover': {
                      bgcolor: 'primary.dark',
                      transform: 'scale(1.08)',
                    },
                    transition: 'all 0.2s ease-in-out',
                  }}
                  aria-label="Scroll down to Activity Design"
                >
                  <KeyboardArrowDownIcon />
                </IconButton>
              </Tooltip>
            </Box>
          </Fade>
        </DialogContent>
        <DialogActions sx={{ p: 2.5 }}>
          <Button onClick={() => setEditorOpen(false)} disabled={saving} color="inherit">
            Close
          </Button>
          {(!editing || canEditRequest(editing)) && canManageRequest && (
            <Button
              onClick={saveRequest}
              disabled={saving || !form.requestedBudget || !areRequiredFieldsComplete}
              variant="contained"
            >
              {saving ? 'Saving' : 'Save Request'}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <ActionErrorDialog open={Boolean(error)} title="Unable to Save Request" message={error} onClose={() => setError('')} />

      {/* Dedicated Budget Validation Dialog */}
      <Dialog
        open={budgetValidationOpen}
        onClose={() => setBudgetValidationOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
          <WarningIcon color="warning" />
          Balance Limit Exceeded
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5} sx={{ py: 1 }}>
            <Typography variant="body1" sx={{ color: 'text.primary' }}>
              {budgetValidationMessage || 'The requested amount exceeds the remaining CapDev allocation.'}
            </Typography>
            <Box sx={{ p: 1.5, bgcolor: '#f4f7f4', borderRadius: 1.5 }}>
              <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                <Typography variant="caption" color="text.secondary">Remaining Project Balance</Typography>
                <Typography variant="caption" sx={{ fontWeight: 700, color: isCapdevBudgetDepleted ? 'error.main' : 'primary.dark' }}>
                  {formatCurrency(capdev.budget)}
                </Typography>
              </Stack>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button variant="contained" onClick={() => setBudgetValidationOpen(false)} sx={{ fontWeight: 700 }}>
            Understood
          </Button>
        </DialogActions>
      </Dialog>

      {/* Filter Requests Dialog using MUI DatePicker */}
      <Dialog open={filtersOpen} onClose={() => setFiltersOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 800 }}>Filter Requests</DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={2} sx={{ pt: .5 }}>
            <Grid size={12}>
              <TextField select fullWidth label="Setting" value={draftFilters.setting} onChange={(e) => setDraftFilters({ ...draftFilters, setting: e.target.value })}>
                <MenuItem value="all">All settings</MenuItem>
                <MenuItem value="internal">Internal</MenuItem>
                <MenuItem value="external">External</MenuItem>
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField fullWidth type="number" label="Requested amount from" value={draftFilters.min} onChange={(e) => setDraftFilters({ ...draftFilters, min: e.target.value })} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField fullWidth type="number" label="Requested amount to" value={draftFilters.max} onChange={(e) => setDraftFilters({ ...draftFilters, max: e.target.value })} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <DateField
                label="Date added from"
                value={draftFilters.dateFrom}
                onChange={(val) => setDraftFilters({ ...draftFilters, dateFrom: val })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <DateField
                label="Date added to"
                value={draftFilters.dateTo}
                onChange={(val) => setDraftFilters({ ...draftFilters, dateTo: val })}
              />
            </Grid>
            <Grid size={12}>
              <TextField select fullWidth label="Sort" value={draftFilters.sort} onChange={(e) => setDraftFilters({ ...draftFilters, sort: e.target.value })}>
                <MenuItem value="newest">Newest to oldest</MenuItem>
                <MenuItem value="oldest">Oldest to newest</MenuItem>
              </TextField>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ p: 2.5 }}>
          <Button onClick={() => setDraftFilters({ setting: 'all', min: '', max: '', dateFrom: '', dateTo: '', sort: 'newest' })}>
            Reset
          </Button>
          <Button variant="contained" onClick={() => { setFilters(draftFilters); resetPage(); setFiltersOpen(false); }}>
            Apply Filters
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Request Dialog */}
      <Dialog open={Boolean(deleting)} onClose={() => !saving && setDeleting(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>Delete Request?</DialogTitle>
        <DialogContent>
          <Typography>This permanently removes Request #{deleting?.id}.</Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2.5 }}>
          <Button onClick={() => setDeleting(null)} disabled={saving}>Cancel</Button>
          <Button color="error" variant="contained" onClick={removeRequest} disabled={saving}>
            {saving ? 'Deleting' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

