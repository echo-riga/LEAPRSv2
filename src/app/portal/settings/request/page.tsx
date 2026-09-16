'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Container,
  Box,
  Typography,
  IconButton,
  Stack,
  Chip,
  CircularProgress,
  Grid,
  Card,
  CardContent,
  Button,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  FormControlLabel,
  Checkbox,
  Autocomplete,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Save as SaveIcon,
  DragIndicator as DragIcon,
  CloudUpload as UploadIcon,
  Edit as EditIcon,
} from '@mui/icons-material';
import { authClient } from '@/lib/auth/client';
import { getCurrentUserAccess } from '@/app/actions';
import { FormConfigSkeleton } from '@/components/Skeletons';
import DateField from '@/components/DateField';
import DynamicTableField from '@/components/DynamicTableField';
import {
  EmptyHalfFieldDropSlot,
  FieldDropIndicator,
  getHalfFieldLayout,
  useFieldReorder,
} from '@/components/FieldReorder';
import {
  getRequestFieldDefinitions,
  saveRequestFieldDefinition,
  deleteRequestFieldDefinition,
  updateRequestFieldsOrder,
} from '@/app/actions';

interface Field {
  id?: number;
  key: string; // stable client-side identity, used for edit/backup tracking (not sent to the server)
  name: string;
  type: string;
  options: string[] | null;
  isRequired: boolean;
  section: string;
  width: string;
  columnPosition: 'left' | 'right';
  placeholder?: string | null;
  sortOrder: number;
  isTemp?: boolean;
}

export default function RequestConfigPage() {
  const router = useRouter();
  const session = authClient.useSession();
  const [fields, setFields] = useState<Field[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | string | null>(null);

  // Inline editing state (replaces the old modal)
  const [editingKeys, setEditingKeys] = useState<Set<string>>(new Set());
  const [backups, setBackups] = useState<Record<string, Field>>({});
  const [optionDrafts, setOptionDrafts] = useState<Record<string, string>>({});
  const tempCounter = useRef(0);
  const [isSavingConfiguration, setIsSavingConfiguration] = useState(false);
  const [configurationSaved, setConfigurationSaved] = useState(false);
  const [hasPendingDeletion, setHasPendingDeletion] = useState(false);
  const configurationSaveTimeout = useRef<number | null>(null);
  useEffect(() => () => {
    if (configurationSaveTimeout.current) window.clearTimeout(configurationSaveTimeout.current);
  }, []);

  // Interactive preview input states
  const [previewData, setPreviewData] = useState<Record<string, unknown>>({});
  const [previewFiles, setPreviewFiles] = useState<Record<string, File[]>>({});

  // Fixed/required preview fields (AIP Code, Budget, etc.) — typeable, placeholder only
  const [fixedPreviewData, setFixedPreviewData] = useState<Record<string, string>>({
    setting: '',
    requestedBudget: '',
  });

  const handleFixedPreviewChange = (key: string, value: string) => {
    setFixedPreviewData((prev) => ({ ...prev, [key]: value }));
  };

  useEffect(() => {
    if (!session.isPending && !session.data) {
      router.push('/');
    }
  }, [session.isPending, session.data, router]);

  useEffect(() => {
    if (!session.data) return;
    void getCurrentUserAccess().then((access) => { if (access.success && access.role !== 'admin') router.replace('/portal'); });
  }, [router, session.data]);

  useEffect(() => {
    const loadFields = async () => {
      try {
        const data = await getRequestFieldDefinitions();
        const mapped = data.map((f) => ({
          ...f,
          key: `field-${f.id}`,
          options: Array.isArray(f.options) ? (f.options as string[]) : [],
          placeholder: f.placeholder || '',
          section: f.isRequired ? 'required' : 'optional',
          columnPosition: f.columnPosition === 'right' ? 'right' as const : 'left' as const,
        }));
        setFields(mapped);
      } catch (error) {
        console.error('Failed to load fields:', error);
      } finally {
        setLoading(false);
      }
    };
    loadFields();
  }, []);

  const { draggedFieldKey, dragOverTarget, handlePointerDragStart, handleKeyboardMove } = useFieldReorder({
    fields,
    setFields,
    disabledKeys: editingKeys,
    persistOrder: async (sortedFields) => {
      const currentUserId = session.data?.user.id;
      if (!currentUserId) return;
      const fieldLayout = sortedFields
        .filter((field): field is Field & { id: number } => typeof field.id === 'number')
        .map((field) => ({ id: field.id, columnPosition: field.columnPosition }));
      await updateRequestFieldsOrder(fieldLayout, currentUserId);
    },
  });

  if (session.isPending || loading) {
    return <FormConfigSkeleton titleWidth={260} />;
  }

  if (!session.data) return null;

  const currentUserId = session.data.user.id;
  const draftFields = fields.filter((field) => field.isTemp || editingKeys.has(field.key));
  const hasInvalidDraft = draftFields.some((field) => !field.name.trim());
  const hasConfigurationChanges = draftFields.length > 0 || hasPendingDeletion;

  // ---- Inline add / edit / cancel / save / delete -------------------------------------------

  const handleAddField = (isRequired = false) => {
    tempCounter.current += 1;
    const key = `temp-${tempCounter.current}`;
    const newField: Field = {
      key,
      name: '',
      type: 'text',
      options: [],
      isRequired,
      section: isRequired ? 'required' : 'optional',
      width: 'full',
      columnPosition: 'left',
      placeholder: '',
      sortOrder: fields.length + 1,
      isTemp: true,
    };
    setFields((prev) => [...prev, newField]);
    setEditingKeys((prev) => new Set(prev).add(key));
  };

  const handleStartEdit = (originalIndex: number) => {
    const f = fields[originalIndex];
    setBackups((prev) => ({ ...prev, [f.key]: { ...f } }));
    setEditingKeys((prev) => new Set(prev).add(f.key));
  };

  const handleFieldChange = (originalIndex: number, updates: Partial<Field>) => {
    setFields((prev) => prev.map((field, idx) => (idx === originalIndex ? { ...field, ...updates } : field)));
  };

  const clearEditingState = (key: string) => {
    setEditingKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setBackups((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setOptionDrafts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleCancelEdit = (originalIndex: number) => {
    const f = fields[originalIndex];
    if (f.isTemp) {
      setFields((prev) => prev.filter((_, idx) => idx !== originalIndex));
    } else {
      const backup = backups[f.key];
      if (backup) {
        setFields((prev) => prev.map((field, idx) => (idx === originalIndex ? backup : field)));
      }
    }
    clearEditingState(f.key);
  };

  const handleConfirmAddField = (originalIndex: number) => {
    const field = fields[originalIndex];
    if (!field.isTemp || !field.name.trim()) return;
    clearEditingState(field.key);
  };

  const handleSaveConfiguration = async () => {
    if (hasInvalidDraft) return;
    if (draftFields.length === 0) {
      setHasPendingDeletion(false);
      setConfigurationSaved(true);
      if (configurationSaveTimeout.current) window.clearTimeout(configurationSaveTimeout.current);
      configurationSaveTimeout.current = window.setTimeout(() => setConfigurationSaved(false), 2_000);
      return;
    }
    setIsSavingConfiguration(true);
    setConfigurationSaved(false);
    try {
      const savedFields = await Promise.all(draftFields.map(async (field) => {
        const result = await saveRequestFieldDefinition({
          id: field.isTemp ? undefined : field.id,
          name: field.name,
          type: field.type,
          options: field.options,
          isRequired: field.isRequired,
          section: field.isRequired ? 'required' : 'optional',
          width: field.width,
          columnPosition: field.columnPosition,
          placeholder: field.placeholder || '',
          sortOrder: field.sortOrder,
          updatedById: currentUserId,
        });
        return { key: field.key, result };
      }));
      if (savedFields.every(({ result }) => result.success && result.id)) {
        const idsByKey = new Map(savedFields.map(({ key, result }) => [key, result.id!]));
        setFields((current) => current.map((field) => {
          const id = idsByKey.get(field.key);
          return id ? { ...field, id, key: `field-${id}`, isTemp: false } : field;
        }));
        setEditingKeys(new Set());
        setBackups({});
        setOptionDrafts({});
        setHasPendingDeletion(false);
        setConfigurationSaved(true);
        if (configurationSaveTimeout.current) window.clearTimeout(configurationSaveTimeout.current);
        configurationSaveTimeout.current = window.setTimeout(() => setConfigurationSaved(false), 2_000);
      }
    } catch (error) {
      console.error('Configuration save failed:', error);
    } finally {
      setIsSavingConfiguration(false);
    }
  };

  const handleDeleteFieldDirect = async (originalIndex: number) => {
    const fieldToDelete = fields[originalIndex];
    if (fieldToDelete.isTemp) {
      setFields((prev) => prev.filter((_, idx) => idx !== originalIndex));
      clearEditingState(fieldToDelete.key);
      return;
    }
    if (!fieldToDelete.id) return;
    setSavingId(fieldToDelete.id);
    try {
      const result = await deleteRequestFieldDefinition(fieldToDelete.id, currentUserId);
      if (result.success) {
        setFields((prev) => prev.filter((_, idx) => idx !== originalIndex));
        clearEditingState(fieldToDelete.key);
        setHasPendingDeletion(true);
        setConfigurationSaved(false);
      }
    } catch (error) {
      console.error('Delete failed:', error);
    } finally {
      setSavingId(null);
    }
  };

  // Options builder (used inside the inline editor for "text" fields)
  const handleAddOption = (originalIndex: number) => {
    const f = fields[originalIndex];
    const text = (optionDrafts[f.key] || '').trim();
    if (!text) return;
    const currentOptions = f.options || [];
    if (!currentOptions.includes(text)) {
      handleFieldChange(originalIndex, { options: [...currentOptions, text] });
    }
    setOptionDrafts((prev) => ({ ...prev, [f.key]: '' }));
  };

  const handleRemoveOption = (originalIndex: number, optToRemove: string) => {
    const f = fields[originalIndex];
    const currentOptions = f.options || [];
    handleFieldChange(originalIndex, { options: currentOptions.filter((o) => o !== optToRemove) });
  };

  const groups = [{ key: 'all', label: 'Request' }] as const;

  // ---- Interactive Upload Preview --------------------------------------------------------------

  const handleFileChange = (fieldName: string, files: FileList | null) => {
    if (!files) return;
    const arr = Array.from(files);
    setPreviewFiles((prev) => ({
      ...prev,
      [fieldName]: [...(prev[fieldName] || []), ...arr],
    }));
  };

  const handleRemoveFile = (fieldName: string, fileIdx: number) => {
    setPreviewFiles((prev) => ({
      ...prev,
      [fieldName]: (prev[fieldName] || []).filter((_, idx) => idx !== fileIdx),
    }));
  };

  function renderPreviewField(field: Field) {
    const isRequired = field.isRequired;
    const storedValue = previewData[field.key];
    const value = typeof storedValue === 'string' ? storedValue : '';
    const files = previewFiles[field.key] || [];

    switch (field.type) {
      case 'number':
        return (
          <Stack spacing={0.5}>
            <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
              {field.name} {isRequired && <span style={{ color: '#d32f2f', fontWeight: 'bold' }}>*</span>}
            </Typography>
            <TextField
              type="number"
              fullWidth
              size="small"
              placeholder={field.placeholder || 'Enter number...'}
              value={value}
              onChange={(e) => setPreviewData({ ...previewData, [field.key]: e.target.value })}
              sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#ffffff' } }}
            />
          </Stack>
        );
      case 'date':
        return (
          <Stack spacing={0.5}>
            <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
              {field.name} {isRequired && <span style={{ color: '#d32f2f', fontWeight: 'bold' }}>*</span>}
            </Typography>
            <DateField size="small" value={value} onChange={(nextValue) => setPreviewData({ ...previewData, [field.key]: nextValue })} />
          </Stack>
        );
      case 'file':
        return (
          <Stack spacing={0.5}>
            <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
              {field.name} {isRequired && <span style={{ color: '#d32f2f', fontWeight: 'bold' }}>*</span>}
            </Typography>
            <Box
              sx={{
                border: '2px dashed #2e7d32',
                p: 2.5,
                borderRadius: 2,
                textAlign: 'center',
                bgcolor: '#ffffff',
                cursor: 'pointer',
                position: 'relative',
                '&:hover': { bgcolor: 'rgba(46, 125, 50, 0.02)' },
              }}
              component="label"
            >
              <input
                type="file"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => handleFileChange(field.name, e.target.files)}
              />
              <UploadIcon sx={{ color: 'primary.main', fontSize: 28, mb: 0.5 }} />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 'bold' }}>
                Drag & drop files or click to upload (Allows multiple files)
              </Typography>
            </Box>
            {files.length > 0 && (
              <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
                {files.map((file, idx) => (
                  <Chip
                    key={`${file.name}-${idx}`}
                    label={file.name}
                    size="small"
                    onDelete={() => handleRemoveFile(field.name, idx)}
                  />
                ))}
              </Stack>
            )}
          </Stack>
        );
      case 'table':
        return (
          <DynamicTableField
            label={field.name}
            required={isRequired}
            value={previewData[field.key]}
            template={field.options?.[0]}
            showDimensionControls={false}
            onChange={(val) => setPreviewData({ ...previewData, [field.key]: val })}
          />
        );
      case 'text':
      case 'textarea':
      default:
        if (field.options && field.options.length > 0) {
          return (
            <Stack spacing={0.5}>
              <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
                {field.name} {isRequired && <span style={{ color: '#d32f2f', fontWeight: 'bold' }}>*</span>}
              </Typography>
              <Autocomplete
                freeSolo
                options={field.options}
                value={value}
                onChange={(_, newValue) => setPreviewData({ ...previewData, [field.key]: newValue || '' })}
                onInputChange={(_, newValue) => setPreviewData({ ...previewData, [field.key]: newValue })}
                renderInput={(params) => <TextField {...params} size="small" placeholder={field.placeholder || 'Select or type...'} sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#ffffff' } }} />}
              />
            </Stack>
          );
        }
        return (
          <Stack spacing={0.5}>
            <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
              {field.name} {isRequired && <span style={{ color: '#d32f2f', fontWeight: 'bold' }}>*</span>}
            </Typography>
            <TextField
              fullWidth
              multiline
              minRows={2}
              size="small"
              placeholder={field.placeholder || 'Enter text...'}
              value={value}
              onChange={(e) => setPreviewData({ ...previewData, [field.key]: e.target.value })}
              sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#ffffff' } }}
            />
          </Stack>
        );
    }
  }

  // Inline editor shown in place of a field when it's being added or edited.
  function renderFieldEditor(f: Field, originalIndex: number) {
    const isSaving = savingId === (f.id ?? f.key);
    return (
      <Box
        sx={{
          p: 2.5,
          border: '2px solid',
          borderColor: 'primary.main',
          borderRadius: 2.5,
          bgcolor: '#ffffff',
          boxShadow: '0 4px 16px rgba(46, 125, 50, 0.08)',
        }}
      >
        <Typography variant="subtitle2" sx={{ color: 'primary.main', fontWeight: 'bold', mb: 2 }}>
          {f.isTemp ? 'Add New Field' : `Editing: ${f.name}`}
        </Typography>

        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Field Name"
              fullWidth
              size="small"
              autoFocus
              value={f.name}
              onChange={(e) => handleFieldChange(originalIndex, { name: e.target.value })}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Placeholder"
              fullWidth
              size="small"
              value={f.placeholder || ''}
              onChange={(e) => handleFieldChange(originalIndex, { placeholder: e.target.value })}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Type</InputLabel>
              <Select
                value={f.type === 'textarea' ? 'text' : f.type}
                label="Type"
                onChange={(e) => handleFieldChange(originalIndex, { type: e.target.value })}
              >
                <MenuItem value="text">Text (Textbox / Combobox)</MenuItem>
                <MenuItem value="number">Number</MenuItem>
                <MenuItem value="date">Date Picker</MenuItem>
                <MenuItem value="file">File Upload (Allows Multiple)</MenuItem>
                <MenuItem value="table">Table (Dynamic Grid)</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Width</InputLabel>
              <Select
                value={f.width}
                label="Width"
                onChange={(e) => handleFieldChange(originalIndex, { width: e.target.value })}
              >
                <MenuItem value="full">100% Width (Full)</MenuItem>
                <MenuItem value="half">50% Width (Half)</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid size={12}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={f.isRequired}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    handleFieldChange(originalIndex, {
                      isRequired: checked,
                      section: checked ? 'required' : 'optional',
                    });
                  }}
                />
              }
              label="Required Field"
            />
          </Grid>

          {f.type === 'text' && (
            <Grid size={12}>
              <Box sx={{ border: '1px solid rgba(0,0,0,0.12)', borderRadius: 2, p: 2, bgcolor: '#ffffff' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
                  Dropdown Options Builder
                </Typography>
                <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
                  <TextField
                    label="Option Value"
                    size="small"
                    fullWidth
                    value={optionDrafts[f.key] || ''}
                    onChange={(e) => setOptionDrafts((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddOption(originalIndex);
                      }
                    }}
                  />
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => handleAddOption(originalIndex)}
                    sx={{ height: 40, minWidth: '120px', whiteSpace: 'nowrap' }}
                  >
                    Add Option
                  </Button>
                </Stack>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, maxHeight: 120, overflowY: 'auto' }}>
                  {(f.options || []).length === 0 ? (
                    <Typography variant="caption" color="text.secondary">
                      No options added yet. User will type inputs freely.
                    </Typography>
                  ) : (
                    (f.options || []).map((opt) => (
                      <Chip key={opt} label={opt} size="small" onDelete={() => handleRemoveOption(originalIndex, opt)} />
                    ))
                  )}
                </Box>
              </Box>
            </Grid>
          )}

          {f.type === 'table' && (
            <Grid size={12}>
              <Box sx={{ border: '1px solid rgba(0,0,0,0.12)', borderRadius: 2, p: 2, bgcolor: '#ffffff' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
                  Table Structure Configuration
                </Typography>
                <DynamicTableField
                  label=""
                  value={f.options?.[0] ? JSON.parse(f.options[0]) : undefined}
                  template={f.options?.[0]}
                  showDimensionControls={true}
                  onChange={(val) => {
                    handleFieldChange(originalIndex, { options: [JSON.stringify(val)] });
                  }}
                />
              </Box>
            </Grid>
          )}
        </Grid>

        <Stack direction="row" spacing={1} sx={{ mt: 2.5, justifyContent: 'flex-end' }}>
          {!f.isTemp && (
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={() => handleDeleteFieldDirect(originalIndex)}
              disabled={isSaving}
              sx={{ mr: 'auto' }}
            >
              Delete
            </Button>
          )}
          <Button variant="outlined" onClick={() => handleCancelEdit(originalIndex)} disabled={isSaving}>
            Cancel
          </Button>
          {f.isTemp && (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => handleConfirmAddField(originalIndex)}
              disabled={isSaving || !f.name.trim()}
            >
              Add Field
            </Button>
          )}
        </Stack>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 'calc(100vh - 72px)',
      }}
    >
      {/* Main Single Live Preview Container */}
      <Container maxWidth="md" sx={{ p: 0, width: '100%', mb: 4 }}>
        <Typography variant="h4" sx={{ fontWeight: '800', color: 'text.primary', letterSpacing: '-1px', mb: 0.5 }}>
          Activity Design Layout
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Configure required and optional fields, then drag to set their order.
        </Typography>

        <Card
          variant="outlined"
          sx={{
            borderRadius: 2,
            bgcolor: '#ffffff',
            borderColor: 'rgba(46, 125, 50, 0.18)',
            boxShadow: '0 8px 24px rgba(28, 40, 28, 0.05)',
          }}
        >
          <CardContent sx={{ p: { xs: 3, md: 4 } }}>
            <Box
              sx={{
                bgcolor: '#fafcfa',
                p: { xs: 2, sm: 3.5 },
                borderRadius: 2,
                border: '1px solid rgba(28, 40, 28, 0.14)',
                boxShadow: '0 2px 8px rgba(28, 40, 28, 0.04)',
              }}
            >
              {groups.map(({ key: secKey, label }) => {
                const sectionFields = fields;

                return (
                  <Box key={secKey} sx={{ mb: 4.5 }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5, borderBottom: '2px solid #2e7d32', pb: 0.75 }}>
                      <Typography variant="subtitle2" sx={{ color: 'primary.dark', fontWeight: 'bold', letterSpacing: '0.1px', flexGrow: 1 }}>
                        {label}
                      </Typography>
                    </Stack>
                    <Grid container spacing={{ xs: 2.5, sm: 3 }}>
                      {/* Fixed fields shown inside the Activity Design Section.
                          Placeholder-only (not defaultValue), not read-only, so admins can
                          type into them to test the layout — the placeholder is just a hint
                          of what real data will look like once wired to the AIP record. */}
                      {secKey === 'all' && (
                        <>
                          <Grid size={12}>
                            <Stack spacing={0.5}>
                              <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
                                Setting <span style={{ color: '#d32f2f', fontWeight: 'bold' }}>*</span>
                              </Typography>
                              <TextField
                                fullWidth
                                size="small"
                                select
                                value={fixedPreviewData.setting}
                                onChange={(e) => handleFixedPreviewChange('setting', e.target.value)}
                                sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#ffffff' } }}
                              >
                                <MenuItem value="internal">Internal</MenuItem>
                                <MenuItem value="external">External</MenuItem>
                              </TextField>
                            </Stack>
                          </Grid>
                          <Grid size={{ xs: 12, sm: 6 }}>
                            <Stack spacing={0.5}>
                              <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
                                Amount <span style={{ color: '#d32f2f', fontWeight: 'bold' }}>*</span>
                              </Typography>
                              <TextField
                                fullWidth
                                size="small"
                                placeholder="e.g. 150000.00"
                                type="number"
                                value={fixedPreviewData.requestedBudget}
                                onChange={(e) => handleFixedPreviewChange('requestedBudget', e.target.value)}
                                sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#ffffff' } }}
                              />
                            </Stack>
                          </Grid>
                          <Grid size={{ xs: 12, sm: 6 }}>
                            <Stack spacing={0.5}>
                              <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>
                                Balance
                              </Typography>
                              <TextField
                                fullWidth
                                size="small"
                                value="₱"
                                disabled
                                slotProps={{
                                  input: {
                                    readOnly: true,
                                  },
                                }}
                                sx={{
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
                                }}
                              />
                            </Stack>
                          </Grid>
                        </>
                      )}

                      {(() => {
                        const halfFieldLayout = getHalfFieldLayout(
                          sectionFields.map((field) => editingKeys.has(field.key) ? { ...field, width: 'full' } : field)
                        );

                        return sectionFields.map((f) => {
                          const originalIndex = fields.findIndex((field) => field.key === f.key);
                          const editing = editingKeys.has(f.key);
                          const isBeingDragged = draggedFieldKey === f.key;
                          const activeDropTarget = dragOverTarget?.key === f.key ? dragOverTarget : null;

                          return (
                            <React.Fragment key={f.key}>
                              {halfFieldLayout.before.has(f.key) && (
                                <EmptyHalfFieldDropSlot
                                  fieldKey={f.key}
                                  fieldName={f.name}
                                  side="left"
                                  active={dragOverTarget?.key === f.key && dragOverTarget.columnPosition === 'left'}
                                />
                              )}
                              <Grid
                                data-field-drop-key={f.key}
                                data-field-drop-width={f.type === 'table' ? 'full' : f.width}
                                size={editing ? 12 : f.type === 'table' ? 12 : f.width === 'half' ? { xs: 12, sm: 6 } : 12}
                                sx={{
                                  opacity: isBeingDragged ? 0.4 : 1,
                                  transform: isBeingDragged ? 'scale(0.98)' : 'none',
                                  transition: 'opacity 0.15s ease, transform 0.15s ease',
                                  position: 'relative',
                                  pointerEvents: isBeingDragged ? 'none' : 'auto',
                                }}
                              >
                                {activeDropTarget && <FieldDropIndicator target={activeDropTarget} />}

                                {editing ? (
                                  renderFieldEditor(f, originalIndex)
                                ) : (
                                  <Box
                                    sx={{
                                      position: 'relative',
                                      '&:hover .field-actions, &:focus-within .field-actions': { opacity: 1 },
                                      p: 2,
                                      border: isBeingDragged
                                        ? '2px dashed #2e7d32'
                                        : activeDropTarget
                                        ? '2px solid #2e7d32'
                                        : '1px solid rgba(46, 125, 50, 0.12)',
                                      borderRadius: 2.5,
                                      bgcolor: isBeingDragged
                                        ? 'rgba(46, 125, 50, 0.04)'
                                        : activeDropTarget
                                        ? 'rgba(46, 125, 50, 0.03)'
                                        : '#ffffff',
                                      transition: 'all 0.15s ease',
                                      '&:hover': {
                                        borderColor: 'primary.main',
                                        boxShadow: '0 4px 12px rgba(46, 125, 50, 0.06)',
                                      },
                                    }}
                                  >
                                    {/* Field Action Overlay */}
                                    <Stack
                                      className="field-actions"
                                      direction="row"
                                      spacing={0.25}
                                      sx={{
                                        position: 'absolute',
                                        top: -12,
                                        right: 8,
                                        bgcolor: '#ffffff',
                                        border: '1px solid rgba(46, 125, 50, 0.18)',
                                        borderRadius: '20px',
                                        px: 0.75,
                                        py: 0.25,
                                        opacity: 1,
                                        zIndex: 10,
                                        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                                      }}
                                    >
                                      <IconButton size="small" color="primary" onClick={() => handleStartEdit(originalIndex)} sx={{ p: 0.4 }} title="Edit">
                                        <EditIcon sx={{ fontSize: 16 }} />
                                      </IconButton>
                                      <IconButton size="small" color="error" onClick={() => handleDeleteFieldDirect(originalIndex)} sx={{ p: 0.4 }} title="Delete">
                                        <DeleteIcon sx={{ fontSize: 16 }} />
                                      </IconButton>
                                      <IconButton
                                        size="small"
                                        onPointerDown={(event) => handlePointerDragStart(event, f.key)}
                                        onKeyDown={(event) => handleKeyboardMove(event, f.key)}
                                        aria-label={`Reorder ${f.name || 'field'}`}
                                        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
                                        sx={{ width: 40, height: 40, cursor: 'grab', touchAction: 'none', userSelect: 'none', '&:active': { cursor: 'grabbing' } }}
                                        title="Drag to reorder"
                                      >
                                        <DragIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                                      </IconButton>
                                    </Stack>

                                    {renderPreviewField(f)}
                                  </Box>
                                )}
                              </Grid>

                              {halfFieldLayout.after.has(f.key) && (
                                <EmptyHalfFieldDropSlot
                                  fieldKey={f.key}
                                  fieldName={f.name}
                                  side="right"
                                  active={dragOverTarget?.key === f.key && dragOverTarget.columnPosition === 'right'}
                                />
                              )}
                            </React.Fragment>
                          );
                        });
                      })()}

                      {/* Add Field, scoped to this section */}
                      <Grid size={12}>
                        <Box
                          onClick={() => handleAddField()}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => { event.preventDefault(); event.stopPropagation(); }}
                          sx={{
                            border: '2px dashed rgba(46, 125, 50, 0.3)',
                            borderRadius: 2.5,
                            p: 1.75,
                            textAlign: 'center',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            '&:hover': { bgcolor: 'rgba(46, 125, 50, 0.04)', borderColor: 'primary.main' },
                          }}
                        >
                          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', justifyContent: 'center' }}>
                            <AddIcon sx={{ fontSize: 18, color: 'primary.main' }} />
                            <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                              Add Field
                            </Typography>
                          </Stack>
                        </Box>
                      </Grid>
                    </Grid>
                  </Box>
                );
              })}

              {/* Add Section — right-aligned to match the rest of the toolbar actions */}
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
              </Box>
            </Box>
          </CardContent>
        </Card>
      </Container>
      <Button
        variant="contained"
        size="large"
        startIcon={isSavingConfiguration ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
        onClick={() => void handleSaveConfiguration()}
        disabled={isSavingConfiguration || !hasConfigurationChanges || hasInvalidDraft}
        sx={{ position: 'fixed', right: { xs: 16, md: 24 }, bottom: { xs: 16, md: 24 }, zIndex: (theme) => theme.zIndex.appBar - 1 }}
      >
        {isSavingConfiguration ? 'Saving...' : configurationSaved ? 'Saved' : 'Save Configuration'}
      </Button>
    </Box>
  );
}
