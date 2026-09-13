'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Card, Chip, Container, FormControl, InputAdornment, InputLabel, MenuItem,
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
import { roleLabel } from '@/lib/role-options';

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

function formatCurrency(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(amount) : null;
}

function requestLabel(details: Record<string, unknown>, fallback: string) {
  return typeof details.requestId === 'number' ? `Request #${details.requestId}` : fallback;
}

function activityText(log: AuditLogItem) {
  const details = getDetails(log.details);
  const label = log.entityLabel;
  const action = actionLabels[log.action] || log.action;

  if (log.entityType === 'status_update') {
    const status = typeof details.statusMark === 'string' ? details.statusMark : null;
    return `${action === 'Created' ? 'Added' : action} ${status ? `a ${status} ` : 'a '}update to ${requestLabel(details, label)}`;
  }
  if (log.entityType === 'request' && log.action === 'status_changed') {
    return `${String(details.status || 'updated').replace(/^./, (letter) => letter.toUpperCase())} ${label}`;
  }
  if (log.entityType === 'request' && log.action === 'stopped') return `Stopped progress on ${label}`;
  if (log.entityType === 'request' && log.action === 'resumed') return `Resumed ${label}`;
  if (log.entityType === 'capdev_field' || log.entityType === 'request_field') {
    return `${action} ${label}`;
  }
  return `${action} ${label}`;
}

function activityMetadata(log: AuditLogItem) {
  const details = getDetails(log.details);
  const metadata: { label: string; color?: 'default' | 'primary' | 'success' | 'warning' | 'error' }[] = [];
  if (typeof details.capdevAipCode === 'string') metadata.push({ label: `AIP Code: ${details.capdevAipCode}`, color: 'primary' });
  if (typeof details.statusMark === 'string') {
    const mark = details.statusMark;
    metadata.push({ label: mark.charAt(0).toUpperCase() + mark.slice(1), color: mark === 'denied' ? 'error' : mark === 'pending' ? 'warning' : 'success' });
  }
  const amount = details.deductedAmount ?? details.requestedBudget ?? details.initialBudget;
  const formattedAmount = formatCurrency(amount);
  if (formattedAmount) metadata.push({ label: details.deductedAmount ? `${formattedAmount} deducted` : formattedAmount, color: 'success' });
  if (typeof details.department === 'string') metadata.push({ label: details.department });
  if (typeof details.role === 'string') metadata.push({ label: roleLabel(details.role) });
  if (typeof details.reason === 'string') metadata.push({ label: `Reason: ${details.reason}` });
  return metadata;
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
                <Typography sx={{ fontWeight: 600, color: 'text.primary', mt: 0.25 }}>{activityText(log)}</Typography>
                {activityMetadata(log).length > 0 && <Stack direction="row" spacing={0.75} sx={{ mt: 1, flexWrap: 'wrap', rowGap: 0.75 }}>{activityMetadata(log).map((item) => <Chip key={item.label} label={item.label} size="small" color={item.color} variant="outlined" sx={{ fontWeight: 600 }} />)}</Stack>}
              </Box>
            </Stack>
          </Box>
        ))}
      </Card>
      {pageCount > 1 && <Box sx={{ display: 'flex', justifyContent: 'center', pt: 3 }}><Pagination count={pageCount} page={page} onChange={(_, value) => setPage(value)} color="primary" /></Box>}
    </Container>
  );
}
