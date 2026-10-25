'use client';

import { bulkManageDirectoryUsers, getManageUserOptions } from '@/app/actions';
import BulkRecordManager from '@/components/BulkRecordManager';
import { roleLabel } from '@/lib/role-options';

type Props = { archived: boolean; onChanged: () => Promise<void> };

export default function ManageUsers({ archived, onChanged }: Props) {
  const action = archived ? 'delete' : 'archive';
  return <BulkRecordManager noun="Users" action={action} onChanged={onChanged}
    confirmationMessage={archived ? 'Permanently remove these accounts and their sign-in access? Their existing requests and history will be kept. This cannot be undone.' : 'Selected users will lose access until restored.'}
    loadOptions={async () => {
      const result = await getManageUserOptions(archived);
      if (!result.success) return result;
      return { success: true, records: result.records.map(user => ({ id: user.id, label: user.name || user.email, detail: `${user.email} / ${roleLabel(user.role)} / ${user.department}` })) };
    }}
    perform={userIds => bulkManageDirectoryUsers({ userIds, action })} />;
}
