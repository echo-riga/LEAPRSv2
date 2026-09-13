import RequestsPage from './requests-page';

export default async function Page({ params }: { params: Promise<{ capdevId: string }> }) {
  const { capdevId } = await params;
  return <RequestsPage capdevId={Number(capdevId)} />;
}
