'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AppBar, Box, Chip, CircularProgress, IconButton, Stack, Toolbar, Tooltip, Typography } from '@mui/material';
import { ArrowBack as ArrowBackIcon, CheckCircleOutlined as CheckIcon, ExitToApp as ExitToAppIcon, Fullscreen as FullscreenIcon, FullscreenExit as FullscreenExitIcon, Settings as SettingsIcon } from '@mui/icons-material';
import { authClient } from '@/lib/auth/client';
import { getCurrentUserAccess, type AppRole } from '@/app/actions';
import { ResourceGridSkeleton } from '@/components/Skeletons';
import NotificationsMenu from '@/components/NotificationsMenu';
import RequestTimelineProgress from '@/components/RequestTimelineProgress';

const ADMIN_ROUTES = ['/admin', '/admin/analytics', '/admin/reports', '/admin/audit-logs', '/admin/settings', '/admin/users', '/admin/settings/capdev', '/admin/settings/request'];
type ConfigHeaderStatus = 'idle' | 'editing' | 'saved';

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function AdminLayoutContent({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const session = authClient.useSession();
  const [greeting, setGreeting] = useState(getGreeting);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [configHeaderStatus, setConfigHeaderStatus] = useState<ConfigHeaderStatus>('idle');
  const configStatusTimeout = useRef<number | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);

  useEffect(() => {
    const interval = window.setInterval(() => setGreeting(getGreeting()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!session.isPending && !session.data) router.replace('/');
  }, [router, session.data, session.isPending]);

  useEffect(() => {
    if (!session.data) return;
    void getCurrentUserAccess().then((access) => {
      if (access.success) setRole(access.role);
    });
  }, [session.data]);

  useEffect(() => {
    ADMIN_ROUTES.forEach((route) => router.prefetch(route));
  }, [router]);

  useEffect(() => {
    const syncFullscreenState = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', syncFullscreenState);
    syncFullscreenState();
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState);
  }, []);

  useEffect(() => {
    const handleConfigEditing = (event: Event) => {
      const status = (event as CustomEvent<ConfigHeaderStatus>).detail;
      if (configStatusTimeout.current) window.clearTimeout(configStatusTimeout.current);
      setConfigHeaderStatus(status);
      if (status === 'saved') configStatusTimeout.current = window.setTimeout(() => setConfigHeaderStatus('idle'), 2_000);
    };
    window.addEventListener('leaprs:config-editing', handleConfigEditing);
    return () => {
      window.removeEventListener('leaprs:config-editing', handleConfigEditing);
      if (configStatusTimeout.current) window.clearTimeout(configStatusTimeout.current);
    };
  }, []);

  const handleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  };

  const handleSignOut = async () => {
    try {
      await authClient.signOut();
      router.replace('/');
    } catch (error) {
      console.error('Failed to sign out:', error);
    }
  };

  if (session.isPending) {
    return <Box sx={{ minHeight: '100vh', bgcolor: '#fafcfa', p: 3, pt: 12 }}><ResourceGridSkeleton /></Box>;
  }
  if (!session.data) return null;

  const userName = session.data.user.name || session.data.user.email || 'Admin';
  const statusRouteMatch = pathname.match(/^\/admin\/capdev\/(\d+)\/requests\/(\d+)\/status$/);
  const settingsReturnPath = searchParams.get('from');
  const isSettingsPage = pathname.startsWith('/admin/settings');
  const safeSettingsReturnPath = settingsReturnPath?.startsWith('/admin') && !settingsReturnPath.startsWith('//') ? settingsReturnPath : null;
  const backHref = isSettingsPage && safeSettingsReturnPath
    ? safeSettingsReturnPath
    : statusRouteMatch
      ? `/admin/capdev/${statusRouteMatch[1]}/requests`
      : pathname === '/admin/users' || pathname === '/admin/analytics' || pathname === '/admin/reports' || pathname === '/admin/audit-logs' || pathname === '/admin/settings/capdev' || pathname === '/admin/settings/request'
        ? '/admin/settings'
        : '/admin';
  const settingsHref = `/admin/settings?from=${encodeURIComponent(pathname)}`;
  const isDashboard = pathname === '/admin';
  const roleLabel = !role
    ? '...'
    : role === 'viewer-full'
    ? 'Viewer (All)'
    : role === 'employee-department'
    ? 'Employee (Department)'
    : `${role.charAt(0).toUpperCase()}${role.slice(1)}`;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#fafcfa' }}>
      <AppBar position="fixed" color="inherit" elevation={0} sx={{ bgcolor: '#fafcfa', borderBottom: '1px solid rgba(28, 40, 28, 0.12)' }}>
        <Toolbar sx={{ minHeight: { xs: 64, md: 72 }, px: { xs: 2, md: 3 }, display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr) auto', md: 'minmax(180px, 1fr) auto minmax(180px, 1fr)' }, alignItems: 'center', columnGap: 1.5, position: 'relative' }}>
          <Stack direction="row" spacing={1.5} sx={{ gridColumn: 1, gridRow: 1, minWidth: 0, alignItems: 'center' }}>
            <Typography variant="h6" noWrap sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 700, color: 'text.primary' }}>{greeting}, {userName}</Typography>
            <Chip label={roleLabel} size="small" color="primary" sx={{ flexShrink: 0, fontWeight: 700, height: 24, borderRadius: '6px' }} />
          </Stack>
          <Stack direction="row" spacing={0.75} sx={{ gridColumn: { xs: 2, md: 3 }, gridRow: 1, justifySelf: 'end', flexShrink: 0, alignItems: 'center' }}>
            {!isDashboard && <Tooltip title="Back"><IconButton color="primary" onClick={() => router.push(backHref)} aria-label="Back"><ArrowBackIcon /></IconButton></Tooltip>}
            <NotificationsMenu />
            {role && role !== 'employee' && role !== 'employee-department' && !isSettingsPage && <Tooltip title="Settings"><IconButton color="primary" onClick={() => router.push(settingsHref)} aria-label="Settings"><SettingsIcon /></IconButton></Tooltip>}
            <Tooltip title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}><IconButton color="primary" onClick={handleFullscreen} aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>{isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}</IconButton></Tooltip>
            <Tooltip title="Sign out"><IconButton color="error" onClick={handleSignOut} aria-label="Sign out"><ExitToAppIcon /></IconButton></Tooltip>
          </Stack>
          {statusRouteMatch && <Box sx={{ display: { xs: 'none', md: 'block' }, gridColumn: 2, gridRow: 1, minWidth: 0 }}><RequestTimelineProgress requestId={Number(statusRouteMatch[2])} /></Box>}
          {configHeaderStatus !== 'idle' && <Tooltip title={configHeaderStatus === 'saved' ? 'Configuration saved' : 'Configuration in progress'}><Box sx={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', display: 'grid', placeItems: 'center' }}>{configHeaderStatus === 'saved' ? <CheckIcon sx={{ color: 'success.main', fontSize: 26, animation: 'leaprs-config-check-in 300ms ease-out', '@keyframes leaprs-config-check-in': { '0%': { transform: 'scale(0)', opacity: 0 }, '70%': { transform: 'scale(1.2)', opacity: 1 }, '100%': { transform: 'scale(1)', opacity: 1 } } }} /> : <CircularProgress size={22} color="primary" />}</Box></Tooltip>}
        </Toolbar>
      </AppBar>
      <Box component="main" sx={{ minHeight: '100vh', boxSizing: 'border-box', px: { xs: 2, md: 3 }, pb: { xs: 2, md: 3 }, pt: { xs: '80px', md: '96px' } }}>{children}</Box>
    </Box>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<Box sx={{ minHeight: '100vh', bgcolor: '#fafcfa', p: 3, pt: 12 }}><ResourceGridSkeleton /></Box>}>
      <AdminLayoutContent>{children}</AdminLayoutContent>
    </Suspense>
  );
}
