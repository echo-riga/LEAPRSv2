'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Assessment as AnalyticsIcon,
  CheckCircleOutlined as CompleteIcon,
  ChevronRight as ChevronRightIcon,
  FilterList as FilterIcon,
  FolderOutlined as ProjectIcon,
  PauseCircleOutlined as StoppedIcon,
  PendingActions as ProgressIcon,
  RequestPage as RequestIcon,
} from '@mui/icons-material';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Card,
  CardActionArea,
  CardContent,
  Checkbox,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Grid,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import { getAnalyticsData } from '@/app/actions';
import { AnalyticsSkeleton } from '@/components/Skeletons';
import { summarizeAnalytics } from '@/lib/analytics-metrics';
import { manilaDate } from '@/lib/manila-date';
import DateField from '@/components/DateField';

type AnalyticsData = Awaited<ReturnType<typeof getAnalyticsData>>;
type AnalyticsFilters = { departments: string[]; capdevIds: number[]; dateFrom: string; dateTo: string; snapshotDate: string };

const currency = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 });
const today = () => manilaDate();
const displayDate = (value: string) => new Date(`${value}T00:00:00+08:00`).toLocaleDateString('en-PH', {
  timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric',
});
const dateRange = (range: 'today' | 'month' | 'year') => {
  const dateTo = today();
  return range === 'today'
    ? { dateFrom: dateTo, dateTo }
    : range === 'month'
    ? { dateFrom: dateTo.slice(0, 7) + '-01', dateTo }
    : { dateFrom: dateTo.slice(0, 4) + '-01-01', dateTo };
};

function buildAuditSeries(
  activity: AnalyticsData['auditActivity'],
  capdevIds: number[],
  dateFrom: string,
  dateTo: string
) {
  const from = dateFrom || activity[0]?.day || today();
  const to = dateTo || today();
  const spanDays = Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));
  const unit = spanDays <= 31 ? 'day' : spanDays <= 730 ? 'month' : 'year';
  const selected = new Set(capdevIds);
  const totals = new Map<string, number>();
  const keyFor = (day: string) => unit === 'day' ? day : unit === 'month' ? day.slice(0, 7) : day.slice(0, 4);

  for (const entry of activity) {
    if (!selected.has(entry.capdevId) || entry.day < from || entry.day > to) continue;
    const key = keyFor(entry.day);
    totals.set(key, (totals.get(key) || 0) + entry.total);
  }

  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const series: { key: string; label: string; value: number }[] = [];
  const cursor = new Date(start);
  if (unit === 'month') cursor.setUTCDate(1);
  if (unit === 'year') cursor.setUTCMonth(0, 1);
  while (cursor <= end) {
    const iso = cursor.toISOString().slice(0, 10);
    const key = keyFor(iso);
    const label = unit === 'day'
      ? cursor.toLocaleDateString('en-PH', { timeZone: 'UTC', month: 'short', day: 'numeric' })
      : unit === 'month'
      ? cursor.toLocaleDateString('en-PH', { timeZone: 'UTC', month: 'short', year: spanDays > 365 ? '2-digit' : undefined })
      : String(cursor.getUTCFullYear());
    series.push({ key, label, value: totals.get(key) || 0 });
    if (unit === 'day') cursor.setUTCDate(cursor.getUTCDate() + 1);
    else if (unit === 'month') cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCFullYear(cursor.getUTCFullYear() + 1);
  }
  return series;
}

function ChartCard({ title, children, onClick }: { title: string; children: React.ReactNode; onClick?: () => void }) {
  const content = (
    <CardContent sx={{ p: { xs: 2.5, md: 3 }, '&:last-child': { pb: { xs: 2.5, md: 3 } } }}>
      <Typography variant="h6" sx={{ fontWeight: 800, mb: 2.5 }}>{title}</Typography>
      {children}
    </CardContent>
  );
  return (
    <Card variant="outlined" sx={{ borderRadius: 2, height: '100%', bgcolor: '#fafcfa' }}>
      {onClick ? <CardActionArea onClick={onClick} sx={{ height: '100%' }}>{content}</CardActionArea> : content}
    </Card>
  );
}

function StatCard({ label, value, icon, onClick }: { label: string; value: React.ReactNode; icon: React.ReactNode; onClick: () => void }) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 2, bgcolor: '#fafcfa', height: '100%' }}>
      <CardActionArea onClick={onClick} sx={{ height: '100%' }}>
        <CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}>
          <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" color="text.secondary">{label}</Typography>
              <Typography variant="h4" sx={{ fontWeight: 800, mt: 0.5, overflowWrap: 'anywhere' }}>{value}</Typography>
            </Box>
            <Box sx={{ display: 'grid', placeItems: 'center', width: 48, height: 48, flexShrink: 0, borderRadius: 2, bgcolor: 'rgba(46, 125, 50, 0.10)', color: 'primary.main' }}>{icon}</Box>
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

type DetailRow = { key: string; title: string; subtitle: string; href: string };

export default function AnalyticsPage() {
  const router = useRouter();
  const [data, setData] = useState<AnalyticsData>({ capdevs: [], requests: [], requestEvents: [], auditActivity: [], auditItems: [] });
  const [loading, setLoading] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [detailsModal, setDetailsModal] = useState<{ title: string; rows: DetailRow[] } | null>(null);
  const [filters, setFilters] = useState<AnalyticsFilters>({
    departments: [],
    capdevIds: [],
    dateFrom: manilaDate().slice(0, 4) + '-01-01',
    dateTo: today(),
    snapshotDate: today(),
  });
  const [draftFilters, setDraftFilters] = useState<AnalyticsFilters>(filters);

  useEffect(() => {
    void getAnalyticsData().then((result) => {
      setData(result);
      const allDepts = Array.from(new Set(result.capdevs.map((c) => c.department))).sort();
      const allCapdevIds = result.capdevs.map((c) => c.id);
      const initial: AnalyticsFilters = {
        departments: allDepts,
        capdevIds: allCapdevIds,
        dateFrom: manilaDate().slice(0, 4) + '-01-01',
        dateTo: today(),
        snapshotDate: today(),
      };
      setFilters(initial);
      setDraftFilters(initial);
      setLoading(false);
    });
  }, []);

  const allDepartments = useMemo(() => Array.from(new Set(data.capdevs.map((capdev) => capdev.department))).sort(), [data.capdevs]);

  // CapDev projects available in the filter modal, dynamically based on checked draft departments
  const availableDraftCapdevs = useMemo(() => {
    return data.capdevs.filter((capdev) => draftFilters.departments.includes(capdev.department));
  }, [data.capdevs, draftFilters.departments]);

  const handleToggleDepartment = (dept: string) => {
    setDraftFilters((current) => {
      const isCurrentlyChecked = current.departments.includes(dept);
      const nextDepartments = isCurrentlyChecked
        ? current.departments.filter((d) => d !== dept)
        : [...current.departments, dept];

      const capdevsOfThisDept = data.capdevs.filter((c) => c.department === dept).map((c) => c.id);
      const nextCapdevIds = isCurrentlyChecked
        ? current.capdevIds.filter((id) => !capdevsOfThisDept.includes(id))
        : Array.from(new Set([...current.capdevIds, ...capdevsOfThisDept]));

      return {
        ...current,
        departments: nextDepartments,
        capdevIds: nextCapdevIds,
      };
    });
  };

  const handleToggleAllDepartments = (selectAll: boolean) => {
    if (selectAll) {
      setDraftFilters((current) => ({
        ...current,
        departments: allDepartments,
        capdevIds: data.capdevs.map((c) => c.id),
      }));
    } else {
      setDraftFilters((current) => ({
        ...current,
        departments: [],
        capdevIds: [],
      }));
    }
  };

  const handleToggleCapdev = (capdevId: number) => {
    setDraftFilters((current) => ({
      ...current,
      capdevIds: current.capdevIds.includes(capdevId)
        ? current.capdevIds.filter((id) => id !== capdevId)
        : [...current.capdevIds, capdevId],
    }));
  };

  const handleToggleAllAvailableCapdevs = (selectAll: boolean) => {
    const availableIds = availableDraftCapdevs.map((c) => c.id);
    setDraftFilters((current) => ({
      ...current,
      capdevIds: selectAll
        ? Array.from(new Set([...current.capdevIds, ...availableIds]))
        : current.capdevIds.filter((id) => !availableIds.includes(id)),
    }));
  };

  const resetFiltersToDefault = () => {
    const allDepts = Array.from(new Set(data.capdevs.map((c) => c.department))).sort();
    const allCapdevIds = data.capdevs.map((c) => c.id);
    setDraftFilters({
      departments: allDepts,
      capdevIds: allCapdevIds,
      dateFrom: manilaDate().slice(0, 4) + '-01-01',
      dateTo: today(),
      snapshotDate: today(),
    });
  };

  const summary = summarizeAnalytics(data, filters);
  const {
    selectedProjects: selectedCapdevs,
    activityProjects: activityCapdevs,
    activityRequests,
    completedRequests,
    completedCount,
    inProgressCount,
    stoppedCount,
    inProgressRequests,
    stoppedRequests,
    incompleteHistoryCount,
    initialBudget,
    utilizedBudget,
    remainingBudget,
    allocations,
    snapshotProjects,
  } = summary;
  const utilization = initialBudget > 0 ? Math.round((utilizedBudget / initialBudget) * 100) : 0;
  const maxAllocation = Math.max(...allocations.map((allocation) => allocation.value), 1);

  const internalCount = activityRequests.filter((request) => request.setting.toLowerCase() === 'internal').length;
  const externalCount = activityRequests.filter((request) => request.setting.toLowerCase() === 'external').length;
  const trainingTotal = internalCount + externalCount;
  const internalPercent = trainingTotal > 0 ? Math.round((internalCount / trainingTotal) * 100) : 0;
  const auditSeries = useMemo(
    () => buildAuditSeries(data.auditActivity, filters.capdevIds, filters.dateFrom, filters.dateTo),
    [data.auditActivity, filters.capdevIds, filters.dateFrom, filters.dateTo]
  );
  const maxAuditActivity = Math.max(...auditSeries.map((item) => item.value), 1);
  const activityLabel = filters.dateFrom === filters.dateTo
    ? displayDate(filters.dateFrom)
    : `${displayDate(filters.dateFrom)} to ${displayDate(filters.dateTo)}`;
  const snapshotLabel = displayDate(filters.snapshotDate);
  const activityDatesInvalid = !draftFilters.dateFrom || !draftFilters.dateTo || draftFilters.dateFrom > draftFilters.dateTo;
  const snapshotDateInvalid = !draftFilters.snapshotDate || draftFilters.snapshotDate > today();

  if (loading) {
    return <AnalyticsSkeleton />;
  }

  const visibleDepartments = filters.departments.slice(0, 2);
  const visibleProjects = selectedCapdevs.slice(0, 2);
  const projectsById = new Map(data.capdevs.map((project) => [project.id, project]));
  const projectRows = (projects: typeof selectedCapdevs): DetailRow[] => projects.map((project) => ({
    key: `project-${project.id}`,
    title: project.aipCode,
    subtitle: project.department || 'No department',
    href: `/portal#capdev-record-${project.id}`,
  }));
  const requestRows = (items: { request: AnalyticsData['requests'][number]; targetEventId?: string }[]): DetailRow[] => items.map(({ request, targetEventId }) => {
    const project = projectsById.get(request.capdevId);
    const hash = targetEventId?.startsWith('timeline-')
      ? `#request-status-update-${targetEventId.slice('timeline-'.length)}`
      : targetEventId?.startsWith('audit-')
      ? '#request-status-resolution'
      : '';
    return {
      key: `request-${request.id}-${targetEventId || 'record'}`,
      title: `Request #${request.id}`,
      subtitle: [
        project?.aipCode,
        request.requestorName,
        request.setting.toLowerCase() === 'internal' ? 'In-House' : 'External',
      ].filter(Boolean).join(' · '),
      href: hash
        ? `/portal/capdev/${request.capdevId}/requests/${request.id}/status${hash}`
        : `/portal/capdev/${request.capdevId}/requests#request-record-${request.id}`,
    };
  });
  const openDetails = (title: string, rows: DetailRow[]) => setDetailsModal({ title, rows });
  const openAuditBucket = (key: string, label: string) => {
    const selectedIds = new Set(filters.capdevIds);
    const rows = data.auditItems.filter((item) =>
      selectedIds.has(item.capdevId) && item.day.startsWith(key) && item.day >= filters.dateFrom && item.day <= filters.dateTo
    ).map<DetailRow>((item) => {
      const details = item.details && typeof item.details === 'object' && !Array.isArray(item.details)
        ? item.details as Record<string, unknown>
        : {};
      const requestId = typeof details.requestId === 'number'
        ? details.requestId
        : item.entityType === 'request' && item.entityId ? Number(item.entityId) : null;
      const updateId = item.entityType === 'status_update' && item.entityId
        ? Number(item.entityId)
        : typeof details.statusUpdateId === 'number'
        ? details.statusUpdateId
        : typeof details.stopperId === 'number'
        ? details.stopperId
        : null;
      let href = `/portal#capdev-record-${item.capdevId}`;
      if (requestId && updateId) href = `/portal/capdev/${item.capdevId}/requests/${requestId}/status#request-status-update-${updateId}`;
      else if (requestId && item.action === 'status_changed') href = `/portal/capdev/${item.capdevId}/requests/${requestId}/status#request-status-resolution`;
      else if (requestId) href = `/portal/capdev/${item.capdevId}/requests#request-record-${requestId}`;
      return {
        key: `audit-${item.id}`,
        title: item.entityLabel,
        subtitle: `${item.action.replaceAll('_', ' ')} · ${item.day}`,
        href,
      };
    });
    openDetails(`Project actions · ${label}`, rows);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 72px)' }}>
      <Container maxWidth={false} sx={{ p: 0, width: '100%' }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', mb: 3 }}
        >
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: '-1px' }}>
              Analytics
            </Typography>
            {visibleDepartments.map((department) => <Chip key={`department-${department}`} label={department} size="small" color="primary" />)}
            {filters.departments.length > visibleDepartments.length && (
              <Chip label={`+${filters.departments.length - visibleDepartments.length} departments`} size="small" color="primary" variant="outlined" />
            )}
            {filters.departments.length === 0 && <Chip label="No departments" size="small" color="warning" variant="outlined" />}
            {visibleProjects.map((project) => <Chip key={`project-${project.id}`} label={project.aipCode} size="small" variant="outlined" />)}
            {selectedCapdevs.length > visibleProjects.length && (
              <Chip label={`+${selectedCapdevs.length - visibleProjects.length} projects`} size="small" variant="outlined" />
            )}
            {filters.departments.length > 0 && selectedCapdevs.length === 0 && <Chip label="No CapDev projects" size="small" color="warning" variant="outlined" />}
          </Stack>
          <Button
            size="small"
            sx={{ height: 40, alignSelf: { xs: 'flex-start', sm: 'auto' } }}
            variant="outlined"
            startIcon={<FilterIcon />}
            onClick={() => {
              setDraftFilters({
                departments: [...filters.departments],
                capdevIds: [...filters.capdevIds],
                dateFrom: filters.dateFrom,
                dateTo: filters.dateTo,
                snapshotDate: filters.snapshotDate,
              });
              setFiltersOpen(true);
            }}
          >
            Filter
          </Button>
        </Stack>

        <Box sx={{ mb: 4 }}>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>Activity during {activityLabel}</Typography>
          <Grid container spacing={2.5} sx={{ mt: 2, mb: 2.5 }}>
            <Grid size={{ xs: 12, sm: 4 }}><StatCard label="CapDev projects added during this period" value={activityCapdevs.length} icon={<ProjectIcon />} onClick={() => openDetails('CapDev projects added', projectRows(activityCapdevs))} /></Grid>
            <Grid size={{ xs: 12, sm: 4 }}><StatCard label="Requests submitted during this period" value={activityRequests.length} icon={<RequestIcon />} onClick={() => openDetails('Requests submitted', requestRows(activityRequests.map((request) => ({ request }))))} /></Grid>
            <Grid size={{ xs: 12, sm: 4 }}><StatCard label="Requests completed during this period" value={completedCount} icon={<CompleteIcon />} onClick={() => openDetails('Requests completed', requestRows(completedRequests))} /></Grid>
          </Grid>

          <Grid container spacing={2.5}>
          <Grid size={{ xs: 12, md: 5 }}>
            <ChartCard title="Request types submitted during this period" onClick={() => openDetails('Requests submitted by type', requestRows(activityRequests.map((request) => ({ request })) ))}>
              <Stack direction="row" spacing={3} sx={{ alignItems: 'center', justifyContent: 'center', py: 1 }}>
                <Box
                  sx={{
                    width: 175,
                    height: 175,
                    borderRadius: '50%',
                    background: trainingTotal
                      ? `conic-gradient(#2e7d32 0 ${internalPercent}%, #8fbf90 ${internalPercent}% 100%)`
                      : '#dfe8df',
                    position: 'relative',
                  }}
                >
                  <Box
                    sx={{
                      position: 'absolute',
                      inset: 34,
                      borderRadius: '50%',
                      bgcolor: '#fafcfa',
                      display: 'grid',
                      placeItems: 'center',
                    }}
                  >
                    <AnalyticsIcon color="primary" />
                  </Box>
                </Box>
                <Stack spacing={1.5}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: 'primary.main' }} />
                    <Box>
                      <Typography variant="body2">In-House</Typography>
                      <Typography sx={{ fontWeight: 800 }}>
                        {internalCount} · {internalPercent}%
                      </Typography>
                    </Box>
                  </Stack>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#8fbf90' }} />
                    <Box>
                      <Typography variant="body2">External</Typography>
                      <Typography sx={{ fontWeight: 800 }}>
                        {externalCount} · {trainingTotal ? 100 - internalPercent : 0}%
                      </Typography>
                    </Box>
                  </Stack>
                </Stack>
              </Stack>
            </ChartCard>
          </Grid>
          <Grid size={{ xs: 12, md: 7 }}>
            <ChartCard title="Project actions during this period">
              <Box sx={{ overflowX: 'auto', pb: 1 }}>
                <Stack direction="row" spacing={1} sx={{ height: 220, alignItems: 'flex-end', minWidth: Math.max(420, auditSeries.length * 48) }}>
                  {auditSeries.map((item) => (
                    <ButtonBase key={item.key} disabled={item.value === 0} onClick={() => openAuditBucket(item.key, item.label)} sx={{ height: '100%', minWidth: 38, flex: 1, alignItems: 'stretch', borderRadius: 1 }}>
                    <Stack spacing={0.75} sx={{ height: '100%', width: '100%', alignItems: 'center', justifyContent: 'flex-end' }}>
                      <Typography variant="caption" sx={{ fontWeight: 700 }}>{item.value}</Typography>
                      <Box sx={{ width: '100%', maxWidth: 34, height: 160, bgcolor: '#e4ece4', borderRadius: '4px 4px 0 0', display: 'flex', alignItems: 'flex-end' }}>
                        <Box sx={{ width: '100%', height: `${(item.value / maxAuditActivity) * 100}%`, minHeight: item.value ? 3 : 0, bgcolor: 'primary.main', borderRadius: '4px 4px 0 0' }} />
                      </Box>
                      <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>{item.label}</Typography>
                    </Stack>
                    </ButtonBase>
                  ))}
                </Stack>
              </Box>
            </ChartCard>
          </Grid>
          </Grid>
        </Box>

        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>Status and balances as of {snapshotLabel}</Typography>
          {incompleteHistoryCount > 0 && <Alert severity="warning" sx={{ mt: 2, mb: 2 }}>{incompleteHistoryCount} concluded request{incompleteHistoryCount === 1 ? '' : 's'} cannot be placed accurately as of this historical date because the completion date is unavailable.</Alert>}
          <Grid container spacing={2.5} sx={{ mt: 2, mb: 2.5 }}>
            <Grid size={{ xs: 12, sm: 6 }}><StatCard label={`Requests in progress as of ${snapshotLabel}`} value={inProgressCount} icon={<ProgressIcon />} onClick={() => openDetails('Requests in progress', requestRows(inProgressRequests))} /></Grid>
            <Grid size={{ xs: 12, sm: 6 }}><StatCard label={`Requests stopped as of ${snapshotLabel}`} value={stoppedCount} icon={<StoppedIcon />} onClick={() => openDetails('Requests stopped', requestRows(stoppedRequests))} /></Grid>
          </Grid>

          <Grid container spacing={2.5}>
            <Grid size={{ xs: 12, lg: 5 }}>
              <ChartCard title={`Balance utilization as of ${snapshotLabel}`} onClick={() => openDetails('CapDev project balances', projectRows(snapshotProjects))}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ alignItems: 'center' }}>
                  <Box sx={{ position: 'relative', display: 'grid', placeItems: 'center', width: 190, height: 190, flexShrink: 0 }}>
                    <Box sx={{ position: 'absolute', inset: 0, borderRadius: '50%', background: `conic-gradient(#2e7d32 ${utilization * 3.6}deg, #dfe8df 0)` }} />
                    <Box sx={{ position: 'relative', width: 142, height: 142, borderRadius: '50%', bgcolor: '#fafcfa', display: 'grid', placeItems: 'center', textAlign: 'center' }}>
                      <Typography variant="h4" sx={{ fontWeight: 800 }}>{utilization}%</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ mt: -0.25 }}>of initial balance</Typography>
                    </Box>
                  </Box>
                  <Stack spacing={1.25} sx={{ flexGrow: 1, minWidth: 0, width: { xs: '100%', md: 'auto' } }}>
                    <Box><Typography variant="body2" color="text.secondary">Initial balance</Typography><Typography sx={{ fontWeight: 800, fontSize: '1.1rem' }}>{currency.format(initialBudget)}</Typography></Box>
                    <Box><Typography variant="body2" color="text.secondary">Utilized</Typography><Typography sx={{ fontWeight: 800, fontSize: '1.1rem', color: 'primary.dark' }}>{currency.format(utilizedBudget)}</Typography></Box>
                    <Box><Typography variant="body2" color="text.secondary">Remaining</Typography><Typography sx={{ fontWeight: 800, fontSize: '1.1rem', color: remainingBudget <= 0 ? 'error.main' : 'inherit' }}>{currency.format(remainingBudget)}</Typography></Box>
                  </Stack>
                </Stack>
              </ChartCard>
            </Grid>
            <Grid size={{ xs: 12, lg: 7 }}>
              <ChartCard title={`Balance allocation by department as of ${snapshotLabel}`}>
                <Stack direction="row" spacing={{ xs: 1, sm: 2 }} sx={{ minHeight: 250, alignItems: 'flex-end', overflowX: 'auto', pt: 1 }}>
                  {allocations.map((allocation) => (
                    <ButtonBase key={allocation.name} onClick={() => openDetails(`${allocation.name} CapDev projects`, projectRows(snapshotProjects.filter((project) => project.department === allocation.name)))} sx={{ minWidth: 88, height: 240, flex: 1, alignItems: 'stretch', borderRadius: 1 }}>
                    <Stack spacing={1} sx={{ alignItems: 'center', justifyContent: 'flex-end', width: '100%', height: '100%' }}>
                      <Typography variant="caption" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{currency.format(allocation.value)}</Typography>
                      <Box sx={{ height: 170, width: '100%', maxWidth: 58, display: 'flex', alignItems: 'flex-end', bgcolor: '#e4ece4', borderRadius: '6px 6px 0 0' }}>
                        <Box sx={{ width: '100%', height: `${(allocation.value / maxAllocation) * 100}%`, bgcolor: 'primary.main', borderRadius: '6px 6px 0 0' }} />
                      </Box>
                      <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 92, textAlign: 'center', lineHeight: 1.15 }}>{allocation.name}</Typography>
                    </Stack>
                    </ButtonBase>
                  ))}
                  {allocations.length === 0 && <Typography color="text.secondary" sx={{ m: 'auto' }}>No balance allocation as of this date.</Typography>}
                </Stack>
              </ChartCard>
            </Grid>
          </Grid>
        </Box>
      </Container>

      <Dialog open={Boolean(detailsModal)} onClose={() => setDetailsModal(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>{detailsModal?.title}</DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          {detailsModal?.rows.length ? detailsModal.rows.map((row) => (
            <ListItemButton
              key={row.key}
              divider
              onClick={() => {
                setDetailsModal(null);
                router.push(row.href);
              }}
              sx={{ px: 3, py: 1.5 }}
            >
              <ListItemText primary={row.title} secondary={row.subtitle} slotProps={{ primary: { sx: { fontWeight: 700 } } }} />
              <ChevronRightIcon color="action" />
            </ListItemButton>
          )) : (
            <Typography color="text.secondary" sx={{ p: 3 }}>No records found.</Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}><Button onClick={() => setDetailsModal(null)}>Close</Button></DialogActions>
      </Dialog>

      {/* Filter Dialog */}
      <Dialog open={filtersOpen} onClose={() => setFiltersOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>Filter Analytics</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5}>
            {/* Departments Filter */}
            <Box>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  Departments
                </Typography>
                <Stack direction="row" spacing={1}>
                  <Button size="small" onClick={() => handleToggleAllDepartments(true)} sx={{ p: 0, minWidth: 0 }}>
                    Select all
                  </Button>
                  <Button size="small" onClick={() => handleToggleAllDepartments(false)} sx={{ p: 0, minWidth: 0, color: 'text.secondary' }}>
                    Clear
                  </Button>
                </Stack>
              </Stack>
              <Box sx={{ maxHeight: 150, overflowY: 'auto', pr: 1 }}>
                {allDepartments.map((department) => (
                  <FormControlLabel
                    key={department}
                    control={
                      <Checkbox
                        checked={draftFilters.departments.includes(department)}
                        onChange={() => handleToggleDepartment(department)}
                      />
                    }
                    label={department}
                    sx={{ display: 'flex', width: 'fit-content' }}
                  />
                ))}
                {allDepartments.length === 0 && (
                  <Typography variant="caption" color="text.secondary">
                    No departments available.
                  </Typography>
                )}
              </Box>
            </Box>

            <Divider />

            {/* CapDev Projects Filter - dynamically shows CapDevs belonging to checked departments */}
            <Box>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    CapDev Projects
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {availableDraftCapdevs.length} project{availableDraftCapdevs.length === 1 ? '' : 's'} available
                  </Typography>
                </Box>
                {availableDraftCapdevs.length > 0 && (
                  <Stack direction="row" spacing={1}>
                    <Button size="small" onClick={() => handleToggleAllAvailableCapdevs(true)} sx={{ p: 0, minWidth: 0 }}>
                      Select all
                    </Button>
                    <Button size="small" onClick={() => handleToggleAllAvailableCapdevs(false)} sx={{ p: 0, minWidth: 0, color: 'text.secondary' }}>
                      Clear
                    </Button>
                  </Stack>
                )}
              </Stack>
              <Box sx={{ maxHeight: 180, overflowY: 'auto', pr: 1 }}>
                {availableDraftCapdevs.map((capdev) => (
                  <FormControlLabel
                    key={capdev.id}
                    control={
                      <Checkbox
                        checked={draftFilters.capdevIds.includes(capdev.id)}
                        onChange={() => handleToggleCapdev(capdev.id)}
                      />
                    }
                    label={
                      <Stack>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                          {capdev.aipCode}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {capdev.department}
                        </Typography>
                      </Stack>
                    }
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      mb: 0.5,
                      p: 0.5,
                      borderRadius: 1,
                      bgcolor: draftFilters.capdevIds.includes(capdev.id) ? 'rgba(46, 125, 50, 0.04)' : 'transparent',
                    }}
                  />
                ))}
                {availableDraftCapdevs.length === 0 && (
                  <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                    {draftFilters.departments.length === 0
                      ? 'Select at least one department to view and filter CapDev projects.'
                      : 'No CapDev projects found for the selected departments.'}
                  </Typography>
                )}
              </Box>
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>Activity dates</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Show projects added, requests submitted or completed, deductions, and recorded actions that happened between these dates.</Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <DateField
                  label="Activity from"
                  value={draftFilters.dateFrom}
                  onChange={(val) => setDraftFilters((curr) => ({ ...curr, dateFrom: val }))}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <DateField
                  label="Activity to"
                  value={draftFilters.dateTo}
                  onChange={(val) => setDraftFilters((curr) => ({ ...curr, dateTo: val }))}
                />
              </Grid>
            </Grid>

            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1, mt: 1 }}>
              {(['today', 'month', 'year'] as const).map((range) => (
                <Button key={range} size="small" onClick={() => setDraftFilters((current) => ({ ...current, ...dateRange(range) }))}>
                  {range === 'today' ? 'Today' : range === 'month' ? 'This month' : 'This year'}
                </Button>
              ))}
            </Stack>
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>Status and balance date</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Show which requests were active or stopped and how much funding was available at the end of this date.</Typography>
              <DateField
                label="Show status and balances as of"
                value={draftFilters.snapshotDate}
                onChange={(val) => setDraftFilters((current) => ({ ...current, snapshotDate: val }))}
              />
              <Button size="small" sx={{ mt: 1 }} onClick={() => setDraftFilters((current) => ({ ...current, snapshotDate: today() }))}>Today</Button>
            </Box>

            {activityDatesInvalid && <Alert severity="error">Choose an Activity From date that is on or before the Activity To date.</Alert>}
            {snapshotDateInvalid && <Alert severity="error">Choose a status and balance date that is today or earlier.</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2.5 }}>
          <Button onClick={resetFiltersToDefault}>Reset</Button>
          <Button
            variant="contained"
            disabled={activityDatesInvalid || snapshotDateInvalid}
            onClick={() => {
              setFilters({
                departments: [...draftFilters.departments],
                capdevIds: [...draftFilters.capdevIds],
                dateFrom: draftFilters.dateFrom,
                dateTo: draftFilters.dateTo,
                snapshotDate: draftFilters.snapshotDate,
              });
              setFiltersOpen(false);
            }}
          >
            Apply Filters
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
