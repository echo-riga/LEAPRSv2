'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Assessment as AnalyticsIcon, CheckCircleOutlined as CompleteIcon, FilterList as FilterIcon, PendingActions as ProgressIcon, RequestPage as RequestIcon, TrendingUp as TrendIcon } from '@mui/icons-material';
import { Box, Button, Card, CardContent, Checkbox, CircularProgress, Container, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Grid, Stack, TextField, Typography } from '@mui/material';
import { getAnalyticsData } from '@/app/actions';

type AnalyticsData = Awaited<ReturnType<typeof getAnalyticsData>>;
type AnalyticsFilters = { departments: string[]; dateFrom: string; dateTo: string };

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const auditActivity = [28, 42, 36, 58, 49, 72, 65, 88, 78, 96, 86, 112];
const currency = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 });
const today = () => new Date().toISOString().slice(0, 10);
const yearFilters = (): AnalyticsFilters => ({ departments: [], dateFrom: `${new Date().getFullYear()}-01-01`, dateTo: today() });
const dateRange = (range: 'today' | 'month' | 'year') => {
  const now = new Date(); const dateTo = today();
  return range === 'today' ? { dateFrom: dateTo, dateTo } : range === 'month' ? { dateFrom: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, dateTo } : { dateFrom: `${now.getFullYear()}-01-01`, dateTo };
};

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card variant="outlined" sx={{ borderRadius: 2, height: '100%', bgcolor: '#fafcfa' }}><CardContent sx={{ p: { xs: 2.5, md: 3 }, '&:last-child': { pb: { xs: 2.5, md: 3 } } }}><Typography variant="h6" sx={{ fontWeight: 800, mb: 2.5 }}>{title}</Typography>{children}</CardContent></Card>;
}

export default function AnalyticsPage() {
  const defaultFilters = yearFilters();
  const [data, setData] = useState<AnalyticsData>({ capdevs: [], requests: [], statusUpdates: [] });
  const [loading, setLoading] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<AnalyticsFilters>(defaultFilters);
  const [draftFilters, setDraftFilters] = useState<AnalyticsFilters>(defaultFilters);

  useEffect(() => { void getAnalyticsData().then((result) => { setData(result); setLoading(false); }); }, []);

  const departments = useMemo(() => Array.from(new Set(data.capdevs.map((capdev) => capdev.department))).sort(), [data.capdevs]);
  const filteredCapdevs = useMemo(() => data.capdevs.filter((capdev) => {
    const createdAt = new Date(capdev.createdAt).getTime();
    return (filters.departments.length === 0 || filters.departments.includes(capdev.department)) && (!filters.dateFrom || createdAt >= new Date(filters.dateFrom).getTime()) && (!filters.dateTo || createdAt <= new Date(`${filters.dateTo}T23:59:59`).getTime());
  }), [data.capdevs, filters]);
  const filteredCapdevIds = useMemo(() => new Set(filteredCapdevs.map((capdev) => capdev.id)), [filteredCapdevs]);
  const filteredRequests = useMemo(() => data.requests.filter((request) => {
    const createdAt = new Date(request.createdAt).getTime();
    return filteredCapdevIds.has(request.capdevId) && (!filters.dateFrom || createdAt >= new Date(filters.dateFrom).getTime()) && (!filters.dateTo || createdAt <= new Date(`${filters.dateTo}T23:59:59`).getTime());
  }), [data.requests, filteredCapdevIds, filters.dateFrom, filters.dateTo]);
  const completedIds = useMemo(() => new Set(data.statusUpdates.filter((update) => update.markAsComplete).map((update) => update.requestId)), [data.statusUpdates]);
  const completedCount = filteredRequests.filter((request) => completedIds.has(request.id)).length;
  const initialBudget = filteredCapdevs.reduce((total, capdev) => total + Number(capdev.initialBudget), 0);
  const remainingBudget = filteredCapdevs.reduce((total, capdev) => total + Number(capdev.budget), 0);
  const utilizedBudget = initialBudget - remainingBudget;
  const utilization = initialBudget > 0 ? Math.round((utilizedBudget / initialBudget) * 100) : 0;
  const allocations = useMemo(() => Object.values(filteredCapdevs.reduce<Record<string, { name: string; value: number }>>((totals, capdev) => {
    totals[capdev.department] = totals[capdev.department] || { name: capdev.department, value: 0 }; totals[capdev.department].value += Number(capdev.initialBudget); return totals;
  }, {})).sort((a, b) => b.value - a.value), [filteredCapdevs]);
  const maxAllocation = Math.max(...allocations.map((allocation) => allocation.value), 1);
  const internalCount = filteredRequests.filter((request) => request.setting.toLowerCase() === 'internal').length;
  const externalCount = filteredRequests.filter((request) => request.setting.toLowerCase() === 'external').length;
  const trainingTotal = internalCount + externalCount;
  const internalPercent = trainingTotal > 0 ? Math.round((internalCount / trainingTotal) * 100) : 0;
  const activityPoints = useMemo(() => auditActivity.map((value, index) => `${(index / (auditActivity.length - 1)) * 100},${100 - ((value - 20) / 100) * 82}`).join(' '), []);

  if (loading) return <Box sx={{ display: 'grid', minHeight: 'calc(100vh - 72px)', placeItems: 'center' }}><CircularProgress color="primary" /></Box>;

  return <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 72px)' }}><Container maxWidth={false} sx={{ p: 0, width: '100%' }}>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', mb: 3 }}><Box><Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: '-1px' }}>Analytics</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Overview for {filters.departments.length === 0 ? 'All departments' : filters.departments.join(', ')}</Typography></Box><Button size="small" sx={{ height: 40, alignSelf: { xs: 'flex-start', sm: 'auto' } }} variant="outlined" startIcon={<FilterIcon />} onClick={() => { setDraftFilters({ ...filters, departments: [...filters.departments] }); setFiltersOpen(true); }}>Filter</Button></Stack>

    <Grid container spacing={2.5} sx={{ mb: 2.5 }}>{[{ label: 'Total requests', value: filteredRequests.length, icon: <RequestIcon /> }, { label: 'In progress', value: filteredRequests.length - completedCount, icon: <ProgressIcon /> }, { label: 'Completed', value: completedCount, icon: <CompleteIcon /> }].map((stat) => <Grid key={stat.label} size={{ xs: 12, sm: 4 }}><Card variant="outlined" sx={{ borderRadius: 2, bgcolor: '#fafcfa', height: '100%' }}><CardContent sx={{ p: 3, '&:last-child': { pb: 3 } }}><Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}><Box><Typography variant="body2" color="text.secondary">{stat.label}</Typography><Typography variant="h3" sx={{ fontWeight: 800, mt: 0.5 }}>{stat.value}</Typography></Box><Box sx={{ display: 'grid', placeItems: 'center', width: 48, height: 48, borderRadius: 2, bgcolor: 'rgba(46, 125, 50, 0.10)', color: 'primary.main' }}>{stat.icon}</Box></Stack></CardContent></Card></Grid>)}</Grid>

    <Grid container spacing={2.5}>
      <Grid size={{ xs: 12, lg: 5 }}><ChartCard title="Budget utilization"><Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ alignItems: 'center' }}><Box sx={{ position: 'relative', display: 'grid', placeItems: 'center', width: 190, height: 190, flexShrink: 0 }}><Box sx={{ position: 'absolute', inset: 0, borderRadius: '50%', background: `conic-gradient(#2e7d32 ${utilization * 3.6}deg, #dfe8df 0)` }} /><Box sx={{ position: 'relative', width: 142, height: 142, borderRadius: '50%', bgcolor: '#fafcfa', display: 'grid', placeItems: 'center', textAlign: 'center' }}><Typography variant="h4" sx={{ fontWeight: 800 }}>{utilization}%</Typography><Typography variant="caption" color="text.secondary" sx={{ mt: -0.25 }}>of total budget</Typography></Box></Box><Stack spacing={1.25} sx={{ flexGrow: 1, minWidth: 0, width: { xs: '100%', md: 'auto' } }}><Box><Typography variant="body2" color="text.secondary">Initial budget</Typography><Typography sx={{ fontWeight: 800, fontSize: '1.1rem' }}>{currency.format(initialBudget)}</Typography></Box><Box><Typography variant="body2" color="text.secondary">Utilized</Typography><Typography sx={{ fontWeight: 800, fontSize: '1.1rem', color: 'primary.dark' }}>{currency.format(utilizedBudget)}</Typography></Box><Box><Typography variant="body2" color="text.secondary">Remaining</Typography><Typography sx={{ fontWeight: 800, fontSize: '1.1rem' }}>{currency.format(remainingBudget)}</Typography></Box></Stack></Stack></ChartCard></Grid>
      <Grid size={{ xs: 12, lg: 7 }}><ChartCard title="Budget allocation by department"><Stack direction="row" spacing={{ xs: 1, sm: 2 }} sx={{ minHeight: 250, alignItems: 'flex-end', overflowX: 'auto', pt: 1 }}>{allocations.map((allocation) => <Stack key={allocation.name} spacing={1} sx={{ alignItems: 'center', justifyContent: 'flex-end', minWidth: 88, height: 240, flex: 1 }}><Typography variant="caption" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{currency.format(allocation.value)}</Typography><Box sx={{ height: 170, width: '100%', maxWidth: 58, display: 'flex', alignItems: 'flex-end', bgcolor: '#e4ece4', borderRadius: '6px 6px 0 0' }}><Box sx={{ width: '100%', height: `${(allocation.value / maxAllocation) * 100}%`, bgcolor: 'primary.main', borderRadius: '6px 6px 0 0' }} /></Box><Typography variant="caption" color="text.secondary" sx={{ maxWidth: 92, textAlign: 'center', lineHeight: 1.15 }}>{allocation.name}</Typography></Stack>)}{allocations.length === 0 && <Typography color="text.secondary" sx={{ m: 'auto' }}>No budget allocation for this filter.</Typography>}</Stack></ChartCard></Grid>
      <Grid size={{ xs: 12, md: 5 }}><ChartCard title="Training type distribution"><Stack direction="row" spacing={3} sx={{ alignItems: 'center', justifyContent: 'center', py: 1 }}><Box sx={{ width: 175, height: 175, borderRadius: '50%', background: trainingTotal ? `conic-gradient(#2e7d32 0 ${internalPercent}%, #8fbf90 ${internalPercent}% 100%)` : '#dfe8df', position: 'relative' }}><Box sx={{ position: 'absolute', inset: 34, borderRadius: '50%', bgcolor: '#fafcfa', display: 'grid', placeItems: 'center' }}><AnalyticsIcon color="primary" /></Box></Box><Stack spacing={1.5}><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: 'primary.main' }} /><Box><Typography variant="body2">Internal</Typography><Typography sx={{ fontWeight: 800 }}>{internalCount} · {internalPercent}%</Typography></Box></Stack><Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#8fbf90' }} /><Box><Typography variant="body2">External</Typography><Typography sx={{ fontWeight: 800 }}>{externalCount} · {trainingTotal ? 100 - internalPercent : 0}%</Typography></Box></Stack></Stack></Stack></ChartCard></Grid>
      <Grid size={{ xs: 12, md: 7 }}><ChartCard title="Audit log activity"><Box sx={{ height: 220, position: 'relative' }}><svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="190" aria-label="Monthly audit log activity line chart" role="img"><line x1="0" x2="100" y1="18" y2="18" stroke="#dfe8df" strokeWidth="0.6" /><line x1="0" x2="100" y1="50" y2="50" stroke="#dfe8df" strokeWidth="0.6" /><line x1="0" x2="100" y1="82" y2="82" stroke="#dfe8df" strokeWidth="0.6" /><polyline points={activityPoints} fill="none" stroke="#2e7d32" strokeWidth="2.3" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" /></svg><Stack direction="row" sx={{ justifyContent: 'space-between', mt: -0.5 }}>{months.map((month) => <Typography key={month} variant="caption" color="text.secondary">{month}</Typography>)}</Stack></Box><Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1 }}><TrendIcon color="primary" fontSize="small" /><Typography variant="body2" color="text.secondary">Hardcoded audit log activity by month</Typography></Stack></ChartCard></Grid>
    </Grid>
  </Container>
  <Dialog open={filtersOpen} onClose={() => setFiltersOpen(false)} maxWidth="sm" fullWidth><DialogTitle sx={{ fontWeight: 800 }}>Filter Analytics</DialogTitle><DialogContent dividers><Stack spacing={2}><Box><Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>Departments</Typography>{departments.map((department) => <FormControlLabel key={department} control={<Checkbox checked={draftFilters.departments.length === 0 || draftFilters.departments.includes(department)} onChange={() => setDraftFilters((current) => ({ ...current, departments: current.departments.length === 0 ? departments.filter((item) => item !== department) : current.departments.includes(department) ? current.departments.filter((item) => item !== department) : [...current.departments, department] }))} />} label={department} sx={{ display: 'flex', width: 'fit-content' }} />)}</Box><Grid container spacing={2}><Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth type="date" label="From" slotProps={{ inputLabel: { shrink: true } }} value={draftFilters.dateFrom} onChange={(event) => setDraftFilters({ ...draftFilters, dateFrom: event.target.value })} /></Grid><Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth type="date" label="To" slotProps={{ inputLabel: { shrink: true } }} value={draftFilters.dateTo} onChange={(event) => setDraftFilters({ ...draftFilters, dateTo: event.target.value })} /></Grid></Grid><Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>{(['today', 'month', 'year'] as const).map((range) => <Button key={range} size="small" onClick={() => setDraftFilters({ ...draftFilters, ...dateRange(range) })}>{range === 'today' ? 'Today' : range === 'month' ? 'This month' : 'This year'}</Button>)}</Stack></Stack></DialogContent><DialogActions sx={{ p: 2.5 }}><Button onClick={() => setDraftFilters(yearFilters())}>Reset</Button><Button variant="contained" onClick={() => { setFilters({ ...draftFilters, departments: [...draftFilters.departments] }); setFiltersOpen(false); }}>Apply Filters</Button></DialogActions></Dialog>
  </Box>;
}
