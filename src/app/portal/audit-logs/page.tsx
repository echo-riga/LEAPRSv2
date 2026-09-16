'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Card, Container, FormControl, InputAdornment, InputLabel, MenuItem,
  Pagination, Select, Stack, TextField, Typography,
} from '@mui/material';
import {
  AssignmentOutlined as RequestIcon,
  HistoryOutlined as HistoryIcon,
  PersonOutlined as UserIcon,
  SchoolOutlined as CapdevIcon,
  Search as SearchIcon,
  TuneOutlined as FieldIcon,
  UpdateOutlined as UpdateIcon,
} from '@mui/icons-material';
import { getAuditLogs, type AuditLogItem } from '@/app/actions';
import { AuditLogsSkeleton } from '@/components/Skeletons';

const PAGE_SIZE = 12;

const actionLabels: Record<string, string> = {
  created: 'Created', updated: 'Updated', deleted: 'Deleted', status_changed: 'Status changed', stopped: 'Stopped', resumed: 'Resumed',
};
const entityLabels: Record<string, string> = {
  capdev: 'CapDev', request: 'Request', status_update: 'Status update', user: 'User', capdev_field: 'CapDev field', request_field: 'Request field',
};

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function getDetails(details: unknown): Record<string, unknown> {
  return details && typeof details === 'object' && !Array.isArray(details) ? details as Record<string, unknown> : {};
}

function isInternalId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function recordLabel(log: AuditLogItem, details: Record<string, unknown>) {
  if (log.entityType === 'user') {
    const name = log.entityLabel.trim();
    if (name && !isInternalId(name)) return name;
    if (typeof details.email === 'string' && details.email.trim()) return details.email;
    if (details.source === 'self_registration') return log.actorName;
    return 'user account';
  }
  if (log.entityType === 'capdev') return 'CapDev project';
  if (log.entityType === 'request') return log.entityLabel || 'request';
  if (log.entityType === 'status_update') {
    return typeof details.requestId === 'number' ? `Request #${details.requestId}` : 'a request';
  }
  return log.entityLabel;
}

function activityText(log: AuditLogItem) {
  const details = getDetails(log.details);
  const label = recordLabel(log, details);
  const action = actionLabels[log.action] || log.action;

  if (log.entityType === 'status_update') {
    return `${action === 'Created' ? 'Added' : action} a status update to ${label}`;
  }
  if (log.entityType === 'request' && log.action === 'status_changed') {
    const status = typeof details.status === 'string' ? details.status.replace(/_/g, ' ') : 'updated';
    return `Marked ${label} ${status}`;
  }
  if (log.entityType === 'request' && log.action === 'stopped') return `Stopped progress on ${label}`;
  if (log.entityType === 'request' && log.action === 'resumed') return `Resumed progress on ${label}`;
  if (log.entityType === 'system_setting' && typeof details.enabled === 'boolean') {
    return `${details.enabled ? 'Enabled' : 'Disabled'} maintenance mode`;
  }
  if (log.entityType === 'capdev') return `${action} ${label}`;
  if (log.entityType === 'user') {
    if (details.source === 'role_approval') {
      return `${details.decision === 'accepted' ? 'Approved' : 'Declined'} role request for ${label}`;
    }
    return label === 'user account' ? `${action} a user account` : `${action} user account for ${label}`;
  }
  return `${action} ${label}`;
}

function activityDetail(log: AuditLogItem) {
  const details = getDetails(log.details);
  if (log.entityType === 'capdev') return `AIP code: ${log.entityLabel}`;
  if (log.action === 'stopped' && typeof details.reason === 'string') return `Reason: ${details.reason}`;
  if (log.entityType === 'status_update' && typeof details.statusMark === 'string') {
    return `Status: ${details.statusMark.replace(/_/g, ' ')}`;
  }
  if ((log.entityType === 'request' || log.entityType === 'status_update') && typeof details.capdevAipCode === 'string') {
    return `CapDev AIP code: ${details.capdevAipCode}`;
  }
  return null;
}

function activityIcon(entityType: string) {
  if (entityType === 'capdev') return <CapdevIcon color="primary" />;
  if (entityType === 'request' || entityType === 'status_update') return <RequestIcon color="primary" />;
  if (entityType === 'user') return <UserIcon color="primary" />;
  if (entityType === 'capdev_field' || entityType === 'request_field') return <FieldIcon color="primary" />;
  return <UpdateIcon color="primary" />;
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let active = true;
    void getAuditLogs({ search: debouncedSearch, action, entityType, page, pageSize: PAGE_SIZE })
      .then((result) => {
        if (!active || !result.success) return;
        setLogs(result.logs);
        setTotal(result.total);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [debouncedSearch, action, entityType, page]);

  const pageCount = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);
  if (loading && logs.length === 0) return <AuditLogsSkeleton />;

  return (
    <Container maxWidth={false} sx={{ p: 0, width: '100%' }}>
      <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: '-1px', mb: 3 }}>Audit Logs</Typography>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 3 }}>
        <TextField
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search actor or record"
          aria-label="Search audit logs"
          sx={{ flexGrow: 1 }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> } }}
        />
        <FormControl sx={{ minWidth: { md: 180 } }}><InputLabel>Action</InputLabel><Select label="Action" value={action} onChange={(event) => { setAction(event.target.value); setPage(1); }}><MenuItem value="">All actions</MenuItem>{Object.entries(actionLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</Select></FormControl>
        <FormControl sx={{ minWidth: { md: 180 } }}><InputLabel>Record type</InputLabel><Select label="Record type" value={entityType} onChange={(event) => { setEntityType(event.target.value); setPage(1); }}><MenuItem value="">All record types</MenuItem>{Object.entries(entityLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</Select></FormControl>
      </Stack>

      <Card variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        {logs.length === 0 ? (
          <Stack spacing={1} sx={{ py: 8, px: 3, alignItems: 'center' }}><HistoryIcon sx={{ fontSize: 44, color: 'text.disabled' }} /><Typography color="text.secondary" sx={{ fontWeight: 600 }}>No audit logs found</Typography></Stack>
        ) : logs.map((log) => (
          <Box key={log.id} sx={{ px: { xs: 2, md: 2.5 }, py: 2, borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
              <Box sx={{ width: 40, height: 40, borderRadius: 2, bgcolor: log.action === 'deleted' ? 'rgba(211, 47, 47, 0.1)' : 'rgba(46, 125, 50, 0.08)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                {activityIcon(log.entityType)}
              </Box>
              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', gap: 0.5 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{log.actorName}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>{formatDate(log.createdAt)}</Typography>
                </Stack>
                <Typography sx={{ fontWeight: 600, color: 'text.primary', mt: 0.25, overflowWrap: 'anywhere' }}>{activityText(log)}</Typography>
                {activityDetail(log) && <Typography variant="body2" color="text.secondary" title={activityDetail(log) || undefined} sx={{ mt: 0.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activityDetail(log)}</Typography>}
              </Box>
            </Stack>
          </Box>
        ))}
      </Card>
      {pageCount > 1 && <Box sx={{ display: 'flex', justifyContent: 'center', pt: 3 }}><Pagination count={pageCount} page={page} onChange={(_, value) => setPage(value)} color="primary" /></Box>}
    </Container>
  );
}
