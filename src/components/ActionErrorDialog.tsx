'use client';

import { ErrorOutlineOutlined as ErrorIcon } from '@mui/icons-material';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';

type ActionErrorDialogProps = {
  open: boolean;
  title: string;
  message: string;
  onClose: () => void;
};

export default function ActionErrorDialog({ open, title, message, onClose }: ActionErrorDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 800 }}>
        <ErrorIcon color="error" />
        {title}
      </DialogTitle>
      <DialogContent dividers>
        <Stack sx={{ py: 1 }}>
          <Typography color="text.primary">{message}</Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button variant="contained" onClick={onClose}>Understood</Button>
      </DialogActions>
    </Dialog>
  );
}
