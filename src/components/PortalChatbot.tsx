'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  AutoAwesome as SparkleIcon,
  SmartToy as RobotIcon,
  Send as SendIcon,
  AttachFile as AttachFileIcon,
  OpenInNew as OpenInNewIcon,
  EditNote as EditNoteIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  MenuItem,
  Paper,
  Popover,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  askPortalChatbot,
  handleChatbotActivityDesignUpload,
  handleChatbotAipCodeInput,
  handleChatbotSubmitRequest,
  getRequestFieldDefinitions,
  getCurrentUserAccess,
} from '@/app/actions';
import { uploadFilesDirectlyToGoogleDrive } from '@/lib/google-drive-client';
import DateField from '@/components/DateField';
import DynamicTableField from '@/components/DynamicTableField';
import { dynamicFieldStorageKey, getDynamicFieldValue } from '@/lib/dynamic-fields';
import type { StatusAttachment } from '@/lib/services/leaprs-service';

export type DynamicField = {
  id: number;
  name: string;
  type: string;
  options?: unknown[] | null;
  isRequired: boolean;
  section: string;
  width: string;
  columnPosition: string;
  sortOrder: number;
  placeholder?: string | null;
};

export type DraftState = {
  aipCode?: string | null;
  capdev?: { id: number; aipCode: string; department: string; remainingBudget: number } | null;
  setting: 'internal' | 'external';
  requestedBudget: string;
  description: string;
  dynamicFields: Record<string, unknown>;
  attachments: StatusAttachment[];
  sourceFile?: StatusAttachment | null;
  imagePreviewUrl?: string;
  missingRequiredFields: string[];
  budgetValidation: {
    isValid: boolean;
    requestedBudget: number;
    remainingBudget: number;
    error?: string;
  };
  isReadyForSubmission: boolean;
};

type StagedFile = {
  id: string;
  file: File;
  previewUrl?: string;
  name: string;
  isImage: boolean;
};

type ChatMessage = {
  id: string;
  sender: 'assistant' | 'user';
  text: string;
  imagePreview?: string;
  imagePreviews?: string[];
  draft?: DraftState;
  isDraftCard?: boolean;
  createdRequestLink?: string;
  requestId?: number;
};

export function getRoleWelcomeMessage(role?: string | null): string {
  if (role === 'admin') {
    return `Hi! I'm your LEAPRS assistant. Here is what I can help you with:

• **Approvals & Submissions**: Ask "Show pending requests" or check submissions across departments.
• **Process Activity Designs**: Paste (Ctrl+V) or upload photos/documents to draft requests.
• **Live Request Lookups**: Ask "Status of Request #30" to view real-time progress and blockers.
• **Budget & CapDev Monitoring**: Ask about budget balances for any department or project.
• **General Questions & Guidance**: Ask any question about user management, settings, audit logs, reports, or how the system works.`;
  }

  if (role === 'viewer' || role === 'viewer-full') {
    return `Hi! I'm your LEAPRS assistant. Here is what I can help you with:

• **Track Requests**: Ask "Status of Request #30" or "Show recent requests".
• **Department Budgets**: Ask about allocated and remaining training balances.
• **CapDev Programs**: Ask which training projects are currently active.
• **General Questions & Guidance**: Ask any question about how to view reports, analytics, timelines, or system features.`;
  }

  return `Hi! I'm your LEAPRS assistant. Here is what I can help you with:

• **Process Activity Designs**: Paste (Ctrl+V) or upload photos/documents to auto-fill a request.
• **Check Request Status**: Ask "What is the status of Request #30?" or "Show my requests".
• **Department Budgets**: Ask how much training budget your department has left.
• **General Questions & Guidance**: Ask any question about how LEAPRS works, how to submit forms, or where to find features.`;
}

function formatMessage(text: string) {
  // Split on **bold**, *italic*, or `code`
  const tokens = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return tokens.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return (
        <Box key={index} component="span" sx={{ fontWeight: 800 }}>
          {part.slice(2, -2)}
        </Box>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
      return (
        <Box key={index} component="span" sx={{ fontStyle: 'italic' }}>
          {part.slice(1, -1)}
        </Box>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <Box
          key={index}
          component="span"
          sx={{
            fontFamily: 'monospace',
            bgcolor: 'rgba(0,0,0,0.06)',
            px: 0.5,
            py: 0.1,
            borderRadius: 0.5,
            fontSize: '0.88em',
          }}
        >
          {part.slice(1, -1)}
        </Box>
      );
    }
    return part;
  });
}

function ChatbotIcon({ size = 32, animated = false }: { size?: number; animated?: boolean }) {
  const eyeSize = Math.max(3, Math.round(size * 0.13));

  return (
    <Box
      aria-hidden="true"
      sx={{
        position: 'relative',
        display: 'inline-flex',
        flexShrink: 0,
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
        animation: animated ? 'chatbotGlow 2.6s ease-in-out infinite' : 'none',
        '@keyframes chatbotGlow': {
          '0%, 100%': { transform: 'scale(1)' },
          '35%': { transform: 'scale(0.92)' },
          '65%': { transform: 'scale(1.06)' },
        },
        '@keyframes chatbotSparkle': {
          '0%, 100%': { opacity: 0.45, transform: 'scale(0.72)' },
          '50%': { opacity: 1, transform: 'scale(1.16)' },
        },
        '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
      }}
    >
      <RobotIcon sx={{ fontSize: size, color: 'primary.main' }} />
      <Box
        sx={{
          position: 'absolute',
          top: `${Math.round(size * 0.4)}px`,
          left: `${Math.round(size * 0.29)}px`,
          width: eyeSize,
          height: eyeSize,
          borderRadius: '50%',
          bgcolor: '#fff',
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          top: `${Math.round(size * 0.4)}px`,
          right: `${Math.round(size * 0.29)}px`,
          width: eyeSize,
          height: eyeSize,
          borderRadius: '50%',
          bgcolor: '#fff',
        }}
      />
      {animated && (
        <>
          <SparkleIcon sx={{ position: 'absolute', top: -7, left: -8, fontSize: 11, color: '#fff59d', animation: 'chatbotSparkle 1.8s ease-in-out infinite' }} />
          <SparkleIcon sx={{ position: 'absolute', top: -8, right: -5, fontSize: 9, color: '#fff59d', animation: 'chatbotSparkle 1.8s ease-in-out 0.2s infinite' }} />
          <SparkleIcon sx={{ position: 'absolute', top: '36%', left: -10, fontSize: 9, color: '#fbc02d', animation: 'chatbotSparkle 1.8s ease-in-out 0.5s infinite' }} />
          <SparkleIcon sx={{ position: 'absolute', top: '32%', right: -9, fontSize: 16, color: '#fbc02d', animation: 'chatbotSparkle 1.8s ease-in-out 0.35s infinite' }} />
          <SparkleIcon sx={{ position: 'absolute', bottom: -6, left: -6, fontSize: 10, color: '#fff59d', animation: 'chatbotSparkle 1.8s ease-in-out 0.7s infinite' }} />
          <SparkleIcon sx={{ position: 'absolute', bottom: -7, right: -7, fontSize: 10, color: '#fff59d', animation: 'chatbotSparkle 1.8s ease-in-out 0.9s infinite' }} />
        </>
      )}
    </Box>
  );
}

interface RequestDraftModalProps {
  open: boolean;
  draft: DraftState | null;
  definitions: DynamicField[];
  onClose: () => void;
  onUpdateDraft: (updated: DraftState) => void;
  onSubmit: (draft: DraftState) => Promise<void>;
  submitting: boolean;
}

function RequestDraftModal({
  open,
  draft,
  definitions,
  onClose,
  onUpdateDraft,
  onSubmit,
  submitting,
}: RequestDraftModalProps) {
  const [aipCodeInput, setAipCodeInput] = useState(draft?.aipCode || '');
  const [aipError, setAipError] = useState('');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (draft) {
      setAipCodeInput(draft.aipCode || '');
      setAipError('');
      setFormError('');
    }
  }, [draft]);

  if (!draft) return null;

  const handleAipCodeBlur = async (codeValue: string) => {
    const code = codeValue.trim();
    if (!code) return;
    const result = await handleChatbotAipCodeInput(code, {
      aipCode: code,
      setting: draft.setting,
      requestedBudget: draft.requestedBudget,
      description: draft.description,
      dynamicFields: draft.dynamicFields,
      sourceFile: draft.sourceFile || undefined,
    });
    if (result.success) {
      setAipError('');
      onUpdateDraft({
        ...draft,
        ...result.draft,
        aipCode: result.draft.aipCode,
        capdev: result.draft.capdev,
      });
    } else {
      setAipError(result.error || 'CapDev project not found.');
    }
  };

  const handleSetDynamicValue = (field: DynamicField, value: unknown) => {
    const key = dynamicFieldStorageKey(field);
    const updatedDynamics = { ...draft.dynamicFields, [key]: value };
    onUpdateDraft({
      ...draft,
      dynamicFields: updatedDynamics,
    });
  };

  const requestedNum = Number(draft.requestedBudget || 0);
  const remainingNum = draft.capdev?.remainingBudget ?? 0;
  const isBudgetExceeded = draft.capdev ? requestedNum > remainingNum : false;

  const handleSave = async () => {
    if (!draft.capdev) {
      setFormError('Please enter a valid AIP Code.');
      return;
    }
    if (!draft.requestedBudget || requestedNum <= 0) {
      setFormError('Please enter a requested amount.');
      return;
    }
    if (isBudgetExceeded) {
      setFormError('Requested amount exceeds remaining CapDev balance.');
      return;
    }
    setFormError('');
    await onSubmit(draft);
  };

  return (
    <Dialog open={open} onClose={() => !submitting && onClose()} fullWidth maxWidth="md">
      <DialogTitle sx={{ fontWeight: 800 }}>Review Request</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ py: 1 }}>
          <Grid container spacing={2}>
            {/* AIP Code */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                required
                fullWidth
                label="AIP Code"
                placeholder="0000-000-0-0-00-000-000"
                value={aipCodeInput}
                onChange={(e) => {
                  setAipCodeInput(e.target.value);
                  setAipError('');
                }}
                onBlur={(e) => void handleAipCodeBlur(e.target.value)}
                disabled={submitting}
                error={Boolean(aipError)}
                helperText={aipError || (draft.capdev ? `${draft.capdev.department || 'CapDev'} (Remaining: ₱${Number(draft.capdev.remainingBudget).toLocaleString('en-PH', { minimumFractionDigits: 2 })})` : undefined)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Grid>

            {/* Setting */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                select
                required
                fullWidth
                label="Setting"
                value={draft.setting}
                onChange={(e) => onUpdateDraft({ ...draft, setting: e.target.value as 'internal' | 'external' })}
                disabled={submitting}
              >
                <MenuItem value="internal">Internal</MenuItem>
                <MenuItem value="external">External</MenuItem>
              </TextField>
            </Grid>

            {/* Amount */}
            <Grid size={12}>
              <TextField
                required
                fullWidth
                type="number"
                label="Amount (₱)"
                value={draft.requestedBudget}
                onChange={(e) => {
                  const val = e.target.value;
                  const reqNum = Number(val || 0);
                  const remNum = draft.capdev?.remainingBudget ?? 0;
                  const isOver = draft.capdev ? reqNum > remNum : false;
                  onUpdateDraft({
                    ...draft,
                    requestedBudget: val,
                    budgetValidation: {
                      isValid: !isOver,
                      requestedBudget: reqNum,
                      remainingBudget: remNum,
                      error: isOver ? 'Requested amount exceeds CapDev balance.' : undefined,
                    },
                  });
                }}
                error={isBudgetExceeded}
                helperText={isBudgetExceeded ? 'Requested amount exceeds CapDev balance.' : undefined}
                disabled={submitting}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Grid>

            {/* Activity Description */}
            <Grid size={12}>
              <TextField
                fullWidth
                multiline
                minRows={2}
                maxRows={4}
                label="Activity Description"
                placeholder="Activity or seminar title..."
                value={draft.description}
                onChange={(e) => onUpdateDraft({ ...draft, description: e.target.value })}
                disabled={submitting}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Grid>

            {/* Dynamic Fields */}
            {definitions.map((field) => {
              const fieldValue = getDynamicFieldValue(draft.dynamicFields, field);
              return (
                <Grid
                  key={field.id}
                  size={field.type === 'table' ? 12 : field.width === 'half' ? { xs: 12, sm: 6 } : 12}
                >
                  {field.type === 'date' ? (
                    <DateField
                      label={field.name}
                      required={field.isRequired}
                      value={String(fieldValue || '')}
                      onChange={(val) => handleSetDynamicValue(field, val)}
                      disabled={submitting}
                    />
                  ) : field.type === 'table' ? (
                    <DynamicTableField
                      label={field.name}
                      required={field.isRequired}
                      value={fieldValue}
                      template={field.options?.[0]}
                      showDimensionControls={false}
                      onChange={(val) => handleSetDynamicValue(field, val)}
                    />
                  ) : (
                    <TextField
                      fullWidth
                      required={field.isRequired}
                      label={field.name}
                      placeholder={field.placeholder || ''}
                      value={String(fieldValue ?? '')}
                      onChange={(e) => handleSetDynamicValue(field, e.target.value)}
                      disabled={submitting}
                      slotProps={{ inputLabel: { shrink: true } }}
                    />
                  )}
                </Grid>
              );
            })}

            {/* Source Attachment Preview */}
            {(draft.sourceFile || draft.imagePreviewUrl) && (
              <Grid size={12}>
                <Stack
                  direction="row"
                  spacing={1.5}
                  sx={{
                    alignItems: 'center',
                    p: 1.25,
                    bgcolor: '#f4f7f4',
                    borderRadius: 2,
                  }}
                >
                  {draft.imagePreviewUrl && (
                    <Box
                      component="img"
                      src={draft.imagePreviewUrl}
                      alt="Source Activity Design"
                      sx={{
                        width: 50,
                        height: 50,
                        borderRadius: 1,
                        objectFit: 'cover',
                      }}
                    />
                  )}
                  <Typography variant="body2" sx={{ fontWeight: 600, flexGrow: 1 }}>
                    {draft.sourceFile?.name || 'Attached Activity Design'}
                  </Typography>
                  {draft.sourceFile?.url && (
                    <Button
                      size="small"
                      variant="outlined"
                      component="a"
                      href={draft.sourceFile.url}
                      target="_blank"
                      rel="noreferrer"
                      endIcon={<OpenInNewIcon sx={{ fontSize: 13 }} />}
                      sx={{ textTransform: 'none', fontWeight: 600 }}
                    >
                      Open
                    </Button>
                  )}
                </Stack>
              </Grid>
            )}
          </Grid>

          {formError && (
            <Typography variant="body2" color="error.main" sx={{ fontWeight: 600 }}>
              {formError}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} disabled={submitting} color="inherit">
          Cancel
        </Button>
        <Button
          onClick={() => void handleSave()}
          disabled={submitting || !draft.requestedBudget || requestedNum <= 0 || isBudgetExceeded}
          variant="contained"
          color="primary"
          sx={{ fontWeight: 800, px: 3, borderRadius: 2 }}
        >
          {submitting ? <CircularProgress size={18} color="inherit" /> : 'Save Request'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

interface PortalChatbotProps {
  userRole?: string | null;
}

export default function PortalChatbot({ userRole }: PortalChatbotProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [message, setMessage] = useState('');
  const [currentRole, setCurrentRole] = useState<string | null>(userRole || null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text: getRoleWelcomeMessage(userRole),
    },
  ]);
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [sending, setSending] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [activeDraft, setActiveDraft] = useState<DraftState | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [submittingDraft, setSubmittingDraft] = useState(false);
  const [definitions, setDefinitions] = useState<DynamicField[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const open = Boolean(anchorEl);

  useEffect(() => {
    if (userRole !== undefined) {
      setCurrentRole(userRole);
    } else {
      void getCurrentUserAccess().then((access) => {
        if (access.success) {
          setCurrentRole(access.role);
        }
      });
    }
  }, [userRole]);

  useEffect(() => {
    const welcomeText = getRoleWelcomeMessage(currentRole);
    setMessages((prev) => {
      if (prev.length === 1 && prev[0].id === 'welcome') {
        return [{ id: 'welcome', sender: 'assistant', text: welcomeText }];
      }
      return prev;
    });
  }, [currentRole]);

  useEffect(() => {
    void getRequestFieldDefinitions().then((fields) => {
      setDefinitions(fields as DynamicField[]);
    });
  }, []);

  const handleRemoveStagedFile = (id: string) => {
    setStagedFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((f) => f.id !== id);
    });
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    const newStaged: StagedFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isImage = file.type.startsWith('image/');
      newStaged.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${i}`,
        file,
        previewUrl: isImage ? URL.createObjectURL(file) : undefined,
        name: file.name,
        isImage,
      });
    }
    event.target.value = '';
    if (newStaged.length > 0) {
      setStagedFiles((prev) => [...prev, ...newStaged]);
    }
  };

  const handlePaste = (event: React.ClipboardEvent) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    const newStaged: StagedFile[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          event.preventDefault();
          event.stopPropagation();
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const ext = file.type.includes('png') ? 'png' : file.type.includes('webp') ? 'webp' : 'jpg';
          const namedFile = new File(
            [file],
            `Pasted-Image-${timestamp}.${ext}`,
            { type: file.type }
          );
          newStaged.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${i}`,
            file: namedFile,
            previewUrl: URL.createObjectURL(namedFile),
            name: namedFile.name,
            isImage: true,
          });
        }
      }
    }
    if (newStaged.length > 0) {
      setStagedFiles((prev) => [...prev, ...newStaged]);
    }
  };

  const sendMessage = async () => {
    const text = message.trim();
    const currentStaged = [...stagedFiles];
    if ((!text && currentStaged.length === 0) || sending || extracting) return;

    setMessage('');
    setStagedFiles([]);

    const imagePreviews = currentStaged
      .filter((f) => f.isImage && f.previewUrl)
      .map((f) => f.previewUrl as string);

    const fileNames = currentStaged
      .filter((f) => !f.isImage)
      .map((f) => f.name);

    let userBubbleText = text;
    if (!text && fileNames.length > 0) {
      userBubbleText = `Uploaded: ${fileNames.join(', ')}`;
    }

    const userMsg: ChatMessage = {
      id: String(Date.now()),
      sender: 'user',
      text: userBubbleText,
      imagePreview: imagePreviews[0],
      imagePreviews: imagePreviews.length > 0 ? imagePreviews : undefined,
    };
    setMessages((current) => [...current, userMsg]);

    // If images/files were attached
    if (currentStaged.length > 0) {
      setExtracting(true);
      try {
        const primaryFile = currentStaged[0].file;
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve, reject) => {
          reader.onload = () => {
            const res = reader.result as string;
            const base64 = res.split(',')[1] || '';
            resolve(base64);
          };
          reader.onerror = reject;
        });
        reader.readAsDataURL(primaryFile);
        const base64Data = await base64Promise;

        let attachment: StatusAttachment | undefined;
        try {
          const uploadResult = await uploadFilesDirectlyToGoogleDrive([primaryFile]);
          if (uploadResult.success && uploadResult.files.length > 0) {
            attachment = uploadResult.files[0];
          }
        } catch (err) {
          console.warn('Google Drive direct upload notice:', err);
        }

        const result = await handleChatbotActivityDesignUpload(
          {
            base64Data,
            mimeType: primaryFile.type || 'image/jpeg',
            fileName: primaryFile.name,
          },
          attachment
        );

        if (result.success) {
          if (result.isActivityDesign && result.draft) {
            const initialDraft: DraftState = {
              aipCode: result.draft.aipCode,
              capdev: result.draft.capdev,
              setting: result.draft.setting,
              requestedBudget: result.draft.requestedBudget,
              description: result.draft.description,
              dynamicFields: result.draft.dynamicFields,
              attachments: result.draft.attachments,
              sourceFile: result.draft.sourceFile || attachment || null,
              imagePreviewUrl: imagePreviews[0],
              missingRequiredFields: result.draft.missingRequiredFields,
              budgetValidation: result.draft.budgetValidation,
              isReadyForSubmission: result.draft.isReadyForSubmission,
            };
            setActiveDraft(initialDraft);

            setMessages((current) => [
              ...current,
              {
                id: String(Date.now() + 1),
                sender: 'assistant',
                text: result.reply,
                draft: initialDraft,
                isDraftCard: true,
              },
            ]);
          } else {
            setMessages((current) => [
              ...current,
              {
                id: String(Date.now() + 1),
                sender: 'assistant',
                text: result.reply,
              },
            ]);
          }
        } else {
          setMessages((current) => [
            ...current,
            {
              id: String(Date.now() + 1),
              sender: 'assistant',
              text: result.error || 'Unable to analyze the image.',
            },
          ]);
        }
      } catch (err) {
        console.error('File upload error in Chatbot:', err);
        setMessages((current) => [
          ...current,
          {
            id: String(Date.now() + 1),
            sender: 'assistant',
            text: 'An error occurred while analyzing the image.',
          },
        ]);
      } finally {
        setExtracting(false);
      }
      return;
    }

    // Standard text message flow
    setSending(true);
    const aipPattern = /\b\d{4}-\d{3}-\d-\d-\d{2}-\d{3}-\d{3}\b/;
    const matchedAip = text.match(aipPattern);

    if (activeDraft && (!activeDraft.capdev || matchedAip)) {
      const aipToUse = matchedAip ? matchedAip[0] : text;
      const result = await handleChatbotAipCodeInput(aipToUse, {
        aipCode: aipToUse,
        setting: activeDraft.setting,
        requestedBudget: activeDraft.requestedBudget,
        description: activeDraft.description,
        dynamicFields: activeDraft.dynamicFields,
        sourceFile: activeDraft.sourceFile || undefined,
      });

      if (result.success) {
        const updatedDraft: DraftState = {
          ...activeDraft,
          ...result.draft,
          aipCode: result.draft.aipCode,
          capdev: result.draft.capdev,
          imagePreviewUrl: activeDraft.imagePreviewUrl,
        };
        setActiveDraft(updatedDraft);
        setMessages((current) => [
          ...current,
          {
            id: String(Date.now() + 1),
            sender: 'assistant',
            text: result.reply,
            draft: updatedDraft,
            isDraftCard: true,
          },
        ]);
        setSending(false);
        return;
      }
    }

    const history = messages.slice(-6).map((m) => ({ sender: m.sender, text: m.text }));
    const result = await askPortalChatbot(text, history);
    setMessages((current) => [
      ...current,
      {
        id: String(Date.now() + 1),
        sender: 'assistant',
        text: result.success ? result.reply : result.error,
      },
    ]);
    setSending(false);
  };

  const handleSubmitDraft = async (draftToSubmit: DraftState) => {
    if (!draftToSubmit.aipCode || !draftToSubmit.capdev) return;
    setSubmittingDraft(true);

    try {
      const result = await handleChatbotSubmitRequest({
        aipCode: draftToSubmit.aipCode,
        setting: draftToSubmit.setting,
        requestedBudget: draftToSubmit.requestedBudget,
        description: draftToSubmit.description,
        dynamicFields: draftToSubmit.dynamicFields,
        attachments: draftToSubmit.attachments,
        sourceFile: draftToSubmit.sourceFile || undefined,
        userConfirmed: true,
      });

      if (result.success && result.request) {
        const requestId = result.request.id;
        const link = result.link || `/portal/capdev/${result.request.capdevId}/requests#request-record-${requestId}`;

        setModalOpen(false);
        setActiveDraft(null);

        setMessages((current) => [
          ...current,
          {
            id: String(Date.now()),
            sender: 'assistant',
            text: `Request **#${requestId}** created successfully for CapDev **${draftToSubmit.aipCode}**.`,
            createdRequestLink: link,
            requestId,
          },
        ]);
      } else {
        setMessages((current) => [
          ...current,
          {
            id: String(Date.now()),
            sender: 'assistant',
            text: result.error || 'Failed to submit request.',
          },
        ]);
      }
    } catch (err) {
      console.error('Submit draft failed:', err);
      setMessages((current) => [
        ...current,
        {
          id: String(Date.now()),
          sender: 'assistant',
          text: 'An error occurred while submitting the request.',
        },
      ]);
    } finally {
      setSubmittingDraft(false);
    }
  };

  return (
    <>
      <Tooltip title="Help chat">
        <IconButton onClick={(event) => setAnchorEl(event.currentTarget)} aria-label="Open help chat" sx={{ p: 0.5 }}>
          <ChatbotIcon animated />
        </IconButton>
      </Tooltip>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: {
              width: { xs: 'calc(100vw - 32px)', sm: 480, md: 520 },
              maxHeight: { xs: 'calc(100vh - 120px)', sm: 620 },
              borderRadius: 2.5,
              overflow: 'hidden',
              mt: 1,
              boxShadow: '0 12px 36px rgba(0,0,0,0.18)',
            },
          },
        }}
      >
        <Stack sx={{ height: { xs: 500, sm: 560 } }}>
          <Box sx={{ px: 2, py: 1.5, bgcolor: 'primary.dark', color: 'primary.contrastText' }}>
            <Typography sx={{ fontWeight: 800 }}>LEAPRS Help</Typography>
          </Box>

          <Stack spacing={1.25} sx={{ flexGrow: 1, overflowY: 'auto', p: 1.5, bgcolor: 'background.default' }}>
            {messages.map((item) => {
              const hasImages = Boolean(
                (item.imagePreviews && item.imagePreviews.length > 0) || item.imagePreview
              );
              const isUserImageOnly = item.sender === 'user' && hasImages && !item.text;
              return (
                <Stack
                  key={item.id}
                  direction="row"
                  spacing={0.75}
                  sx={{
                    alignSelf: item.sender === 'user' ? 'flex-end' : 'flex-start',
                    maxWidth: isUserImageOnly ? '80%' : '92%',
                    alignItems: 'flex-end',
                  }}
                >
                  {item.sender === 'assistant' && <ChatbotIcon size={28} />}
                  <Paper
                    variant={isUserImageOnly ? 'elevation' : 'outlined'}
                    elevation={0}
                    sx={{
                      p: isUserImageOnly ? 0 : 1,
                      borderRadius: 2,
                      bgcolor: isUserImageOnly
                        ? 'transparent'
                        : item.sender === 'user'
                        ? 'primary.main'
                        : 'background.paper',
                      color: item.sender === 'user' ? 'primary.contrastText' : 'text.primary',
                      borderColor: isUserImageOnly ? 'transparent' : item.sender === 'user' ? 'primary.main' : 'divider',
                      overflow: 'hidden',
                    }}
                  >
                    {item.imagePreviews && item.imagePreviews.length > 0 ? (
                      <Stack spacing={0.75} sx={{ mb: item.text ? 0.75 : 0 }}>
                        {item.imagePreviews.map((imgUrl, idx) => (
                          <Box
                            key={idx}
                            component="img"
                            src={imgUrl}
                            alt={`Shared image ${idx + 1}`}
                            sx={{
                              display: 'block',
                              maxWidth: 240,
                              maxHeight: 180,
                              borderRadius: 2,
                              objectFit: 'contain',
                              bgcolor: 'rgba(0,0,0,0.03)',
                              border: '1px solid rgba(0,0,0,0.08)',
                            }}
                          />
                        ))}
                      </Stack>
                    ) : item.imagePreview ? (
                      <Box
                        component="img"
                        src={item.imagePreview}
                        alt="Shared image"
                        sx={{
                          display: 'block',
                          maxWidth: 240,
                          maxHeight: 180,
                          borderRadius: 2,
                          objectFit: 'contain',
                          bgcolor: 'rgba(0,0,0,0.03)',
                          border: '1px solid rgba(0,0,0,0.08)',
                          mb: item.text ? 0.75 : 0,
                        }}
                      />
                    ) : null}

                    {item.text && (
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                        {formatMessage(item.text)}
                      </Typography>
                    )}

                    {/* Review Request button directly below message */}
                    {item.isDraftCard && item.draft && (
                      <Box sx={{ mt: 1 }}>
                        <Button
                          size="small"
                          variant="contained"
                          color="primary"
                          startIcon={<EditNoteIcon sx={{ fontSize: 16 }} />}
                          onClick={() => setModalOpen(true)}
                          sx={{
                            textTransform: 'none',
                            fontWeight: 700,
                            fontSize: '0.8rem',
                            py: 0.45,
                            px: 1.5,
                            borderRadius: 1.5,
                            boxShadow: 'none',
                          }}
                        >
                          Review Request
                        </Button>
                      </Box>
                    )}

                    {item.createdRequestLink && (
                      <Button
                        size="small"
                        variant="outlined"
                        color="primary"
                        component="a"
                        href={item.createdRequestLink}
                        target="_blank"
                        endIcon={<OpenInNewIcon sx={{ fontSize: 13 }} />}
                        sx={{ textTransform: 'none', fontWeight: 700, mt: 1, borderRadius: 1.5 }}
                      >
                        Open Request #{item.requestId}
                      </Button>
                    )}
                  </Paper>
                </Stack>
              );
            })}

            {(sending || extracting) && (
              <Stack direction="row" spacing={0.75} sx={{ alignSelf: 'flex-start', maxWidth: '86%', alignItems: 'flex-end' }}>
                <ChatbotIcon size={28} />
                <Paper variant="outlined" sx={{ px: 1.25, py: 0.9, borderRadius: 2, bgcolor: 'background.paper' }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <CircularProgress size={14} />
                    <Typography variant="body2" color="text.secondary">
                      {extracting ? 'Analyzing image…' : 'Thinking…'}
                    </Typography>
                  </Stack>
                </Paper>
              </Stack>
            )}
          </Stack>

          {/* Staged Attachments Tray */}
          {stagedFiles.length > 0 && (
            <Box
              sx={{
                px: 1.5,
                pt: 1,
                pb: 0.5,
                bgcolor: 'background.paper',
                borderTop: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', py: 0.5, alignItems: 'center' }}>
                {stagedFiles.map((item) => (
                  <Box
                    key={item.id}
                    sx={{
                      position: 'relative',
                      display: 'inline-flex',
                      flexShrink: 0,
                      borderRadius: 1.5,
                    }}
                  >
                    {item.isImage && item.previewUrl ? (
                      <Box
                        component="img"
                        src={item.previewUrl}
                        alt={item.name}
                        sx={{
                          width: 52,
                          height: 52,
                          borderRadius: 1.5,
                          objectFit: 'cover',
                          border: '1px solid rgba(0,0,0,0.12)',
                        }}
                      />
                    ) : (
                      <Paper
                        variant="outlined"
                        sx={{
                          p: 0.75,
                          borderRadius: 1.5,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.5,
                          maxWidth: 140,
                          fontSize: '0.75rem',
                        }}
                      >
                        <AttachFileIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                        <Typography variant="caption" noWrap sx={{ fontWeight: 600 }}>
                          {item.name}
                        </Typography>
                      </Paper>
                    )}

                    <IconButton
                      size="small"
                      aria-label="Remove attachment"
                      onClick={() => handleRemoveStagedFile(item.id)}
                      sx={{
                        position: 'absolute',
                        top: -5,
                        right: -5,
                        width: 18,
                        height: 18,
                        p: 0,
                        bgcolor: 'rgba(30, 30, 30, 0.7)',
                        color: '#ffffff',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                        '&:hover': {
                          bgcolor: 'rgba(0, 0, 0, 0.9)',
                        },
                      }}
                    >
                      <CloseIcon sx={{ fontSize: 11 }} />
                    </IconButton>
                  </Box>
                ))}
              </Stack>
            </Box>
          )}

          <Divider />

          <Stack direction="row" spacing={0.75} sx={{ p: 1.25, alignItems: 'flex-end' }}>
            <input
              type="file"
              ref={fileInputRef}
              hidden
              multiple
              accept="image/*,application/pdf"
              onChange={(e) => void handleFileUpload(e)}
            />
            <Tooltip title="Attach file">
              <IconButton
                size="small"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending || extracting}
                aria-label="Attach file"
                sx={{ p: 0.75, mb: 0.25 }}
              >
                <AttachFileIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <TextField
              fullWidth
              multiline
              minRows={1}
              maxRows={4}
              size="small"
              placeholder="Ask about LEAPRS"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onPaste={handlePaste}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              disabled={sending || extracting}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 2,
                  py: 0.75,
                },
              }}
            />
            <Button
              variant="contained"
              onClick={() => void sendMessage()}
              disabled={sending || extracting || (!message.trim() && stagedFiles.length === 0)}
              aria-label="Send message"
              sx={{ minWidth: 40, height: 40, px: 1, mb: 0.25, borderRadius: 2 }}
            >
              <SendIcon fontSize="small" />
            </Button>
          </Stack>
        </Stack>
      </Popover>

      {/* Simplified, Clean Review Modal Dialog */}
      <RequestDraftModal
        open={modalOpen}
        draft={activeDraft}
        definitions={definitions}
        onClose={() => setModalOpen(false)}
        onUpdateDraft={(updated) => setActiveDraft(updated)}
        onSubmit={handleSubmitDraft}
        submitting={submittingDraft}
      />
    </>
  );
}
