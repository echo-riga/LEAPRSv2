'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Box, Button, Fab, IconButton, LinearProgress, Paper, Stack, Tooltip, Typography } from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useRouter } from 'next/navigation';
import { finishBackgroundAttachment, prepareBackgroundAttachment, reconcileBackgroundAttachment } from '@/app/actions';
import { BackgroundUploadQueue, type UploadJob } from '@/lib/background-upload-queue';
import { createUploadStorage } from '@/lib/upload-storage';

const UploadContext = createContext<BackgroundUploadQueue | null>(null);
export function useBackgroundUploads() {
  const queue = useContext(UploadContext);
  if (!queue) throw new Error('Upload provider is missing.');
  return queue;
}

export function useAttachmentRefresh(refresh: () => Promise<unknown>) {
  useEffect(() => {
    const listener = () => { void refresh(); };
    window.addEventListener('leaprs-attachments-updated', listener);
    return () => window.removeEventListener('leaprs-attachments-updated', listener);
  }, [refresh]);
}

async function uploadJob(job: UploadJob, progress: (value: number) => void, signal: AbortSignal, checkpoint: () => Promise<void>) {
  const state = await reconcileBackgroundAttachment(job.target, job.uploadId, job.attempts > 1);
  if (!state.success) throw new Error(state.error);
  if (state.state === 'completed') return;
  if (state.state === 'cancelled') { job.status = 'cancelled'; return; }
  if (state.fileId) job.fileId = state.fileId;
  if (!job.fileId) {
    if (!job.sessionUrl) {
      const prepared = await prepareBackgroundAttachment(job.target, job.uploadId);
      if (!prepared.success) throw new Error(prepared.error || 'Unable to prepare upload.');
      job.sessionUrl = prepared.session.uploadUrl;
      await checkpoint();
    }
    if (signal.aborted) throw new Error('Upload interrupted.');
    // Probe the existing resumable session before retrying bytes. A lost final
    // response can still be recovered without creating another Drive file.
    let offset = 0;
    if (job.sessionUrl) {
      const probe = await fetch(job.sessionUrl, { method: 'PUT', headers: { 'Content-Range': `bytes */${job.file.size}` }, signal });
      if (probe.ok) job.fileId = (await probe.json()).id;
      else if (probe.status === 308) {
        const range = probe.headers.get('Range');
        offset = range ? Number(range.split('-')[1]) + 1 : 0;
      } else if ([404, 410].includes(probe.status)) {
        job.sessionUrl = undefined;
        throw new Error('Upload session expired. Retrying with a new session.');
      } else throw new Error('Unable to resume upload.');
    }
    if (!job.fileId) {
      job.fileId = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const abort = () => xhr.abort();
        signal.addEventListener('abort', abort, { once: true });
        const done = () => signal.removeEventListener('abort', abort);
        xhr.open('PUT', job.sessionUrl!);
        xhr.setRequestHeader('Content-Type', job.file.type || 'application/octet-stream');
        if (offset) xhr.setRequestHeader('Content-Range', `bytes ${offset}-${job.file.size - 1}/${job.file.size}`);
        xhr.upload.onprogress = event => { if (event.lengthComputable) progress(Math.min(99, Math.round((offset + event.loaded) / job.file.size * 100))); };
        xhr.timeout = 10 * 60 * 1000;
        xhr.onload = () => {
          done();
          try {
            if (xhr.status < 200 || xhr.status >= 300) throw new Error('Google Drive could not upload this file.');
            const result = JSON.parse(xhr.responseText);
            if (!result.id) throw new Error('Google Drive did not return the uploaded file.');
            resolve(result.id);
          } catch (error) { reject(error); }
        };
        xhr.onerror = xhr.ontimeout = () => { done(); reject(new Error('Upload connection failed.')); };
        xhr.onabort = () => { done(); reject(new Error('Upload interrupted.')); };
        xhr.send(job.file.slice(offset));
      });
    }
    await checkpoint();
  }
  if (signal.aborted) throw new Error('Upload interrupted.');
  const saved = await finishBackgroundAttachment(job.target, job.uploadId, job.fileId!);
  if (!saved.success) throw new Error(saved.error || 'Unable to attach uploaded file.');
  window.dispatchEvent(new Event('leaprs-attachments-updated'));
}

export default function BackgroundUploads({ children, userId }: { children: React.ReactNode; userId: string }) {
  const router = useRouter();
  const [, render] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [queue] = useState(() => new BackgroundUploadQueue(uploadJob, () => render(value => value + 1), undefined, createUploadStorage(userId)));
  const stopTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (queue.unfinished) { event.preventDefault(); event.returnValue = ''; } };
    const refresh = () => router.refresh();
    const signOut = (event: Event) => {
      if (queue.unfinished && !window.confirm('Attachments are still pending. Signing out will interrupt them. Sign out anyway?')) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    window.addEventListener('leaprs-attachments-updated', refresh);
    window.addEventListener('leaprs-before-signout', signOut);
    return () => { window.removeEventListener('beforeunload', warn); window.removeEventListener('leaprs-attachments-updated', refresh); window.removeEventListener('leaprs-before-signout', signOut); };
  }, [queue, router]);
  // Mount the provider for the authenticated account only (keyed in layout).
  useEffect(() => {
    clearTimeout(stopTimer.current);
    queue.start();
    return () => { stopTimer.current = setTimeout(() => queue.stop(), 0); };
  }, [queue]);
  return <UploadContext.Provider value={queue}>
    {children}
    {queue.storageError && !queue.unfinished && <Paper variant="outlined" sx={{ position: 'fixed', bottom: 16, left: 16, zIndex: 1200, p: 2 }}>
      <Typography color="error">{queue.storageError}</Typography><Button onClick={() => queue.start()}>Retry</Button>
    </Paper>}
    {queue.unfinished && hidden && <Tooltip title="Show attachment uploads">
      <Fab size="small" color="primary" aria-label="Show attachment uploads" onClick={() => setHidden(false)}
        sx={{ position: 'fixed', bottom: 16, left: 16, zIndex: 1200 }}>
        <AttachFileIcon />
      </Fab>
    </Tooltip>}
    {queue.unfinished && !hidden && <Paper variant="outlined" role="region" aria-label="Attachment uploads"
      sx={{ position: 'fixed', bottom: 16, left: 16, width: { xs: 'calc(100vw - 32px)', sm: 340 }, maxHeight: '40vh', overflow: 'auto', zIndex: 1200, p: 2, borderRadius: 2 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography sx={{ fontWeight: 700 }}>Attachments</Typography>
        <Tooltip title="Hide uploads">
          <IconButton aria-label="Hide attachment uploads" size="small" onClick={() => setHidden(true)}>
            <ExpandMoreIcon />
          </IconButton>
        </Tooltip>
      </Stack>
      {queue.jobs.map(job => <Box key={job.uploadId} sx={{ mb: 1.5 }}>
        <Typography variant="body2" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{job.file.name}</Typography>
        {job.status === 'uploading' && <LinearProgress variant="determinate" value={job.progress} sx={{ my: 0.5 }} />}
        <Typography variant="body2" color={job.status === 'failed' ? 'error' : 'text.secondary'}>
          {job.status === 'completed' ? 'Uploaded' : job.status === 'cancelled' ? 'Removed' : job.status === 'pending' ? 'Waiting' : job.status === 'failed' ? job.error : `Uploading… ${job.progress}%`}
        </Typography>
        {job.status === 'failed' && <Button onClick={() => queue.retry(job.uploadId)}>Retry</Button>}
      </Box>)}
    </Paper>}
  </UploadContext.Provider>;
}
