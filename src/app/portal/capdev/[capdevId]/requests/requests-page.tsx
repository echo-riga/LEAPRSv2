'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Add as AddIcon,
  AttachFile as AttachFileIcon,
  Assignment as RequestIcon,
  ChevronRight as ChevronRightIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  Payments as PaymentsIcon,
  Search as SearchIcon,
  VisibilityOutlined as VisibilityIcon,
  NotificationsActiveRounded as ReminderIcon,
} from '@mui/icons-material';
import {
  Alert,
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
import { useRouter, useSearchParams } from 'next/navigation';
import { authClient } from '@/lib/auth/client';
import ArchiveActions from '@/components/ArchiveActions';
import ReadOnlyDynamicField from '@/components/ReadOnlyDynamicField';
import DateField from '@/components/DateField';
import SelectionCombobox from '@/components/SelectionCombobox';
import DynamicTableField from '@/components/DynamicTableField';
import { ResourceGridSkeleton } from '@/components/Skeletons';
import { dynamicFieldStorageKey, getDynamicFieldValue } from '@/lib/dynamic-fields';
import {
  archiveRequest,
  restoreRequest,
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
import { getHalfFieldLayout } from '@/components/FieldReorder';
import FileFieldChecklist from '@/components/FileFieldChecklist';
import { focusFormError } from '@/lib/form-error-focus';

import { inactivityMessage, type RequestInactivity } from '@/lib/request-inactivity';

type RequestRecord = {
  inactivity: RequestInactivity | null;
  archivedAt: Date | string | null;
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
type DynamicField = { id: number; setting?: 'internal' | 'external'; name: string; type: string; options: string[] | null; isRequired: boolean; width: string; columnPosition: string; placeholder: string | null; section?: string };
type RequestForm = Pick<RequestRecord, 'setting' | 'description' | 'requestedBudget' | 'additionalInfo'>;
type CapdevDetail = {
  archivedAt: Date | string | null;
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
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const showArchived = searchParams.get('archived') === '1';
  const setShowArchived = useCallback((archived: boolean) => {
    const params = new URLSearchParams(query);
    if (archived) params.set('archived', '1');
    else params.delete('archived');
    const suffix = params.toString();
    router.replace(`/portal/capdev/${capdevId}/requests${suffix ? `?${suffix}` : ''}${window.location.hash}`, { scroll: false });
  }, [capdevId, query, router]);
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
  const [form, setForm] = useState<RequestForm>(EMPTY_FORM);
  const [pendingFiles, setPendingFiles] = useState<Record<string, File[]>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
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
    const [projectData, requestData, internalFieldData, externalFieldData, capdevFieldData] = await Promise.all([
      getCapdevById(capdevId),
      getRequestsByCapdev(capdevId),
      getRequestFieldDefinitions('internal'),
      getRequestFieldDefinitions('external'),
      getCapdevFieldDefinitions(),
    ]);
    setCapdev(
      projectData
        ? {
            id: projectData.id,
            archivedAt: projectData.archivedAt,
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
      [...internalFieldData, ...externalFieldData].map((field) => ({
        ...field,
        setting: field.setting === 'external' ? 'external' as const : 'internal' as const,
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
    const interval = window.setInterval(refreshRequests, 30_000);
    window.addEventListener('leaprs:reminder-settings-changed', refreshRequests);
    window.addEventListener('focus', refreshRequests);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('leaprs:reminder-settings-changed', refreshRequests);
      window.removeEventListener('focus', refreshRequests);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [loadData]);

  const filtered = useMemo(() => requests.filter((request) => {
    const date = new Date(request.createdAt).getTime();
    return (
      (Boolean(request.archivedAt) === showArchived) &&
      (request.requestorName || '').toLowerCase().includes(search.toLowerCase()) &&
      (filters.setting === 'all' || request.setting === filters.setting) &&
      (!filters.min || Number(request.requestedBudget) >= Number(filters.min)) &&
      (!filters.max || Number(request.requestedBudget) <= Number(filters.max)) &&
      (!filters.dateFrom || date >= new Date(filters.dateFrom).getTime()) &&
      (!filters.dateTo || date <= new Date(`${filters.dateTo}T23:59:59`).getTime())
    );
  }).sort((a, b) => filters.sort === 'newest' ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()), [filters, requests, search, showArchived]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / 6));
  const visible = filtered.slice((page - 1) * 6, page * 6);

  useEffect(() => {
    if (!notificationFocus || loading) return;
    const requestIdToFocus = Number(notificationFocus.targetId.replace('request-record-', ''));
    const filteredIndex = filtered.findIndex((request) => request.id === requestIdToFocus);

    if (filteredIndex < 0 && requests.some((request) => request.id === requestIdToFocus)) {
      const resetTimeoutId = window.setTimeout(() => {
        const focused = requests.find((item) => item.id === requestIdToFocus);
        setShowArchived(Boolean(focused?.archivedAt));
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
    }, 2500);
    return () => window.clearTimeout(timeoutId);
  }, [filtered, loading, notificationFocus, page, requests, setShowArchived]);
  const allDefinitions = definitions.filter((field) => field.setting === form.setting);
  const requiredDefinitions = allDefinitions.filter((field) => field.isRequired || field.section === 'required');
  const rightAlignedFieldIds = getHalfFieldLayout(allDefinitions.map((field) => ({ ...field, key: field.id }))).before;
  const rightAlignedCapdevFieldIds = getHalfFieldLayout(capdevDefinitions.map((field) => ({ ...field, key: field.id }))).before;
  const setValue = (updates: Partial<RequestForm>) => {
    setForm((current) => ({ ...current, ...updates }));
    const changed = Object.keys(updates);
    if (changed.some((key) => fieldErrors[key])) setFieldErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !changed.includes(key))));
  };
  const showFormError = (message: string) => {
    setError(message);
    focusFormError('request-form-error');
  };
  const setDynamicValue = (field: DynamicField, value: unknown) => setForm((current) => ({ ...current, additionalInfo: { ...current.additionalInfo, [dynamicFieldStorageKey(field)]: value } }));
  const resetPage = () => setPage(1);

  const editorReadOnly = showArchived || Boolean(capdev?.archivedAt || editing?.archivedAt);
  const openCreate = () => { if (showArchived || capdev?.archivedAt) return; setError(''); setFieldErrors({}); setPendingFiles({}); setEditing(null); setForm(EMPTY_FORM); setShowScrollArrow(true); setEditorOpen(true); };
  const openEdit = (request: RequestRecord) => { setError(''); setFieldErrors({}); setPendingFiles({}); setEditing(request); setForm({ setting: request.setting, description: request.description, requestedBudget: request.requestedBudget, additionalInfo: { ...request.additionalInfo } }); setShowScrollArrow(true); setEditorOpen(true); };
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
    if (editorReadOnly) return;
    if (!session.data || !form.requestedBudget) return;

    const missingRequiredFields = requiredDefinitions.filter((field) => !hasDynamicValue(field));
    if (missingRequiredFields.length > 0) return;

    const requestedAmount = Number(form.requestedBudget);
    const availableBudget = Number(capdev?.budget || 0);

    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      setFieldErrors({ requestedBudget: 'Enter an amount greater than zero.' });
      focusFormError('request-field-budget');
      return;
    }

    // Validation check for requested budget vs remaining CapDev budget
    if (!editing?.hasDeductedBudget && requestedAmount > availableBudget) {
      setFieldErrors({ requestedBudget: `Exceeds available balance of ${formatCurrency(availableBudget)}.` });
      focusFormError('request-field-budget');
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
      const field = allDefinitions.find((definition) => dynamicFieldStorageKey(definition) === fieldName);
      if (!field) continue;
      const uploaded = await uploadFilesDirectlyToGoogleDrive(files, { ...requestContext, folderId: currentFolderId });
      if (!uploaded.success) { showFormError(uploaded.error || `Unable to upload ${field?.name || 'attachment'}.`); setSaving(false); return; }
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
      const resultError = result.error?.toLowerCase() || '';
      if (['budget', 'amount', 'balance'].some((term) => resultError.includes(term))) {
        setFieldErrors({ requestedBudget: `Exceeds available balance of ${formatCurrency(availableBudget)}.` });
        focusFormError('request-field-budget');
      } else {
        showFormError(result.error || 'Unable to save request.');
      }
    }
    setSaving(false);
  };

  const renderDynamicField = (field: DynamicField) => {
    const storageKey = dynamicFieldStorageKey(field);
    const fieldValue = getDynamicFieldValue(form.additionalInfo, field);
    if (editorReadOnly) return <Grid key={field.id} size={field.type === 'table' ? 12 : field.width === 'half' ? { xs: 12, sm: 6 } : 12}><ReadOnlyDynamicField field={field} value={getDynamicFieldValue(form.additionalInfo, field)} /></Grid>;
    const canEdit = !editorReadOnly && (!editing || role === 'admin' || role === 'employee-department' || (role === 'employee' && editing.userId === session.data?.user?.id));
    return <Grid
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
            disabled={!canEdit}
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
        <FileFieldChecklist
          label={field.name}
          required={field.isRequired}
          existingFiles={getAttachments(fieldValue)}
          pendingFiles={pendingFiles[storageKey] || []}
          editable={canEdit}
          onSelectFiles={(event) => addSelectedFiles(storageKey, event)}
          onRemoveExisting={(fileId) => removeExistingAttachment(field, fileId)}
          onRemovePending={(file) => removeSelectedFile(storageKey, file)}
        />
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
            <Button size="small" sx={{ height: 40, whiteSpace: 'nowrap' }} variant="outlined" onClick={() => { setShowArchived(!showArchived); setNotificationFocus(null); resetPage(); }}>{showArchived ? 'See Active Requests' : 'See Archives'}</Button>
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
                      {request.archivedAt ? 'Archived' : 'Added'} {formatDate(request.archivedAt || request.createdAt)}
                    </Typography>
                  </Box>
                </Box>
                <Card
                  variant="outlined"
                  sx={{
                    position: 'relative',
                    overflow: 'visible',
                    zIndex: 1,
                    borderRadius: 2,
                    borderColor: request.inactivity ? 'error.main' : undefined,
                    bgcolor: request.archivedAt || capdev.archivedAt ? 'grey.100' : '#fafcfa',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    transition: 'all 0.2s',
                    animation: notificationFocus?.targetId === `request-record-${request.id}`
                      ? 'requestNotificationFocus 2500ms ease-in-out'
                      : 'none',
                    '@keyframes requestNotificationFocus': {
                      '0%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(46, 125, 50, 0)' },
                      '30%': { transform: 'scale(0.975)', boxShadow: '0 0 0 3px rgba(46, 125, 50, 0.22)' },
                      '65%': { transform: 'scale(1.025)', boxShadow: '0 8px 24px rgba(46, 125, 50, 0.2)' },
                      '100%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(46, 125, 50, 0)' },
                    },
                    '&:hover': { boxShadow: '0 4px 12px rgba(0,0,0,0.04)', borderColor: request.inactivity ? 'error.dark' : 'primary.main' },
                  }}
                >
                  {request.inactivity && (
                    <Tooltip title={inactivityMessage(request.inactivity.days)}>
                      <IconButton
                        color="error"
                        aria-label={inactivityMessage(request.inactivity.days) + ' View last activity'}
                        onClick={() => router.push(request.inactivity!.link)}
                        sx={{ position: 'absolute', top: -18, right: -12, zIndex: 2, width: 44, height: 44, borderRadius: 2, bgcolor: '#fafcfa', '&:hover': { bgcolor: '#fceeee' } }}
                      >
                        <ReminderIcon sx={{ fontSize: 34 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                  <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', p: 3 }}>
                    <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', mb: 2 }}>
                      <Box sx={{ bgcolor: request.archivedAt || capdev.archivedAt ? 'grey.200' : 'rgba(46, 125, 50, 0.08)', p: 1.2, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <RequestIcon color={request.archivedAt || capdev.archivedAt ? 'action' : 'primary'} />
                      </Box>
                      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                        <Typography variant="h6" noWrap sx={{ fontWeight: '700', color: 'text.primary', lineHeight: 1.2 }}>
                          {request.requestorName || 'Requestor'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {request.setting === 'internal' ? 'In-House' : 'External'}
                        </Typography>
                      </Box>
                      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexShrink: 0 }}>
                        <Chip
                          label={request.status === 'completed' || request.isComplete ? 'Complete' : request.status === 'denied' ? 'Denied' : 'In progress'}
                          color={request.archivedAt || capdev.archivedAt ? 'default' : request.status === 'completed' || request.isComplete ? 'success' : request.status === 'denied' ? 'error' : 'primary'}
                          size="small"
                          sx={{ fontWeight: 700 }}
                        />
                        {request.hasDeductedBudget && <Chip icon={<PaymentsIcon />} label="Amount deducted" color={request.archivedAt || capdev.archivedAt ? 'default' : 'success'} variant="outlined" size="small" sx={{ fontWeight: 700 }} />}

                      </Stack>
                    </Stack>
                    <Stack spacing={1.5} sx={{ my: 1 }}>
                      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" color="text.secondary">Requested amount</Typography>
                        <Typography variant="body2" sx={{ fontWeight: '700', color: request.archivedAt || capdev.archivedAt ? 'text.secondary' : 'primary.dark' }}>{formatCurrency(request.requestedBudget)}</Typography>
                      </Stack>
                    </Stack>
                    <Divider sx={{ my: 2 }} />
                    <Stack direction="row" sx={{ mt: 'auto', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                      <Button variant="text" color="primary" endIcon={<ChevronRightIcon />} onClick={() => router.push(`/portal/capdev/${capdevId}/requests/${request.id}/status${showArchived || request.archivedAt ? '?archived=1' : ''}`)} sx={{ p: 0, minWidth: 0, fontWeight: '700', '&:hover': { bgcolor: 'transparent', color: 'primary.dark' } }}>
                        Track Progress
                      </Button>
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                        <Tooltip title={request.archivedAt || capdev.archivedAt ? 'View Details' : 'View & Edit Details'}>
                          <IconButton size="small" color="primary" onClick={() => openEdit(request)} aria-label="View request details">
                            <VisibilityIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        {canEditRequest(request) && <ArchiveActions label={`${request.requestorName || 'Requestor'}'s request`} archived={Boolean(request.archivedAt)} parentArchived={Boolean(capdev.archivedAt)} onArchive={() => archiveRequest(request.id)} onRestore={() => restoreRequest(request.id)} onDelete={() => deleteRequest(request.id)} onChanged={loadData} deleteMessage={`Permanently delete ${request.requestorName || 'Requestor'}'s request and its progress updates? This cannot be undone.`} />}
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

      {canManageRequest && !showArchived && !capdev.archivedAt && (
        <Fab variant="extended" color="primary" onClick={openCreate} sx={{ position: 'fixed', right: 24, bottom: 24, zIndex: 1100, px: 2.5, boxShadow: '0 4px 14px rgba(46, 125, 50, 0.4)' }}>
          <AddIcon sx={{ mr: 1 }} />
          Add Request
        </Fab>
      )}

      {/* Add / Edit Request Dialog */}
      <Dialog open={editorOpen} onClose={() => !saving && setEditorOpen(false)} fullWidth maxWidth="md">
        <DialogTitle sx={{ fontWeight: 800 }}>{editorReadOnly ? 'Request Details' : editing ? 'Edit Request' : 'Add Request'}</DialogTitle>
        <DialogContent
          dividers
          sx={{ position: 'relative' }}
          onScroll={(e) => {
            setShowScrollArrow(e.currentTarget.scrollTop < 120);
          }}
        >
          {error && <Alert id="request-form-error" tabIndex={-1} severity="error" sx={{ mb: 2 }}>{error}</Alert>}

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
                <TextField disabled={editorReadOnly} select required fullWidth label="Setting" value={form.setting} onChange={(event) => setValue({ setting: event.target.value })}>
                  <MenuItem value="internal">In-House</MenuItem>
                  <MenuItem value="external">External</MenuItem>
                </TextField>
              </Grid>
              <Grid size={12}>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }} id="request-field-budget">
                <TextField required
                  fullWidth
                  label="Amount"
                  type="number"
                  value={form.requestedBudget}
                  onChange={(event) => setValue({ requestedBudget: event.target.value })}
                  onBlur={() => {
                    if (form.requestedBudget && (!Number.isFinite(Number(form.requestedBudget)) || Number(form.requestedBudget) <= 0)) {
                      setFieldErrors((current) => ({ ...current, requestedBudget: 'Enter an amount greater than zero.' }));
                    }
                  }}
                  error={Boolean(fieldErrors.requestedBudget)}
                  helperText={fieldErrors.requestedBudget}
                  disabled={editorReadOnly || editing?.hasDeductedBudget}
                  sx={editing?.hasDeductedBudget ? disabledFieldSx : undefined}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField fullWidth
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
              disabled={editorReadOnly || saving || !form.requestedBudget || Number(form.requestedBudget) <= 0 || !areRequiredFieldsComplete || Object.keys(fieldErrors).length > 0}
              variant="contained"
            >
              {saving ? 'Saving' : 'Save Request'}
            </Button>
          )}
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
                <MenuItem value="internal">In-House</MenuItem>
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


    </Box>
  );
}
