'use client';

import React from 'react';
import {
  Box,
  Card,
  Container,
  Divider,
  Grid,
  Skeleton,
  Stack,
} from '@mui/material';

/**
 * 2 rows x 3 columns (6 boxes) grid skeleton.
 * Used for resource listings: CapDev Projects, Requests, Users.
 */
export function ResourceGridSkeleton({ titleWidth = 220 }: { titleWidth?: number }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 72px)' }}>
      <Container maxWidth={false} sx={{ p: 0, width: '100%', flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Header & Filter Bar */}
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 3 }}
        >
          <Skeleton variant="text" width={titleWidth} height={40} sx={{ borderRadius: 1 }} />
          <Stack direction="row" spacing={2} sx={{ width: { xs: '100%', sm: 'auto' }, alignItems: 'center' }}>
            <Skeleton variant="rounded" width={260} height={40} sx={{ borderRadius: 2 }} />
            <Skeleton variant="rounded" width={90} height={40} sx={{ borderRadius: 2 }} />
          </Stack>
        </Stack>

        {/* 2 Rows x 3 Columns (6 Box Grid) */}
        <Grid container spacing={3} sx={{ flexGrow: 1 }}>
          {Array.from({ length: 6 }).map((_, index) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={index}>
              <Card
                variant="outlined"
                sx={{
                  borderRadius: 2,
                  bgcolor: '#ffffff',
                  height: '100%',
                  minHeight: 220,
                  p: 3,
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', mb: 2 }}>
                  <Skeleton variant="rounded" width={44} height={44} sx={{ borderRadius: 2 }} />
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Skeleton variant="text" width="70%" height={26} />
                    <Skeleton variant="text" width="40%" height={18} />
                  </Box>
                  <Skeleton variant="rounded" width={64} height={24} sx={{ borderRadius: 1.5 }} />
                </Stack>
                <Stack spacing={1.5} sx={{ my: 1.5 }}>
                  <Skeleton variant="text" width="90%" height={20} />
                  <Skeleton variant="text" width="60%" height={20} />
                </Stack>
                <Divider sx={{ my: 1.5 }} />
                <Stack direction="row" sx={{ mt: 'auto', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Skeleton variant="text" width={100} height={24} />
                  <Skeleton variant="text" width={60} height={24} />
                </Stack>
              </Card>
            </Grid>
          ))}
        </Grid>

        {/* Pagination Skeleton */}
        <Box sx={{ mt: 'auto', pt: 3, pb: 1, display: 'flex', justifyContent: 'center' }}>
          <Skeleton variant="rounded" width={280} height={36} sx={{ borderRadius: 2 }} />
        </Box>
      </Container>
    </Box>
  );
}

/**
 * 2 rows x 3 columns settings panel skeleton.
 * Used for /portal/settings.
 */
export function SettingsGridSkeleton() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 72px)' }}>
      <Container maxWidth={false} sx={{ p: 0, width: '100%', flexGrow: 1 }}>
        <Box sx={{ mb: 3 }}>
          <Skeleton variant="text" width={160} height={40} sx={{ borderRadius: 1 }} />
          <Skeleton variant="text" width={320} height={20} />
        </Box>
        <Grid container spacing={3}>
          {Array.from({ length: 6 }).map((_, index) => (
            <Grid size={{ xs: 12, md: 4 }} key={index}>
              <Card
                variant="outlined"
                sx={{
                  borderRadius: 2,
                  bgcolor: '#ffffff',
                  height: '100%',
                  minHeight: 220,
                  p: 3,
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', mb: 2 }}>
                  <Skeleton variant="rounded" width={48} height={48} sx={{ borderRadius: 2 }} />
                  <Box sx={{ flexGrow: 1 }}>
                    <Skeleton variant="text" width="70%" height={28} />
                    <Skeleton variant="text" width="90%" height={18} />
                  </Box>
                </Stack>
                <Box sx={{ my: 'auto', py: 1 }}>
                  <Skeleton variant="rounded" width={120} height={24} sx={{ borderRadius: 1 }} />
                </Box>
                <Divider sx={{ my: 2 }} />
                <Stack direction="row" spacing={2} sx={{ mt: 'auto' }}>
                  <Skeleton variant="text" width={110} height={24} />
                  <Skeleton variant="text" width={90} height={24} />
                </Stack>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Container>
    </Box>
  );
}

/**
 * Status Timeline skeleton.
 * Used for /portal/capdev/[capdevId]/requests/[requestId]/status.
 */
export function TimelineGridSkeleton() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 72px)' }}>
      <Container maxWidth={false} sx={{ p: 0, width: '100%', flexGrow: 1 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', mb: 3 }}
        >
          <Box>
            <Skeleton variant="text" width={200} height={40} sx={{ borderRadius: 1 }} />
            <Skeleton variant="text" width={280} height={20} />
          </Box>
          <Skeleton variant="rounded" width={100} height={28} sx={{ borderRadius: 2 }} />
        </Stack>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
            columnGap: { xs: 3, md: 6 },
            rowGap: { xs: 3, md: 4.5 },
            pb: 12,
          }}
        >
          {Array.from({ length: 3 }).map((_, index) => (
            <Card
              key={index}
              variant="outlined"
              sx={{
                borderRadius: 2,
                bgcolor: '#ffffff',
                height: '100%',
                minHeight: 220,
                p: 2.75,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start', mb: 2 }}>
                <Skeleton variant="rounded" width={40} height={40} sx={{ borderRadius: 2 }} />
                <Box sx={{ flexGrow: 1 }}>
                  <Skeleton variant="text" width="60%" height={24} />
                  <Skeleton variant="text" width="40%" height={16} />
                </Box>
                <Skeleton variant="rounded" width={64} height={24} sx={{ borderRadius: 1 }} />
              </Stack>
              <Skeleton variant="text" width="90%" height={22} sx={{ mb: 1 }} />
              <Skeleton variant="text" width="70%" height={18} />
              <Divider sx={{ my: 'auto', mt: 2 }} />
              <Skeleton variant="rounded" width={100} height={24} sx={{ borderRadius: 1, mt: 1 }} />
            </Card>
          ))}
        </Box>
      </Container>
    </Box>
  );
}

/**
 * Form Configuration Preview skeleton.
 * Used for /portal/settings/capdev and /portal/settings/request.
 */
export function FormConfigSkeleton({ titleWidth = 260 }: { titleWidth?: number }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 72px)' }}>
      <Container maxWidth="md" sx={{ p: 0, width: '100%', mb: 4 }}>
        <Skeleton variant="text" width={titleWidth} height={40} sx={{ borderRadius: 1, mb: 0.5 }} />
        <Skeleton variant="text" width={380} height={20} sx={{ mb: 3 }} />
        <Card variant="outlined" sx={{ borderRadius: 2, bgcolor: '#ffffff', p: { xs: 3, md: 4 } }}>
          <Box sx={{ bgcolor: '#fafcfa', p: { xs: 2, sm: 3.5 }, borderRadius: 2, border: '1px solid rgba(28, 40, 28, 0.14)' }}>
            <Skeleton variant="text" width={180} height={28} sx={{ mb: 2 }} />
            <Grid container spacing={3}>
              <Grid size={12}><Skeleton variant="rounded" height={44} sx={{ borderRadius: 2 }} /></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><Skeleton variant="rounded" height={44} sx={{ borderRadius: 2 }} /></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><Skeleton variant="rounded" height={44} sx={{ borderRadius: 2 }} /></Grid>
              <Grid size={12}><Skeleton variant="rounded" height={80} sx={{ borderRadius: 2 }} /></Grid>
            </Grid>
          </Box>
        </Card>
      </Container>
    </Box>
  );
}

/**
 * Analytics Dashboard skeleton.
 * Used for /portal/analytics.
 */
export function AnalyticsSkeleton() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 72px)' }}>
      <Container maxWidth={false} sx={{ p: 0, width: '100%', flexGrow: 1 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
          <Skeleton variant="text" width={220} height={40} sx={{ borderRadius: 1 }} />
          <Skeleton variant="rounded" width={120} height={40} sx={{ borderRadius: 2 }} />
        </Stack>
        <Grid container spacing={3} sx={{ mb: 3 }}>
          {Array.from({ length: 4 }).map((_, index) => (
            <Grid size={{ xs: 12, sm: 6, md: 3 }} key={index}>
              <Card variant="outlined" sx={{ borderRadius: 2, bgcolor: '#ffffff', p: 2.5 }}>
                <Skeleton variant="text" width="60%" height={20} />
                <Skeleton variant="text" width="80%" height={36} sx={{ my: 1 }} />
                <Skeleton variant="text" width="40%" height={16} />
              </Card>
            </Grid>
          ))}
        </Grid>
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 8 }}>
            <Card variant="outlined" sx={{ borderRadius: 2, height: 320, p: 3, bgcolor: '#ffffff' }}>
              <Skeleton variant="rounded" height="100%" sx={{ borderRadius: 2 }} />
            </Card>
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <Card variant="outlined" sx={{ borderRadius: 2, height: 320, p: 3, bgcolor: '#ffffff' }}>
              <Skeleton variant="rounded" height="100%" sx={{ borderRadius: 2 }} />
            </Card>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
}

/**
 * Reports Page skeleton.
 * Used for /portal/reports.
 */
export function ReportsSkeleton() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 72px)' }}>
      <Container maxWidth={false} sx={{ p: 0, width: '100%', flexGrow: 1 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
          <Skeleton variant="text" width={220} height={40} sx={{ borderRadius: 1 }} />
          <Skeleton variant="rounded" width={140} height={40} sx={{ borderRadius: 2 }} />
        </Stack>
        <Card variant="outlined" sx={{ borderRadius: 2, bgcolor: '#ffffff', p: 3 }}>
          <Skeleton variant="rounded" height={50} sx={{ borderRadius: 2, mb: 2 }} />
          <Skeleton variant="rounded" height={240} sx={{ borderRadius: 2 }} />
        </Card>
      </Container>
    </Box>
  );
}

export function AuditLogsSkeleton() {
  return (
    <Container maxWidth={false} sx={{ p: 0, width: '100%' }}>
      <Skeleton variant="text" width={210} height={48} sx={{ mb: 2 }} />
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 3 }}>
        <Skeleton variant="rounded" height={48} sx={{ flexGrow: 1, borderRadius: 2 }} />
        <Skeleton variant="rounded" width={180} height={48} sx={{ borderRadius: 2 }} />
        <Skeleton variant="rounded" width={180} height={48} sx={{ borderRadius: 2 }} />
      </Stack>
      <Card variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        {Array.from({ length: 8 }).map((_, index) => (
          <React.Fragment key={index}>
            <Stack direction="row" spacing={3} sx={{ p: 2.5, alignItems: 'center' }}>
              <Skeleton variant="rounded" width={86} height={26} sx={{ borderRadius: 1 }} />
              <Box sx={{ flexGrow: 1 }}><Skeleton variant="text" width="42%" /><Skeleton variant="text" width="28%" /></Box>
              <Skeleton variant="text" width={140} />
            </Stack>
            {index < 7 && <Divider />}
          </React.Fragment>
        ))}
      </Card>
    </Container>
  );
}
