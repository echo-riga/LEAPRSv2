import { getPortalContext } from '@/app/actions';
import { notFound, redirect } from 'next/navigation';
import CapdevPage from './capdev-page';

export default async function Page({ params }: { params: Promise<{ folderId: string }> }) {
  const { folderId } = await params;
  const id = Number(folderId);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const context = await getPortalContext();
  if (!context.success) redirect('/');
  if (context.activeFolder?.id !== id) redirect('/portal');
  return <CapdevPage key={id} folderId={id} />;
}
