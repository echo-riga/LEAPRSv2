'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Assessment as ReportIcon, CheckBox as SelectAllIcon, Download as DownloadIcon, FilterAlt as FilterIcon, Refresh as ResetIcon } from '@mui/icons-material';
import { Box, Button, Card, CardActionArea, CardContent, Checkbox, CircularProgress, Divider, FormControlLabel, Grid, Stack, TextField, Typography } from '@mui/material';
import { generateMonitoringSheet, getMonitoringReportData } from '@/app/actions';

type ReportData = Awaited<ReturnType<typeof getMonitoringReportData>>;
type SelectedField = { id: string | number; name: string; source: 'capdev' | 'request'; key?: string };

const TEMPLATE_SECTIONS = [
  { title: 'CAPDEV PROPOSAL (To be filled out by HRDO)', color: '#fff2cc', fields: ['DOC. NO.', 'SOURCE OF BUDGET'] },
  { title: 'I. LBP FORM 4 DETAILS (To be filled out by OFFICES)', color: '#47d45a', fields: ['SECTOR', 'OFFICE', 'AIP REFERENCE CODE', 'ACTIVITY'] },
  { title: 'II. ACTIVITY DESIGN DETAILS (To be filled out by OFFICES)', color: '#47d45a', fields: ['CURRENT STATE', 'DESIRED STATE', 'MAJOR FINAL OUTPUT', 'PERFORMANCE / OUTPUT INDICATOR', 'TARGET FOR THE BUDGET YEAR', 'TARGET DATE OF COMPLETION', 'TITLE', 'VENUE', 'ACTIVITY CATEGORY', 'BATCH', 'FIRST LEVEL (MALE)', 'FIRST LEVEL (FEMALE)', 'SECOND LEVEL (MALE)', 'SECOND LEVEL (FEMALE)', 'PARTICIPANTS PARTICULARS', 'IMPLEMENTATION DATE FROM'] },
  { title: 'III. BUDGETARY REQUIREMENTS (Fill Color = Obligated/Utilized) (To be filled out by OFFICES)', color: '#c1e4f5', fields: ['IMPLEMENTATION DATE END', 'RATIONALE', 'METHODOLOGY', 'PERFORMANCE OBJECTIVES', 'LEARNING OBJECTIVES', 'COURSE CONTENT', 'LEASE OF VENUE / ACCOMMODATION', 'CITY-OWNED', 'SUPPLIES', 'REGISTRATION FEE', 'HONORARIUM', 'TRANSPO EXPENSE', 'DTE/DSA'] },
  { title: 'IV. DOCUMENT TRACKER DETAILS (To be filled out by OFFICES)', color: '#a6c9eb', fields: ['AIRFARE', 'FOOD', 'INCIDENTAL EXPENSE', 'TOTAL AMOUNT', 'OBLIGATED', 'UTILIZED', 'EXPENSE PER PAX', 'PRESENT MALE', 'PRESENT FEMALE', 'NO. OF ABSENCES', 'EXPENSE LOSS'] },
  { title: 'V. TERMINAL REPORT DETAILS (To be filled out by OFFICES)', color: '#45b0e1', fields: ['ATTENDANCE BREAKDOWN', 'OBJECTIVE ACHIEVEMENT RATE', 'PRE/POST TEST IMPROVEMENT RATE', 'ATTACH PRE/POST TEST LINK ACCESS', 'SME EVALUATION', 'TRAINING EVALUATION', 'ACTIVITY OBJECTIVES'] },
  { title: 'VI. ATTACHMENT (To be filled out by OFFICES)', color: '#4d94d8', fields: ['SUMMARY OF PARTICIPANTS’ EVALUATION', 'QUALITATIVE HIGHLIGHTS', 'LESSONS LEARNED / BEST PRACTICES', 'ISSUES AND CHALLENGES', 'RECOMMENDATIONS AND NEXT STEPS', 'ACTIVITY HIGHLIGHTS', 'ATTACH ACTIVITY DESIGN', 'ACTIVITY DESIGN APPROVAL DATE', 'ATTACH OBR', 'OBR DATE'] },
  { title: 'HRDO RATING PRE-IMPLEMENTATION', color: '#47d45a', fields: ['QUALITY', 'EFFICIENCY', 'TIMELINESS'] },
  { title: 'HRDO RATING DURING-IMPLEMENTATION', color: '#47d45a', fields: ['QUALITY', 'EFFICIENCY', 'TIMELINESS'] },
  { title: 'HRDO RATING POST-IMPLEMENTATION', color: '#47d45a', fields: ['QUALITY', 'EFFICIENCY', 'TIMELINESS'] },
  { title: 'AVERAGE ACTIVITY RATING', color: '#47d45a', fields: ['QUALITY', 'EFFICIENCY', 'TIMELINESS', 'TOTAL'] },
  { title: 'HRDO ANALYSIS', color: '#47d45a', fields: ['ANALYSIS'] },
];
const CAPDEV_FIXED_FIELDS = ['AIP Code', 'Department', 'Description', 'Initial Budget', 'Remaining Budget'] as const;
const REQUEST_FIXED_FIELDS = ['Setting', 'Description', 'Requested Budget', 'Requestor'] as const;
const CAPDEV_FIXED_KEYS = ['aipCode', 'department', 'description', 'initialBudget', 'budget'];
const REQUEST_FIXED_KEYS = ['setting', 'description', 'requestedBudget', 'requestorName'];

const toDateInput = () => new Date().toISOString().slice(0, 10);

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '';
  if (Array.isArray(value)) return value.map((item) => typeof item === 'object' && item !== null && 'name' in item ? String(item.name) : String(item)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function fieldValue(additionalInfo: Record<string, unknown>, field: Pick<SelectedField, 'name'>) {
  return displayValue(additionalInfo[field.name]);
}

export default function ReportsPage() {
  const [data, setData] = useState<ReportData>({ capdevs: [], requests: [], capdevFields: [], requestFields: [] });
  const [loading, setLoading] = useState(true);
  const [selectedCapdevIds, setSelectedCapdevIds] = useState<number[]>([]);
  const [selectedCapdevFields, setSelectedCapdevFields] = useState<number[]>([]);
  const [selectedRequestFields, setSelectedRequestFields] = useState<number[]>([]);
  const [selectedCapdevFixedFields, setSelectedCapdevFixedFields] = useState<string[]>([]);
  const [selectedRequestFixedFields, setSelectedRequestFixedFields] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [generated, setGenerated] = useState(false);
  const [generating, setGenerating] = useState(false);
  const reportTableRef = useRef<HTMLTableElement>(null);

  useEffect(() => {
    void getMonitoringReportData().then((result) => {
      setData(result);
      setSelectedCapdevIds(result.capdevs.map((capdev) => capdev.id));
      setLoading(false);
    });
  }, []);

  const visibleCapdevs = useMemo(() => data.capdevs.filter((capdev) => {
    const createdAt = new Date(capdev.createdAt).getTime();
    return (!dateFrom || createdAt >= new Date(dateFrom).getTime()) && (!dateTo || createdAt <= new Date(`${dateTo}T23:59:59`).getTime());
  }), [data.capdevs, dateFrom, dateTo]);
  const visibleIds = useMemo(() => new Set(visibleCapdevs.map((capdev) => capdev.id)), [visibleCapdevs]);
  const selectedCapdevs = data.capdevs.filter((capdev) => selectedCapdevIds.includes(capdev.id) && visibleIds.has(capdev.id));
  const selectedCapdevFieldDefinitions = data.capdevFields.filter((field) => selectedCapdevFields.includes(field.id));
  const selectedRequestFieldDefinitions = data.requestFields.filter((field) => selectedRequestFields.includes(field.id));
  const selectedMonitoringFields: SelectedField[] = [
    ...CAPDEV_FIXED_FIELDS.flatMap((name, index) => selectedCapdevFixedFields.includes(CAPDEV_FIXED_KEYS[index]) ? [{ id: `capdev-fixed-${index}`, name, source: 'capdev' as const, key: CAPDEV_FIXED_KEYS[index] }] : []),
    ...selectedCapdevFieldDefinitions.map((field) => ({ id: field.id, name: field.name, source: 'capdev' as const })),
    ...REQUEST_FIXED_FIELDS.flatMap((name, index) => selectedRequestFixedFields.includes(REQUEST_FIXED_KEYS[index]) ? [{ id: `request-fixed-${index}`, name, source: 'request' as const, key: REQUEST_FIXED_KEYS[index] }] : []),
    ...selectedRequestFieldDefinitions.map((field) => ({ id: field.id, name: field.name, source: 'request' as const })),
  ];
  const reportRows = data.requests.filter((request) => selectedCapdevs.some((capdev) => capdev.id === request.capdevId));
  const capdevColumnCount = Math.max(1, selectedMonitoringFields.length);

  const setQuickDate = (range: 'today' | 'month' | 'year') => {
    const now = new Date(); const dateTo = toDateInput();
    setDateFrom(range === 'today' ? dateTo : range === 'month' ? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01` : `${now.getFullYear()}-01-01`);
    setDateTo(dateTo);
  };
  const toggleCapdev = (id: number) => setSelectedCapdevIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const toggleField = (id: number, setSelected: React.Dispatch<React.SetStateAction<number[]>>) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const exportExcel = async () => {
    setGenerating(true);
    const result = await generateMonitoringSheet({ capdevIds: selectedCapdevs.map((capdev) => capdev.id), capdevFieldIds: selectedCapdevFields, requestFieldIds: selectedRequestFields, capdevFixedFields: selectedCapdevFixedFields, requestFixedFields: selectedRequestFixedFields });
    if (result.success && 'base64' in result && result.base64 && result.fileName) { const binary = atob(result.base64); const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0)); const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); const link = document.createElement('a'); link.href = url; link.download = result.fileName; link.click(); URL.revokeObjectURL(url); }
    setGenerating(false);
  };

  if (loading) return <Box sx={{ display: 'grid', minHeight: 'calc(100vh - 72px)', placeItems: 'center' }}><CircularProgress color="primary" /></Box>;

  return <Box sx={{ minHeight: 'calc(100vh - 72px)' }}>
    <style>{`table tr:nth-child(1) td:not(:first-child) { background: #ffffff !important; } table tr:nth-child(2) td:nth-child(2) { background: #fff2cc !important; } table tr:nth-child(3) td { background: #a4c2f4 !important; } table tr:nth-child(n + 4) td { background: #ffffff !important; }`}</style>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', mb: 3 }}><Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: '-1px' }}>Reports</Typography></Stack>
    <Grid container spacing={3}>
      <Grid size={{ xs: 12, lg: 3 }}><Card variant="outlined" sx={{ borderRadius: 2, bgcolor: '#fafcfa', position: { lg: 'sticky' }, top: { lg: 96 } }}><CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}><Typography variant="overline" color="text.secondary">Report type</Typography><CardActionArea sx={{ border: '1px solid', borderColor: 'primary.main', borderRadius: 2, bgcolor: 'rgba(46, 125, 50, 0.07)', mt: 1, p: 2 }}><Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}><ReportIcon color="primary" /><Box><Typography sx={{ fontWeight: 800 }}>Monitoring Sheet</Typography><Typography variant="caption" color="text.secondary">CapDev requests</Typography></Box></Stack></CardActionArea></CardContent></Card></Grid>
      <Grid size={{ xs: 12, lg: 9 }}><Card variant="outlined" sx={{ borderRadius: 2, bgcolor: '#fafcfa' }}><CardContent sx={{ p: { xs: 2.5, md: 3 }, '&:last-child': { pb: { xs: 2.5, md: 3 } } }}>
        <Stack spacing={3}><Box><Typography variant="h6" sx={{ fontWeight: 800 }}>Monitoring Sheet</Typography></Box><Divider />
          <Box><Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, mb: 1 }}><Typography sx={{ fontWeight: 800 }}>CapDev projects</Typography><Stack direction="row" spacing={1}><Button size="small" startIcon={<SelectAllIcon />} onClick={() => setSelectedCapdevIds(visibleCapdevs.map((capdev) => capdev.id))}>Select all</Button><Button size="small" onClick={() => setSelectedCapdevIds([])}>Clear</Button></Stack></Stack><Grid container spacing={1}>{visibleCapdevs.map((capdev) => <Grid key={capdev.id} size={{ xs: 12, sm: 6 }}><FormControlLabel control={<Checkbox checked={selectedCapdevIds.includes(capdev.id)} onChange={() => toggleCapdev(capdev.id)} />} label={<Stack><Typography variant="body2" sx={{ fontWeight: 700 }}>{capdev.aipCode}</Typography><Typography variant="caption" color="text.secondary">{capdev.department}</Typography></Stack>} sx={{ m: 0, p: 1, width: '100%', alignItems: 'center', border: '1px solid', borderColor: selectedCapdevIds.includes(capdev.id) ? 'primary.main' : 'divider', borderRadius: 2, bgcolor: selectedCapdevIds.includes(capdev.id) ? 'rgba(46, 125, 50, 0.05)' : 'transparent' }} /></Grid>)}</Grid>{visibleCapdevs.length === 0 && <Typography color="text.secondary" sx={{ py: 2 }}>No CapDev projects match the date filter.</Typography>}</Box>
          <Box><Typography sx={{ fontWeight: 800, mb: 1 }}>Added date</Typography><Grid container spacing={1.5}><Grid size={{ xs: 12, sm: 4 }}><TextField fullWidth size="small" type="date" label="From" slotProps={{ inputLabel: { shrink: true } }} value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></Grid><Grid size={{ xs: 12, sm: 4 }}><TextField fullWidth size="small" type="date" label="To" slotProps={{ inputLabel: { shrink: true } }} value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></Grid><Grid size={{ xs: 12, sm: 4 }}><Stack direction="row" spacing={0.5} sx={{ height: '100%', alignItems: 'center', flexWrap: 'wrap' }}>{(['today', 'month', 'year'] as const).map((range) => <Button key={range} size="small" onClick={() => setQuickDate(range)}>{range === 'today' ? 'Today' : range === 'month' ? 'This month' : 'This year'}</Button>)}<Button size="small" startIcon={<ResetIcon />} onClick={() => { setDateFrom(''); setDateTo(''); }}>Reset</Button></Stack></Grid></Grid></Box>
          <Grid container spacing={3}><Grid size={{ xs: 12, md: 6 }}><Typography sx={{ fontWeight: 800, mb: 1 }}>CapDev fields</Typography><Typography variant="caption" color="text.secondary">Core fields</Typography>{CAPDEV_FIXED_FIELDS.map((field, index) => <FormControlLabel key={field} control={<Checkbox checked={selectedCapdevFixedFields.includes(CAPDEV_FIXED_KEYS[index])} onChange={() => setSelectedCapdevFixedFields((current) => current.includes(CAPDEV_FIXED_KEYS[index]) ? current.filter((key) => key !== CAPDEV_FIXED_KEYS[index]) : [...current, CAPDEV_FIXED_KEYS[index]])} />} label={field} sx={{ display: 'flex', width: 'fit-content' }} />)}<Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>Configured fields</Typography>{data.capdevFields.map((field) => <FormControlLabel key={field.id} control={<Checkbox checked={selectedCapdevFields.includes(field.id)} onChange={() => toggleField(field.id, setSelectedCapdevFields)} />} label={field.name} sx={{ display: 'flex', width: 'fit-content' }} />)}</Grid><Grid size={{ xs: 12, md: 6 }}><Typography sx={{ fontWeight: 800, mb: 1 }}>Request fields</Typography><Typography variant="caption" color="text.secondary">Core fields</Typography>{REQUEST_FIXED_FIELDS.map((field, index) => <FormControlLabel key={field} control={<Checkbox checked={selectedRequestFixedFields.includes(REQUEST_FIXED_KEYS[index])} onChange={() => setSelectedRequestFixedFields((current) => current.includes(REQUEST_FIXED_KEYS[index]) ? current.filter((key) => key !== REQUEST_FIXED_KEYS[index]) : [...current, REQUEST_FIXED_KEYS[index]])} />} label={field} sx={{ display: 'flex', width: 'fit-content' }} />)}<Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>Configured fields</Typography>{data.requestFields.map((field) => <FormControlLabel key={field.id} control={<Checkbox checked={selectedRequestFields.includes(field.id)} onChange={() => toggleField(field.id, setSelectedRequestFields)} />} label={field.name} sx={{ display: 'flex', width: 'fit-content' }} />)}</Grid></Grid>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ justifyContent: 'flex-end', pt: 1 }}><Button variant="outlined" startIcon={<FilterIcon />} onClick={() => { setSelectedCapdevIds(visibleCapdevs.map((capdev) => capdev.id)); setSelectedCapdevFields([]); setSelectedRequestFields([]); setSelectedCapdevFixedFields([]); setSelectedRequestFixedFields([]); setGenerated(false); }}>Reset selection</Button><Button variant="contained" onClick={() => setGenerated(true)} disabled={selectedCapdevs.length === 0}>Generate report</Button></Stack>
        </Stack>
      </CardContent></Card></Grid>
      {generated && <Grid size={12}><Card variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', bgcolor: '#fafcfa' }}><CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}><Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', p: 2, borderBottom: '1px solid', borderColor: 'divider' }}><Typography sx={{ fontWeight: 800 }}>Live preview</Typography><Button variant="contained" startIcon={<DownloadIcon />} onClick={exportExcel} disabled={generating}>{generating ? 'Generating...' : 'Download Report'}</Button></Stack><Box sx={{ overflowX: 'auto' }}><table ref={reportTableRef} style={{ width: 'max-content', minWidth: '100%', borderCollapse: 'collapse', fontFamily: 'Arial, sans-serif', fontSize: 12 }}><tbody><tr><td style={{ width: 18 }} /><td colSpan={capdevColumnCount + TEMPLATE_SECTIONS.reduce((total, section) => total + section.fields.length, 0)} style={{ height: 30, padding: '8px 16px', fontWeight: 700, fontSize: 15, background: '#47d45a', border: '1px solid #999', textAlign: 'center' }}>{new Date().getFullYear()} CONSOLIDATED COMPETENCY-BASED LEARNING & DEVELOPMENT INTERVENTIONS (CapDev)</td></tr><tr><td /><td colSpan={capdevColumnCount} style={{ padding: '8px 12px', fontWeight: 700, background: '#47d45a', border: '1px solid #999', textAlign: 'center' }}>CAPACITY DEVELOPMENT</td>{TEMPLATE_SECTIONS.map((section) => <td key={section.title} colSpan={section.fields.length} style={{ padding: '8px 12px', fontWeight: 700, background: '#47d45a', border: '1px solid #999', textAlign: 'center', whiteSpace: 'nowrap' }}>{section.title}</td>)}</tr><tr><td />{selectedMonitoringFields.length > 0 ? selectedMonitoringFields.map((field) => <td key={`${field.source}-${field.id}`} style={{ height: 45, padding: '8px 10px', fontWeight: 700, background: '#47d45a', border: '1px solid #999', minWidth: 150, textAlign: 'center' }}>{field.name}</td>) : <td style={{ height: 45, padding: '8px 10px', background: '#47d45a', border: '1px solid #999', minWidth: 150 }} />}{TEMPLATE_SECTIONS.flatMap((section) => section.fields.map((field) => <td key={`${section.title}-${field}`} style={{ height: 45, padding: '8px 10px', fontWeight: 700, background: '#47d45a', border: '1px solid #999', minWidth: 130, textAlign: 'center' }}>{field}</td>))}</tr>{reportRows.map((request) => { const capdev = selectedCapdevs.find((item) => item.id === request.capdevId); const capdevInfo = (capdev?.additionalInfo || {}) as Record<string, unknown>; const requestInfo = (request.additionalInfo || {}) as Record<string, unknown>; const capdevRecord = (capdev || {}) as Record<string, unknown>; const requestRecord = request as unknown as Record<string, unknown>; return <tr key={request.id}><td />{selectedMonitoringFields.length > 0 ? selectedMonitoringFields.map((field) => <td key={`${field.source}-${field.id}`} style={{ padding: '8px 10px', border: '1px solid #999', verticalAlign: 'top', background: '#47d45a' }}>{field.key ? displayValue((field.source === 'capdev' ? capdevRecord : requestRecord)[field.key]) : fieldValue(field.source === 'capdev' ? capdevInfo : requestInfo, field)}</td>) : <td style={{ padding: '8px 10px', border: '1px solid #999', background: '#47d45a' }} />}{TEMPLATE_SECTIONS.flatMap((section) => section.fields.map((field) => <td key={`${request.id}-${section.title}-${field}`} style={{ padding: '8px 10px', border: '1px solid #999', minWidth: 130, background: '#47d45a' }} />))}</tr>; })}</tbody></table>{reportRows.length === 0 && <Box sx={{ p: 3, textAlign: 'center' }}><Typography color="text.secondary">No requests found for the selected CapDev projects.</Typography></Box>}</Box></CardContent></Card></Grid>}
    </Grid>
  </Box>;
}
