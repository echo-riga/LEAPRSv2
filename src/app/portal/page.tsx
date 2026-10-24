import { Alert } from '@mui/material';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { getPortalContext } from '@/app/actions';
import CapdevPage from './folders/[folderId]/capdev-page';

export default async function PortalPage() {
  await connection();
  const context = await getPortalContext();
  if (!context.success) redirect('/');
  if (context.activeFolder) return <CapdevPage key={context.activeFolder.id} folderId={context.activeFolder.id} />;
  if (context.role === 'admin') return <CapdevPage folderId={0} />;
  return <Alert severity="info">No active CapDev folder is available. Please contact an administrator.</Alert>;
}
