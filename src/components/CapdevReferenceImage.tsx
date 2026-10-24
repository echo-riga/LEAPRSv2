'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Tooltip, Typography } from '@mui/material';
import { getCapdevFolderReferenceImage, removeCapdevFolderReferenceImage, saveCapdevFolderReferenceImage } from '@/app/actions';
import type { FolderReferenceImage } from '@/db/schema';
import ActionErrorDialog from '@/components/ActionErrorDialog';
import DeleteConfirmationDialog from '@/components/DeleteConfirmationDialog';
import { validateFolderReferenceImage } from '@/lib/folder-reference-image';

type Props = { folderId: number; isAdmin: boolean };
export default function CapdevReferenceImage({ folderId, isAdmin }: Props) {
  const [image, setImage] = useState<FolderReferenceImage | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [imageFailed, setImageFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const loadSequence = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    try {
      const result = await getCapdevFolderReferenceImage(folderId);
      if (sequence !== loadSequence.current) return;
      if (!result.success) throw new Error(result.error);
      setImage(result.image); setLoadError(''); setImageFailed(false);
    } catch { if (sequence === loadSequence.current) setLoadError('Unable to load the LBP reference file.'); }
  }, [folderId]);
  useEffect(() => { let active = true; void Promise.resolve().then(() => { if (active) return load(); }); return () => { active = false; }; }, [load]);
  const source = '/api/capdev-folders/' + folderId + '/reference-image?v=' + (image?.version || '');
  const upload = async (file: File) => {
    if (inFlight.current) return;
    inFlight.current = true; ++loadSequence.current; setBusy(true); setOpen(true);
    try {
      await validateFolderReferenceImage(file);
      const form = new FormData(); form.set('image', file);
      const result = await saveCapdevFolderReferenceImage(folderId, form);
      if (!result.success) throw new Error(result.error);
      setImage(result.image); setLoadError(''); setImageFailed(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to upload the file.'); }
    finally { inFlight.current = false; setBusy(false); }
  };
  if (!image && !isAdmin && !loadError) return null;
  return <>
    {isAdmin && <input hidden ref={input} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" aria-label="Choose LBP reference file" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }} />}
    <Tooltip title={image || !isAdmin ? 'View LBP reference file' : 'Add LBP reference file'}><IconButton color="primary" aria-label={image || !isAdmin ? 'View LBP reference file' : 'Add LBP reference file'} onClick={() => { setOpen(true); void load(); }} sx={{ width: 40, height: 40, border: '1px solid', borderColor: 'divider', borderRadius: 2, fontSize: '0.75rem', fontWeight: 800 }}>LBP</IconButton></Tooltip>
    <Dialog open={open && !removing && !error} onClose={() => { if (!busy) setOpen(false); }} fullWidth maxWidth="lg">
      <DialogTitle sx={{ fontWeight: 800 }}>LBP reference</DialogTitle>
      <DialogContent dividers sx={{ textAlign: 'center' }}>
        {loadError && <Alert severity="error" sx={{ mb: 2 }}>{loadError}<Button onClick={() => void load()}>Retry</Button></Alert>}
        {busy && <Box sx={{ py: 2 }}><CircularProgress size={24} /><Typography variant="body2">Uploading file...</Typography></Box>}
        {image ? <>{imageFailed ? <Alert severity="error">Unable to display this file.<Button onClick={() => void load()}>Retry</Button></Alert> : image.mimeType === 'application/pdf' ? <Box component="iframe" key={image.version} src={source} title="LBP reference PDF" sx={{ display: 'block', width: '100%', height: '70vh', border: 0 }} /> : <Box component="img" key={image.version} src={source} alt="Physical CapDev list for this folder" onError={() => setImageFailed(true)} sx={{ display: 'block', maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain', mx: 'auto' }} />}<Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, overflowWrap: 'anywhere' }}>{image.name}</Typography></> : !busy && <Typography color="text.secondary" sx={{ py: 5 }}>No LBP reference file added.</Typography>}
        {isAdmin && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>One PDF, JPG, PNG, or WebP file, up to 4 MB.</Typography>}
      </DialogContent>
      <DialogActions sx={{ p: 2.5, flexWrap: 'wrap', gap: 1 }}>
        {image && <Button component="a" href={source} target="_blank" rel="noopener noreferrer">Open full size</Button>}
        {isAdmin && image && <Button color="error" disabled={busy} onClick={() => setRemoving(true)}>Remove</Button>}
        <Button color="inherit" disabled={busy} onClick={() => setOpen(false)}>Close</Button>
        {isAdmin && <Button variant="contained" disabled={busy} onClick={() => input.current?.click()}>{image ? 'Replace file' : 'Add file'}</Button>}
      </DialogActions>
    </Dialog>
    <DeleteConfirmationDialog open={removing} title="Remove LBP reference file?" recordLabel={'Remove "' + (image?.name || '') + '" from this folder?'} confirmLabel="Remove" onClose={() => setRemoving(false)} onConfirm={async () => {
      ++loadSequence.current;
      const result = await removeCapdevFolderReferenceImage(folderId);
      if (!result.success) throw new Error(result.error);
      setImage(null); setImageFailed(false);
    }} />
    <ActionErrorDialog open={Boolean(error)} title="Unable to upload LBP reference file" message={error} onClose={() => setError('')} />
  </>;
}
