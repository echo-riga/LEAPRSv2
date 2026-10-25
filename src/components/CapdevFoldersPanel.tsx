'use client';

import { useRef, useState } from 'react';
import { Add, Check, Close, DeleteOutlined, EditOutlined, FolderCopyOutlined } from '@mui/icons-material';
import { Alert, Box, Button, ButtonBase, CircularProgress, Divider, IconButton, Popover, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { deleteCapdevFolder, getCapdevFolders, markCapdevFolderActive, saveCapdevFolder } from '@/app/actions';
import ActionErrorDialog from '@/components/ActionErrorDialog';
import DeleteConfirmationDialog from '@/components/DeleteConfirmationDialog';

export type CapdevFolderOption = { id: number; name: string; isActive: boolean; projectCount: number };
type Props = {
  onSelected: (folder: CapdevFolderOption) => void;
  onChanged: (folders: CapdevFolderOption[]) => void;
};

export default function CapdevFoldersPanel({ onSelected, onChanged }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [folders, setFolders] = useState<CapdevFolderOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: number | null; name: string } | null>(null);
  const [deleting, setDeleting] = useState<CapdevFolderOption | null>(null);
  const inFlight = useRef(false);

  const refresh = async () => {
    const result = await getCapdevFolders();
    if (!result.success) throw new Error(result.error || 'Unable to load folders.');
    setFolders(result.folders);
    onChanged(result.folders);
    return result.folders;
  };
  const load = async () => {
    setLoading(true); setLoadError('');
    try { await refresh(); }
    catch (cause) { setLoadError(cause instanceof Error ? cause.message : 'Unable to load folders.'); }
    finally { setLoading(false); }
  };
  const select = async (folder: CapdevFolderOption) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      if (!folder.isActive) {
        const result = await markCapdevFolderActive(folder.id);
        if (!result.success) throw new Error(result.error || 'Unable to select folder.');
      }
      const next = folders.map(item => ({ ...item, isActive: item.id === folder.id }));
      setFolders(next); onChanged(next); setEditing(null); setAnchor(null);
      onSelected({ ...folder, isActive: true });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to select folder.'); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const save = async () => {
    if (!editing?.name.trim() || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const result = await saveCapdevFolder(editing.name, editing.id ?? undefined);
      if (!result.success) throw new Error(result.error || 'Unable to save folder.');
      setEditing(null);
      const next = await refresh();
      // The first folder is selected automatically when no folders existed.
      if (editing.id === null && result.folder?.isActive) {
        const created = next.find(folder => folder.id === result.folder.id);
        if (created) { setAnchor(null); onSelected(created); }
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save folder.'); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const editor = (label: string) => <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', width: '100%', minWidth: 0 }}>
    <TextField autoFocus fullWidth size="small" label={label} value={editing?.name || ''} disabled={busy} slotProps={{ htmlInput: { maxLength: 255 } }} onChange={event => setEditing(current => current ? { ...current, name: event.target.value } : null)} onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); void save(); }
      if (event.key === 'Escape') { event.stopPropagation(); if (!busy) setEditing(null); }
    }} />
    <Tooltip title="Save"><span><IconButton size="small" color="primary" aria-label="Save folder name" disabled={busy || !editing?.name.trim()} onClick={() => void save()}><Check /></IconButton></span></Tooltip>
    <Tooltip title="Cancel"><span><IconButton size="small" aria-label="Cancel folder name" disabled={busy} onClick={() => setEditing(null)}><Close /></IconButton></span></Tooltip>
  </Stack>;

  return <>
    <Tooltip title="CapDev folders"><IconButton color="primary" aria-label="CapDev folders" aria-haspopup="dialog" aria-expanded={Boolean(anchor)} aria-controls={anchor ? 'capdev-folders-panel' : undefined} onClick={event => { setAnchor(event.currentTarget); setEditing(null); void load(); }} sx={{ width: 40, height: 40, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}><FolderCopyOutlined /></IconButton></Tooltip>
    <Popover open={Boolean(anchor) && !deleting && !error} anchorEl={anchor} onClose={() => { if (!busy) { setAnchor(null); setEditing(null); } }} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }} slotProps={{ paper: { id: 'capdev-folders-panel', role: 'dialog', 'aria-label': 'CapDev folders', sx: { width: { xs: 'calc(100vw - 32px)', sm: 400 }, maxHeight: 'calc(100dvh - 120px)', borderRadius: 2.5, overflow: 'hidden', mt: 1, boxShadow: '0 12px 36px rgba(0,0,0,0.18)' } } }}>
      <Stack direction="row" sx={{ px: 2, py: 1.25, bgcolor: 'primary.dark', color: 'primary.contrastText', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography sx={{ fontWeight: 800 }}>CapDev folders</Typography>
        <Stack direction="row" spacing={0.5}><Tooltip title="Add folder"><span><IconButton size="small" aria-label="Add folder" disabled={busy || loading} onClick={() => setEditing({ id: null, name: '' })} sx={{ color: 'inherit' }}><Add /></IconButton></span></Tooltip><IconButton size="small" aria-label="Close folders" disabled={busy} onClick={() => { setAnchor(null); setEditing(null); }} sx={{ color: 'inherit' }}><Close /></IconButton></Stack>
      </Stack>
      <Box sx={{ p: 1.5, overflowY: 'auto', maxHeight: 'calc(100dvh - 190px)', bgcolor: 'background.default' }}>
        {editing?.id === null && <Box sx={{ p: 1, mb: 1 }}>{editor('New folder name')}</Box>}
        {loading ? <Box sx={{ p: 3, textAlign: 'center' }}><CircularProgress size={24} aria-label="Loading folders" /></Box> : loadError ? <Alert severity="error">{loadError}<Button size="small" onClick={() => void load()}>Retry</Button></Alert> : <Stack spacing={1} role="list" aria-label="Folder selection">
          {folders.map(folder => <Stack key={folder.id} role="listitem" direction="row" spacing={0.5} sx={{ p: 1, minHeight: 54, alignItems: 'center', border: '1px solid', borderColor: folder.isActive ? 'primary.main' : 'divider', borderRadius: 1.5, bgcolor: folder.isActive ? 'rgba(46,125,50,0.09)' : 'background.paper' }}>
            {editing?.id === folder.id ? editor('Folder name') : <>
              <ButtonBase disabled={busy} aria-pressed={folder.isActive} onClick={() => void select(folder)} sx={{ flex: 1, minWidth: 0, alignSelf: 'stretch', justifyContent: 'flex-start', gap: 1, textAlign: 'left', borderRadius: 1, px: 0.5, '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main' } }}>
                <Typography sx={{ fontWeight: folder.isActive ? 800 : 600, overflowWrap: 'anywhere', flex: 1 }}>{folder.name}</Typography>{folder.isActive && <Check color="primary" fontSize="small" />}
              </ButtonBase>
              <Tooltip title="Rename"><span><IconButton size="small" color="primary" disabled={busy} aria-label={'Rename ' + folder.name} onClick={() => setEditing({ id: folder.id, name: folder.name })}><EditOutlined fontSize="small" /></IconButton></span></Tooltip>
              <Tooltip title={folder.isActive ? 'Select another folder before deleting' : 'Delete'}><span><IconButton size="small" color="error" disabled={busy || folder.isActive} aria-label={'Delete ' + folder.name} onClick={() => setDeleting(folder)}><DeleteOutlined fontSize="small" /></IconButton></span></Tooltip>
            </>}
          </Stack>)}
          {!folders.length && <Typography color="text.secondary" sx={{ p: 2 }}>No folders yet.</Typography>}
        </Stack>}
      </Box>
      {busy && <><Divider /><Typography variant="caption" sx={{ display: 'block', px: 2, py: 1 }}>Saving...</Typography></>}
    </Popover>
    <DeleteConfirmationDialog open={Boolean(deleting)} title="Delete folder permanently?" recordLabel={'Permanently delete "' + (deleting?.name || '') + '" and all its active and archived CapDev, requests, progress, notifications, and managed attachments? This cannot be undone.'} onClose={() => setDeleting(null)} onConfirm={async () => {
      if (!deleting) return;
      const result = await deleteCapdevFolder(deleting.id);
      if (!result.success) throw new Error(result.error || 'Unable to delete folder.');
      await refresh();
    }} />
    <ActionErrorDialog open={Boolean(error)} title="Unable to update folders" message={error} onClose={() => setError('')} />
  </>;
}
