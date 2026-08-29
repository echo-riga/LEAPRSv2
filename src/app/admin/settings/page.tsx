'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Container,
  Box,
  Typography,
  Stack,
  Chip,
  CircularProgress,
  Grid,
  Card,
  CardContent,
  Switch,
  FormControlLabel,
  Button,
  Divider,
} from '@mui/material';
import {
  People as PeopleIcon,
  Assessment as ReportsIcon,
  Build as MaintenanceIcon,
  School as CapDevIcon,
  Assignment as RequestIcon,
  ChevronRight as ChevronRightIcon,
  Analytics as AnalyticsIcon,
} from '@mui/icons-material';
import { authClient } from '@/lib/auth/client';
import { getDynamicFieldCounts } from '@/app/actions';

export default function SettingsPage() {
  const router = useRouter();
  const session = authClient.useSession();
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [counts, setCounts] = useState({ capdevFieldsCount: 0, requestFieldsCount: 0 });

  useEffect(() => {
    getDynamicFieldCounts().then(setCounts);
  }, []);

  // Redirect if not logged in
  useEffect(() => {
    if (!session.isPending && !session.data) {
      router.push('/');
    }
  }, [session.isPending, session.data, router]);

  if (session.isPending) {
    return (
      <Box
        sx={{
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: '#fafcfa',
        }}
      >
        <CircularProgress color="primary" />
      </Box>
    );
  }

  if (!session.data) {
    return null;
  }

  const settingsComponents = [
    {
      title: 'Users Management',
      icon: <PeopleIcon color="primary" sx={{ fontSize: 32 }} />,
      description: 'Manage roles and user access.',
      control: (
        <Stack direction="row" spacing={1} sx={{ mt: 2, alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
          <Chip label="12 Active Users" size="small" variant="outlined" color="primary" />
          <Chip label="2 Pending" size="small" variant="outlined" color="warning" />
          <Button size="small" variant="outlined" disabled>View Audit Logs</Button>
        </Stack>
      ),
      actionText: 'Manage Users',
      route: '/admin/users',
    },
    {
      title: 'Reports',
      icon: <ReportsIcon color="primary" sx={{ fontSize: 32 }} />,
      description: 'Configure and download Excel/CSV data exports.',
      control: (
        <Stack direction="row" spacing={1} sx={{ mt: 2, alignItems: 'center' }}>
          <Chip label="Excel & CSV" size="small" variant="outlined" color="success" />
          <Chip label="3 Templates" size="small" variant="outlined" />
        </Stack>
      ),
      actionText: 'Export Reports',
    },
    {
      title: 'Analytics',
      icon: <AnalyticsIcon color="primary" sx={{ fontSize: 32 }} />,
      description: 'KPI widget settings and dashboard charts layout.',
      control: (
        <Stack direction="row" spacing={1} sx={{ mt: 2, alignItems: 'center' }}>
          <Chip label="4 Active Indicators" size="small" variant="outlined" color="primary" />
        </Stack>
      ),
      actionText: 'Configure Analytics',
    },
    {
      title: 'Maintenance Mode',
      icon: <MaintenanceIcon color="primary" sx={{ fontSize: 32 }} />,
      description: 'Restrict access during system maintenance.',
      control: (
        <Box sx={{ mt: 1.5 }}>
          <FormControlLabel
            control={
              <Switch
                checked={maintenanceMode}
                onChange={(e) => setMaintenanceMode(e.target.checked)}
                color="primary"
              />
            }
            label={
              <Typography
                variant="body2"
                sx={{
                  fontWeight: '600',
                  color: maintenanceMode ? 'error.main' : 'text.secondary',
                }}
              >
                {maintenanceMode ? 'Active (Offline)' : 'Inactive (Online)'}
              </Typography>
            }
          />
        </Box>
      ),
      actionText: 'Configure Schedules',
    },
    {
      title: 'CapDev Configuration',
      icon: <CapDevIcon color="primary" sx={{ fontSize: 32 }} />,
      description: 'Configure custom dynamic fields, form layout, and additional form information for CapDev projects.',
      control: (
        <Stack direction="row" spacing={1} sx={{ mt: 2, alignItems: 'center' }}>
          <Chip label={`${counts.capdevFieldsCount} Dynamic Fields`} size="small" variant="outlined" color="success" />
        </Stack>
      ),
      actionText: 'Configure Fields',
      route: '/admin/settings/capdev',
    },
    {
      title: 'Request Configuration',
      icon: <RequestIcon color="primary" sx={{ fontSize: 32 }} />,
      description: 'Configure custom dynamic fields, form layout, and layout options for request forms.',
      control: (
        <Stack direction="row" spacing={1} sx={{ mt: 2, alignItems: 'center' }}>
          <Chip label={`${counts.requestFieldsCount} Dynamic Fields`} size="small" variant="outlined" color="primary" />
        </Stack>
      ),
      actionText: 'Configure Fields',
      route: '/admin/settings/request',
    },
  ];

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 'calc(100vh - 72px)',
      }}
    >
      {/* Main Grid Content - Full-width kiosk container */}
      <Container maxWidth={false} sx={{ p: 0, width: '100%' }}>
        <Typography
          variant="h4"
          sx={{
            fontWeight: '800',
            color: 'text.primary',
            letterSpacing: '-1px',
            mb: 3,
          }}
        >
          Settings
        </Typography>

        <Grid container spacing={3}>
          {settingsComponents.map((item, index) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={index}>
              <Card
                variant="outlined"
                sx={{
                  borderRadius: 2,
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  transition: 'all 0.2s',
                  '&:hover': {
                    boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
                    borderColor: 'primary.main',
                  },
                }}
              >
                <CardContent
                  sx={{
                    flexGrow: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    p: 3,
                  }}
                >
                  <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', mb: 2 }}>
                    <Box
                      sx={{
                        bgcolor: 'rgba(46, 125, 50, 0.08)',
                        p: 1.2,
                        borderRadius: 2,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {item.icon}
                    </Box>
                    <Box sx={{ flexGrow: 1 }}>
                      <Typography
                        variant="h6"
                        sx={{
                          fontWeight: '700',
                          color: 'text.primary',
                          lineHeight: 1.2,
                        }}
                      >
                        {item.title}
                      </Typography>
                    </Box>
                  </Stack>

                  <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
                    {item.description}
                  </Typography>

                  {item.control}

                  <Divider sx={{ my: 2 }} />

                  <Button
                    variant="text"
                    color="primary"
                    endIcon={<ChevronRightIcon />}
                    onClick={() => item.route && router.push(item.route)}
                    sx={{
                      alignSelf: 'flex-start',
                      p: 0,
                      minWidth: 0,
                      fontWeight: '700',
                      '&:hover': { bgcolor: 'transparent', color: 'primary.dark' },
                    }}
                  >
                    {item.actionText}
                  </Button>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Container>
    </Box>
  );
}
