'use client';

import { useEffect, useState } from 'react';
import { Button, Dialog, DialogTitle } from '@mui/material';
import { ChevronRight } from '@mui/icons-material';
import GoogleStorageSettings from '@/components/GoogleStorageSettings';

export default function DriveStorageAction() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get('storage');
    if (status && ['connected', 'cancelled', 'connection_failed', 'configuration_error'].includes(status)) {
      void Promise.resolve().then(() => setOpen(true));
    }
  }, []);

  return <>
    <Button variant="text" color="primary" endIcon={<ChevronRight />} onClick={() => setOpen(true)}
      sx={{ p: 0, minWidth: 0, fontWeight: 700, whiteSpace: 'nowrap', '&:hover': { bgcolor: 'transparent', color: 'primary.dark' } }}>
      Change Drive Storage
    </Button>
    <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm" aria-labelledby="drive-storage-title">
      <DialogTitle id="drive-storage-title" sx={{ fontWeight: 800, textAlign: 'center' }}>Drive Storage</DialogTitle>
      {open && <GoogleStorageSettings onClose={() => setOpen(false)} />}
    </Dialog>
  </>;
}
