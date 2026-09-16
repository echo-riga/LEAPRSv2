'use client';

import React from 'react';
import {
  BarChart as ChartIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import type { EvaluationSummary } from '@/lib/google-forms';

type Props = {
  open: boolean;
  loading: boolean;
  error: string;
  summary: EvaluationSummary | null;
  onClose: () => void;
  onRefresh: () => void;
};

function SummaryList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 0.75 }}>{title}</Typography>
      <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.5 }}>
        {items.map((item, index) => (
          <Typography component="li" variant="body2" key={`${title}-${index}`} sx={{ lineHeight: 1.5 }}>
            {item}
          </Typography>
        ))}
      </Stack>
    </Box>
  );
}

export default function EvaluationSummaryDialog({ open, loading, error, summary, onClose, onRefresh }: Props) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.25, fontWeight: 800 }}>
        <Box sx={{ width: 38, height: 38, borderRadius: 2, bgcolor: 'rgba(46, 125, 50, 0.1)', color: 'primary.main', display: 'grid', placeItems: 'center' }}>
          <ChartIcon />
        </Box>
        Evaluation Summary
        {summary && <Chip label={`${summary.responseCount} response${summary.responseCount === 1 ? '' : 's'}`} size="small" color="primary" sx={{ ml: 'auto', fontWeight: 700 }} />}
      </DialogTitle>
      <DialogContent dividers sx={{ bgcolor: '#fafcfa' }}>
        {loading ? (
          <Stack spacing={2}>
            <Skeleton variant="rounded" height={92} />
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
              <Skeleton variant="rounded" height={190} />
              <Skeleton variant="rounded" height={190} />
            </Box>
          </Stack>
        ) : error ? (
          <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'error.light' }}>
            <CardContent>
              <Typography color="error.main" sx={{ fontWeight: 700 }}>{error}</Typography>
            </CardContent>
          </Card>
        ) : summary?.responseCount === 0 ? (
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <CardContent sx={{ py: 5, textAlign: 'center' }}>
              <ChartIcon sx={{ fontSize: 42, color: 'text.disabled', mb: 1 }} />
              <Typography sx={{ fontWeight: 700 }}>No responses yet</Typography>
            </CardContent>
          </Card>
        ) : summary ? (
          <Stack spacing={2.5}>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>{summary.formTitle}</Typography>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
              {summary.ratingQuestions.map((rating) => {
                const largestCount = Math.max(1, ...rating.distribution);
                return (
                  <Card key={rating.question} variant="outlined" sx={{ borderRadius: 2, bgcolor: '#ffffff' }}>
                    <CardContent>
                      <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
                        <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.35 }}>{rating.question}</Typography>
                        <Chip label={`${rating.average.toFixed(1)} / 5`} size="small" color="primary" sx={{ fontWeight: 800, flexShrink: 0 }} />
                      </Stack>
                      <Stack spacing={0.65}>
                        {rating.distribution.map((count, index) => (
                          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }} key={`${rating.question}-${index + 1}`}>
                            <Typography variant="caption" sx={{ width: 10, fontWeight: 700 }}>{index + 1}</Typography>
                            <Box sx={{ height: 8, flexGrow: 1, bgcolor: 'rgba(46, 125, 50, 0.1)', borderRadius: 4, overflow: 'hidden' }}>
                              <Box sx={{ height: '100%', width: `${(count / largestCount) * 100}%`, minWidth: count > 0 ? 4 : 0, bgcolor: 'primary.main', borderRadius: 4 }} />
                            </Box>
                            <Typography variant="caption" color="text.secondary" sx={{ width: 18, textAlign: 'right' }}>{count}</Typography>
                          </Stack>
                        ))}
                      </Stack>
                    </CardContent>
                  </Card>
                );
              })}
            </Box>

            {summary.aiSummary && (summary.aiSummary.strengths.length > 0 || summary.aiSummary.improvements.length > 0 || summary.aiSummary.recommendations.length > 0) && (
              <Card variant="outlined" sx={{ borderRadius: 2, bgcolor: '#ffffff' }}>
                <CardContent>
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }, gap: 2.5 }}>
                    <SummaryList title="Strengths" items={summary.aiSummary.strengths} />
                    <SummaryList title="Improvements" items={summary.aiSummary.improvements} />
                    <SummaryList title="Recommended Actions" items={summary.aiSummary.recommendations} />
                  </Box>
                </CardContent>
              </Card>
            )}

            {summary.aiError && (
              <Typography variant="body2" color="error.main" sx={{ fontWeight: 600 }}>{summary.aiError} Charts are still available.</Typography>
            )}
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} color="inherit" sx={{ fontWeight: 700 }}>Close</Button>
        <Button onClick={onRefresh} disabled={loading} variant="contained" startIcon={<RefreshIcon />} sx={{ fontWeight: 700 }}>Refresh Summary</Button>
      </DialogActions>
    </Dialog>
  );
}
