'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Add as AddIcon,
  VisibilityOutlined as VisibilityIcon,
  Assignment as RequestIcon,
  AttachFile as AttachFileIcon,
  Cancel as CancelIcon,
  Check as CheckIcon,
  CheckCircle as CheckCircleIcon,
  ContentCopy as ContentCopyIcon,
  Description as FormIcon,
  Edit as EditIcon,
  Insights as SummaryIcon,
  OpenInNew as OpenInNewIcon,
  Payments as PaymentsIcon,
  PlayArrow as ResumeIcon,
  PushPin as StopperIcon,
  NotificationsActiveRounded as ReminderIcon,
} from '@mui/icons-material';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Fab,
  FormControlLabel,
  Grid,
  InputAdornment,
  IconButton,
  Tooltip,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { TimelineGridSkeleton } from '@/components/Skeletons';
import ReadOnlyDynamicField from '@/components/ReadOnlyDynamicField';
import EvaluationSummaryDialog from '@/components/EvaluationSummaryDialog';
import { authClient } from '@/lib/auth/client';
import {
  createRequestStatusUpdate,
  getCapdevById,
  getCurrentUserAccess,
  getOrCreateRequestEvaluationForms,
  getRequestById,
  getRequestEvaluationSummary,
  getRequestStatusUpdates,
  getStatusUpdateFieldDefinitions,
  resumeRequestProgress,
  stopRequestProgress,
  updateRequestStatus,
  type AppRole,
  type StatusAttachment,
} from '@/app/actions';
import DateField from '@/components/DateField';
import SelectionCombobox from '@/components/SelectionCombobox';
import DynamicTableField from '@/components/DynamicTableField';
import { dynamicFieldStorageKey, getDynamicFieldValue } from '@/lib/dynamic-fields';
import { getHalfFieldLayout } from '@/components/FieldReorder';
import { uploadFilesDirectlyToGoogleDrive } from '@/lib/google-drive-client';
import type { EvaluationSummary } from '@/lib/google-forms';
import FileFieldChecklist from '@/components/FileFieldChecklist';
import { focusFormError } from '@/lib/form-error-focus';
import { orderedStatusValues, showPrimaryStatus, showStandaloneRemarks } from '@/lib/status-update-display';

type DynamicField = {
  id: number;
  name: string;
  type: string;
  options: string[] | null;
  isRequired: boolean;
  section: string;
  width: string;
  columnPosition: string;
  placeholder: string | null;
};

import { inactivityMessage, type RequestInactivity } from '@/lib/request-inactivity';

type RequestSummary = {
  inactivity: RequestInactivity | null;
  budgetDeductedAt: Date | string | null;
  archivedAt: Date | string | null;
  requestorName: string | null;
  id: number;
  capdevId: number;
  setting: string;
  requestedBudget: string;
  status: string;
  isStopped: boolean;
  activeStopperId: number | null;
  participantFeedbackFormId: string | null;
  participantFeedbackFormUrl: string | null;
};

type StatusUpdate = {
  archivedAt: Date | string | null;
  id: number;
  requestId: number;
  authorName: string | null;
  statusUpdate: string;
  remarks: string | null;
  files: unknown;
  statusMark?: string | null;
  markAsComplete: boolean;
  subtractsRequestedAmount: boolean;
  isStopper: boolean;
  isStopperResponse: boolean;
  isResume: boolean;
  stopperId: number | null;
  additionalInfo?: Record<string, unknown>;
  createdAt: Date | string;
};

type StatusForm = {
  statusUpdate: string;
  remarks: string;
  files: File[];
  additionalInfo: Record<string, unknown>;
  statusMark: 'pending' | 'denied' | 'completed' | 'accepted' | null;
  subtractsRequestedAmount: boolean;
  addStopper: boolean;
};

type TimelineFocusRequest = {
  targetId: string;
  nonce: number;
};

const EMPTY_FORM: StatusForm = {
  statusUpdate: '',
  remarks: '',
  files: [],
  additionalInfo: {},
  statusMark: 'pending',
  subtractsRequestedAmount: false,
  addStopper: false,
};

const formatDateTime = (value: Date | string) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));

const formatCurrency = (value: string | number) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(
    Number(value) || 0
  );

const getAttachments = (value: unknown): StatusAttachment[] =>
  Array.isArray(value)
    ? value.filter(
        (file): file is StatusAttachment =>
          typeof file === 'object' && file !== null && 'id' in file && 'name' in file && 'url' in file
      )
    : [];

function ConnectorDown({ toResolution = false }: { toResolution?: boolean }) {
  const height = toResolution ? 88 : 40;
  return (
    <Box
      sx={{
        display: { xs: 'none', md: 'block' },
        position: 'absolute',
        bottom: `-${height}px`,
        left: '50%',
        width: 22,
        height,
        transform: 'translateX(-50%)',
        color: 'primary.main',
        zIndex: 1,
        pointerEvents: 'none',
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          bottom: 13,
          left: 8.5,
          width: 5,
          bgcolor: 'currentColor',
          borderRadius: 2,
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          bottom: 0,
          left: 1,
          width: 0,
          height: 0,
          borderLeft: '10px solid transparent',
          borderRight: '10px solid transparent',
          borderTop: '13px solid currentColor',
        }}
      />
    </Box>
  );
}

function ConnectorRight({ toResolution = false }: { toResolution?: boolean }) {
  const width = toResolution ? 112 : 56;
  return (
    <Box
      sx={{
        display: { xs: 'none', md: 'block' },
        position: 'absolute',
        top: '50%',
        right: `-${width}px`,
        width,
        height: 22,
        transform: 'translateY(-50%)',
        color: 'primary.main',
        zIndex: 1,
        pointerEvents: 'none',
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          left: 0,
          right: 13,
          top: 8.5,
          height: 5,
          bgcolor: 'currentColor',
          borderRadius: 2,
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          right: 0,
          top: 1,
          width: 0,
          height: 0,
          borderTop: '10px solid transparent',
          borderBottom: '10px solid transparent',
          borderLeft: '13px solid currentColor',
        }}
      />
    </Box>
  );
}

function ConnectorLeft({ toResolution = false }: { toResolution?: boolean }) {
  const width = toResolution ? 112 : 56;
  return (
    <Box
      sx={{
        display: { xs: 'none', md: 'block' },
        position: 'absolute',
        top: '50%',
        left: `-${width}px`,
        width,
        height: 22,
        transform: 'translateY(-50%)',
        color: 'primary.main',
        zIndex: 1,
        pointerEvents: 'none',
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          left: 13,
          right: 0,
          top: 8.5,
          height: 5,
          bgcolor: 'currentColor',
          borderRadius: 2,
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          left: 0,
          top: 1,
          width: 0,
          height: 0,
          borderTop: '10px solid transparent',
          borderBottom: '10px solid transparent',
          borderRight: '13px solid currentColor',
        }}
      />
    </Box>
  );
}

export default function StatusTimelinePage({ capdevId, requestId }: { capdevId: number; requestId: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reminderQuery = searchParams.get('reminder');
  const [reminderRequested, setReminderRequested] = useState(false);
  const session = authClient.useSession();
  const [request, setRequest] = useState<RequestSummary | null>(null);
  const [viewingUpdate, setViewingUpdate] = useState<StatusUpdate | null>(null);
  const [updates, setUpdates] = useState<StatusUpdate[]>([]);
  const [definitions, setDefinitions] = useState<DynamicField[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [concludeDialogOpen, setConcludeDialogOpen] = useState(false);
  const [concludeAction, setConcludeAction] = useState<'completed' | 'denied' | null>(null);
  const [concluding, setConcluding] = useState(false);
  const [formsModalOpen, setFormsModalOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [summaryModalOpen, setSummaryModalOpen] = useState(false);
  const [evaluationSummary, setEvaluationSummary] = useState<EvaluationSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [form, setForm] = useState<StatusForm>(EMPTY_FORM);
  const [pendingFiles, setPendingFiles] = useState<Record<string, File[]>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [capdev, setCapdev] = useState<{ id: number; aipCode: string; budget: string; archivedAt: Date | string | null } | null>(null);
  const [deductModalOpen, setDeductModalOpen] = useState(false);
  const [deductionWarningOpen, setDeductionWarningOpen] = useState(false);
  const [editableDeductedAmount, setEditableDeductedAmount] = useState('');
  const [role, setRole] = useState<AppRole>('employee');
  const [stopperResponse, setStopperResponse] = useState({ text: '', files: [] as File[] });
  const [respondingToStopper, setRespondingToStopper] = useState(false);
  const [timelineFocus, setTimelineFocus] = useState<TimelineFocusRequest | null>(null);

  useEffect(() => {
    if (reminderQuery === '1') void Promise.resolve().then(() => setReminderRequested(true));
  }, [reminderQuery]);

  const closeReminder = () => {
    setReminderRequested(false);
    const latestUpdateId = request?.inactivity?.latestUpdateId;
    if (latestUpdateId && updates.some((update) => update.id === latestUpdateId)) {
      setTimelineFocus({ targetId: 'request-status-update-' + latestUpdateId, nonce: Date.now() });
    }
    const url = new URL(window.location.href);
    url.searchParams.delete('reminder');
    if (url.hash === '#request-status-start') url.hash = '';
    router.replace(url.pathname + url.search + url.hash, { scroll: false });
  };

  useEffect(() => {
    const focusTarget = (targetId: string) => {
      if (
        targetId !== 'request-status-start' &&
        targetId !== 'request-status-resolution' &&
        !targetId.startsWith('request-status-update-')
      ) return;
      setTimelineFocus({ targetId, nonce: Date.now() });
    };

    const handleTimelineFocus = (event: Event) => {
      const detail = (event as CustomEvent<{ requestId?: number; targetId?: string }>).detail;
      if (detail?.requestId !== requestId || !detail.targetId) return;
      focusTarget(detail.targetId);
    };

    const handleNotificationFocus = (event: Event) => {
      const detail = (event as CustomEvent<{ targetId?: string; reminder?: boolean }>).detail;
      setReminderRequested(Boolean(detail?.reminder));
      if (detail?.targetId) focusTarget(detail.targetId);
    };

    const focusFromHash = () => {
      const targetId = decodeURIComponent(window.location.hash.slice(1));
      if (targetId) focusTarget(targetId);
    };

    window.addEventListener('leaprs:request-timeline-focus', handleTimelineFocus);
    window.addEventListener('leaprs:notification-focus', handleNotificationFocus);
    window.addEventListener('hashchange', focusFromHash);
    focusFromHash();
    return () => {
      window.removeEventListener('leaprs:request-timeline-focus', handleTimelineFocus);
      window.removeEventListener('leaprs:notification-focus', handleNotificationFocus);
      window.removeEventListener('hashchange', focusFromHash);
    };
  }, [requestId]);

  useEffect(() => {
    if (!timelineFocus || loading || reminderRequested) return;
    const target = document.getElementById(timelineFocus.targetId);
    if (!target) return;

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const timeoutId = window.setTimeout(() => {
      setTimelineFocus((current) => (current?.nonce === timelineFocus.nonce ? null : current));
    }, 2500);

    return () => window.clearTimeout(timeoutId);
  }, [loading, reminderRequested, timelineFocus, updates]);

  useEffect(() => {
    if (session.data) {
      void getCurrentUserAccess().then((access) => {
        if (access.success) setRole(access.role);
      });
    }
  }, [session.data]);

  const loadData = useCallback(async () => {
    const [requestData, updateData, capdevData, fieldDefs] = await Promise.all([
      getRequestById(requestId),
      getRequestStatusUpdates(requestId),
      getCapdevById(capdevId),
      getStatusUpdateFieldDefinitions(),
    ]);

    setDefinitions(
      fieldDefs.map((field) => ({
        ...field,
        options: Array.isArray(field.options)
          ? field.options.filter((option): option is string => typeof option === 'string')
          : [],
      }))
    );

    if (capdevData) {
      setCapdev({
        id: capdevData.id,
        archivedAt: capdevData.archivedAt,
        aipCode: capdevData.aipCode,
        budget: String(capdevData.budget),
      });
    }

    if (requestData?.capdevId === capdevId) {
      if (requestData.archivedAt) {
        const url = new URL(window.location.href);
        if (url.searchParams.get('archived') !== '1') {
          url.searchParams.set('archived', '1');
          router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
        }
      }
      let formFields = {
        participantFeedbackFormId: requestData.participantFeedbackFormId,
        participantFeedbackFormUrl: requestData.participantFeedbackFormUrl,
      };
      if (!requestData.archivedAt && !capdevData?.archivedAt && requestData.status === 'completed' && requestData.setting === 'internal') {
        const generated = await getOrCreateRequestEvaluationForms(requestId);
        if (generated.success) formFields = generated.forms;
        else setError(generated.error);
      }
      setRequest({
        id: requestData.id,
        inactivity: requestData.inactivity,
        archivedAt: requestData.archivedAt,
        budgetDeductedAt: requestData.budgetDeductedAt,
        requestorName: requestData.requestorName,
        capdevId: requestData.capdevId,
        setting: requestData.setting,
        requestedBudget: String(requestData.requestedBudget),
        status: requestData.status || 'in_progress',
        isStopped: Boolean(requestData.isStopped),
        activeStopperId: requestData.activeStopperId ?? null,
        ...formFields,
      });
      setUpdates(
        updateData.map((update) => ({
          ...update,
          files: Array.isArray(update.files) ? update.files : [],
          additionalInfo: (update.additionalInfo && typeof update.additionalInfo === 'object'
            ? update.additionalInfo
            : {}) as Record<string, unknown>,
        }))
      );
      window.dispatchEvent(new CustomEvent('leaprs:request-timeline-changed', { detail: requestId }));
    }
    setLoading(false);
  }, [capdevId, requestId, router]);

  useEffect(() => {
    void Promise.resolve().then(loadData);
  }, [loadData]);

  useEffect(() => {
    const refresh = () => { void loadData(); };
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener('leaprs:reminder-settings-changed', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('leaprs:reminder-settings-changed', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [loadData]);

  const hasDeductedBudget = useMemo(
    () => Boolean(request?.budgetDeductedAt) || updates.some((update) => update.subtractsRequestedAmount),
    [request, updates]
  );
  const isCompleted = request?.status === 'completed';
  const isDenied = request?.status === 'denied';
  const isConcluded = isCompleted || isDenied;
  const parentArchived = Boolean(request?.archivedAt || capdev?.archivedAt);
  const readOnly = parentArchived;
  const canControlStopper = !readOnly && !updates.some((update) => update.id === request?.activeStopperId && update.archivedAt) && (role === 'admin' || role === 'employee-department');
  const canConcludeRequest =
    !readOnly && (role === 'admin' || role === 'employee' || role === 'employee-department') &&
    !(request?.isStopped && role === 'employee');
  const visibleUpdates = useMemo(
    () => updates.filter((update) => !update.isStopperResponse),
    [updates]
  );

  const rightAlignedFieldIds = useMemo(() => {
    return getHalfFieldLayout(definitions.map((field) => ({ ...field, key: field.id }))).before;
  }, [definitions]);

  const openAdd = () => {
    if (readOnly) return;
    setError('');
    setFieldErrors({});
    setPendingFiles({});
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const addSelectedFiles = (fieldName: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    setPendingFiles((current) => ({
      ...current,
      [fieldName]: [...(current[fieldName] || []), ...selectedFiles].filter(
        (file, index, files) =>
          files.findIndex(
            (candidate) =>
              candidate.name === file.name &&
              candidate.size === file.size &&
              candidate.lastModified === file.lastModified
          ) === index
      ),
    }));
    event.target.value = '';
  };

  const removeSelectedFile = (fieldName: string, file: File) => {
    setPendingFiles((current) => ({
      ...current,
      [fieldName]: (current[fieldName] || []).filter((candidate) => candidate !== file),
    }));
  };

  const removeExistingAttachment = (field: DynamicField, fileId: string) => {
    const current = getDynamicFieldValue(form.additionalInfo, field);
    const updated = Array.isArray(current)
      ? current.filter((item: unknown) =>
          typeof item === 'object' && item && 'id' in item
            ? (item as { id: string }).id !== fileId
            : true
        )
      : [];
    setDynamicValue(field, updated);
  };

  const setDynamicValue = (field: DynamicField, value: unknown) => {
    const key = dynamicFieldStorageKey(field);
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setForm((current) => {
      const nextInfo = { ...current.additionalInfo, [key]: value };
      let su = current.statusUpdate;
      let rem = current.remarks;
      const lower = field.name.trim().toLowerCase();
      if (lower === 'status update' || lower === 'status') {
        su = String(value || '');
      } else if (lower === 'remarks' || lower === 'remark') {
        rem = String(value || '');
      }
      return {
        ...current,
        statusUpdate: su,
        remarks: rem,
        additionalInfo: nextInfo,
      };
    });
  };

  const hasDynamicValue = (field: DynamicField) => {
    const storageKey = dynamicFieldStorageKey(field);
    const value = getDynamicFieldValue(form.additionalInfo, field);
    if (field.type === 'file') {
      return (
        getAttachments(value).length > 0 || (pendingFiles[storageKey] || []).length > 0
      );
    }
    if (field.type === 'table') {
      if (Array.isArray(value) && value.length > 0) {
        return value.some((row) => Array.isArray(row) && row.some((cell) => String(cell || '').trim().length > 0));
      }
      return false;
    }
    return value !== undefined && value !== null && String(value).trim().length > 0;
  };

  const requiredStatusFieldsComplete = definitions.every(
    (field) => !field.isRequired || hasDynamicValue(field)
  );

  const showFieldError = (key: string, message: string, elementId: string) => {
    setError('');
    setFieldErrors((current) => ({ ...current, [key]: message }));
    focusFormError(elementId);
  };

  const showStatusFormError = (message: string, elementId = 'status-form-error') => {
    setError(message);
    focusFormError(elementId);
  };

  const addStopperResponseFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    setStopperResponse((current) => ({
      ...current,
      files: [...current.files, ...selected].filter(
        (file, index, files) =>
          files.findIndex(
            (candidate) =>
              candidate.name === file.name &&
              candidate.size === file.size &&
              candidate.lastModified === file.lastModified
          ) === index
      ),
    }));
    event.target.value = '';
  };

  const submitStopperResponse = async (stopperId: number) => {
    if (readOnly) return;
    if (!session.data || !stopperResponse.text.trim()) return;
    setRespondingToStopper(true);
    const uploaded = await uploadFilesDirectlyToGoogleDrive(stopperResponse.files, { requestId });
    if (!uploaded.success) {
      setError(uploaded.error || 'Unable to upload the selected files.');
      setRespondingToStopper(false);
      return;
    }
    const result = await createRequestStatusUpdate({
      requestId,
      userId: session.data.user.id,
      statusUpdate: stopperResponse.text.trim(),
      files: uploaded.files,
      isStopperResponse: true,
      stopperId,
    });
    if (result.success) {
      setStopperResponse({ text: '', files: [] });
      await loadData();
    } else {
      setError(result.error || 'Unable to save the stopper response.');
    }
    setRespondingToStopper(false);
  };

  const handleInitiateSave = () => {
    if (readOnly) return;
    if (!session.data) return;

    if (form.addStopper) {
      if (!form.statusUpdate.trim()) return;
      void executeStopper();
      return;
    }

    if (!form.statusMark || !requiredStatusFieldsComplete) return;
    if (definitions.length === 0 && !form.statusUpdate.trim()) return;

    setError('');
    if (form.subtractsRequestedAmount && !hasDeductedBudget) {
      setFieldErrors((current) => ({ ...current, deductedAmount: '' }));
      setEditableDeductedAmount(request?.requestedBudget || '');
      setDeductModalOpen(true);
      return;
    }
    void executeSaveUpdate();
  };

  const executeStopper = async () => {
    if (!session.data || !form.statusUpdate.trim()) return;
    setSaving(true);
    const stopperFiles = pendingFiles['stopper'] || form.files || [];
    const uploaded = await uploadFilesDirectlyToGoogleDrive(stopperFiles, { requestId });
    if (!uploaded.success) {
      showStatusFormError(uploaded.error || 'Unable to upload the selected files.');
      setSaving(false);
      return;
    }
    const result = await stopRequestProgress({
      requestId,
      reason: form.statusUpdate.trim(),
      files: uploaded.files,
    });
    if (result.success) {
      setDialogOpen(false);
      await loadData();
    } else {
      const message = result.error || 'Unable to stop request progress.';
      if (message.toLowerCase().includes('reason') || message.toLowerCase().includes('status')) {
        showFieldError('stopper', message, 'status-field-stopper');
      } else {
        showStatusFormError(message);
      }
    }
    setSaving(false);
  };

  const handleResumeProgress = async () => {
    if (readOnly) return;
    setSaving(true);
    const result = await resumeRequestProgress(requestId);
    if (result.success) await loadData();
    else setError(result.error || 'Unable to resume request progress.');
    setSaving(false);
  };

  const executeSaveUpdate = async (deductedAmountOverride?: string) => {
    if (readOnly) return;
    if (!session.data) return;
    setSaving(true);
    setError('');

    const additionalInfo = { ...form.additionalInfo };
    const allUploadedFiles: StatusAttachment[] = [];

    // Upload pending files for any dynamic file fields
    for (const [fieldName, files] of Object.entries(pendingFiles)) {
      if (files.length === 0) continue;
      const field = definitions.find((d) => dynamicFieldStorageKey(d) === fieldName);
      const uploaded = await uploadFilesDirectlyToGoogleDrive(files, { requestId });
      if (!uploaded.success) {
        showStatusFormError(
          uploaded.error || `Unable to upload ${field?.name || 'attachment'}.`,
          deductedAmountOverride !== undefined ? 'status-deduction-error' : 'status-form-error'
        );
        setSaving(false);
        return;
      }
      const existingFiles = field ? getDynamicFieldValue(additionalInfo, field) : additionalInfo[fieldName];
      const combined = [...(Array.isArray(existingFiles) ? existingFiles : []), ...uploaded.files];
      additionalInfo[fieldName] = combined;
      allUploadedFiles.push(...uploaded.files);
    }

    // Resolve primary statusUpdate and remarks strings
    let primaryStatusUpdate = form.statusUpdate.trim();
    let primaryRemarks = form.remarks.trim();

    // If dynamic fields were used, find corresponding values
    for (const field of definitions) {
      const val = getDynamicFieldValue(additionalInfo, field);
      const lower = field.name.trim().toLowerCase();
      if ((lower === 'status update' || lower === 'status') && typeof val === 'string' && val.trim()) {
        primaryStatusUpdate = val.trim();
      } else if ((lower === 'remarks' || lower === 'remark') && typeof val === 'string' && val.trim()) {
        primaryRemarks = val.trim();
      }
    }

    if (!primaryStatusUpdate && definitions.length > 0) {
      // Find first non-empty text value or default to first field
      const firstTextField = definitions.find((d) => d.type === 'text' || d.type === 'textarea' || d.type === 'combobox');
      if (firstTextField) {
        const val = getDynamicFieldValue(additionalInfo, firstTextField);
        if (typeof val === 'string' && val.trim()) {
          primaryStatusUpdate = val.trim();
        }
      }
    }

    if (!primaryStatusUpdate) {
      primaryStatusUpdate = 'Status updated';
    }

    const result = await createRequestStatusUpdate({
      requestId,
      userId: session.data.user.id,
      statusUpdate: primaryStatusUpdate,
      remarks: primaryRemarks || undefined,
      files: allUploadedFiles,
      statusMark: form.statusMark,
      subtractsRequestedAmount: hasDeductedBudget ? false : form.subtractsRequestedAmount,
      deductedAmount: deductedAmountOverride,
      additionalInfo,
    });

    if (result.success) {
      setDialogOpen(false);
      setDeductModalOpen(false);
      await loadData();
    } else {
      const message = result.error || 'Unable to save this status update.';
      const normalized = message.toLowerCase();
      if (normalized.includes('deduct') || normalized.includes('amount') || normalized.includes('balance')) {
        showFieldError('deductedAmount', message, 'status-field-deductedAmount');
      } else if (normalized.includes('status mark')) {
        showFieldError('statusMark', message, 'status-field-statusMark');
      } else {
        const matchingField = definitions.find((field) =>
          normalized.includes(field.name.trim().toLowerCase())
        );
        if (matchingField) {
          const key = dynamicFieldStorageKey(matchingField);
          showFieldError(key, message, `status-field-${key}`);
        } else if (normalized.includes('status update')) {
          showFieldError('statusUpdate', message, 'status-field-statusUpdate');
        } else {
          showStatusFormError(
            message,
            deductedAmountOverride !== undefined ? 'status-deduction-error' : 'status-form-error'
          );
        }
      }
    }
    setSaving(false);
  };

  const handleCopyFormLink = (formName: string, url: string | null) => {
    if (!url) return;
    void navigator.clipboard.writeText(url);
    setCopiedLink(formName);
    setTimeout(() => setCopiedLink(null), 2500);
  };

  const loadEvaluationSummary = async () => {
    setFormsModalOpen(false);
    setSummaryModalOpen(true);
    setSummaryLoading(true);
    setSummaryError('');
    setEvaluationSummary(null);
    const result = await getRequestEvaluationSummary(requestId);
    if (result.success) setEvaluationSummary(result.summary);
    else setSummaryError(result.error);
    setSummaryLoading(false);
  };

  const handleConcludeRequest = async () => {
    if (readOnly) return;
    if (!concludeAction) return;
    setConcluding(true);
    setError('');
    const result = await updateRequestStatus(requestId, concludeAction);
    if (result.success) {
      setConcludeDialogOpen(false);
      if (concludeAction === 'completed' && request?.setting === 'internal') {
        setFormsModalOpen(true);
      }
      setConcludeAction(null);
      await loadData();
    } else {
      showStatusFormError(result.error || 'Unable to update request status.', 'status-conclude-error');
    }
    setConcluding(false);
  };

  const renderDynamicInput = (field: DynamicField) => {
    const storageKey = dynamicFieldStorageKey(field);
    const fieldValue = getDynamicFieldValue(form.additionalInfo, field);
    const isStandardStatusUpdate = field.name.trim().toLowerCase() === 'status update' || field.name.trim().toLowerCase() === 'status';
    const isStandardRemarks = field.name.trim().toLowerCase() === 'remarks' || field.name.trim().toLowerCase() === 'remark';

    return (
      <Grid
        key={field.id}
        id={`status-field-${storageKey}`}
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
            value={String(fieldValue ?? (isStandardStatusUpdate ? form.statusUpdate : isStandardRemarks ? form.remarks : ''))}
            inputValue={String(fieldValue ?? (isStandardStatusUpdate ? form.statusUpdate : isStandardRemarks ? form.remarks : ''))}
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
                multiline={isStandardStatusUpdate || isStandardRemarks || field.type === 'textarea'}
                minRows={isStandardStatusUpdate || isStandardRemarks || field.type === 'textarea' ? 2 : 1}
                label={field.name}
                placeholder={field.placeholder || 'Select or type...'}
                error={Boolean(fieldErrors[storageKey])}
                helperText={fieldErrors[storageKey]}
              />
            )}
          />
        ) : (field.type === 'text' || field.type === 'textarea') ? (
          <TextField
            required={field.isRequired}
            fullWidth
            multiline={isStandardStatusUpdate || isStandardRemarks || field.type === 'textarea'}
            minRows={isStandardStatusUpdate || isStandardRemarks || field.type === 'textarea' ? 2 : 1}
            label={field.name}
            placeholder={field.placeholder || ''}
            value={String(fieldValue ?? (isStandardStatusUpdate ? form.statusUpdate : isStandardRemarks ? form.remarks : ''))}
            onChange={(event) => setDynamicValue(field, event.target.value)}
            error={Boolean(fieldErrors[storageKey])}
            helperText={fieldErrors[storageKey]}
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
            error={Boolean(fieldErrors[storageKey])}
            helperText={fieldErrors[storageKey]}
          />
        )}
        {fieldErrors[storageKey] && !['text', 'textarea', 'number'].includes(field.type) && (
          <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5, mx: 1.75 }}>
            {fieldErrors[storageKey]}
          </Typography>
        )}
      </Grid>
    );
  };

  if (session.isPending || loading) {
    return <TimelineGridSkeleton />;
  }
  if (!session.data) return null;
  if (!request) {
    return (
      <Box sx={{ py: 8, textAlign: 'center' }}>
        <Typography variant="h6" color="text.secondary">
          Request not found.
        </Typography>
      </Box>
    );
  }

  const allCardsCount = visibleUpdates.length + 1;
  const viewingFields = orderedStatusValues(viewingUpdate?.additionalInfo || {}, definitions);
  const viewingAttachmentIds = new Set(viewingFields.flatMap(([, value]) => getAttachments(value).map((file) => file.id)));
  const viewingStandaloneFiles = getAttachments(viewingUpdate?.files).filter((file) => !viewingAttachmentIds.has(file.id));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 72px)' }}>
      <Dialog open={reminderRequested && Boolean(request.inactivity)} onClose={closeReminder} maxWidth="xs" fullWidth aria-labelledby="inactivity-reminder-title">
        <DialogTitle id="inactivity-reminder-title" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 800 }}>
          <ReminderIcon color="error" />
          No Progress
        </DialogTitle>
        <DialogContent dividers>
          <Typography color="error.main" sx={{ fontWeight: 600 }}>
            {request.inactivity ? inactivityMessage(request.inactivity.days) : ''}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button variant="contained" onClick={closeReminder}>Understood</Button>
        </DialogActions>
      </Dialog>
      <Container maxWidth={false} sx={{ p: 0, width: '100%', flexGrow: 1 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', mb: 3 }}
        >
          <Box>
            <Typography variant="h4" sx={{ fontWeight: '800', color: 'text.primary', letterSpacing: '-1px' }}>
              {request.requestorName || 'Requestor'}&apos;s Request
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {request.setting === 'internal' ? 'In-House' : 'External'} · {formatCurrency(request.requestedBudget)}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <Chip
              label={isCompleted ? 'Complete' : isDenied ? 'Denied' : 'In progress'}
              color={parentArchived ? 'default' : isCompleted ? 'success' : isDenied ? 'error' : 'primary'}
              size="small"
              sx={{ fontWeight: 700 }}
            />
            {hasDeductedBudget && (
              <Chip
                icon={<PaymentsIcon sx={{ fontSize: '16px !important' }} />}
                label="Amount deducted"
                color={parentArchived ? 'default' : 'success'}
                variant="outlined"
                size="small"
                sx={{ fontWeight: 700 }}
              />
            )}
          </Stack>
        </Stack>

        {error && !dialogOpen && !deductModalOpen && !concludeDialogOpen && (
          <Alert id="status-page-error" tabIndex={-1} severity="error" onClose={() => setError('')} sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}


        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
            columnGap: { xs: 3, md: 7 },
            rowGap: { xs: 3, md: 5 },
            pb: 12,
          }}
        >
          {visibleUpdates.map((update, index) => {
            const archived = Boolean(update.archivedAt || parentArchived);
            const row = Math.floor(index / 3);
            const column = row % 2 === 0 ? (index % 3) + 1 : 3 - (index % 3);
            const isRowEnd = (index + 1) % 3 === 0;
            const isLastToResolution = index === visibleUpdates.length - 1;
            const files = Array.isArray(update.files)
              ? update.files.filter(
                  (file): file is StatusAttachment =>
                    typeof file === 'object' && file !== null && 'name' in file && 'url' in file
                )
              : [];
            const isStopper = update.isStopper;
            const stopperResponses = isStopper
              ? updates.filter((item) => item.isStopperResponse && item.stopperId === update.id)
              : [];
            const isInactive = !archived && Boolean(request.inactivity && (
              request.inactivity.latestUpdateId === update.id ||
              stopperResponses.some((response) => response.id === request.inactivity?.latestUpdateId)
            ));
            const wasResumed = isStopper && updates.some((item) => item.isResume && item.stopperId === update.id);
            const isActiveStopper = isStopper && request.isStopped && request.activeStopperId === update.id;

            // Extra dynamic fields (beyond statusUpdate, remarks, and standard attachments) in additionalInfo
            const extraFields = orderedStatusValues(update.additionalInfo || {}, definitions);
            const hidePrimaryStatus = !showPrimaryStatus(update.statusUpdate, extraFields, isStopper);
            const showRemarks = showStandaloneRemarks(update.remarks, extraFields);
            const dynamicAttachmentIds = new Set(
              extraFields.flatMap(([, value]) => getAttachments(value).map((file) => file.id))
            );
            const standaloneFiles = files.filter((file) => !dynamicAttachmentIds.has(file.id));

            return (
              <Box
                key={update.id}
                id={`request-status-update-${update.id}`}
                sx={{
                  gridColumn: { md: column },
                  gridRow: { md: row + 1 },
                  position: 'relative',
                  scrollMarginTop: 96,
                }}
              >
                <Card
                  variant="outlined"
                  sx={{
                    position: 'relative',
                    overflow: 'visible',
                    borderRadius: 2,
                    bgcolor: archived ? 'grey.100' : '#fafcfa',
                    ...(archived ? { '& .MuiChip-root': { bgcolor: 'grey.200', color: 'text.secondary', borderColor: 'grey.400' }, '& .MuiChip-icon': { color: 'text.secondary' } } : {}),
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    transition: 'all 0.2s',
                    borderColor: isInactive || isStopper ? 'error.main' : undefined,
                    animation:
                      !reminderRequested && (timelineFocus?.targetId === `request-status-update-${update.id}` || stopperResponses.some((response) => timelineFocus?.targetId === `request-status-update-${response.id}`))
                        ? 'timelineCardFocus 2500ms ease-in-out'
                        : 'none',
                    '@keyframes timelineCardFocus': {
                      '0%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(46, 125, 50, 0)' },
                      '30%': { transform: 'scale(0.975)', boxShadow: '0 0 0 3px rgba(46, 125, 50, 0.22)' },
                      '65%': { transform: 'scale(1.025)', boxShadow: '0 8px 24px rgba(46, 125, 50, 0.2)' },
                      '100%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(46, 125, 50, 0)' },
                    },
                    '&:hover': {
                      boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
                      borderColor: isInactive || isStopper ? 'error.dark' : 'primary.main',
                    },
                  }}
                >
                  {isInactive && request.inactivity && (
                    <Tooltip title={inactivityMessage(request.inactivity.days)}>
                      <IconButton
                        color="error"
                        aria-label={inactivityMessage(request.inactivity.days) + ' Open reminder'}
                        onClick={() => setReminderRequested(true)}
                        sx={{ position: 'absolute', top: -18, right: -12, zIndex: 2, width: 44, height: 44, borderRadius: 2, bgcolor: '#fafcfa', '&:hover': { bgcolor: '#fceeee' } }}
                      >
                        <ReminderIcon sx={{ fontSize: 34 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                  <CardContent sx={{ p: 2.75, flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start', mb: 2 }}>
                      <Box
                        sx={{
                          bgcolor: archived ? 'grey.200' : isStopper ? 'rgba(211, 47, 47, 0.1)' : 'rgba(46, 125, 50, 0.08)',
                          p: 1.1,
                          borderRadius: 2,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {isStopper ? (
                          <StopperIcon color={archived ? 'action' : 'error'} sx={{ transform: 'rotate(35deg)' }} />
                        ) : (
                          <RequestIcon color={archived ? 'action' : 'primary'} />
                        )}
                      </Box>
                      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                        <Typography variant="h6" sx={{ fontWeight: '700', lineHeight: 1.2 }}>
                          {isStopper ? 'Stopper' : update.isResume ? 'Progress Resumed' : update.isStopperResponse ? 'Stopper Response' : `Update ${index + 1}`}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" noWrap>
                          {update.authorName || 'Staff member'} · {formatDateTime(update.createdAt)}
                        </Typography>
                      </Box>
                      {isStopper ? (
                        <Chip
                          icon={
                            wasResumed ? (
                              <ResumeIcon sx={{ fontSize: '17px !important' }} />
                            ) : (
                              <StopperIcon sx={{ fontSize: '15px !important' }} />
                            )
                          }
                          label={wasResumed ? 'Resumed' : 'Stopped'}
                          color={archived ? 'default' : wasResumed ? 'success' : 'error'}
                          size="small"
                          sx={{ fontWeight: 700 }}
                        />
                      ) : (
                        update.statusMark && (
                          <Chip
                            label={
                              update.statusMark === 'pending'
                                ? 'Pending'
                                : update.statusMark === 'completed' || update.statusMark === 'accepted'
                                ? 'Completed'
                                : 'Denied'
                            }
                            color={
                              archived ? 'default' : update.statusMark === 'pending'
                                ? 'warning'
                                : update.statusMark === 'completed' || update.statusMark === 'accepted'
                                ? 'success'
                                : 'error'
                            }
                            size="small"
                            sx={{ fontWeight: 700 }}
                          />
                        )
                      )}
                    </Stack>

                    {isStopper && (
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                        Reason
                      </Typography>
                    )}
                    {!hidePrimaryStatus && (
                      <Typography
                        variant="body1"
                        sx={{ fontWeight: 600, color: 'text.primary', mb: update.remarks ? 0.75 : 0 }}
                      >
                        {update.statusUpdate}
                      </Typography>
                    )}
                    {showRemarks && (
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        {update.remarks}
                      </Typography>
                    )}

                    {/* Extra dynamic fields if present */}
                    {extraFields.length > 0 && (
                      <Stack spacing={0.75} sx={{ mt: 1, mb: 1 }}>
                        {extraFields.map(([k, v]) => {
                          const matchingDef = definitions.find(
                            (d) => dynamicFieldStorageKey(d) === k || d.name === k
                          );
                          const label = matchingDef?.name || k;
                          if (matchingDef?.type === 'date') {
                            return <ReadOnlyDynamicField key={k} field={matchingDef} value={v} />;
                          }
                          if (matchingDef?.type === 'table') {
                            return (
                              <DynamicTableField
                                key={k}
                                label={label}
                                value={v}
                                template={matchingDef.options?.[0]}
                                disabled
                                showDimensionControls={false}
                              />
                            );
                          }
                          if (Array.isArray(v)) {
                            const files = getAttachments(v);
                            if (files.length > 0) {
                              return (
                                <Box key={k}>
                                  <Typography variant="caption" color="text.secondary">
                                    {label}:
                                  </Typography>
                                  <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                                    {files.map((f) => (
                                      <Button
                                        key={f.id}
                                        component="a"
                                        href={f.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        size="small"
                                        sx={{ minWidth: 0, px: 0.5, textTransform: 'none', fontWeight: 600 }}
                                      >
                                        {f.name}
                                      </Button>
                                    ))}
                                  </Stack>
                                </Box>
                              );
                            }
                          }
                          return (
                            <Typography key={k} variant="body2" color="text.secondary">
                              <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
                                {label}:
                              </Box>{' '}
                              {String(v)}
                            </Typography>
                          );
                        })}
                      </Stack>
                    )}

                    {standaloneFiles.length > 0 && (
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mt: 1, flexWrap: 'wrap' }}>
                        <AttachFileIcon fontSize="small" color="action" />
                        {standaloneFiles.map((file) => (
                          <Button
                            key={file.id}
                            component="a"
                            href={file.url}
                            target="_blank"
                            rel="noreferrer"
                            size="small"
                            sx={{ minWidth: 0, px: 0.5, textTransform: 'none', fontWeight: 600 }}
                          >
                            {file.name}
                          </Button>
                        ))}
                      </Stack>
                    )}

                    {isStopper && stopperResponses.length > 0 && (
                      <Stack spacing={1} sx={{ mt: 2, pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
                        {stopperResponses.map((response) => (
                          <Box key={response.id} id={`request-status-update-${response.id}`} sx={response.archivedAt || parentArchived ? { bgcolor: 'grey.100', color: 'text.secondary', borderRadius: 1, p: 1 } : undefined}>
                            <Typography variant="caption" color="text.secondary">
                              {response.authorName || 'Employee'} · {formatDateTime(response.createdAt)}
                            </Typography>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              {response.statusUpdate}
                            </Typography>
                            {Array.isArray(response.files) && response.files.length > 0 && (
                              <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                                {response.files
                                  .filter(
                                    (file): file is StatusAttachment =>
                                      typeof file === 'object' &&
                                      file !== null &&
                                      'name' in file &&
                                      'url' in file
                                  )
                                  .map((file) => (
                                    <Button
                                      key={file.id}
                                      component="a"
                                      href={file.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      size="small"
                                      sx={{ minWidth: 0, px: 0.5, textTransform: 'none' }}
                                    >
                                      {file.name}
                                    </Button>
                                  ))}
                              </Stack>
                            )}
                          </Box>
                        ))}
                      </Stack>
                    )}

                    {!readOnly && !archived && isActiveStopper && role === 'employee' && (
                      <Stack spacing={1.25} sx={{ mt: 2, pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
                        <TextField
                          fullWidth
                          multiline
                          minRows={2}
                          label="Status Update"
                          value={stopperResponse.text}
                          onChange={(event) =>
                            setStopperResponse((current) => ({ ...current, text: event.target.value }))
                          }
                        />
                        <Button
                          component="label"
                          variant="outlined"
                          size="small"
                          startIcon={<AttachFileIcon />}
                          sx={{ borderRadius: 2, fontWeight: 700 }}
                        >
                          Attach Files
                          <input hidden type="file" multiple onChange={addStopperResponseFiles} />
                        </Button>
                        {stopperResponse.files.length > 0 && (
                          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                            {stopperResponse.files.map((file) => (
                              <Chip
                                key={`${file.name}-${file.lastModified}-${file.size}`}
                                label={file.name}
                                size="small"
                                onDelete={() =>
                                  setStopperResponse((current) => ({
                                    ...current,
                                    files: current.files.filter((item) => item !== file),
                                  }))
                                }
                              />
                            ))}
                          </Stack>
                        )}
                        <Button
                          variant="contained"
                          size="small"
                          onClick={() => void submitStopperResponse(update.id)}
                          disabled={respondingToStopper || !stopperResponse.text.trim()}
                          sx={{ borderRadius: 2, fontWeight: 700 }}
                        >
                          {respondingToStopper ? 'Saving...' : 'Submit Update'}
                        </Button>
                      </Stack>
                    )}

                    <Stack direction="row" spacing={1} sx={{ mt: 'auto', pt: 2, flexWrap: 'wrap', rowGap: 0.5 }}>
                      {update.markAsComplete && (
                        <Chip
                          icon={<CheckCircleIcon />}
                          label="Completed"
                          color={archived ? 'default' : 'success'}
                          size="small"
                          sx={{ fontWeight: 700 }}
                        />
                      )}
                      {update.subtractsRequestedAmount && (
                        <Chip
                          icon={<PaymentsIcon />}
                          label="Amount deducted"
                          color={archived ? 'default' : 'success'}
                          variant="outlined"
                          size="small"
                          sx={{ fontWeight: 700 }}
                        />
                      )}
                    </Stack>
                    <Stack direction="row" spacing={0.5} sx={{ mt: 'auto', pt: 2, justifyContent: 'flex-end' }}>
                      <Tooltip title="View Details"><IconButton size="small" color="primary" onClick={() => setViewingUpdate(update)} aria-label="View progress update"><VisibilityIcon fontSize="small" /></IconButton></Tooltip>
                    </Stack>
                  </CardContent>
                </Card>
                {index < allCardsCount - 1 &&
                  (isRowEnd ? (
                    <ConnectorDown toResolution={isLastToResolution} />
                  ) : row % 2 === 0 ? (
                    <ConnectorRight toResolution={isLastToResolution} />
                  ) : (
                    <ConnectorLeft toResolution={isLastToResolution} />
                  ))}
              </Box>
            );
          })}

          {/* Floating Action / Conclude Option Beside Last Status Update */}
          {(() => {
            const concludeIndex = visibleUpdates.length;
            const row = Math.floor(concludeIndex / 3);
            const column = row % 2 === 0 ? (concludeIndex % 3) + 1 : 3 - (concludeIndex % 3);
            const isFromRowEnd = visibleUpdates.length > 0 && visibleUpdates.length % 3 === 0;
            const isFromLeft = !isFromRowEnd && row % 2 === 0;
            const isFromRight = !isFromRowEnd && row % 2 !== 0;

            return (
              <Box
                id={isConcluded ? 'request-status-resolution' : undefined}
                sx={{
                  gridColumn: { md: column },
                  gridRow: { md: row + 1 },
                  position: 'relative',
                  display: 'flex',
                  alignItems: isFromRowEnd ? 'flex-start' : 'center',
                  justifyContent: isFromLeft ? 'flex-start' : isFromRight ? 'flex-end' : 'center',
                  pl: isFromLeft ? { md: 7, xs: 0 } : 0,
                  pr: isFromRight ? { md: 7, xs: 0 } : 0,
                  pt: isFromRowEnd ? { md: 6, xs: 0 } : 0,
                  scrollMarginTop: 96,
                  animation:
                    timelineFocus?.targetId === 'request-status-resolution'
                      ? 'timelineResolutionFocus 2500ms ease-in-out'
                      : 'none',
                  '@keyframes timelineResolutionFocus': {
                    '0%': { transform: 'scale(1)' },
                    '30%': { transform: 'scale(0.975)' },
                    '65%': { transform: 'scale(1.04)' },
                    '100%': { transform: 'scale(1)' },
                  },
                }}
              >
                {!isConcluded ? (
                  canConcludeRequest ? (
                    <Stack spacing={2} sx={{ width: '100%', maxWidth: 210 }}>
                      <Button
                        variant="contained"
                        color="success"
                        fullWidth
                        size="large"
                        startIcon={<CheckCircleIcon />}
                        onClick={() => {
                          setConcludeAction('completed');
                          setConcludeDialogOpen(true);
                        }}
                        sx={{
                          py: 1.5,
                          fontWeight: 700,
                          borderRadius: 2,
                          fontSize: '0.95rem',
                          boxShadow: '0 4px 12px rgba(46, 125, 50, 0.25)',
                        }}
                      >
                        Complete
                      </Button>
                      <Button
                        variant="outlined"
                        color="error"
                        fullWidth
                        size="large"
                        startIcon={<CancelIcon />}
                        onClick={() => {
                          setConcludeAction('denied');
                          setConcludeDialogOpen(true);
                        }}
                        sx={{
                          py: 1.5,
                          fontWeight: 700,
                          borderRadius: 2,
                          fontSize: '0.95rem',
                          borderWidth: 2,
                          '&:hover': { borderWidth: 2 },
                        }}
                      >
                        Deny
                      </Button>
                    </Stack>
                  ) : null
                ) : isCompleted ? (
                  request.setting === 'internal' ? (
                  <Card
                    variant="outlined"
                    sx={{
                      width: '100%',
                      maxWidth: 460,
                      borderRadius: 2,
                      bgcolor: parentArchived ? 'grey.100' : '#fafcfa',
                      ...(parentArchived ? { '& .MuiChip-root': { bgcolor: 'grey.200', color: 'text.secondary' }, '& .MuiChip-icon': { color: 'text.secondary' } } : {}),
                      borderColor: 'success.main',
                      boxShadow: '0 4px 14px rgba(46, 125, 50, 0.08)',
                    }}
                  >
                    <CardContent sx={{ p: 2 }}>
                      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 800, color: parentArchived ? 'text.secondary' : 'success.dark' }}>
                          Request Completed
                        </Typography>
                        <Chip
                          icon={<CheckCircleIcon sx={{ fontSize: '16px !important' }} />}
                          label="Complete"
                          color="success"
                          size="small"
                          sx={{ fontWeight: 700 }}
                        />
                      </Stack>

                      <Stack spacing={1}>
                        <Box sx={{ p: 1.25, borderRadius: 1.5, bgcolor: '#fafcfa', border: '1px solid rgba(0,0,0,0.06)' }}>
                          <Stack
                            direction="row"
                            spacing={1}
                            sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 1 }}
                          >
                            <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.primary', whiteSpace: 'nowrap' }}>
                              Seminar Evaluation
                            </Typography>
                            <Stack
                              direction="row"
                              spacing={0.75}
                              sx={{ minWidth: 0, flexWrap: 'wrap', rowGap: 0.75 }}
                            >
                              <Button
                                size="small"
                                variant="contained"
                                color="primary"
                                startIcon={<OpenInNewIcon sx={{ fontSize: 13 }} />}
                                component="a"
                                href={request.participantFeedbackFormUrl || undefined}
                                target="_blank"
                                rel="noreferrer"
                                disabled={!request.participantFeedbackFormUrl}
                                sx={{
                                  textTransform: 'none',
                                  fontWeight: 700,
                                  fontSize: '0.75rem',
                                  py: 0.3,
                                  px: 1,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                Open
                              </Button>
                              <Button
                                size="small"
                                variant="outlined"
                                startIcon={<EditIcon sx={{ fontSize: 13 }} />}
                                component="a"
                                href={
                                  request.participantFeedbackFormId
                                    ? `https://docs.google.com/forms/d/${request.participantFeedbackFormId}/edit`
                                    : undefined
                                }
                                target="_blank"
                                rel="noreferrer"
                                disabled={readOnly || !request.participantFeedbackFormId}
                                sx={{
                                  textTransform: 'none',
                                  fontWeight: 700,
                                  fontSize: '0.75rem',
                                  py: 0.3,
                                  px: 1,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                Edit
                              </Button>
                              <Button
                                size="small"
                                variant="outlined"
                                color="inherit"
                                startIcon={
                                  copiedLink === 'Participant Form' ? (
                                    <CheckIcon sx={{ fontSize: 13, color: 'success.main' }} />
                                  ) : (
                                    <ContentCopyIcon sx={{ fontSize: 13 }} />
                                  )
                                }
                                onClick={() => handleCopyFormLink('Participant Form', request.participantFeedbackFormUrl)}
                                disabled={!request.participantFeedbackFormUrl}
                                sx={{
                                  textTransform: 'none',
                                  fontWeight: 600,
                                  fontSize: '0.75rem',
                                  py: 0.3,
                                  px: 1,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {copiedLink === 'Participant Form' ? 'Copied!' : 'Copy'}
                              </Button>
                              <Button
                                size="small"
                                variant="outlined"
                                startIcon={<SummaryIcon sx={{ fontSize: 13 }} />}
                                onClick={() => void loadEvaluationSummary()}
                                disabled={!request.participantFeedbackFormId}
                                sx={{
                                  textTransform: 'none',
                                  fontWeight: 700,
                                  fontSize: '0.75rem',
                                  py: 0.3,
                                  px: 1,
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                Summary
                              </Button>
                            </Stack>
                          </Stack>
                        </Box>
                      </Stack>
                    </CardContent>
                  </Card>
                  ) : (
                    <Chip
                      icon={<CheckCircleIcon />}
                      label="Complete"
                      color="success"
                      sx={{
                        fontWeight: 700,
                        py: 2.5,
                        px: 2,
                        fontSize: '1rem',
                        borderRadius: 2,
                      }}
                    />
                  )
                ) : (
                  <Chip
                    icon={<CancelIcon />}
                    label="Denied"
                    color="error"
                    sx={{
                      fontWeight: 700,
                      py: 2.5,
                      px: 2,
                      fontSize: '1rem',
                      borderRadius: 2,
                    }}
                  />
                )}
              </Box>
            );
          })()}
        </Box>
      </Container>

      {!readOnly && !isConcluded &&
        (request.isStopped
          ? canControlStopper
          : role === 'admin' || role === 'employee' || role === 'employee-department') && (
          <Fab
            variant="extended"
            color="primary"
            onClick={request.isStopped ? () => void handleResumeProgress() : openAdd}
            disabled={saving}
            sx={{
              position: 'fixed',
              right: 24,
              bottom: 24,
              zIndex: 1100,
              px: 2.5,
              fontWeight: 700,
              boxShadow: '0 4px 14px rgba(46, 125, 50, 0.4)',
            }}
          >
            {request.isStopped ? <ResumeIcon sx={{ mr: 1 }} /> : <AddIcon sx={{ mr: 1 }} />}
            {request.isStopped ? 'Resume Progress' : 'Add Status'}
          </Fab>
        )}

      {/* Add Status Update Dialog */}
      <Dialog open={Boolean(viewingUpdate)} onClose={() => setViewingUpdate(null)} fullWidth maxWidth="md">
        <DialogTitle sx={{ fontWeight: 800 }}>Progress Update</DialogTitle>
        <DialogContent dividers><Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">{viewingUpdate?.authorName} ? {viewingUpdate && formatDateTime(viewingUpdate.createdAt)}</Typography>
          {viewingUpdate && showPrimaryStatus(viewingUpdate.statusUpdate, viewingFields, viewingUpdate.isStopper) && (
            <Typography sx={{ whiteSpace: 'pre-wrap' }}>{viewingUpdate.statusUpdate}</Typography>
          )}
          {viewingUpdate && showStandaloneRemarks(viewingUpdate.remarks, viewingFields) && <Typography sx={{ whiteSpace: 'pre-wrap' }}>{viewingUpdate.remarks}</Typography>}
          {viewingFields.map(([key, value]) => {
            const field = definitions.find((definition) => dynamicFieldStorageKey(definition) === key || definition.name === key);
            return <ReadOnlyDynamicField key={key} field={field || { name: key, type: getAttachments(value).length ? 'file' : 'text' }} value={value} />;
          })}
          {viewingStandaloneFiles.length > 0 && <ReadOnlyDynamicField field={{ name: 'Attachments', type: 'file' }} value={viewingStandaloneFiles} />}
        </Stack></DialogContent><DialogActions sx={{ p: 2.5 }}><Button onClick={() => setViewingUpdate(null)}>Close</Button></DialogActions>
      </Dialog>
      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 800 }}>Add Status Update</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5} sx={{ pt: 0.5 }}>
            {error && (
              <Alert id="status-form-error" tabIndex={-1} severity="error" onClose={() => setError('')}>
                {error}
              </Alert>
            )}
            {/* Dynamic Fields Section (at top) */}
            {form.addStopper ? (
              <Stack spacing={2} sx={{ pt: 1 }}>
                <TextField
                  id="status-field-stopper"
                  required
                  autoFocus
                  fullWidth
                  multiline
                  minRows={2}
                  label="Stopper Reason"
                  value={form.statusUpdate}
                  onChange={(event) => {
                    setForm((current) => ({ ...current, statusUpdate: event.target.value }));
                    setFieldErrors((current) => ({ ...current, stopper: '' }));
                  }}
                  error={Boolean(fieldErrors.stopper)}
                  helperText={fieldErrors.stopper}
                />
                <Button
                  component="label"
                  variant="outlined"
                  fullWidth
                  startIcon={<AttachFileIcon />}
                  sx={{ borderRadius: 2, fontWeight: 700, py: 1.25 }}
                >
                  Attach Files
                  <input hidden type="file" multiple onChange={(event) => addSelectedFiles('stopper', event)} />
                </Button>
                {(pendingFiles['stopper'] || []).length > 0 && (
                  <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                    {pendingFiles['stopper'].map((file) => (
                      <Chip
                        key={`${file.name}-${file.lastModified}-${file.size}`}
                        label={file.name}
                        size="small"
                        onDelete={() => removeSelectedFile('stopper', file)}
                      />
                    ))}
                  </Stack>
                )}
              </Stack>
            ) : (
              <Box sx={{ pt: 1 }}>
                {definitions.length > 0 ? (
                  <Grid container spacing={2}>
                    {definitions.map((field) => renderDynamicInput(field))}
                  </Grid>
                ) : (
                  <Stack spacing={2}>
                    <TextField
                      id="status-field-statusUpdate"
                      required
                      autoFocus
                      fullWidth
                      multiline
                      minRows={2}
                      label="Status Update"
                      value={form.statusUpdate}
                      onChange={(event) => {
                        setForm((current) => ({ ...current, statusUpdate: event.target.value }));
                        setFieldErrors((current) => ({ ...current, statusUpdate: '' }));
                      }}
                      error={Boolean(fieldErrors.statusUpdate)}
                      helperText={fieldErrors.statusUpdate}
                    />
                    <TextField
                      fullWidth
                      multiline
                      minRows={2}
                      label="Remarks"
                      value={form.remarks}
                      onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))}
                    />
                  </Stack>
                )}
              </Box>
            )}

            {/* Fixed Form Controls at Bottom */}
            {!form.addStopper && (
              <Stack id="status-field-statusMark" spacing={1}>
                <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.primary' }}>
                  Status Mark <Box component="span" sx={{ color: 'error.main' }}>*</Box>
                </Typography>
                <ToggleButtonGroup
                  value={form.statusMark || 'pending'}
                  exclusive
                  onChange={(_, val) => {
                    if (val) {
                      setForm((curr) => ({ ...curr, statusMark: val as StatusForm['statusMark'] }));
                    }
                  }}
                  size="small"
                  fullWidth
                  sx={{
                    '& .MuiToggleButton-root': {
                      borderRadius: 2,
                      fontWeight: 700,
                      textTransform: 'none',
                      py: 1,
                      borderColor: 'rgba(0, 0, 0, 0.12)',
                    },
                  }}
                >
                  <ToggleButton
                    value="pending"
                    sx={{
                      '&.Mui-selected': {
                        bgcolor: 'rgba(237, 108, 2, 0.12)',
                        color: 'warning.dark',
                        borderColor: 'warning.main',
                      },
                    }}
                  >
                    Pending
                  </ToggleButton>
                  <ToggleButton
                    value="completed"
                    sx={{
                      '&.Mui-selected': {
                        bgcolor: 'rgba(46, 125, 50, 0.12)',
                        color: 'success.dark',
                        borderColor: 'success.main',
                      },
                    }}
                  >
                    Completed
                  </ToggleButton>
                  <ToggleButton
                    value="denied"
                    sx={{
                      '&.Mui-selected': {
                        bgcolor: 'rgba(211, 47, 47, 0.12)',
                        color: 'error.dark',
                        borderColor: 'error.main',
                      },
                    }}
                  >
                    Denied
                  </ToggleButton>
                </ToggleButtonGroup>
                {fieldErrors.statusMark && (
                  <Typography variant="caption" color="error">
                    {fieldErrors.statusMark}
                  </Typography>
                )}
              </Stack>
            )}

            {!form.addStopper && (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={hasDeductedBudget ? false : form.subtractsRequestedAmount}
                    disabled={hasDeductedBudget}
                    onChange={(event) => {
                      if (event.target.checked) setDeductionWarningOpen(true);
                      else setForm((current) => ({ ...current, subtractsRequestedAmount: false }));
                    }}
                    color="primary"
                  />
                }
                label={
                  <Typography
                    variant="body2"
                    sx={{ color: hasDeductedBudget ? 'text.disabled' : 'text.primary', fontWeight: 500 }}
                  >
                    Subtract requested amount from CapDev balance
                    {hasDeductedBudget && ' (Already deducted)'}
                  </Typography>
                }
              />
            )}

            {canControlStopper && (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={form.addStopper}
                    onChange={(event) => setForm((current) => ({ ...current, addStopper: event.target.checked }))}
                    color="error"
                  />
                }
                label={<Typography variant="body2" sx={{ fontWeight: 500 }}>Add stopper</Typography>}
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2.5 }}>
          <Button onClick={() => setDialogOpen(false)} disabled={saving} color="inherit" sx={{ fontWeight: 600 }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleInitiateSave}
            disabled={
              readOnly || saving ||
              Object.values(fieldErrors).some(Boolean) ||
              (form.addStopper
                ? !form.statusUpdate.trim()
                : !form.statusMark ||
                  !requiredStatusFieldsComplete ||
                  (definitions.length === 0 && !form.statusUpdate.trim()))
            }
            sx={{ fontWeight: 700, borderRadius: 2 }}
          >
            {saving ? 'Saving...' : form.addStopper ? 'Stop Progress' : 'Save Status'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deductionWarningOpen} onClose={() => setDeductionWarningOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>Permanent Budget Deduction</DialogTitle>
        <DialogContent dividers><Typography>This is a one-time deduction. Once saved, the amount cannot be restored, even if the request is deleted.</Typography></DialogContent>
        <DialogActions sx={{ p: 2.5 }}>
          <Button autoFocus onClick={() => setDeductionWarningOpen(false)}>Cancel</Button>
          <Button variant="contained" color="warning" onClick={() => { setForm((current) => ({ ...current, subtractsRequestedAmount: true })); setDeductionWarningOpen(false); }}>Continue</Button>
        </DialogActions>
      </Dialog>
      {/* Modal for Adjusting & Confirming Deducted Budget */}
      <Dialog
        open={deductModalOpen}
        onClose={() => !saving && setDeductModalOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ p: 1, borderRadius: 1.5, bgcolor: 'rgba(46, 125, 50, 0.1)', display: 'flex' }}>
            <PaymentsIcon color="primary" />
          </Box>
          Confirm Permanent Deduction
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5} sx={{ py: 1 }}>
            {error && (
              <Alert id="status-deduction-error" tabIndex={-1} severity="error" onClose={() => setError('')}>
                {error}
              </Alert>
            )}
            <TextField
              id="status-field-deductedAmount"
              label="Deducted Amount"
              type="number"
              fullWidth
              value={editableDeductedAmount}
              onChange={(e) => {
                setEditableDeductedAmount(e.target.value);
                setFieldErrors((current) => ({ ...current, deductedAmount: '' }));
              }}
              error={
                Boolean(fieldErrors.deductedAmount) ||
                Number(editableDeductedAmount) <= 0 ||
                (capdev !== null && Number(editableDeductedAmount) > Number(capdev.budget))
              }
              helperText={
                fieldErrors.deductedAmount ||
                (Number(editableDeductedAmount) <= 0
                  ? 'Enter an amount greater than ₱0.00.'
                  : capdev && Number(editableDeductedAmount) > Number(capdev.budget)
                    ? `Exceeds the remaining balance (${formatCurrency(capdev.budget)}).`
                    : '')
              }
              slotProps={{
                input: {
                  startAdornment: <InputAdornment position="start">₱</InputAdornment>,
                },
              }}
            />

            <Typography color="warning.dark">This deduction cannot be restored.</Typography>
            {/* Live Calculation Preview */}
            <Card variant="outlined" sx={{ bgcolor: '#fafcfa', borderRadius: 2 }}>
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <Stack spacing={1.5}>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="body2" color="text.secondary">
                      Original Requested Amount
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {formatCurrency(request.requestedBudget)}
                    </Typography>
                  </Stack>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="body2" color="text.secondary">
                      CapDev Available Balance
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700, color: 'primary.dark' }}>
                      {formatCurrency(capdev?.budget || '0')}
                    </Typography>
                  </Stack>
                  <Divider />
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      Est. Remaining CapDev Balance
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 800,
                        color:
                          Number(capdev?.budget || 0) - (Number(editableDeductedAmount) || 0) < 0
                            ? 'error.main'
                            : 'primary.dark',
                      }}
                    >
                      {formatCurrency(
                        Number(capdev?.budget || 0) - (Number(editableDeductedAmount) || 0)
                      )}
                    </Typography>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>

          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2.5 }}>
          <Button onClick={() => setDeductModalOpen(false)} disabled={saving} color="inherit" sx={{ fontWeight: 600 }}>
            Back to Status
          </Button>
          <Button
            variant="contained"
            color="primary"
            onClick={() => void executeSaveUpdate(editableDeductedAmount)}
            disabled={
              saving ||
              Number(editableDeductedAmount) <= 0 ||
              (capdev !== null && Number(editableDeductedAmount) > Number(capdev.budget))
            }
            sx={{ fontWeight: 700, borderRadius: 2 }}
          >
            {saving ? 'Deducting & Saving...' : 'Confirm & Deduct'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Confirmation Dialog for Complete / Deny */}
      <Dialog
        open={concludeDialogOpen}
        onClose={() => !concluding && setConcludeDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
          {concludeAction === 'completed' ? (
            <>
              <CheckCircleIcon color="success" />
              Complete Request
            </>
          ) : (
            <>
              <CancelIcon color="error" />
              Deny Request
            </>
          )}
        </DialogTitle>
        <DialogContent dividers>
          {error && (
            <Alert id="status-conclude-error" tabIndex={-1} severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Typography variant="body1" sx={{ py: 1, fontWeight: 500 }}>
            {concludeAction === 'completed'
              ? `Finalize ${request.requestorName || 'Requestor'}'s request as Complete?`
              : `Finalize ${request.requestorName || 'Requestor'}'s request as Denied?`}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setConcludeDialogOpen(false)} disabled={readOnly || concluding} color="inherit" sx={{ fontWeight: 600 }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color={concludeAction === 'completed' ? 'success' : 'error'}
            onClick={handleConcludeRequest}
            disabled={concluding}
            sx={{ fontWeight: 700, borderRadius: 2 }}
          >
            {concluding
              ? 'Updating...'
              : concludeAction === 'completed'
              ? 'Confirm Complete'
              : 'Confirm Deny'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Generated Google Forms Completion Modal */}
      <Dialog open={formsModalOpen && request.setting === 'internal'} onClose={() => setFormsModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ p: 1, borderRadius: 1.5, bgcolor: 'rgba(46, 125, 50, 0.12)', display: 'flex' }}>
            <CheckCircleIcon color="success" />
          </Box>
          Evaluation Form Ready
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5} sx={{ py: 1 }}>
            <Card variant="outlined" sx={{ borderRadius: 2, bgcolor: '#fafcfa' }}>
              <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Stack
                  direction="row"
                  spacing={2}
                  sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 1.5 }}
                >
                  <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
                    <Box
                      sx={{
                        p: 1,
                        borderRadius: 1.5,
                        bgcolor: 'rgba(21, 101, 192, 0.1)',
                        color: '#1565c0',
                        display: 'flex',
                      }}
                    >
                      <FormIcon fontSize="small" />
                    </Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.primary', whiteSpace: 'nowrap' }}>
                      Seminar Evaluation Form
                    </Typography>
                  </Stack>
                  <Stack direction="row" spacing={1} sx={{ minWidth: 0, flexWrap: 'wrap', rowGap: 1 }}>
                    <Button
                      variant="contained"
                      color="primary"
                      size="small"
                      startIcon={<OpenInNewIcon fontSize="small" />}
                      component="a"
                      href={request.participantFeedbackFormUrl || undefined}
                      target="_blank"
                      rel="noreferrer"
                      disabled={!request.participantFeedbackFormUrl}
                      sx={{ fontWeight: 700, borderRadius: 1.5, textTransform: 'none', whiteSpace: 'nowrap' }}
                    >
                      Open Form
                    </Button>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<EditIcon fontSize="small" />}
                      component="a"
                      href={
                        request.participantFeedbackFormId
                          ? `https://docs.google.com/forms/d/${request.participantFeedbackFormId}/edit`
                          : undefined
                      }
                      target="_blank"
                      rel="noreferrer"
                      disabled={!request.participantFeedbackFormId}
                      sx={{ fontWeight: 700, borderRadius: 1.5, textTransform: 'none', whiteSpace: 'nowrap' }}
                    >
                      Edit Form
                    </Button>
                    <Button
                      variant="outlined"
                      color="inherit"
                      size="small"
                      startIcon={
                        copiedLink === 'Modal Participant' ? (
                          <CheckIcon color="success" fontSize="small" />
                        ) : (
                          <ContentCopyIcon fontSize="small" />
                        )
                      }
                      onClick={() => handleCopyFormLink('Modal Participant', request.participantFeedbackFormUrl)}
                      disabled={!request.participantFeedbackFormUrl}
                      sx={{ fontWeight: 600, borderRadius: 1.5, textTransform: 'none', whiteSpace: 'nowrap' }}
                    >
                      {copiedLink === 'Modal Participant' ? 'Copied Link!' : 'Copy Link'}
                    </Button>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<SummaryIcon fontSize="small" />}
                      onClick={() => void loadEvaluationSummary()}
                      disabled={!request.participantFeedbackFormId}
                      sx={{ fontWeight: 700, borderRadius: 1.5, textTransform: 'none', whiteSpace: 'nowrap' }}
                    >
                      See Summary
                    </Button>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2.5 }}>
          <Button
            variant="contained"
            color="primary"
            onClick={() => setFormsModalOpen(false)}
            sx={{ fontWeight: 700, borderRadius: 2, px: 3 }}
          >
            Done
          </Button>
        </DialogActions>
      </Dialog>

      <EvaluationSummaryDialog
        open={summaryModalOpen}
        loading={summaryLoading}
        error={summaryError}
        summary={evaluationSummary}
        onClose={() => setSummaryModalOpen(false)}
        onRefresh={() => void loadEvaluationSummary()}
      />
    </Box>
  );
}
