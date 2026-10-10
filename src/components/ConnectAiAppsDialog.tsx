'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Check, ContentCopy, ChevronRight } from '@mui/icons-material';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Skeleton, Stack, Tab, Tabs, Typography } from '@mui/material';
import { getMcpConnectionInfo } from '@/app/mcp-connection-actions';
import { AI_APP_GUIDES } from '@/lib/ai-app-guides';
import ConnectedAiAppsDialog from '@/components/ConnectedAiAppsDialog';

export default function ConnectAiAppsDialog() {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [serverUrl, setServerUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const guide = AI_APP_GUIDES[provider];
  const step = guide.steps[stepIndex];
  const screenshot = step.screenshot;

  const handleOpen = async () => {
    setOpen(true); setLoading(true); setCopied(false); setError(''); setServerUrl(''); setStepIndex(0);
    try {
      const result = await getMcpConnectionInfo();
      if (result.success) setServerUrl(result.serverUrl);
      else setError(result.error);
    } catch { setError('Unable to load connection details. Try again.'); }
    finally { setLoading(false); }
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(serverUrl);
      setCopied(true); setError('');
    } catch { setError('Copy is unavailable. Select the server URL and copy it manually.'); }
  };

  return (
    <>
      <Button color="inherit" size="small" endIcon={<ChevronRight />} onClick={() => void handleOpen()}
        sx={{ fontWeight: 700, textTransform: 'none', minHeight: 36, px: 1, flexShrink: 0 }}>
        Connect to AI Apps
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="md" aria-labelledby="connect-ai-apps-title">
        <DialogTitle id="connect-ai-apps-title" sx={{ fontWeight: 800 }}>Connect to AI Apps</DialogTitle>
        <DialogContent dividers sx={{ py: 3 }}>
          <Box sx={{ mb: 2 }}><ConnectedAiAppsDialog /></Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Server URL</Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' }, mb: 2 }}>
            <Box sx={{ flex: 1, minWidth: 0, bgcolor: 'background.default', border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
              {loading ? <Skeleton width="90%" /> : <Typography component="code" variant="body2" sx={{ overflowWrap: 'anywhere', userSelect: 'all' }}>{serverUrl || 'Unavailable'}</Typography>}
            </Box>
            <Button variant="outlined" disabled={loading || !serverUrl} startIcon={copied ? <Check /> : <ContentCopy />}
              onClick={() => void copyUrl()} sx={{ minHeight: 44, flexShrink: 0 }}>
              {copied ? 'Copied' : 'Copy URL'}
            </Button>
          </Stack>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Tabs value={provider} onChange={(_, value: number) => { setProvider(value); setStepIndex(0); }} aria-label="AI app setup instructions"
            sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
            {AI_APP_GUIDES.map(item => <Tab key={item.id} label={item.label} id={`ai-guide-tab-${item.id}`}
              aria-controls={`ai-guide-panel-${item.id}`} sx={{ fontWeight: 700 }} />)}
          </Tabs>
          <Box role="tabpanel" id={`ai-guide-panel-${guide.id}`} aria-labelledby={`ai-guide-tab-${guide.id}`}>
            <Box aria-live="polite" aria-atomic="true" sx={{ mb: 2, minHeight: { xs: 120, sm: 72 } }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>Step {stepIndex + 1} of {guide.steps.length}</Typography>
              <Typography sx={{ fontWeight: 700 }}>{step.instruction}</Typography>
            </Box>
            {screenshot && <Box component="a" href={screenshot.src} target="_blank" rel="noopener noreferrer"
              aria-label={`View full screenshot: ${screenshot.alt}`}
              sx={{ display: 'block', mx: 'auto', width: 'min(100%, 500px, 62.5vh)',
                aspectRatio: '5 / 4', borderRadius: 1, overflow: 'hidden',
                '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 4 } }}>
              <Image key={screenshot.src} src={screenshot.src} alt={screenshot.alt} width={screenshot.width} height={screenshot.height}
                sizes="(max-width: 900px) 90vw, 850px"
                style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} />
            </Box>}
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2, gap: 1, flexWrap: 'wrap' }}>
          <Button onClick={() => setOpen(false)} color="inherit" sx={{ mr: 'auto' }}>Close</Button>
          <Button disabled={stepIndex === 0} onClick={() => setStepIndex(index => index - 1)}>Back</Button>
          {stepIndex < guide.steps.length - 1
            ? <Button variant="contained" onClick={() => setStepIndex(index => index + 1)}>Next</Button>
            : <Button variant="contained" onClick={() => setOpen(false)}>Done</Button>}
        </DialogActions>
      </Dialog>
    </>
  );
}
