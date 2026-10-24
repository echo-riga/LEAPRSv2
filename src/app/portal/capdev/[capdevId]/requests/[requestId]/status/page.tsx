import StatusTimelinePage from './status-timeline-page';

export default async function Page({ params }: { params: Promise<{ capdevId: string; requestId: string }> }) {
  const { capdevId, requestId } = await params;
  return <StatusTimelinePage key={requestId} capdevId={Number(capdevId)} requestId={Number(requestId)} />;
}
