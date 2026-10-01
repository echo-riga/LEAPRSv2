'use client';

import React, { useState } from 'react';
import {
  AttachFile as AttachFileIcon,
  CheckCircle as CheckCircleIcon,
  ChevronRight as ChevronRightIcon,
  Close as CloseIcon,
  RadioButtonUnchecked as UncheckedIcon,
} from '@mui/icons-material';
import {
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';

export type ChecklistAttachment = {
  id: string;
  name: string;
  url: string;
};

type FileFieldChecklistProps = {
  label: string;
  required?: boolean;
  existingFiles: ChecklistAttachment[];
  pendingFiles: File[];
  editable?: boolean;
  onSelectFiles?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveExisting?: (fileId: string) => void;
  onRemovePending?: (file: File) => void;
};

export default function FileFieldChecklist({
  label,
  required = false,
  existingFiles,
  pendingFiles,
  editable = true,
  onSelectFiles,
  onRemoveExisting,
  onRemovePending,
}: FileFieldChecklistProps) {
  const [open, setOpen] = useState(false);
  const fileCount = existingFiles.length + pendingFiles.length;
  const hasFiles = fileCount > 0;

  return (
    <>
      <ButtonBase
        onClick={() => setOpen(true)}
        aria-label={`${label}: ${fileCount} ${fileCount === 1 ? 'file' : 'files'}`}
        sx={{
          width: '100%',
          minHeight: 56,
          justifyContent: 'flex-start',
          textAlign: 'left',
          border: '1px solid',
          borderColor: hasFiles ? 'primary.main' : 'divider',
          borderRadius: 2,
          bgcolor: hasFiles ? 'rgba(46, 125, 50, 0.05)' : '#ffffff',
          px: 1.5,
          py: 1.25,
          transition: 'background-color 0.15s ease, border-color 0.15s ease',
          '&:hover': {
            bgcolor: hasFiles ? 'rgba(46, 125, 50, 0.09)' : 'rgba(46, 125, 50, 0.03)',
            borderColor: 'primary.main',
          },
          '&:focus-visible': {
            outline: '3px solid rgba(46, 125, 50, 0.24)',
            outlineOffset: 2,
          },
        }}
      >
        {hasFiles ? (
          <CheckCircleIcon color="primary" sx={{ mr: 1.5 }} />
        ) : (
          <UncheckedIcon sx={{ mr: 1.5, color: 'text.secondary' }} />
        )}
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700, color: 'text.primary' }}>
            {label}{required && <Box component="span" sx={{ color: 'error.main' }}> *</Box>}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {fileCount === 0 ? 'No files' : `${fileCount} ${fileCount === 1 ? 'file' : 'files'}`}
          </Typography>
        </Box>
        <ChevronRightIcon color="action" />
      </ButtonBase>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 800 }}>{label}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1}>
            {existingFiles.map((file) => (
              <Stack
                key={file.id}
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', border: '1px solid', borderColor: 'divider', borderRadius: 2, px: 1.5, py: 1 }}
              >
                <AttachFileIcon color="primary" />
                <Button
                  component="a"
                  href={file.url}
                  target="_blank"
                  rel="noreferrer"
                  sx={{ justifyContent: 'flex-start', minWidth: 0, flexGrow: 1, px: 0, textTransform: 'none', fontWeight: 700, overflow: 'hidden' }}
                >
                  <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {file.name}
                  </Box>
                </Button>
                {editable && onRemoveExisting && (
                  <IconButton color="error" onClick={() => onRemoveExisting(file.id)} aria-label={`Remove ${file.name}`}>
                    <CloseIcon />
                  </IconButton>
                )}
              </Stack>
            ))}

            {pendingFiles.map((file) => (
              <Stack
                key={`${file.name}-${file.lastModified}-${file.size}`}
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', border: '1px solid', borderColor: 'primary.light', borderRadius: 2, px: 1.5, py: 1, bgcolor: 'rgba(46, 125, 50, 0.04)' }}
              >
                <AttachFileIcon color="primary" />
                <Typography sx={{ flexGrow: 1, minWidth: 0, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {file.name}
                </Typography>
                {editable && onRemovePending && (
                  <IconButton color="error" onClick={() => onRemovePending(file)} aria-label={`Remove ${file.name}`}>
                    <CloseIcon />
                  </IconButton>
                )}
              </Stack>
            ))}

            {!hasFiles && (
              <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                No files uploaded.
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setOpen(false)} color="inherit">Close</Button>
          {editable && onSelectFiles && (
            <Button component="label" variant="contained" startIcon={<AttachFileIcon />}>
              Add Files
              <input hidden type="file" multiple onChange={onSelectFiles} />
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
}
