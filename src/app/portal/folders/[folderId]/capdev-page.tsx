'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Add as AddIcon, ChevronRight as ChevronRightIcon, FilterList as FilterIcon, FolderOpen as CapdevIcon, LibraryAddOutlined as DuplicateIcon, ChecklistOutlined as BulkIcon, DriveFileMoveOutlined as MoveIcon, ArchiveOutlined as ArchiveIcon, DeleteOutlined as DeleteIcon, Search as SearchIcon, VisibilityOutlined as VisibilityIcon } from '@mui/icons-material';
import { Alert, Autocomplete, Box, Button, Card, CardContent, Checkbox, Container, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Fab, FormControlLabel, Grid, IconButton, InputAdornment, MenuItem, Snackbar, Stack, TextField, Tooltip, Typography } from '@mui/material';
import CapdevReferenceImage from '@/components/CapdevReferenceImage';
import CapdevFoldersPanel from '@/components/CapdevFoldersPanel';
import ArchiveActions from '@/components/ArchiveActions';
import ReadOnlyDynamicField from '@/components/ReadOnlyDynamicField';
import Link from 'next/link';
import { readPortal } from '@/lib/portal-read-client';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { authClient } from '@/lib/auth/client';
import { bulkManageCapdevs, archiveCapdev, restoreCapdev, createCapdev, deleteCapdev, duplicateCapdevs, getAllCapdevs, getCapdevById, getCapdevFolders, getCapdevBudgetHistory, updateCapdev, type AppRole, type StatusAttachment } from '@/app/actions';
import { validateMoney } from '@/lib/request-validation';
import { manilaDate } from '@/lib/manila-date';
import DateField from '@/components/DateField';
import SelectionCombobox from '@/components/SelectionCombobox';
import DynamicTableField from '@/components/DynamicTableField';
import { ResourceGridSkeleton } from '@/components/Skeletons';
import DepartmentCombobox from '@/components/DepartmentCombobox';
import { dynamicFieldStorageKey, getDynamicFieldValue } from '@/lib/dynamic-fields';
import { isPendingAttachment, stageAttachments } from '@/lib/background-attachments';
import { useAttachmentRefresh, useBackgroundUploads } from '@/components/BackgroundUploads';
import { getHalfFieldLayout } from '@/components/FieldReorder';
import FileFieldChecklist from '@/components/FileFieldChecklist';
import { focusFormError } from '@/lib/form-error-focus';
import { filterPreferenceStorageKey, getActiveDateFilterPreset, getDateFilterPresetRange } from '@/lib/filter-preferences';

type DynamicField = { id: number; name: string; type: string; options: string[] | null; isRequired: boolean; section: string; width: string; columnPosition: string; placeholder: string | null };
type Capdev = { folderId: number; archivedAt: Date | string | null; id: number; aipCode: string; description: string; initialBudget: string; budget: string; department: string; updatedById: string; createdAt: Date | string; additionalInfo: Record<string, unknown> };
type CapdevForm = Omit<Capdev, 'id' | 'createdAt' | 'updatedById' | 'archivedAt'>;
type BudgetHistoryEntry = { authorName: string | null; amount: string; createdAt: Date | string };
type CapdevFilters = { departments: string[]; initialMin: string; initialMax: string; remainingMin: string; remainingMax: string; dateFrom: string; dateTo: string; sort: string };

const EMPTY_FORM: CapdevForm = { folderId: 0, aipCode: '', description: '', initialBudget: '', budget: '', department: '', additionalInfo: {} };
const EMPTY_FILTERS: CapdevFilters = { departments: [], initialMin: '', initialMax: '', remainingMin: '', remainingMax: '', dateFrom: '', dateTo: '', sort: 'newest' };
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
const isSavedCapdevFilters = (value: unknown): value is CapdevFilters => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CapdevFilters>;
  return Array.isArray(candidate.departments) && candidate.departments.every((item) => typeof item === 'string') &&
    ['initialMin', 'initialMax', 'remainingMin', 'remainingMax', 'dateFrom', 'dateTo', 'sort']
      .every((key) => typeof candidate[key as keyof CapdevFilters] === 'string') &&
    (candidate.sort === 'newest' || candidate.sort === 'oldest');
};

export default function CapdevPage({ folderId }: { folderId: number }) {
  const uploads = useBackgroundUploads();
  const router = useRouter();
  const searchParams = useSearchParams();
  const session = authClient.useSession();
  const [folderName, setFolderName] = useState('');
  const [folderOptions, setFolderOptions] = useState<{ id: number; name: string }[]>([]);
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
  const debouncedSearch = useDebouncedValue(search);
  const configurationLoaded = useRef(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<CapdevFilters>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState(filters);
  const [bulkAction, setBulkAction] = useState<'duplicate' | 'archive' | 'delete' | 'move'>('duplicate');
  const [bulkDestinationFolderId, setBulkDestinationFolderId] = useState(folderId);
  const [bulkSuccess, setBulkSuccess] = useState('');
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const bulkInFlight = useRef(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkOptions, setBulkOptions] = useState<Capdev[]>([]);
  const [selectedBulkIds, setSelectedBulkIds] = useState<number[]>([]);
  const [bulkTargetDate, setBulkTargetDate] = useState(`${Number(manilaDate().slice(0, 4)) + 1}-01-01`);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState('');
  const [page, setPage] = useState(1);
  const [editorOpen, setEditorOpen] = useState(false);
  const [budgetResetConfirmationOpen, setBudgetResetConfirmationOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(searchParams.get('archived') === '1');
  const [editing, setEditing] = useState<Capdev | null>(null);
  const [form, setForm] = useState<CapdevForm>(EMPTY_FORM);
  const [pendingFiles, setPendingFiles] = useState<Record<string, File[]>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [budgetHistory, setBudgetHistory] = useState<BudgetHistoryEntry[]>([]);
  const [role, setRole] = useState<AppRole>('employee');
  const [notificationFocus, setNotificationFocus] = useState<{ targetId: string; nonce: number } | null>(null);
  const filtersInitialized = useRef(false);
  const filterAccountId = useRef<string | null>(null);
  const saveProjectInFlight = useRef(false);


  useEffect(() => {
    const focusTarget = (targetId: string) => {
      if (!/^capdev-record-\d+$/.test(targetId)) return;
      void getCapdevById(Number(targetId.replace('capdev-record-', ''))).then(project => {
        if (!project) return;
        if (project.folderId !== folderId) router.replace('/portal');
        else setNotificationFocus({ targetId, nonce: Date.now() });
      });
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
  }, [folderId, router]);

  const userId = session.data?.user.id;
  useEffect(() => {
    if (!userId || (filterAccountId.current === userId && filtersInitialized.current)) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      filterAccountId.current = userId;
      filtersInitialized.current = false;
      try {
        const saved = JSON.parse(window.localStorage.getItem(`${filterPreferenceStorageKey('capdev', userId)}:folder:${folderId}`) || 'null');
        if (!isSavedCapdevFilters(saved)) {
          setFilters(EMPTY_FILTERS);
          setDraftFilters(EMPTY_FILTERS);
          return;
        }
        setFilters({ ...saved, departments: [...saved.departments] });
        setDraftFilters({ ...saved, departments: [...saved.departments] });
        filtersInitialized.current = true;
      } catch {
        window.localStorage.removeItem(`${filterPreferenceStorageKey('capdev', userId)}:folder:${folderId}`);
        setFilters(EMPTY_FILTERS);
        setDraftFilters(EMPTY_FILTERS);
      }
    });
    return () => { active = false; };
  }, [userId, folderId]);

  const saveFiltersForAccount = (next: CapdevFilters) => {
    if (!userId) return;
    window.localStorage.setItem(`${filterPreferenceStorageKey('capdev', userId)}:folder:${folderId}`, JSON.stringify(next));
  };
  const loadData = useCallback(async () => {
    if (!userId) return;
    const sequence = ++loadSequence.current;
    try {
      const response = await readPortal('capdev', { folderId, page, search: debouncedSearch, filters, archived: showArchived, configuration: !configurationLoaded.current,
        focusId: notificationFocus ? Number(notificationFocus.targetId.replace('capdev-record-', '')) : undefined }, userId);
      if (sequence !== loadSequence.current) return;
      const result = response.page;
      if (response.configuration) {
        const { fields, departments: options, access, folders } = response.configuration;
        setDefinitions(fields.map(field => ({ ...field, options: Array.isArray(field.options) ? field.options.filter((option): option is string => typeof option === 'string') : [] })));
        setDepartmentOptions(options);
        if (access.success) setRole(access.role);
        if (folders?.success) setFolderOptions(folders.folders);
        configurationLoaded.current = true;
      }
      if (!result) { setLoadError(''); return; }
      if (!result.success) { setLoadError(result.error); return; }
      if (notificationFocus) setShowArchived(result.archived);
      setLoadError('');
      setFolderName(result.folderName);
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
      if (sequence === loadSequence.current) setLoadError('Unable to load CapDev. Please try again.');
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [folderId, userId, page, debouncedSearch, filters, notificationFocus, showArchived]);

  useEffect(() => {
    let active = true;
    const sequenceRef = loadSequence;
    void Promise.resolve().then(() => { if (active) return loadData(); });
    return () => { active = false; sequenceRef.current++; };
  }, [loadData]);
  useAttachmentRefresh(loadData);


  const pageCount = Math.max(1, Math.ceil(total / 6));
  const visible = projects;

  useEffect(() => {
    if (!notificationFocus || loading) return;
    const target = document.getElementById(notificationFocus.targetId);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const timeoutId = window.setTimeout(() => {
      setNotificationFocus((current) => current?.nonce === notificationFocus.nonce ? null : current);
    }, 2500);
    return () => window.clearTimeout(timeoutId);
  }, [loading, notificationFocus, projects]);
  const requiredDefinitions = definitions.filter((field) => field.isRequired || field.section === 'required');
  const allDefinitions = definitions;
  const rightAlignedFieldIds = getHalfFieldLayout(allDefinitions.map((field) => ({ ...field, key: field.id }))).before;
  const resetPage = () => setPage(1);
  const setValue = (updates: Partial<CapdevForm>) => {
    setForm((current) => ({ ...current, ...updates }));
    const changed = Object.keys(updates);
    if (changed.some((key) => fieldErrors[key])) {
      setFieldErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !changed.includes(key))));
    }
  };
  const showFormError = (message: string) => {
    setError(message);
    focusFormError('capdev-form-error');
  };
  const setDynamicValue = (field: DynamicField, value: unknown) => setForm((current) => ({ ...current, additionalInfo: { ...current.additionalInfo, [dynamicFieldStorageKey(field)]: value } }));

  const editorReadOnly = showArchived || Boolean(editing?.archivedAt) || role !== 'admin';
  const openCreate = () => { if (showArchived) return; setError(''); setFieldErrors({}); setPendingFiles({}); setBudgetHistory([]); setEditing(null); setForm({ ...EMPTY_FORM, folderId }); setDepartmentIsOther(false); setEditorOpen(true); };
  const openEdit = async (project: Capdev) => { setError(''); setFieldErrors({}); setPendingFiles({}); setEditing(project); setForm({ ...project, department: (project.department && project.department !== 'None') ? project.department : '', additionalInfo: { ...project.additionalInfo } }); setDepartmentIsOther(false); setBudgetHistory(await getCapdevBudgetHistory(project.id)); setEditorOpen(true); };
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
    if (field.type === 'file') return getAttachments(value).length > 0 || (Array.isArray(value) && value.some(isPendingAttachment)) || (pendingFiles[storageKey] || []).length > 0;
    if (field.type === 'table') {
      if (Array.isArray(value) && value.length > 0) {
        return value.some((row) => Array.isArray(row) && row.some((cell) => String(cell || '').trim().length > 0));
      }
      return false;
    }
    return value !== undefined && value !== null && String(value).trim().length > 0;
  };
  const areRequiredFieldsComplete = requiredDefinitions.every(hasDynamicValue);

  const saveProject = async (budgetResetConfirmed = false) => {
    if (editorReadOnly) return;
    if (saveProjectInFlight.current || !session.data || !form.aipCode || !form.budget) return;
    const aipCodePattern = /^\d{4}-\d{3}-\d-\d-\d{2}-\d{3}-\d{3}$/;
    if (!aipCodePattern.test(form.aipCode.trim())) {
      setFieldErrors({ aipCode: 'Use the format 0000-000-0-0-00-000-000.' });
      focusFormError('capdev-field-aipCode');
      return;
    }
    try { validateMoney(form.initialBudget); }
    catch {
      setFieldErrors({ budget: 'Enter an initial balance greater than zero with at most two decimal places.' });
      focusFormError('capdev-field-budget');
      return;
    }
    const missingRequiredFields = requiredDefinitions.filter((field) => !hasDynamicValue(field));
    if (missingRequiredFields.length > 0) return;
    if (editing && Number(form.initialBudget) !== Number(editing.initialBudget) && !budgetResetConfirmed) {
      setBudgetResetConfirmationOpen(true);
      return;
    }
    setBudgetResetConfirmationOpen(false);
    saveProjectInFlight.current = true;
    setSaving(true);
    setError('');
    try {
      const { additionalInfo, jobs } = stageAttachments(form.additionalInfo, pendingFiles, definitions);
      const payload = { ...form, folderId: form.folderId || folderId, additionalInfo, aipCode: form.aipCode.trim(), department: (form.department && form.department.trim() !== 'None') ? form.department.trim() : '', updatedById: session.data.user.id };
      const result = editing ? await updateCapdev(editing.id, { ...payload, initialBudget: Number(form.initialBudget) !== Number(editing.initialBudget) ? form.initialBudget : undefined }) : await createCapdev(payload);
      if (result.success) {
        if (result.capdev) uploads.enqueue({ kind: 'capdev', id: result.capdev.id }, result.capdev.aipCode, jobs);
        setEditorOpen(false);
        const projectDept = payload.department?.trim() || 'None';
        setFilters((current) => ({
          ...current,
          departments: current.departments.includes(projectDept) ? current.departments : [...current.departments, projectDept],
        }));
        setPage(1);
        await loadData();
      } else {
        const message = result.error || 'Unable to save this CapDev.';
        const lower = message.toLowerCase();
        if (lower.includes('aip code') || lower.includes('duplicate') || lower.includes('already exists')) {
          setFieldErrors({ aipCode: message });
          focusFormError('capdev-field-aipCode');
        } else if (lower.includes('budget') || lower.includes('balance')) {
          setFieldErrors({ budget: message });
          focusFormError('capdev-field-budget');
        } else showFormError(message);
      }
    } catch (error) {
      console.error('Failed to save CapDev:', error);
      showFormError('Unable to save this CapDev. Please try again.');
    } finally {
      saveProjectInFlight.current = false;
      setSaving(false);
    }
  };

  const openBulk = async () => {
    setBulkAction(showArchived ? 'delete' : 'duplicate');
    setBulkDestinationFolderId(folderId);
    setBulkConfirm(false);
    setBulkOpen(true);
    setBulkLoading(true);
    setBulkError('');
    setSelectedBulkIds([]);
    setBulkTargetDate(`${Number(manilaDate().slice(0, 4)) + 1}-01-01`);
    try {
      const [records, folders] = await Promise.all([getAllCapdevs(), getCapdevFolders()]);
      if (!folders.success) throw new Error('Unable to load folders.');
      setFolderOptions(folders.folders);
      setBulkOptions(records.map((record) => ({
        ...record,
        initialBudget: String(record.initialBudget),
        budget: String(record.budget),
        additionalInfo: record.additionalInfo as Record<string, unknown>,
      })));
    } catch {
      setBulkError('Unable to load CapDev.');
    } finally {
      setBulkLoading(false);
    }
  };

  const availableBulkProjects = bulkOptions.filter(project => bulkAction === 'duplicate' ? !project.archivedAt : project.folderId === folderId && (bulkAction === 'delete' || (bulkAction === 'move' && showArchived) ? Boolean(project.archivedAt) : !project.archivedAt));
  const destinationFolderName = folderOptions.find(folder => folder.id === bulkDestinationFolderId)?.name || 'the destination folder';
  const selectedProjectLabel = 'CapDev';
  const bulkLabel = bulkAction === 'duplicate' ? 'Duplicate' : bulkAction === 'archive' ? 'Archive' : bulkAction === 'move' ? 'Move' : 'Delete permanently';
  const BulkActionIcon = bulkAction === 'duplicate' ? DuplicateIcon : bulkAction === 'archive' ? ArchiveIcon : bulkAction === 'move' ? MoveIcon : DeleteIcon;
  const submitBulk = async () => {
    if (bulkInFlight.current || selectedBulkIds.length === 0 || (bulkAction === 'duplicate' && !bulkTargetDate) || ((bulkAction === 'duplicate' || bulkAction === 'move') && !bulkDestinationFolderId) || (bulkAction === 'move' && bulkDestinationFolderId === folderId)) return;
    bulkInFlight.current = true;
    setBulkSaving(true);
    setBulkError('');
    try {
      if (bulkAction !== 'duplicate') {
        const result = await bulkManageCapdevs({ capdevIds: selectedBulkIds, folderId, action: bulkAction, destinationFolderId: bulkDestinationFolderId });
        if (!result.success) { setBulkError(result.error || 'Unable to update the selected CapDev.'); setBulkConfirm(false); return; }
        if (bulkAction === 'move') setBulkSuccess('Moved ' + selectedBulkIds.length + ' ' + selectedProjectLabel + ' to ' + destinationFolderName + '.');
        setBulkConfirm(false); setBulkOpen(false); setPage(1); await loadData(); return;
      }
      const result = await duplicateCapdevs({ capdevIds: selectedBulkIds, targetDate: bulkTargetDate, folderId: bulkDestinationFolderId });
      if (!result.success) {
        setBulkError(result.error || 'Unable to duplicate the selected CapDev.');
        return;
      }
      setBulkSuccess('Duplicated ' + selectedBulkIds.length + ' ' + selectedProjectLabel + ' into ' + destinationFolderName + '.');
      if (bulkDestinationFolderId !== folderId) { setBulkOpen(false); return; }
      const targetYear = bulkTargetDate.slice(0, 4);
      const nextFilters: CapdevFilters = {
        ...filters,
        dateFrom: `${targetYear}-01-01`,
        dateTo: `${targetYear}-12-31`,
      };
      setFilters(nextFilters);
      setDraftFilters(nextFilters);
      saveFiltersForAccount(nextFilters);
      setPage(1);
      setBulkOpen(false);
    } catch {
      setBulkError('Unable to update the selected CapDev.'); setBulkConfirm(false);
    } finally {
      bulkInFlight.current = false;
      setBulkSaving(false);
    }
  };

  const renderDynamicField = (field: DynamicField) => {
    const isRequired = field.isRequired || field.section === 'required';
    const storageKey = dynamicFieldStorageKey(field);
    const fieldValue = getDynamicFieldValue(form.additionalInfo, field);
    if (editorReadOnly) return <Grid key={field.id} size={field.type === 'table' ? 12 : field.width === 'half' ? { xs: 12, sm: 6 } : 12}><ReadOnlyDynamicField field={field} value={fieldValue} /></Grid>;
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
            pendingUploads={Array.isArray(fieldValue) ? fieldValue.filter(isPendingAttachment) : []}
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

  if (session.isPending || loading) return <ResourceGridSkeleton titleWidth={220} />;
  if (!session.data) return null;

  const isAdmin = role === 'admin';
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 72px)' }}>
      <Container maxWidth={false} sx={{ p: 0, width: '100%', flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
          <Typography variant="h4" sx={{ fontWeight: '800', color: 'text.primary', letterSpacing: '-1px' }}>{folderName || 'CapDev'}</Typography>
          <Stack direction="row" spacing={1} useFlexGap sx={{ width: { xs: '100%', sm: 'auto' }, alignItems: 'center', flexWrap: 'wrap' }}>
            <TextField size="small" placeholder="Search CapDev..." value={search} onChange={(event) => { setSearch(event.target.value); resetPage(); }} slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon color="action" /></InputAdornment> } }} sx={{ bgcolor: '#ffffff', borderRadius: 2, minWidth: { sm: 260 }, '& .MuiOutlinedInput-root': { borderRadius: 2 } }} />
            <Button size="small" sx={{ height: 40 }} variant="outlined" startIcon={<FilterIcon />} onClick={() => { setDraftFilters(filters); setFiltersOpen(true); }}>Filter</Button>
            <Button size="small" sx={{ height: 40, whiteSpace: 'nowrap' }} variant="outlined" onClick={() => { setShowArchived(!showArchived); setNotificationFocus(null); resetPage(); }}>{showArchived ? 'See Active CapDev' : 'See Archives'}</Button>
            {Boolean(folderId) && <CapdevReferenceImage key={folderId} folderId={folderId} isAdmin={isAdmin} />}
            {isAdmin && <CapdevFoldersPanel onChanged={(folders) => { setFolderOptions(folders); const current = folders.find(folder => folder.id === folderId); if (current) setFolderName(current.name); }} onSelected={(folder) => { if (folder.id !== folderId) router.replace('/portal/folders/' + folder.id + (showArchived ? '?archived=1' : '')); else { setFolderName(folder.name); void loadData(); } }} />}
            {isAdmin && Boolean(folderId) && <Tooltip title="Manage CapDev"><IconButton color="primary" onClick={() => void openBulk()} aria-label="Manage CapDev" sx={{ width: 40, height: 40, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}><BulkIcon /></IconButton></Tooltip>}
        </Stack>
      </Stack>

        {loadError && <Alert severity="error" sx={{ mb: 2 }}>{loadError}<Button onClick={() => void loadData()}>Retry</Button></Alert>}
        {visible.length === 0 ? <Card variant="outlined" sx={{ borderRadius: 2, minHeight: 300, display: 'grid', placeItems: 'center' }}><Stack spacing={1} sx={{ alignItems: 'center', color: 'text.secondary' }}><CapdevIcon sx={{ fontSize: 42 }} /><Typography>No CapDev found</Typography></Stack></Card> :
          <Grid container spacing={3} sx={{ flexGrow: 1, alignContent: 'flex-start' }}>{visible.map((project) => <Grid id={`capdev-record-${project.id}`} key={project.id} size={{ xs: 12, sm: 6, md: 4 }} sx={{ position: 'relative', pt: 3, scrollMarginTop: 96 }}>
            <Box sx={{ position: 'absolute', top: 0, left: 0, zIndex: 0, height: 48, p: '1px', bgcolor: 'divider', clipPath: 'polygon(10px 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 10px 100%, 0 50%)' }}><Box sx={{ height: '100%', px: 2, pt: .5, bgcolor: '#fafcfa', clipPath: 'polygon(10px 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 10px 100%, 0 50%)', display: 'flex', alignItems: 'flex-start' }}><Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap', lineHeight: 1.3 }}>{project.archivedAt ? 'Archived' : 'Added'} {formatDate(project.archivedAt || project.createdAt)}</Typography></Box></Box>
            <Card variant="outlined" sx={{ position: 'relative', zIndex: 1, borderRadius: 2, bgcolor: project.archivedAt ? 'grey.100' : '#fafcfa', height: '100%', display: 'flex', flexDirection: 'column', transition: 'all 0.2s', animation: notificationFocus?.targetId === `capdev-record-${project.id}` ? 'capdevNotificationFocus 2500ms ease-in-out' : 'none', '@keyframes capdevNotificationFocus': { '0%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(46, 125, 50, 0)' }, '30%': { transform: 'scale(0.975)', boxShadow: '0 0 0 3px rgba(46, 125, 50, 0.22)' }, '65%': { transform: 'scale(1.025)', boxShadow: '0 8px 24px rgba(46, 125, 50, 0.2)' }, '100%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(46, 125, 50, 0)' } }, '&:hover': { boxShadow: '0 4px 12px rgba(0,0,0,0.04)', borderColor: 'primary.main' } }}>
              <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', p: 3 }}>
                <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', mb: 2 }}><Box sx={{ bgcolor: project.archivedAt ? 'grey.200' : 'rgba(46, 125, 50, 0.08)', p: 1.2, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CapdevIcon color={project.archivedAt ? 'action' : 'primary'} /></Box><Box sx={{ flexGrow: 1 }}><Typography variant="h6" sx={{ fontWeight: '700', color: 'text.primary', lineHeight: 1.2 }}>{project.aipCode}</Typography>{project.department && project.department !== 'None' && <Typography variant="body2" color="text.secondary">{project.department}</Typography>}</Box></Stack>
                <Stack spacing={1.5} sx={{ my: 1 }}><Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Typography variant="body2" color="text.secondary">Initial Balance</Typography><Typography variant="body2" sx={{ fontWeight: '700', color: project.archivedAt ? 'text.secondary' : 'primary.dark' }}>{formatCurrency(project.initialBudget)}</Typography></Stack><Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Typography variant="body2" color="text.secondary">Remaining Balance</Typography><Typography variant="body2" sx={{ fontWeight: '700', color: project.archivedAt ? 'text.secondary' : Number(project.budget) <= 0 ? 'error.main' : 'primary.dark' }}>{formatCurrency(project.budget)}</Typography></Stack></Stack>
                <Divider sx={{ my: 2 }} />
                <Stack direction="row" sx={{ mt: 'auto', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                  <Button variant="text" color="primary" endIcon={<ChevronRightIcon />} component={Link} href={`/portal/capdev/${project.id}/requests`} sx={{ p: 0, minWidth: 0, fontWeight: '700', '&:hover': { bgcolor: 'transparent', color: 'primary.dark' } }}>
                    View Requests
                  </Button>
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                    <Tooltip title={project.archivedAt ? 'View Details' : 'View & Edit Details'}>
                      <IconButton size="small" color="primary" onClick={() => openEdit(project)} aria-label={`View details for ${project.aipCode}`}>
                        <VisibilityIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {isAdmin && <ArchiveActions label={project.aipCode} archived={Boolean(project.archivedAt)} onArchive={() => archiveCapdev(project.id)} onRestore={() => restoreCapdev(project.id)} onDelete={() => deleteCapdev(project.id)} onChanged={loadData} deleteMessage={`Permanently delete ${project.aipCode} and all its requests? This cannot be undone.`} />}
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          </Grid>)}</Grid>}

      {total > 6 && <Stack direction="row" spacing={2} sx={{ justifyContent: 'center', alignItems: 'center', mt: 3 }}><Button variant="outlined" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><Typography variant="body2" sx={{ fontWeight: 700 }}>Page {page} of {pageCount}</Typography><Button variant="outlined" disabled={page === pageCount} onClick={() => setPage((value) => value + 1)}>Next</Button></Stack>}
      {isAdmin && Boolean(folderId) && !showArchived && <Fab variant="extended" color="primary" onClick={openCreate} sx={{ position: 'fixed', right: 24, bottom: 24, zIndex: 1100, px: 2.5 }}><AddIcon sx={{ mr: 1 }} />Add CapDev</Fab>}

      <Dialog open={editorOpen} onClose={() => !saving && setEditorOpen(false)} fullWidth maxWidth="md">
        <DialogTitle sx={{ fontWeight: 800 }}>{editing?.archivedAt ? 'CapDev Details' : editing ? 'Edit CapDev' : 'Add CapDev'}</DialogTitle>
        <DialogContent dividers>
          {error && <Alert id="capdev-form-error" tabIndex={-1} severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 2 }}>Capacity Development</Typography>
          <Grid container spacing={2.5} sx={{ pt: 0.5 }}>
            {isAdmin && <Grid size={12}><TextField select fullWidth label="Folder" disabled={editorReadOnly} value={form.folderId || folderId} onChange={(event) => setValue({ folderId: Number(event.target.value) })}>{folderOptions.map(folder => <MenuItem key={folder.id} value={folder.id}>{folder.name}</MenuItem>)}</TextField></Grid>}
            <Grid size={{ xs: 12, sm: 6 }} id="capdev-field-aipCode"><TextField disabled={editorReadOnly} required fullWidth label="AIP Code" placeholder="0000-000-0-0-00-000-000" value={form.aipCode} error={Boolean(fieldErrors.aipCode)} helperText={fieldErrors.aipCode} onChange={(event) => setValue({ aipCode: formatAipCode(event.target.value) })} onBlur={() => { if (form.aipCode && !/^\d{4}-\d{3}-\d-\d-\d{2}-\d{3}-\d{3}$/.test(form.aipCode.trim())) setFieldErrors((current) => ({ ...current, aipCode: 'Use the format 0000-000-0-0-00-000-000.' })); }} /></Grid>
            <Grid size={{ xs: 12, sm: 6 }}><DepartmentCombobox disabled={editorReadOnly} options={departmentOptions} value={form.department} onChange={(department) => setValue({ department })} otherSelected={departmentIsOther} onOtherSelectedChange={setDepartmentIsOther} /></Grid>
            <Grid size={editing ? { xs: 12, sm: 6 } : 12} id="capdev-field-budget">{editorReadOnly ? <><Typography variant="body2" color="text.secondary">Initial Balance</Typography><Typography sx={{ fontWeight: 700 }}>{formatCurrency(form.initialBudget)}</Typography></> : <TextField required fullWidth label="Initial Balance" type="number" value={form.initialBudget} error={Boolean(fieldErrors.budget)} helperText={fieldErrors.budget || (editing && Number(form.initialBudget) !== Number(editing.initialBudget) ? 'Saving resets the remaining balance to this amount.' : undefined)} slotProps={{ htmlInput: { min: '0.01', step: '0.01' } }} onChange={(event) => { const initialBudget = event.target.value; setValue({ initialBudget, budget: editing && Number(initialBudget) === Number(editing.initialBudget) ? editing.budget : initialBudget }); }} />}</Grid>
            {editing && <Grid size={{ xs: 12, sm: 6 }}><Typography variant="body2" color="text.secondary">Remaining Balance</Typography><Typography sx={{ fontWeight: 700, color: Number(form.budget) <= 0 ? 'error.main' : 'primary.dark' }}>{formatCurrency(form.budget)}</Typography></Grid>}
            {allDefinitions.map(renderDynamicField)}
          </Grid>
          {editing && <><Divider sx={{ my: 3 }} /><Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 2 }}>Balance History</Typography>{budgetHistory.length > 0 && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>Deductions include those recorded before balance resets.</Typography>}<Stack spacing={1.25}><Stack direction="row" sx={{ justifyContent: 'space-between' }}><Typography variant="body2">Initial balance</Typography><Typography variant="body2" sx={{ fontWeight: 800 }}>{formatCurrency(form.initialBudget)}</Typography></Stack>{budgetHistory.map((entry, index) => <Stack key={`${String(entry.createdAt)}-${index}`} direction="row" spacing={1} sx={{ pl: 2, alignItems: 'center', color: 'error.main' }}><Typography aria-hidden sx={{ fontWeight: 800 }}>└</Typography><Typography variant="body2" sx={{ flexGrow: 1 }}>Deducted by {entry.authorName || 'Staff member'}</Typography><Typography variant="body2" sx={{ fontWeight: 800 }}>−{formatCurrency(entry.amount)}</Typography></Stack>)}<Divider /><Stack direction="row" sx={{ justifyContent: 'space-between' }}><Typography variant="body2" sx={{ fontWeight: 800 }}>Remaining balance</Typography><Typography variant="body2" sx={{ fontWeight: 800, color: Number(form.budget) <= 0 ? 'error.main' : 'primary.dark' }}>{formatCurrency(form.budget)}</Typography></Stack></Stack><Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 3 }}>Added {formatDate(editing.createdAt)}</Typography></>}
        </DialogContent>
        <DialogActions sx={{ p: 2.5 }}><Button onClick={() => setEditorOpen(false)} disabled={saving} color="inherit">Close</Button>{isAdmin && <Button onClick={() => void saveProject()} disabled={editorReadOnly || saving || !form.aipCode || !form.budget || (!form.initialBudget || Number(form.initialBudget) <= 0) || !areRequiredFieldsComplete || Object.keys(fieldErrors).length > 0} variant="contained">{saving ? 'Saving' : 'Save CapDev'}</Button>}</DialogActions>
      </Dialog>
      <Dialog open={budgetResetConfirmationOpen} onClose={() => !saving && setBudgetResetConfirmationOpen(false)} fullWidth maxWidth="sm" aria-labelledby="budget-reset-title" aria-describedby="budget-reset-description">
        <DialogTitle id="budget-reset-title" sx={{ fontWeight: 800 }}>Reset remaining balance?</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Typography id="budget-reset-description">Changing the initial balance for CapDev {editing?.aipCode} will reset its remaining balance to the new initial amount.</Typography>
            <Stack spacing={1}>
              <Typography>Current remaining balance: <strong>{formatCurrency(editing?.budget || '0')}</strong></Typography>
              <Typography>New initial balance: <strong>{formatCurrency(form.initialBudget)}</strong></Typography>
              <Typography>New remaining balance: <strong>{formatCurrency(form.initialBudget)}</strong></Typography>
            </Stack>
            <Alert severity="warning">Saving replaces the remaining balance shown above. Existing requests and deduction history will be kept.</Alert>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2.5 }}>
          <Button autoFocus color="inherit" disabled={saving} onClick={() => setBudgetResetConfirmationOpen(false)}>Cancel</Button>
          <Button variant="contained" color="warning" disabled={saving} onClick={() => void saveProject(true)}>Reset balance and save</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={filtersOpen} onClose={() => setFiltersOpen(false)} fullWidth maxWidth="sm"><DialogTitle sx={{ fontWeight: 800 }}>Filter CapDev</DialogTitle><DialogContent dividers><Grid container spacing={2} sx={{ pt: .5 }}><Grid size={12}><Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>Departments</Typography>{departments.map((item) => <FormControlLabel key={item} control={<Checkbox checked={draftFilters.departments.includes(item)} onChange={() => setDraftFilters((current) => ({ ...current, departments: current.departments.includes(item) ? current.departments.filter((department) => department !== item) : [...current.departments, item] }))} />} label={item} sx={{ display: 'flex', width: 'fit-content' }} />)}</Grid><Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="Initial balance from" type="number" value={draftFilters.initialMin} onChange={(e) => setDraftFilters({ ...draftFilters, initialMin: e.target.value })} /></Grid><Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="Initial balance to" type="number" value={draftFilters.initialMax} onChange={(e) => setDraftFilters({ ...draftFilters, initialMax: e.target.value })} /></Grid><Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="Remaining balance from" type="number" value={draftFilters.remainingMin} onChange={(e) => setDraftFilters({ ...draftFilters, remainingMin: e.target.value })} /></Grid><Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="Remaining balance to" type="number" value={draftFilters.remainingMax} onChange={(e) => setDraftFilters({ ...draftFilters, remainingMax: e.target.value })} /></Grid><Grid size={{ xs: 12, sm: 6 }}><DateField label="Date added from" value={draftFilters.dateFrom} onChange={(val) => setDraftFilters({ ...draftFilters, dateFrom: val })} /></Grid><Grid size={{ xs: 12, sm: 6 }}><DateField label="Date added to" value={draftFilters.dateTo} onChange={(val) => setDraftFilters({ ...draftFilters, dateTo: val })} /></Grid><Grid size={12}><Stack direction="row" spacing={1}>{(['today', 'month', 'year'] as const).map((preset) => <Button key={preset} size="small" variant={getActiveDateFilterPreset(draftFilters.dateFrom, draftFilters.dateTo) === preset ? 'contained' : 'text'} onClick={() => setDraftFilters({ ...draftFilters, ...getDateFilterPresetRange(preset) })}>{preset === 'today' ? 'Today' : preset === 'month' ? 'This month' : 'This year'}</Button>)}</Stack></Grid><Grid size={12}><TextField select fullWidth label="Sort" value={draftFilters.sort} onChange={(e) => setDraftFilters({ ...draftFilters, sort: e.target.value })}><MenuItem value="newest">Newest to oldest</MenuItem><MenuItem value="oldest">Oldest to newest</MenuItem></TextField></Grid></Grid></DialogContent><DialogActions sx={{ p: 2.5 }}><Button onClick={() => setDraftFilters({ departments: [...departments], initialMin: '', initialMax: '', remainingMin: '', remainingMax: '', dateFrom: '', dateTo: '', sort: 'newest' })}>Reset</Button><Button variant="contained" onClick={() => { const next = { ...draftFilters, departments: [...draftFilters.departments] }; setFilters(next); saveFiltersForAccount(next); resetPage(); setFiltersOpen(false); }}>Apply Filters</Button></DialogActions></Dialog>

      <Dialog open={bulkOpen && !bulkConfirm} onClose={() => { if (!bulkSaving) setBulkOpen(false); }} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 800 }}>Manage CapDev</DialogTitle>
        <DialogContent dividers><Stack spacing={2.5}>
          <TextField select fullWidth label="Action" value={bulkAction} disabled={bulkSaving || bulkLoading} onChange={event => { const action = event.target.value as typeof bulkAction; setBulkAction(action); if (action === 'move' && bulkDestinationFolderId === folderId) setBulkDestinationFolderId(0); else if (action === 'duplicate' && !bulkDestinationFolderId) setBulkDestinationFolderId(folderId); setSelectedBulkIds([]); setBulkError(''); }}>
            {!showArchived && <MenuItem value="duplicate">Duplicate</MenuItem>}
            {!showArchived && <MenuItem value="archive">Archive</MenuItem>}
            {showArchived && <MenuItem value="delete">Delete permanently</MenuItem>}
            <MenuItem value="move">Move</MenuItem>
          </TextField>
          <Typography variant="body2" color="text.secondary">{bulkAction === 'duplicate' ? "Copy CapDev records into the destination folder. Requests and progress are excluded; remaining balances reset to initial balances. The active folder stays selected." : bulkAction === 'move' ? 'Move CapDev from this folder, keeping their requests, progress, attachments, balances, dates added, and archive state. The active folder stays selected.' : bulkAction === 'archive' ? 'Archive selected CapDev in this folder. Their requests and history become read-only.' : 'Permanently delete selected archived CapDev in this folder and their requests, progress, notifications, and managed attachments. This cannot be undone.'}</Typography>
          {bulkError && <Alert severity="error">{bulkError}</Alert>}
          {(bulkAction === 'duplicate' || bulkAction === 'move') && <TextField select required fullWidth label="Destination folder" value={bulkDestinationFolderId} disabled={bulkLoading || bulkSaving} helperText={bulkAction === 'move' && folderOptions.length < 2 ? 'Add another folder to move CapDev into it.' : undefined} onChange={event => setBulkDestinationFolderId(Number(event.target.value))}><MenuItem value={0} disabled>Choose a folder</MenuItem>{folderOptions.filter(folder => bulkAction !== 'move' || folder.id !== folderId).map(folder => <MenuItem key={folder.id} value={folder.id}>{folder.name}</MenuItem>)}</TextField>}
          {bulkAction === 'duplicate' && <DateField label="Date added for duplicates" value={bulkTargetDate} onChange={setBulkTargetDate} required />}
          <Box>
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>CapDev</Typography>
              <Stack direction="row" spacing={1}><Button size="small" disabled={bulkLoading || bulkSaving} onClick={() => setSelectedBulkIds(availableBulkProjects.map(project => project.id))}>Select All</Button><Button size="small" disabled={bulkSaving} onClick={() => setSelectedBulkIds([])} color="inherit">Clear</Button></Stack>
            </Stack>
            <Box sx={{ maxHeight: 300, overflowY: 'auto', pr: 1 }}>
              {bulkLoading ? <Typography color="text.secondary" sx={{ py: 2 }}>Loading CapDev...</Typography> : availableBulkProjects.map(project => <FormControlLabel key={project.id} control={<Checkbox disabled={bulkSaving} checked={selectedBulkIds.includes(project.id)} onChange={() => setSelectedBulkIds(current => current.includes(project.id) ? current.filter(id => id !== project.id) : [...current, project.id])} />} label={<Stack><Typography variant="body2" sx={{ fontWeight: 700 }}>{project.aipCode}</Typography><Typography variant="caption" color="text.secondary">{project.department || 'None'} / {folderOptions.find(folder => folder.id === project.folderId)?.name || folderName} / Added {formatDate(project.createdAt)}</Typography></Stack>} sx={{ display: 'flex', width: '100%', m: 0, py: 0.5 }} />)}
              {!bulkLoading && !availableBulkProjects.length && <Typography color="text.secondary" sx={{ py: 2 }}>No eligible CapDev.</Typography>}
            </Box>
          </Box>
        </Stack></DialogContent>
        <DialogActions sx={{ p: 2.5 }}><Button color="inherit" disabled={bulkSaving} onClick={() => setBulkOpen(false)}>Cancel</Button><Button variant="contained" color={bulkAction === 'delete' ? 'error' : bulkAction === 'archive' ? 'warning' : 'primary'} startIcon={<BulkActionIcon />} disabled={bulkSaving || bulkLoading || !selectedBulkIds.length || selectedBulkIds.length > 500 || (bulkAction === 'duplicate' && !bulkTargetDate) || ((bulkAction === 'duplicate' || bulkAction === 'move') && !bulkDestinationFolderId) || (bulkAction === 'move' && bulkDestinationFolderId === folderId)} onClick={() => { if (bulkAction === 'duplicate') void submitBulk(); else setBulkConfirm(true); }}>{bulkSaving ? 'Saving...' : bulkLabel + ' (' + selectedBulkIds.length + ')'}</Button></DialogActions>
      </Dialog>
      <Dialog open={bulkConfirm} onClose={() => { if (!bulkSaving) setBulkConfirm(false); }} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 800 }}>{bulkLabel} selected CapDev?</DialogTitle>
        <DialogContent dividers><Typography sx={{ mb: 2 }}>{bulkAction === 'delete' ? 'Delete these archived CapDev and all their requests, progress, notifications, and managed attachments permanently? This cannot be undone.' : bulkAction === 'move' ? 'Move these CapDev to ' + (folderOptions.find(folder => folder.id === bulkDestinationFolderId)?.name || '') + '? All related records and balances will be preserved. The active folder will stay selected.' : 'Archive these CapDev and make their requests and history read-only?'}</Typography>{availableBulkProjects.filter(project => selectedBulkIds.includes(project.id)).map(project => <Typography key={project.id} variant="body2">{project.aipCode}</Typography>)}</DialogContent>
        <DialogActions sx={{ p: 2.5 }}><Button autoFocus disabled={bulkSaving} onClick={() => setBulkConfirm(false)}>Cancel</Button><Button variant="contained" color={bulkAction === 'delete' ? 'error' : bulkAction === 'archive' ? 'warning' : 'primary'} startIcon={<BulkActionIcon />} disabled={bulkSaving} onClick={() => void submitBulk()}>{bulkSaving ? 'Saving...' : bulkLabel}</Button></DialogActions>
      </Dialog>

      <Snackbar open={Boolean(bulkSuccess)} autoHideDuration={6000} onClose={() => setBulkSuccess('')}><Alert severity="success" onClose={() => setBulkSuccess('')}>{bulkSuccess}</Alert></Snackbar>
      </Container>
    </Box>
  );
}
