import 'server-only';
import {
  getPortalContext, getCurrentUserAccess, getRootDriveFolderLink,
  getCapdevPage, getCapdevFieldDefinitions, getDepartmentOptions, getCapdevFolders,
  getCapdevById, getRequestPage, getRequestFieldDefinitions,
  getRequestById, getRequestStatusUpdates, getStatusUpdateFieldDefinitions,
  getNotifications, getAnalyticsData, getMonitoringReportData,
  type RequestPageInput,
} from '@/app/actions';

export const portalReaders = {
  context: async (_input: Record<string, never>) => {
    void _input;
    const context = await getPortalContext();
    const access = await getCurrentUserAccess();
    const drive = access.success && access.role === 'admin' ? await getRootDriveFolderLink() : null;
    return { context, access, drive };
  },
  capdev: async (input: Parameters<typeof getCapdevPage>[0] & { configuration: boolean }) => {
    const [page, configuration] = await Promise.all([
      input.folderId ? getCapdevPage(input) : null,
      input.configuration ? Promise.all([getCapdevFieldDefinitions(), getDepartmentOptions(), getCurrentUserAccess()]) : null,
    ]);
    const folders = configuration?.[2].success && configuration[2].role === 'admin' ? await getCapdevFolders() : null;
    return { page, configuration: configuration ? { fields: configuration[0], departments: configuration[1], access: configuration[2], folders } : null };
  },
  requests: async (input: RequestPageInput & { configuration: boolean }) => {
    const [project, page, configuration] = await Promise.all([
      getCapdevById(input.capdevId), getRequestPage(input),
      input.configuration ? Promise.all([getRequestFieldDefinitions('internal'), getRequestFieldDefinitions('external'), getCapdevFieldDefinitions(), getCurrentUserAccess()]) : null,
    ]);
    return { project, page, configuration: configuration ? { internal: configuration[0], external: configuration[1], capdev: configuration[2], access: configuration[3] } : null };
  },
  timeline: async (input: { capdevId: number; requestId: number; configuration: boolean }) => {
    const [request, updates, project, fields] = await Promise.all([
      getRequestById(input.requestId), getRequestStatusUpdates(input.requestId), getCapdevById(input.capdevId),
      input.configuration ? getStatusUpdateFieldDefinitions() : null,
    ]);
    if (!request || request.capdevId !== input.capdevId || !project) throw new Error('Request not found.');
    const access = await getCurrentUserAccess();
    return { request, updates, project, fields, access };
  },
  notifications: async (_input: Record<string, never>) => { void _input; return getNotifications(); },
  analytics: async (input: { dateFrom: string; dateTo: string; snapshotDate: string }) => getAnalyticsData(input),
  reports: async (_input: Record<string, never>) => { void _input; return getMonitoringReportData(); },
};
