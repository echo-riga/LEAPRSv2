'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AppBar, Box, Chip, CircularProgress, IconButton, Stack, Toolbar, Tooltip, Typography } from '@mui/material';
import { ArrowBack as ArrowBackIcon, ExitToApp as ExitToAppIcon, Fullscreen as FullscreenIcon, FullscreenExit as FullscreenExitIcon, Settings as SettingsIcon } from '@mui/icons-material';
import { authClient } from '@/lib/auth/client';
import { getCurrentUserAccess, type AppRole } from '@/app/actions';

const ADMIN_ROUTES = ['/admin', '/admin/analytics', '/admin/reports', '/admin/settings', '/admin/users', '/admin/settings/capdev', '/admin/settings/request'];

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
  const [role, setRole] = useState<AppRole>('employee');

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
    return <Box sx={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', bgcolor: '#fafcfa' }}><CircularProgress color="primary" /></Box>;
  }
  if (!session.data) return null;

  const userName = session.data.user.name || session.data.user.email || 'Admin';
  const statusRouteMatch = pathname.match(/^(\/admin\/capdev\/\d+\/requests)\/\d+\/status$/);
  const settingsReturnPath = searchParams.get('from');
  const isSettingsPage = pathname.startsWith('/admin/settings');
  const safeSettingsReturnPath = settingsReturnPath?.startsWith('/admin') && !settingsReturnPath.startsWith('//') ? settingsReturnPath : null;
  const backHref = isSettingsPage && safeSettingsReturnPath
    ? safeSettingsReturnPath
    : statusRouteMatch
      ? statusRouteMatch[1]
      : pathname === '/admin/users' || pathname === '/admin/analytics' || pathname === '/admin/reports' || pathname === '/admin/settings/capdev' || pathname === '/admin/settings/request'
        ? '/admin/settings'
        : '/admin';
  const settingsHref = `/admin/settings?from=${encodeURIComponent(pathname)}`;
  const isDashboard = pathname === '/admin';

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#fafcfa' }}>
      <AppBar position="fixed" color="inherit" elevation={0} sx={{ bgcolor: '#fafcfa', borderBottom: '1px solid rgba(28, 40, 28, 0.12)' }}>
        <Toolbar sx={{ minHeight: { xs: 64, md: 72 }, px: { xs: 2, md: 3 }, justifyContent: 'space-between' }}>
          <Stack direction="row" spacing={1.5} sx={{ minWidth: 0, alignItems: 'center' }}>
            <Typography variant="h6" noWrap sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 700, color: 'text.primary' }}>{greeting}, {userName}</Typography>
            <Chip label="Admin" size="small" color="primary" sx={{ flexShrink: 0, fontWeight: 700, height: 24, borderRadius: '6px' }} />
          </Stack>
          <Stack direction="row" spacing={0.75} sx={{ flexShrink: 0 }}>
            {!isDashboard && <Tooltip title="Back"><IconButton color="primary" onClick={() => router.push(backHref)} aria-label="Back"><ArrowBackIcon /></IconButton></Tooltip>}
            {role !== 'employee' && !isSettingsPage && <Tooltip title="Settings"><IconButton color="primary" onClick={() => router.push(settingsHref)} aria-label="Settings"><SettingsIcon /></IconButton></Tooltip>}
            <Tooltip title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}><IconButton color="primary" onClick={handleFullscreen} aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>{isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}</IconButton></Tooltip>
            <Tooltip title="Sign out"><IconButton color="error" onClick={handleSignOut} aria-label="Sign out"><ExitToAppIcon /></IconButton></Tooltip>
          </Stack>
        </Toolbar>
      </AppBar>
      <Box component="main" sx={{ minHeight: '100vh', boxSizing: 'border-box', px: { xs: 2, md: 3 }, pb: { xs: 2, md: 3 }, pt: { xs: '80px', md: '96px' } }}>{children}</Box>
    </Box>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<Box sx={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', bgcolor: '#fafcfa' }}><CircularProgress color="primary" /></Box>}>
      <AdminLayoutContent>{children}</AdminLayoutContent>
    </Suspense>
  );
}
