'use client';

import { Box, Link, Stack, Typography } from '@mui/material';
import DynamicTableField from '@/components/DynamicTableField';
import { isPendingAttachment } from '@/lib/background-attachments';

type Props = { field: { name: string; type: string; options?: string[] | null }; value: unknown };
export default function ReadOnlyDynamicField({ field, value }: Props) {
  if (field.type === 'table') return <DynamicTableField label={field.name} value={value} template={field.options?.[0]} disabled showDimensionControls={false} />;
  const dateValue = field.type === 'date' && typeof value === 'string' && value ? new Date(value) : null;
  const displayValue = dateValue && !Number.isNaN(dateValue.getTime())
    ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }).format(dateValue)
    : value;
  return <Box>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>{field.name}</Typography>
    {field.type === 'file' ? <Stack spacing={0.5}>{Array.isArray(value) && value.length ? value.map((file, index) => {
      if (isPendingAttachment(file)) return <Typography key={file.pendingUploadId} variant="body2" color="text.secondary">{file.name} · Upload pending</Typography>;
      if (!file || typeof file !== 'object' || !('url' in file) || !('name' in file)) return null;
      return <Link key={index} href={String(file.url)} target="_blank" rel="noopener noreferrer" sx={{ overflowWrap: 'anywhere' }}>{String(file.name)}</Link>;
    }) : <Typography variant="body2">—</Typography>}</Stack> : <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{displayValue == null || displayValue === '' ? '—' : typeof displayValue === 'object' ? JSON.stringify(displayValue) : String(displayValue)}</Typography>}
  </Box>;
}
