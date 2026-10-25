'use client';

import { bulkManageRequests, getManageRequestOptions } from '@/app/actions';
import BulkRecordManager from '@/components/BulkRecordManager';

type Props = { capdevId: number; archived: boolean; parentArchived: boolean; onChanged: () => Promise<void> };
const formatDate = (value: Date | string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));

export default function ManageRequests({ capdevId, archived, parentArchived, onChanged }: Props) {
  const action = archived || parentArchived ? 'delete' : 'archive';
  return <BulkRecordManager noun="Requests" action={action} onChanged={onChanged}
    confirmationMessage={action === 'delete' ? 'Their progress, notifications, and managed attachments will also be deleted. This cannot be undone.' : 'Selected requests and their history will become read-only.'}
    loadOptions={async () => {
      const result = await getManageRequestOptions(capdevId, archived);
      if (!result.success) return result;
      return { success: true, records: result.records.map(record => ({ id: String(record.id), label: record.requestorName || 'Requestor', detail: `${record.description || 'Untitled request'} / ${record.setting === 'internal' ? 'In-House' : 'External'} / Added ${formatDate(record.createdAt)}` })) };
    }}
    perform={ids => bulkManageRequests({ capdevId, requestIds: ids.map(Number), action })} />;
}
