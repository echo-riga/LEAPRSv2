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
  Tooltip,
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
import DateField from '@/components/DateField';
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
  const [draggedFieldKey, setDraggedFieldKey] = useState<string | null>(null);

  // Inline editing state (replaces the old modal)
  const [editingKeys, setEditingKeys] = useState<Set<string>>(new Set());
  const [backups, setBackups] = useState<Record<string, Field>>({});
  const [optionDrafts, setOptionDrafts] = useState<Record<string, string>>({});
  const tempCounter = useRef(0);

  // Add-section state
  const [extraSections, setExtraSections] = useState<string[]>([]);
  const [sectionOrder, setSectionOrder] = useState<string[]>(['basic', 'supporting']);
  const [draggedSection, setDraggedSection] = useState<string | null>(null);
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [sectionDraft, setSectionDraft] = useState('');
  const [addingSection, setAddingSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');

  // Interactive preview input states
  const [previewData, setPreviewData] = useState<Record<string, string>>({});
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
    void getCurrentUserAccess().then((access) => { if (access.success && access.role !== 'admin') router.replace('/admin'); });
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

  if (session.isPending || loading) {
    return (
      <Box sx={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', bgcolor: '#fafcfa' }}>
        <CircularProgress color="primary" />
      </Box>
    );
  }

  if (!session.data) return null;

  const currentUserId = session.data.user.id;

  // ---- Inline add / edit / cancel / save / delete -------------------------------------------

  const handleAddFieldToSection = (secKey: string) => {
    tempCounter.current += 1;
    const key = `temp-${tempCounter.current}`;
    const newField: Field = {
      key,
      name: '',
      type: 'text',
      options: [],
      isRequired: secKey === 'required',
      section: secKey === 'required' ? 'required' : secKey,
      width: 'full',
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

  const handleSaveField = async (originalIndex: number) => {
    const f = fields[originalIndex];
    if (!f.name.trim()) return;
    setSavingId(f.id ?? f.key);
    try {
      const payload = {
        id: f.isTemp ? undefined : f.id,
        name: f.name,
        type: f.type,
        options: f.options,
        isRequired: f.isRequired,
        section: f.isRequired ? 'required' : f.section,
        width: f.width,
        placeholder: f.placeholder || '',
        sortOrder: f.sortOrder,
        updatedById: currentUserId,
      };

      const result = await saveRequestFieldDefinition(payload);
      if (result.success && result.id) {
        setFields((prev) =>
          prev.map((field, idx) =>
            idx === originalIndex ? { ...field, id: result.id, key: `field-${result.id}`, isTemp: false } : field
          )
        );
        clearEditingState(f.key);
      }
    } catch (error) {
      console.error('Save failed:', error);
    } finally {
      setSavingId(null);
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

  // ---- Drag and drop reordering --------------------------------------------------------------

  const handleDragStart = (e: React.DragEvent, key: string) => {
    if (editingKeys.has(key)) {
      e.preventDefault();
      return;
    }
    e.stopPropagation();
    setDraggedFieldKey(key);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent, targetIndex: number, destinationSection?: string) => {
    e.preventDefault();
    const sourceIndex = draggedFieldKey ? fields.findIndex((field) => field.key === draggedFieldKey) : -1;
    if (sourceIndex === -1 || sourceIndex === targetIndex) {
      setDraggedFieldKey(null);
      return;
    }

    const updated = [...fields];
    const draggedField = updated[sourceIndex];
    const targetField = updated[targetIndex];
    const targetSection = destinationSection || (targetField ? (targetField.isRequired ? 'required' : targetField.section) : null);
    if (!targetSection) {
      setDraggedFieldKey(null);
      return;
    }
    let changed = false;

    if (draggedField.isRequired && targetSection !== 'required') {
      draggedField.isRequired = false;
      draggedField.section = targetSection;
      changed = true;
    } else if (!draggedField.isRequired && targetSection === 'required') {
      draggedField.isRequired = true;
      draggedField.section = 'required';
      changed = true;
    } else if (draggedField.section !== targetSection) {
      draggedField.section = targetSection;
      changed = true;
    }

    updated.splice(sourceIndex, 1);
    updated.splice(targetIndex, 0, draggedField);

    const sorted = updated.map((f, i) => ({ ...f, sortOrder: i + 1 }));
    setFields(sorted);
    setDraggedFieldKey(null);

    // Save ordering
    const idOrder = sorted.map((f) => f.id).filter((id): id is number => typeof id === 'number');
    await updateRequestFieldsOrder(idOrder, currentUserId);

    // Save section change if updated
    if (changed && draggedField.id) {
      const payload = {
        id: draggedField.id,
        name: draggedField.name,
        type: draggedField.type,
        options: draggedField.options,
        isRequired: draggedField.isRequired,
        section: draggedField.section,
        width: draggedField.width,
        placeholder: draggedField.placeholder || '',
        sortOrder: draggedField.sortOrder,
        updatedById: currentUserId,
      };
      await saveRequestFieldDefinition(payload);
    }
  };

  const handleDragEnd = () => {
    setDraggedFieldKey(null);
  };

  const getSectionInsertIndex = (section: string) => {
    let lastIndex = -1;
    fields.forEach((field, index) => {
      if ((field.isRequired ? 'required' : field.section) === section) lastIndex = index;
    });
    return lastIndex + 1 || fields.length;
  };

  // ---- Section helpers ------------------------------------------------------------------------

  const availableSections = Array.from(
    new Set([
      'basic',
      'required',
      'supporting',
      ...fields.map((f) => f.section).filter(Boolean),
      ...extraSections,
    ])
  );

  const getSectionLabel = (sec: string) => {
    if (sec === 'basic') return 'Basic Information';
    if (sec === 'required') return 'Required Information';
    if (sec === 'supporting') return 'Supporting Information';
    return sec;
  };

  const getSectionKey = (val: string | null) => {
    if (!val) return 'basic';
    const clean = val.trim().toLowerCase();
    if (clean === 'required' || clean === 'required information') return 'required';
    if (clean === 'basic' || clean === 'basic information') return 'basic';
    if (clean === 'supporting' || clean === 'supporting information') return 'supporting';
    return val.trim();
  };

  const sectionsToRender = Array.from(
    new Set([
      'required',
      ...fields.map((f) => (f.isRequired ? 'required' : f.section)).filter(Boolean),
      ...extraSections,
    ])
  );

  const sortedSections = sectionsToRender.sort((a, b) => {
    if (a === 'required') return -1;
    if (b === 'required') return 1;
    const indexA = sectionOrder.indexOf(a);
    const indexB = sectionOrder.indexOf(b);
    if (indexA !== -1 && indexB !== -1) return indexA - indexB;
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;
    return a.localeCompare(b);
  });

  const handleConfirmAddSection = () => {
    const trimmed = newSectionName.trim();
    if (!trimmed) {
      setAddingSection(false);
      return;
    }
    const key = getSectionKey(trimmed);
    if (!sectionsToRender.includes(key) && !extraSections.includes(key)) {
      setExtraSections((prev) => [...prev, key]);
      setSectionOrder((prev) => [...prev, key]);
    }
    setNewSectionName('');
    setAddingSection(false);
  };

  const saveSectionFields = async (updatedFields: Field[]) => {
    await Promise.all(updatedFields.filter((field) => field.id).map((field) => saveRequestFieldDefinition({
      id: field.id,
      name: field.name,
      type: field.type,
      options: field.options,
      isRequired: field.isRequired,
      section: field.isRequired ? 'required' : field.section,
      width: field.width,
      placeholder: field.placeholder || '',
      sortOrder: field.sortOrder,
      updatedById: currentUserId,
    })));
  };

  const handleSectionDrop = async (targetSection: string) => {
    if (!draggedSection || draggedSection === targetSection || draggedSection === 'required' || targetSection === 'required') return;
    const movableSections = sortedSections.filter((section) => section !== 'required');
    const sourceIndex = movableSections.indexOf(draggedSection);
    const targetIndex = movableSections.indexOf(targetSection);
    if (sourceIndex === -1 || targetIndex === -1) return;
    movableSections.splice(sourceIndex, 1);
    movableSections.splice(targetIndex, 0, draggedSection);
    setSectionOrder(movableSections);
    setDraggedSection(null);

    const reordered = ['required', ...movableSections].flatMap((section) => fields.filter((field) => (field.isRequired ? 'required' : field.section) === section));
    const normalized = reordered.map((field, index) => ({ ...field, sortOrder: index + 1 }));
    setFields(normalized);
    await updateRequestFieldsOrder(normalized.map((field) => field.id).filter((id): id is number => typeof id === 'number'), currentUserId);
  };

  const handleSaveSection = async (section: string) => {
    const nextSection = getSectionKey(sectionDraft);
    if (!nextSection || nextSection === 'required' || (nextSection !== section && sectionsToRender.includes(nextSection))) return;
    const updated = fields.map((field) => field.section === section && !field.isRequired ? { ...field, section: nextSection } : field);
    setFields(updated);
    setExtraSections((prev) => prev.map((item) => item === section ? nextSection : item));
    setSectionOrder((prev) => prev.map((item) => item === section ? nextSection : item));
    setEditingSection(null);
    await saveSectionFields(updated.filter((field) => field.section === nextSection && !field.isRequired));
  };

  const handleDeleteSection = async (section: string) => {
    if (section === 'required') return;
    const fieldsToDelete = fields.filter((field) => !field.isRequired && field.section === section);
    const deletedKeys = new Set(fieldsToDelete.map((field) => field.key));
    setFields((prev) => prev.filter((field) => !deletedKeys.has(field.key)));
    setEditingKeys((prev) => new Set([...prev].filter((key) => !deletedKeys.has(key))));
    setExtraSections((prev) => prev.filter((item) => item !== section));
    setSectionOrder((prev) => prev.filter((item) => item !== section));
    await Promise.all(fieldsToDelete.filter((field) => field.id).map((field) => deleteRequestFieldDefinition(field.id!, currentUserId)));
  };

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
    const value = previewData[field.name] || '';
    const files = previewFiles[field.name] || [];

    switch (field.type) {
      case 'number':
        return (
          <Stack spacing={0.5}>
            <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
              {field.name} {isRequired && <span style={{ color: 'red' }}>*</span>}
            </Typography>
            <TextField
              type="number"
              fullWidth
              size="small"
              placeholder={field.placeholder || 'Enter number...'}
              value={value}
              onChange={(e) => setPreviewData({ ...previewData, [field.name]: e.target.value })}
              sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#ffffff' } }}
            />
          </Stack>
        );
      case 'date':
        return (
          <Stack spacing={0.5}>
            <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
              {field.name} {isRequired && <span style={{ color: 'red' }}>*</span>}
            </Typography>
            <DateField size="small" value={value} onChange={(nextValue) => setPreviewData({ ...previewData, [field.name]: nextValue })} />
          </Stack>
        );
      case 'file':
        return (
          <Stack spacing={0.5}>
            <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
              {field.name} {isRequired && <span style={{ color: 'red' }}>*</span>}
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
      case 'text':
      default:
        if (field.options && field.options.length > 0) {
          return (
            <Stack spacing={0.5}>
              <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
                {field.name} {isRequired && <span style={{ color: 'red' }}>*</span>}
              </Typography>
              <Autocomplete
                freeSolo
                options={field.options}
                value={value}
                onChange={(_, newValue) => setPreviewData({ ...previewData, [field.name]: newValue || '' })}
                onInputChange={(_, newValue) => setPreviewData({ ...previewData, [field.name]: newValue })}
                renderInput={(params) => <TextField {...params} size="small" placeholder={field.placeholder || 'Select or type...'} sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#ffffff' } }} />}
              />
            </Stack>
          );
        }
        return (
          <Stack spacing={0.5}>
            <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
              {field.name} {isRequired && <span style={{ color: 'red' }}>*</span>}
            </Typography>
            <TextField
              fullWidth
              size="small"
              placeholder={field.placeholder || 'Enter text...'}
              value={value}
              onChange={(e) => setPreviewData({ ...previewData, [field.name]: e.target.value })}
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
          bgcolor: 'rgba(46, 125, 50, 0.03)',
        }}
      >
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Label"
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
                value={f.type}
                label="Type"
                onChange={(e) => handleFieldChange(originalIndex, { type: e.target.value })}
              >
                <MenuItem value="text">Text (Textbox / Combobox)</MenuItem>
                <MenuItem value="number">Number</MenuItem>
                <MenuItem value="date">Date Picker</MenuItem>
                <MenuItem value="file">File Upload (Allows Multiple)</MenuItem>
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
          <Grid size={{ xs: 12, sm: 4 }}>
            <Autocomplete
              freeSolo
              options={availableSections.map(getSectionLabel)}
              value={getSectionLabel(f.isRequired ? 'required' : f.section)}
              onChange={(event, newValue) => {
                const sectionVal = getSectionKey(newValue);
                handleFieldChange(originalIndex, { section: sectionVal, isRequired: sectionVal === 'required' });
              }}
              onInputChange={(event, newInputValue) => {
                const sectionVal = getSectionKey(newInputValue);
                handleFieldChange(originalIndex, { section: sectionVal, isRequired: sectionVal === 'required' });
              }}
              renderInput={(params) => <TextField {...params} label="Section" size="small" />}
            />
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
                      section: checked ? 'required' : f.section === 'required' ? 'basic' : f.section,
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
          <Button
            variant="contained"
            color="primary"
            startIcon={isSaving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
            onClick={() => handleSaveField(originalIndex)}
            disabled={isSaving || !f.name.trim()}
          >
            Save Field
          </Button>
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
        <Typography
          variant="h4"
          sx={{
            fontWeight: '800',
            color: 'text.primary',
            letterSpacing: '-1px',
            mb: 0.5,
          }}
        >
          Request Form Layout
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Configure dynamic fields, custom categories, and drag to sort directly in the form.
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
              {sortedSections.map((secKey) => {
                const sectionFields = fields.filter(
                  (f) => (f.isRequired ? 'required' : f.section) === secKey
                );
                if (sectionFields.length === 0 && secKey !== 'required' && !extraSections.includes(secKey)) {
                  return null;
                }

                return (
                  <Box key={secKey} sx={{ mb: 4.5, opacity: draggedSection === secKey ? 0.45 : 1 }}>
                    <Stack direction="row" spacing={1} draggable={secKey !== 'required' && editingSection !== secKey} onDragStart={(event) => { if (secKey !== 'required') { setDraggedSection(secKey); event.dataTransfer.effectAllowed = 'move'; } }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void handleSectionDrop(secKey); }} onDragEnd={() => setDraggedSection(null)} sx={{ alignItems: 'center', mb: 1.5, borderBottom: '2px solid #2e7d32', pb: 0.75 }}>
                      {editingSection === secKey ? (
                        <TextField size="small" autoFocus value={sectionDraft} onChange={(event) => setSectionDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void handleSaveSection(secKey); if (event.key === 'Escape') setEditingSection(null); }} sx={{ flexGrow: 1 }} />
                      ) : (
                        <Typography variant="subtitle2" sx={{ color: 'primary.dark', fontWeight: 'bold', letterSpacing: '0.1px', flexGrow: 1 }}>
                          {getSectionLabel(secKey)} {secKey === 'required' && '(Fixed & Required Fields)'}
                        </Typography>
                      )}
                      {editingSection === secKey ? <><Button size="small" onClick={() => void handleSaveSection(secKey)}>Save</Button><Button size="small" color="inherit" onClick={() => setEditingSection(null)}>Cancel</Button></> : secKey !== 'required' && <Stack direction="row" spacing={0.25}><Tooltip title="Edit section"><IconButton size="small" color="primary" onClick={() => { setEditingSection(secKey); setSectionDraft(getSectionLabel(secKey)); }}><EditIcon fontSize="small" /></IconButton></Tooltip><Tooltip title="Delete section"><IconButton size="small" color="error" onClick={() => void handleDeleteSection(secKey)}><DeleteIcon fontSize="small" /></IconButton></Tooltip><Tooltip title="Drag to reorder section"><IconButton size="small" color="default" aria-label="Drag to reorder section"><DragIcon fontSize="small" /></IconButton></Tooltip></Stack>}
                    </Stack>
                    <Grid container spacing={{ xs: 2.5, sm: 3 }}>
                      {/* Fixed fields shown inside the Required Section.
                          Placeholder-only (not defaultValue), not read-only, so admins can
                          type into them to test the layout — the placeholder is just a hint
                          of what real data will look like once wired to the AIP record. */}
                      {secKey === 'required' && (
                        <>
                          <Grid size={12}>
                            <Stack spacing={0.5}>
                              <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
                                Setting
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
                                Requested Budget
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
                        </>
                      )}

                      {/* Dynamic fields — clean view, or inline editor when adding/editing */}
                      {sectionFields.map((f) => {
                        const originalIndex = fields.findIndex((field) => field.key === f.key);
                        const editing = editingKeys.has(f.key);
                        return (
                          <Grid
                            size={editing ? 12 : f.width === 'half' ? { xs: 12, sm: 6 } : 12}
                            key={f.key}
                            draggable={!editing}
                            onDragStart={(e) => handleDragStart(e, f.key)}
                            onDragOver={handleDragOver}
                            onDrop={(e) => handleDrop(e, originalIndex)}
                            onDragEnd={handleDragEnd}
                            sx={{
                              opacity: draggedFieldKey === f.key ? 0.3 : 1,
                              transition: 'all 0.2s',
                              position: 'relative',
                            }}
                          >
                            {editing ? (
                              renderFieldEditor(f, originalIndex)
                            ) : (
                              <Box
                                sx={{
                                  position: 'relative',
                                  '&:hover .field-actions': { opacity: 1 },
                                  p: 2,
                                  border: '1px solid rgba(46, 125, 50, 0.08)',
                                  borderRadius: 2.5,
                                  bgcolor: '#ffffff',
                                  transition: 'all 0.2s',
                                  '&:hover': {
                                    borderColor: 'primary.main',
                                    boxShadow: '0 4px 12px rgba(46, 125, 50, 0.03)',
                                  },
                                }}
                              >
                                {/* Field Action Overlay */}
                                <Stack
                                  className="field-actions"
                                  direction="row"
                                  spacing={0.5}
                                  sx={{
                                    position: 'absolute',
                                    top: -12,
                                    right: 8,
                                    bgcolor: '#ffffff',
                                    border: '1px solid rgba(46, 125, 50, 0.18)',
                                    borderRadius: '20px',
                                    px: 1,
                                    py: 0.25,
                                    opacity: 0,
                                    transition: 'opacity 0.2s',
                                    zIndex: 10,
                                    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                                  }}
                                >
                                  <IconButton size="small" color="primary" onClick={() => handleStartEdit(originalIndex)} sx={{ p: 0.5 }}>
                                    <EditIcon sx={{ fontSize: 16 }} />
                                  </IconButton>
                                  <IconButton size="small" color="error" onClick={() => handleDeleteFieldDirect(originalIndex)} sx={{ p: 0.5 }}>
                                    <DeleteIcon sx={{ fontSize: 16 }} />
                                  </IconButton>
                                  <Box sx={{ display: 'flex', alignItems: 'center', cursor: 'grab', pl: 0.5 }}>
                                    <DragIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                                  </Box>
                                </Stack>

                                {renderPreviewField(f)}
                              </Box>
                            )}
                          </Grid>
                        );
                      })}

                      {/* Add Field, scoped to this section */}
                      <Grid size={12}>
                        <Box
                          onClick={() => handleAddFieldToSection(secKey)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => { event.preventDefault(); event.stopPropagation(); void handleDrop(event, getSectionInsertIndex(secKey), secKey); }}
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
                              Add Field to {getSectionLabel(secKey)}
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
                {addingSection ? (
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <TextField
                      size="small"
                      autoFocus
                      placeholder="Section name"
                      value={newSectionName}
                      onChange={(e) => setNewSectionName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleConfirmAddSection();
                        }
                      }}
                    />
                    <Button variant="contained" size="small" onClick={handleConfirmAddSection}>
                      Add
                    </Button>
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => {
                        setAddingSection(false);
                        setNewSectionName('');
                      }}
                    >
                      Cancel
                    </Button>
                  </Stack>
                ) : (
                  <Button
                    variant="outlined"
                    startIcon={<AddIcon />}
                    onClick={() => setAddingSection(true)}
                    sx={{ borderStyle: 'dashed', borderWidth: 2 }}
                  >
                    Add Section
                  </Button>
                )}
              </Box>
            </Box>
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}


