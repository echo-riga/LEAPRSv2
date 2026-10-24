'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@mui/material';
import { getCapdevById, getPortalContext } from '@/app/actions';
import CapdevPage from './folders/[folderId]/capdev-page';
import { ResourceGridSkeleton } from '@/components/Skeletons';

export default function PortalPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [needsFolder, setNeedsFolder] = useState(false);
  useEffect(() => {
    let active = true;
    void getPortalContext().then(async context => {
      if (!active) return;
      if (!context.success) { router.replace('/'); return; }
      // Historical project notifications keep their target after the landing redirect.
      const match = window.location.hash.match(/^#capdev-record-(\d+)$/);
      const project = match ? await getCapdevById(Number(match[1])) : null;
      if (!active) return;
      if (project && project.folderId === context.activeFolder?.id) { router.replace('/portal/folders/' + project.folderId + '#capdev-record-' + project.id); return; }
      if (context.activeFolder) router.replace('/portal/folders/' + context.activeFolder.id);
      else if (context.role === 'admin') setNeedsFolder(true);
      else setError('No active CapDev folder is available. Please contact an administrator.');
    }).catch(() => { if (active) setError('Unable to open the active CapDev folder. Please refresh and try again.'); });
    return () => { active = false; };
  }, [router]);
  if (needsFolder) return <CapdevPage folderId={0} />;
  return error ? <Alert severity="info">{error}</Alert> : <ResourceGridSkeleton titleWidth={240} />;
}
