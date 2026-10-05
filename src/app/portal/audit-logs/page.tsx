'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Button, Card, Container, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, InputAdornment, InputLabel, MenuItem,
  Pagination, Select, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import {
  HistoryOutlined as HistoryIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import { describeAudit } from '@/lib/audit-description';
import { getAuditLogs, type AuditLogItem } from '@/app/actions';
import { AuditLogsSkeleton } from '@/components/Skeletons';

const PAGE_SIZE = 6;

const actionLabels: Record<string, string> = {
  created: 'Created', updated: 'Updated', deleted: 'Deleted', archived: 'Archived', restored: 'Restored', status_changed: 'Status changed', stopped: 'Paused', resumed: 'Resumed',
};
const entityLabels: Record<string, string> = {
  capdev: 'CapDev project', request: 'Request', status_update: 'Progress update', user: 'User account', capdev_field: 'CapDev form field', request_field: 'Request form field', status_update_field: 'Progress update form field', system_setting: 'System setting',
};

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }).format(new Date(value));
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
  const [selectedLog, setSelectedLog] = useState<AuditLogItem | null>(null);

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
  const selectedActivity = selectedLog ? describeAudit(selectedLog) : null;
  if (loading && logs.length === 0) return <AuditLogsSkeleton />;

  return (
    <Container maxWidth={false} sx={{ p: 0, width: '100%' }}>
      <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: '-1px', mb: 3 }}>Audit Logs</Typography>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 3 }}>
        <TextField
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name or record"
          aria-label="Search audit logs"
          sx={{ flexGrow: 1, '& .MuiOutlinedInput-root': { bgcolor: '#fafcfa', minHeight: 56 } }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> } }}
        />
        <FormControl sx={{ minWidth: { md: 180 } }}><InputLabel>Action</InputLabel><Select sx={{ bgcolor: '#fafcfa', minHeight: 56 }} label="Action" value={action} onChange={(event) => { setAction(event.target.value); setPage(1); }}><MenuItem value="">All actions</MenuItem>{Object.entries(actionLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</Select></FormControl>
        <FormControl sx={{ minWidth: { md: 180 } }}><InputLabel>Record type</InputLabel><Select sx={{ bgcolor: '#fafcfa', minHeight: 56 }} label="Record type" value={entityType} onChange={(event) => { setEntityType(event.target.value); setPage(1); }}><MenuItem value="">All record types</MenuItem>{Object.entries(entityLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</Select></FormControl>
      </Stack>

      <Card variant="outlined" sx={{ borderRadius: 2, bgcolor: '#fafcfa', overflow: 'hidden' }}>
        <TableContainer tabIndex={0} role="region" aria-label="Audit logs table" sx={{ overflowX: 'auto' }}>
          <Table aria-label="Audit logs" sx={{
            minWidth: 1100,
            tableLayout: 'fixed',
            '& th, & td': { px: 2, py: 1, fontSize: '1rem', lineHeight: 1.5, borderColor: 'divider' },
            '& td': { verticalAlign: 'middle', color: 'text.primary' },
            '& th': { bgcolor: 'background.default', color: 'secondary.main', fontWeight: 700 },
            '& .MuiTableRow-hover:hover': { bgcolor: 'background.default' },
          }}>
            <TableHead>
              <TableRow>
                <TableCell scope="col" sx={{ width: '17%' }}>Date and time</TableCell>
                <TableCell scope="col" sx={{ width: '16%' }}>Performed by</TableCell>
                <TableCell scope="col" sx={{ width: '15%' }}>Record type</TableCell>
                <TableCell scope="col" sx={{ width: '26%' }}>Action</TableCell>
                <TableCell scope="col" sx={{ width: '26%' }}>Details</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {logs.length === 0 ? (
                <TableRow><TableCell colSpan={5}>
                  <Stack spacing={1} sx={{ py: 6, alignItems: 'center' }}><HistoryIcon sx={{ fontSize: 44, color: 'text.disabled' }} /><Typography color="text.secondary" sx={{ fontWeight: 600 }}>No audit logs found</Typography></Stack>
                </TableCell></TableRow>
              ) : logs.map((log) => {
                const activity = describeAudit(log);
                return (
                  <TableRow key={log.id} hover sx={{ '&:last-child td': { borderBottom: 0 } }}>
                    <TableCell><Typography noWrap title={formatDate(log.createdAt)}>{formatDate(log.createdAt)}</Typography></TableCell>
                    <TableCell><Typography noWrap title={log.actorName} sx={{ fontWeight: 700 }}>{log.actorName}</Typography></TableCell>
                    <TableCell><Typography noWrap title={entityLabels[log.entityType] || 'Activity'}>{entityLabels[log.entityType] || 'Activity'}</Typography></TableCell>
                    <TableCell><Typography noWrap title={activity.summary} sx={{ fontWeight: 600 }}>{activity.summary}</Typography></TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Typography noWrap title={activity.lines.join('\n')} sx={{ flex: 1, minWidth: 0, color: 'text.secondary' }}>{activity.lines.join(' · ') || '—'}</Typography>
                        <Button variant="text" onClick={() => setSelectedLog(log)} aria-label={`View audit details: ${activity.summary}`} sx={{ flexShrink: 0 }}>View</Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
      {pageCount > 1 && <Box sx={{ display: 'flex', justifyContent: 'center', pt: 3 }}><Pagination count={pageCount} page={page} onChange={(_, value) => setPage(value)} color="primary" size="large" sx={{ '& .MuiPaginationItem-root': { minWidth: 48, height: 48, fontSize: '1rem' } }} /></Box>}
      <Dialog open={Boolean(selectedLog)} onClose={() => setSelectedLog(null)} maxWidth="sm" fullWidth aria-labelledby="audit-details-title" slotProps={{ paper: { sx: { bgcolor: '#fafcfa', borderRadius: 2 } } }}>
        <DialogTitle id="audit-details-title" sx={{ fontWeight: 700 }}>Audit Details</DialogTitle>
        <DialogContent dividers>
          {selectedLog && selectedActivity && <Stack spacing={2} sx={{ overflowWrap: 'anywhere' }}>
            <Box><Typography sx={{ fontWeight: 700 }}>{selectedLog.actorName}</Typography><Typography color="text.secondary">{formatDate(selectedLog.createdAt)}</Typography></Box>
            <Typography sx={{ fontWeight: 600 }}>{selectedActivity.summary}</Typography>
            {selectedActivity.lines.map((line, index) => <Typography key={index} sx={{ whiteSpace: 'pre-wrap' }}>{line}</Typography>)}
          </Stack>}
        </DialogContent>
        <DialogActions><Button onClick={() => setSelectedLog(null)}>Close</Button></DialogActions>
      </Dialog>
    </Container>
  );
}
