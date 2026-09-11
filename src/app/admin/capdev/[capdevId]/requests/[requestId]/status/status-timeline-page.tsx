'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Add as AddIcon,
  Assignment as RequestIcon,
  AttachFile as AttachFileIcon,
  Cancel as CancelIcon,
  Check as CheckIcon,
  CheckCircle as CheckCircleIcon,
  ContentCopy as ContentCopyIcon,
  Description as FormIcon,
  OpenInNew as OpenInNewIcon,
  Payments as PaymentsIcon,
} from '@mui/icons-material';
import {
  Alert,
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
  Fab,
  FormControlLabel,
  InputAdornment,
  Divider,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { TimelineGridSkeleton } from '@/components/Skeletons';
import { authClient } from '@/lib/auth/client';
import {
  createRequestStatusUpdate,
  getCapdevById,
  getCurrentUserAccess,
  getRequestById,
  getRequestStatusUpdates,
  updateRequestStatus,
  uploadFilesToGoogleDrive,
  type AppRole,
  type StatusAttachment,
} from '@/app/actions';

type RequestSummary = { id: number; capdevId: number; setting: string; requestedBudget: string; status: string };
type StatusUpdate = {
  id: number;
  requestId: number;
  authorName: string | null;
  statusUpdate: string;
  remarks: string | null;
  files: unknown;
  statusMark?: string | null;
  markAsComplete: boolean;
  subtractsRequestedAmount: boolean;
  createdAt: Date | string;
};
type StatusForm = {
  statusUpdate: string;
  remarks: string;
  files: File[];
  statusMark: 'pending' | 'denied' | 'completed' | 'accepted' | null;
  subtractsRequestedAmount: boolean;
};

const GOOGLE_FORM_FEEDBACK_URL = 'https://forms.gle/c8BjUUoPxYWiBxnF8';
const EMPTY_FORM: StatusForm = { statusUpdate: '', remarks: '', files: [], statusMark: 'pending', subtractsRequestedAmount: false };
const formatDateTime = (value: Date | string) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
const formatCurrency = (value: string | number) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(Number(value) || 0);

function ConnectorDown({ toResolution = false }: { toResolution?: boolean }) {
  if (toResolution) {
    return (
      <Box
        sx={{
          display: { xs: 'none', md: 'flex' },
          position: 'absolute',
          bottom: -63,
          left: '50%',
          transform: 'translateX(-50%)',
          color: 'primary.main',
          zIndex: 1,
        }}
      >
        <svg width="32" height="64" viewBox="0 0 32 64" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M16 0V44" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
          <path d="M16 64L2 38H30L16 64Z" fill="currentColor" />
        </svg>
      </Box>
    );
  }

  return (
    <Box sx={{ display: { xs: 'none', md: 'flex' }, position: 'absolute', bottom: -35, right: 24, color: 'primary.main', zIndex: 1 }}>
      <svg width="32" height="36" viewBox="0 0 32 36" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M16 0V16" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
        <path d="M16 36L2 10H30L16 36Z" fill="currentColor" />
      </svg>
    </Box>
  );
}

function ConnectorRight({ toResolution = false }: { toResolution?: boolean }) {
  if (toResolution) {
    return (
      <Box
        sx={{
          display: { xs: 'none', md: 'flex' },
          position: 'absolute',
          top: '50%',
          right: -84,
          transform: 'translateY(-50%)',
          color: 'primary.main',
          zIndex: 1,
        }}
      >
        <svg width="84" height="32" viewBox="0 0 84 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M0 16H64" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
          <path d="M84 16L58 2V30L84 16Z" fill="currentColor" />
        </svg>
      </Box>
    );
  }

  return (
    <Box sx={{ display: { xs: 'none', md: 'flex' }, position: 'absolute', top: '50%', right: -48, transform: 'translateY(-50%)', color: 'primary.main', zIndex: 1 }}>
      <svg width="48" height="32" viewBox="0 0 48 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M0 16H28" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
        <path d="M48 16L22 2V30L48 16Z" fill="currentColor" />
      </svg>
    </Box>
  );
}

function ConnectorLeft({ toResolution = false }: { toResolution?: boolean }) {
  if (toResolution) {
    return (
      <Box
        sx={{
          display: { xs: 'none', md: 'flex' },
          position: 'absolute',
          top: '50%',
          left: -84,
          transform: 'translateY(-50%)',
          color: 'primary.main',
          zIndex: 1,
        }}
      >
        <svg width="84" height="32" viewBox="0 0 84 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M84 16H20" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
          <path d="M0 16L26 2V30L0 16Z" fill="currentColor" />
        </svg>
      </Box>
    );
  }

  return (
    <Box sx={{ display: { xs: 'none', md: 'flex' }, position: 'absolute', top: '50%', left: -48, transform: 'translateY(-50%)', color: 'primary.main', zIndex: 1 }}>
      <svg width="48" height="32" viewBox="0 0 48 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M48 16H20" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
        <path d="M0 16L26 2V30L0 16Z" fill="currentColor" />
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
  const [concludeDialogOpen, setConcludeDialogOpen] = useState(false);
  const [concludeAction, setConcludeAction] = useState<'completed' | 'denied' | null>(null);
  const [concluding, setConcluding] = useState(false);
  const [formsModalOpen, setFormsModalOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [form, setForm] = useState<StatusForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [capdev, setCapdev] = useState<{ id: number; aipCode: string; budget: string } | null>(null);
  const [deductModalOpen, setDeductModalOpen] = useState(false);
  const [editableDeductedAmount, setEditableDeductedAmount] = useState('');
  const [role, setRole] = useState<AppRole>('employee');

  useEffect(() => {
    if (session.data) {
      void getCurrentUserAccess().then((access) => {
        if (access.success) setRole(access.role);
      });
    }
  }, [session.data]);

  const loadData = useCallback(async () => {
    const [requestData, updateData, capdevData] = await Promise.all([
      getRequestById(requestId),
      getRequestStatusUpdates(requestId),
      getCapdevById(capdevId),
    ]);
    if (capdevData) {
      setCapdev({
        id: capdevData.id,
        aipCode: capdevData.aipCode,
        budget: String(capdevData.budget),
      });
    }
    if (requestData?.capdevId === capdevId) {
      setRequest({
        id: requestData.id,
        capdevId: requestData.capdevId,
        setting: requestData.setting,
        requestedBudget: String(requestData.requestedBudget),
        status: requestData.status || 'in_progress',
      });
      setUpdates(updateData.map((update) => ({ ...update, files: Array.isArray(update.files) ? update.files : [] })));
    }
    setLoading(false);
  }, [capdevId, requestId]);

  useEffect(() => {
    void Promise.resolve().then(loadData);
  }, [loadData]);

  const hasDeductedBudget = useMemo(() => updates.some((update) => update.subtractsRequestedAmount), [updates]);
  const isCompleted = request?.status === 'completed';
  const isDenied = request?.status === 'denied';
  const isConcluded = isCompleted || isDenied;

  const openAdd = () => {
    setError('');
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const addSelectedFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    setForm((current) => {
      const files = [...current.files, ...selectedFiles];
      return {
        ...current,
        files: files.filter(
          (file, index) =>
            files.findIndex(
              (candidate) =>
                candidate.name === file.name &&
                candidate.size === file.size &&
                candidate.lastModified === file.lastModified
            ) === index
        ),
      };
    });
    event.target.value = '';
  };

  const removeSelectedFile = (file: File) =>
    setForm((current) => ({ ...current, files: current.files.filter((candidate) => candidate !== file) }));

  const handleInitiateSave = () => {
    if (!session.data || !form.statusUpdate.trim()) return;
    if (!form.statusMark) {
      setError('Please select a Status Mark (Pending, Completed, or Denied).');
      return;
    }
    setError('');
    // If budget deduction is checked and hasn't been deducted yet, prompt the deduction adjustment modal
    if (form.subtractsRequestedAmount && !hasDeductedBudget) {
      setEditableDeductedAmount(request?.requestedBudget || '');
      setDeductModalOpen(true);
      return;
    }
    void executeSaveUpdate();
  };

  const executeSaveUpdate = async (deductedAmountOverride?: string) => {
    if (!session.data || !form.statusUpdate.trim()) return;
    setSaving(true);
    setError('');
    const uploadData = new FormData();
    form.files.forEach((file) => uploadData.append('files', file));
    const uploaded = await uploadFilesToGoogleDrive(uploadData);
    if (!uploaded.success) {
      setError(uploaded.error || 'Unable to upload the selected files.');
      setSaving(false);
      return;
    }
    const result = await createRequestStatusUpdate({
      requestId,
      userId: session.data.user.id,
      statusUpdate: form.statusUpdate.trim(),
      remarks: form.remarks.trim(),
      files: uploaded.files,
      statusMark: form.statusMark,
      subtractsRequestedAmount: hasDeductedBudget ? false : form.subtractsRequestedAmount,
      deductedAmount: deductedAmountOverride,
    });
    if (result.success) {
      setDialogOpen(false);
      setDeductModalOpen(false);
      await loadData();
    } else {
      setError(result.error || 'Unable to save this status update.');
    }
    setSaving(false);
  };

  const handleCopyFormLink = (formName: string) => {
    void navigator.clipboard.writeText(GOOGLE_FORM_FEEDBACK_URL);
    setCopiedLink(formName);
    setTimeout(() => setCopiedLink(null), 2500);
  };

  const handleConcludeRequest = async () => {
    if (!concludeAction) return;
    setConcluding(true);
    setError('');
    const result = await updateRequestStatus(requestId, concludeAction);
    if (result.success) {
      setConcludeDialogOpen(false);
      if (concludeAction === 'completed') {
        setFormsModalOpen(true);
      }
      setConcludeAction(null);
      await loadData();
    } else {
      setError(result.error || 'Unable to update request status.');
    }
    setConcluding(false);
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

  const allCardsCount = updates.length + 1;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 72px)' }}>
      <Container maxWidth={false} sx={{ p: 0, width: '100%', flexGrow: 1 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', mb: 3 }}
        >
          <Box>
            <Typography variant="h4" sx={{ fontWeight: '800', color: 'text.primary', letterSpacing: '-1px' }}>
              Request Status
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Request #{request.id} · {request.setting === 'internal' ? 'Internal' : 'External'} · {formatCurrency(request.requestedBudget)}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <Chip
              label={isCompleted ? 'Complete' : isDenied ? 'Denied' : 'In progress'}
              color={isCompleted ? 'success' : isDenied ? 'error' : 'primary'}
              size="small"
              sx={{ fontWeight: 700 }}
            />
            {hasDeductedBudget && (
              <Chip
                icon={<PaymentsIcon sx={{ fontSize: '16px !important' }} />}
                label="Amount deducted"
                color="success"
                variant="outlined"
                size="small"
                sx={{ fontWeight: 700 }}
              />
            )}
          </Stack>
        </Stack>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
            columnGap: { xs: 3, md: 6 },
            rowGap: { xs: 3, md: 4.5 },
            pb: 12,
          }}
        >
          {updates.map((update, index) => {
            const row = Math.floor(index / 3);
            const column = row % 2 === 0 ? (index % 3) + 1 : 3 - (index % 3);
            const isRowEnd = (index + 1) % 3 === 0;
            const isLastToResolution = index === updates.length - 1;
            const files = Array.isArray(update.files)
              ? update.files.filter(
                (file): file is StatusAttachment =>
                  typeof file === 'object' && file !== null && 'name' in file && 'url' in file
              )
              : [];

            return (
              <Box
                key={update.id}
                sx={{
                  gridColumn: { md: column },
                  gridRow: { md: row + 1 },
                  position: 'relative',
                }}
              >
                <Card
                  variant="outlined"
                  sx={{
                    borderRadius: 2,
                    bgcolor: '#ffffff',
                    height: '100%',
                    minHeight: 220,
                    display: 'flex',
                    flexDirection: 'column',
                    transition: 'all 0.2s',
                    '&:hover': { boxShadow: '0 4px 12px rgba(0,0,0,0.04)', borderColor: 'primary.main' },
                  }}
                >
                  <CardContent sx={{ p: 2.75, flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start', mb: 2 }}>
                      <Box
                        sx={{
                          bgcolor: 'rgba(46, 125, 50, 0.08)',
                          p: 1.1,
                          borderRadius: 2,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <RequestIcon color="primary" />
                      </Box>
                      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                        <Typography variant="h6" sx={{ fontWeight: '700', lineHeight: 1.2 }}>
                          Update {index + 1}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" noWrap>
                          {update.authorName || 'Staff member'} · {formatDateTime(update.createdAt)}
                        </Typography>
                      </Box>
                      {update.statusMark && (
                        <Chip
                          label={
                            update.statusMark === 'pending'
                              ? 'Pending'
                              : update.statusMark === 'completed' || update.statusMark === 'accepted'
                                ? 'Completed'
                                : 'Denied'
                          }
                          color={
                            update.statusMark === 'pending'
                              ? 'warning'
                              : update.statusMark === 'completed' || update.statusMark === 'accepted'
                                ? 'success'
                                : 'error'
                          }
                          size="small"
                          sx={{ fontWeight: 700 }}
                        />
                      )}
                    </Stack>
                    <Typography variant="body1" sx={{ fontWeight: 600, color: 'text.primary', mb: update.remarks ? 0.75 : 0 }}>
                      {update.statusUpdate}
                    </Typography>
                    {update.remarks && (
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        {update.remarks}
                      </Typography>
                    )}
                    {files.length > 0 && (
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mt: 1, flexWrap: 'wrap' }}>
                        <AttachFileIcon fontSize="small" color="action" />
                        {files.map((file) => (
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
                    <Stack direction="row" spacing={1} sx={{ mt: 'auto', pt: 2, flexWrap: 'wrap', rowGap: 0.5 }}>
                      {update.markAsComplete && (
                        <Chip icon={<CheckCircleIcon />} label="Completed" color="success" size="small" sx={{ fontWeight: 700 }} />
                      )}
                      {update.subtractsRequestedAmount && (
                        <Chip
                          icon={<PaymentsIcon />}
                          label="Amount deducted"
                          color="success"
                          variant="outlined"
                          size="small"
                          sx={{ fontWeight: 700 }}
                        />
                      )}
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
            const concludeIndex = updates.length;
            const row = Math.floor(concludeIndex / 3);
            const column = row % 2 === 0 ? (concludeIndex % 3) + 1 : 3 - (concludeIndex % 3);
            const isFromRowEnd = updates.length > 0 && updates.length % 3 === 0;
            const isFromLeft = !isFromRowEnd && row % 2 === 0;
            const isFromRight = !isFromRowEnd && row % 2 !== 0;

            return (
              <Box
                sx={{
                  gridColumn: { md: column },
                  gridRow: { md: row + 1 },
                  position: 'relative',
                  display: 'flex',
                  alignItems: isFromRowEnd ? 'flex-start' : 'center',
                  justifyContent: isFromLeft ? 'flex-start' : isFromRight ? 'flex-end' : 'center',
                  minHeight: 220,
                  pl: isFromLeft ? { md: 7, xs: 0 } : 0,
                  pr: isFromRight ? { md: 7, xs: 0 } : 0,
                  pt: isFromRowEnd ? { md: 6, xs: 0 } : 0,
                }}
              >
                {!isConcluded ? (
                  (role === 'admin' || role === 'employee') ? (
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
                  <Card
                    variant="outlined"
                    sx={{
                      width: '100%',
                      maxWidth: 360,
                      borderRadius: 2,
                      bgcolor: '#ffffff',
                      borderColor: 'success.main',
                      boxShadow: '0 4px 14px rgba(46, 125, 50, 0.08)',
                    }}
                  >
                    <CardContent sx={{ p: 2 }}>
                      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 800, color: 'success.dark' }}>
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
                        {/* Form 1 */}
                        <Box sx={{ p: 1.25, borderRadius: 1.5, bgcolor: '#fafcfa', border: '1px solid rgba(0,0,0,0.06)' }}>
                          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                            <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.primary', whiteSpace: 'nowrap' }}>
                              Participant Feedback
                            </Typography>
                            <Stack direction="row" spacing={0.75} sx={{ flexShrink: 0 }}>
                              <Button
                                size="small"
                                variant="contained"
                                color="primary"
                                startIcon={<OpenInNewIcon sx={{ fontSize: 13 }} />}
                                component="a"
                                href={GOOGLE_FORM_FEEDBACK_URL}
                                target="_blank"
                                rel="noreferrer"
                                sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.75rem', py: 0.3, px: 1, whiteSpace: 'nowrap' }}
                              >
                                Open
                              </Button>
                              <Button
                                size="small"
                                variant="outlined"
                                color="inherit"
                                startIcon={copiedLink === 'Participant Form' ? <CheckIcon sx={{ fontSize: 13, color: 'success.main' }} /> : <ContentCopyIcon sx={{ fontSize: 13 }} />}
                                onClick={() => handleCopyFormLink('Participant Form')}
                                sx={{ textTransform: 'none', fontWeight: 600, fontSize: '0.75rem', py: 0.3, px: 1, whiteSpace: 'nowrap' }}
                              >
                                {copiedLink === 'Participant Form' ? 'Copied!' : 'Copy'}
                              </Button>
                            </Stack>
                          </Stack>
                        </Box>

                        {/* Form 2 */}
                        <Box sx={{ p: 1.25, borderRadius: 1.5, bgcolor: '#fafcfa', border: '1px solid rgba(0,0,0,0.06)' }}>
                          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                            <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.primary', whiteSpace: 'nowrap' }}>
                              Supervisor Evaluation
                            </Typography>
                            <Stack direction="row" spacing={0.75} sx={{ flexShrink: 0 }}>
                              <Button
                                size="small"
                                variant="contained"
                                color="primary"
                                startIcon={<OpenInNewIcon sx={{ fontSize: 13 }} />}
                                component="a"
                                href={GOOGLE_FORM_FEEDBACK_URL}
                                target="_blank"
                                rel="noreferrer"
                                sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.75rem', py: 0.3, px: 1, whiteSpace: 'nowrap' }}
                              >
                                Open
                              </Button>
                              <Button
                                size="small"
                                variant="outlined"
                                color="inherit"
                                startIcon={copiedLink === 'Supervisor Form' ? <CheckIcon sx={{ fontSize: 13, color: 'success.main' }} /> : <ContentCopyIcon sx={{ fontSize: 13 }} />}
                                onClick={() => handleCopyFormLink('Supervisor Form')}
                                sx={{ textTransform: 'none', fontWeight: 600, fontSize: '0.75rem', py: 0.3, px: 1, whiteSpace: 'nowrap' }}
                              >
                                {copiedLink === 'Supervisor Form' ? 'Copied!' : 'Copy'}
                              </Button>
                            </Stack>
                          </Stack>
                        </Box>
                      </Stack>
                    </CardContent>
                  </Card>
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

      {!isConcluded && (role === 'admin' || role === 'employee') && (
        <Fab
          variant="extended"
          color="primary"
          onClick={openAdd}
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
          <AddIcon sx={{ mr: 1 }} />
          Add Status
        </Fab>
      )}

      {/* Add Status Update Dialog */}
      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 800 }}>Add Status Update</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5} sx={{ pt: 0.5 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              required
              autoFocus
              fullWidth
              multiline
              minRows={2}
              label="Status Update"
              value={form.statusUpdate}
              onChange={(event) => setForm((current) => ({ ...current, statusUpdate: event.target.value }))}
            />
            <TextField
              fullWidth
              multiline
              minRows={2}
              label="Remarks"
              value={form.remarks}
              onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))}
            />
            <Button component="label" variant="outlined" startIcon={<AttachFileIcon />} sx={{ borderRadius: 2, fontWeight: 700 }}>
              Attach Files
              <input hidden type="file" multiple onChange={addSelectedFiles} />
            </Button>
            {form.files.length > 0 && (
              <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                {form.files.map((file) => (
                  <Chip
                    key={`${file.name}-${file.lastModified}-${file.size}`}
                    label={file.name}
                    size="small"
                    onDelete={() => removeSelectedFile(file)}
                  />
                ))}
              </Stack>
            )}

            <Stack spacing={1}>
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
            </Stack>

            <FormControlLabel
              control={
                <Checkbox
                  checked={hasDeductedBudget ? false : form.subtractsRequestedAmount}
                  disabled={hasDeductedBudget}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, subtractsRequestedAmount: event.target.checked }))
                  }
                  color="primary"
                />
              }
              label={
                <Typography variant="body2" sx={{ color: hasDeductedBudget ? 'text.disabled' : 'text.primary', fontWeight: 500 }}>
                  Subtract requested amount from CapDev balance
                  {hasDeductedBudget && ' (Already deducted)'}
                </Typography>
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2.5 }}>
          <Button onClick={() => setDialogOpen(false)} disabled={saving} color="inherit" sx={{ fontWeight: 600 }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleInitiateSave}
            disabled={saving || !form.statusUpdate.trim() || !form.statusMark}
            sx={{ fontWeight: 700, borderRadius: 2 }}
          >
            {saving ? 'Saving...' : 'Save Status'}
          </Button>
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
          Confirm Balance Deduction
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5} sx={{ py: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}

            <TextField
              label="Deducted Amount"
              type="number"
              fullWidth
              value={editableDeductedAmount}
              onChange={(e) => setEditableDeductedAmount(e.target.value)}
              slotProps={{
                input: {
                  startAdornment: <InputAdornment position="start">₱</InputAdornment>,
                },
              }}
            />

            {/* Live Calculation Preview */}
            <Card variant="outlined" sx={{ bgcolor: '#fafcfa', borderRadius: 2 }}>
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <Stack spacing={1.5}>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="body2" color="text.secondary">Original Requested Amount</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {formatCurrency(request.requestedBudget)}
                    </Typography>
                  </Stack>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="body2" color="text.secondary">CapDev Available Balance</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700, color: 'primary.dark' }}>
                      {formatCurrency(capdev?.budget || '0')}
                    </Typography>
                  </Stack>
                  <Divider />
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>Est. Remaining CapDev Balance</Typography>
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 800,
                        color: (Number(capdev?.budget || 0) - (Number(editableDeductedAmount) || 0)) < 0 ? 'error.main' : 'primary.dark',
                      }}
                    >
                      {formatCurrency(Number(capdev?.budget || 0) - (Number(editableDeductedAmount) || 0))}
                    </Typography>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>

            {Number(editableDeductedAmount) <= 0 && (
              <Alert severity="warning">Please enter a valid deduction amount greater than ₱0.00.</Alert>
            )}
            {capdev && Number(editableDeductedAmount) > Number(capdev.budget) && (
              <Alert severity="error">The entered amount exceeds the remaining CapDev balance ({formatCurrency(capdev.budget)}).</Alert>
            )}
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
            disabled={saving || Number(editableDeductedAmount) <= 0 || (capdev !== null && Number(editableDeductedAmount) > Number(capdev.budget))}
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
          <Typography variant="body1" sx={{ py: 1, fontWeight: 500 }}>
            {concludeAction === 'completed'
              ? `Finalize Request #${requestId} as Complete?`
              : `Finalize Request #${requestId} as Denied?`}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setConcludeDialogOpen(false)} disabled={concluding} color="inherit" sx={{ fontWeight: 600 }}>
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
      <Dialog
        open={formsModalOpen}
        onClose={() => setFormsModalOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ p: 1, borderRadius: 1.5, bgcolor: 'rgba(46, 125, 50, 0.12)', display: 'flex' }}>
            <CheckCircleIcon color="success" />
          </Box>
          Evaluation Forms Generated
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5} sx={{ py: 1 }}>
            {/* Form 1 */}
            <Card variant="outlined" sx={{ borderRadius: 2, bgcolor: '#fafcfa' }}>
              <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                  <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
                    <Box sx={{ p: 1, borderRadius: 1.5, bgcolor: 'rgba(21, 101, 192, 0.1)', color: '#1565c0', display: 'flex' }}>
                      <FormIcon fontSize="small" />
                    </Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.primary', whiteSpace: 'nowrap' }}>
                      Participant Feedback Form
                    </Typography>
                  </Stack>
                  <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
                    <Button
                      variant="contained"
                      color="primary"
                      size="small"
                      startIcon={<OpenInNewIcon fontSize="small" />}
                      component="a"
                      href={GOOGLE_FORM_FEEDBACK_URL}
                      target="_blank"
                      rel="noreferrer"
                      sx={{ fontWeight: 700, borderRadius: 1.5, textTransform: 'none', whiteSpace: 'nowrap' }}
                    >
                      Open Form
                    </Button>
                    <Button
                      variant="outlined"
                      color="inherit"
                      size="small"
                      startIcon={copiedLink === 'Modal Participant' ? <CheckIcon color="success" fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
                      onClick={() => handleCopyFormLink('Modal Participant')}
                      sx={{ fontWeight: 600, borderRadius: 1.5, textTransform: 'none', whiteSpace: 'nowrap' }}
                    >
                      {copiedLink === 'Modal Participant' ? 'Copied Link!' : 'Copy Link'}
                    </Button>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>

            {/* Form 2 */}
            <Card variant="outlined" sx={{ borderRadius: 2, bgcolor: '#fafcfa' }}>
              <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                  <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
                    <Box sx={{ p: 1, borderRadius: 1.5, bgcolor: 'rgba(46, 125, 50, 0.1)', color: 'primary.main', display: 'flex' }}>
                      <FormIcon fontSize="small" />
                    </Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.primary', whiteSpace: 'nowrap' }}>
                      Supervisor Evaluation Form
                    </Typography>
                  </Stack>
                  <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
                    <Button
                      variant="contained"
                      color="primary"
                      size="small"
                      startIcon={<OpenInNewIcon fontSize="small" />}
                      component="a"
                      href={GOOGLE_FORM_FEEDBACK_URL}
                      target="_blank"
                      rel="noreferrer"
                      sx={{ fontWeight: 700, borderRadius: 1.5, textTransform: 'none', whiteSpace: 'nowrap' }}
                    >
                      Open Form
                    </Button>
                    <Button
                      variant="outlined"
                      color="inherit"
                      size="small"
                      startIcon={copiedLink === 'Modal Supervisor' ? <CheckIcon color="success" fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
                      onClick={() => handleCopyFormLink('Modal Supervisor')}
                      sx={{ fontWeight: 600, borderRadius: 1.5, textTransform: 'none', whiteSpace: 'nowrap' }}
                    >
                      {copiedLink === 'Modal Supervisor' ? 'Copied Link!' : 'Copy Link'}
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
    </Box>
  );
}
