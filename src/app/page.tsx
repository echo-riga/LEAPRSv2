'use client';

import React, { useEffect, useState } from 'react';
import {
  Container,
  Box,
  Typography,
  Button,
  Stack,
  TextField,
  Alert,
  CircularProgress,
  Divider,
  Chip,
  Paper,
  InputAdornment,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Storage as StorageIcon,
  Lock as LockIcon,
  Email as EmailIcon,
  CheckCircle as CheckCircleIcon,
  Refresh as RefreshIcon,
  Person as PersonIcon,
  FiberManualRecord as DotIcon,
  AccessTime as AccessTimeIcon,
  Dns as DnsIcon,
  Fullscreen as FullscreenIcon,
  FullscreenExit as FullscreenExitIcon,
} from '@mui/icons-material';
import { checkDrizzleConnection, DbStatus, getOrCreateUserRole } from './actions';
import { authClient } from '@/lib/auth/client';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();

  // DB Status States
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);
  const [checkingDb, setCheckingDb] = useState(false);

  // Auth States
  const session = authClient.useSession();
  const [checkingRole, setCheckingRole] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Clock States
  const [timeStr, setTimeStr] = useState('');
  const [dateStr, setDateStr] = useState('');

  // Clock effect for Kiosk look
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(
        now.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        })
      );
      setDateStr(
        now.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

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

  const handleCheckDb = async () => {
    setCheckingDb(true);
    try {
      const status = await checkDrizzleConnection();
      setDbStatus(status);
    } catch (e: any) {
      setDbStatus({
        success: false,
        errorMessage: e.message || 'Failed to check database',
      });
    } finally {
      setCheckingDb(false);
    }
  };

  useEffect(() => {
    if (session.data) {
      handleCheckDb();
    }
  }, [session.data]);

  useEffect(() => {
    let isMounted = true;
    const checkUserRole = async () => {
      if (session.data) {
        setCheckingRole(true);
        try {
          await getOrCreateUserRole(
            session.data.user.id,
            session.data.user.email
          );
          if (isMounted) {
            router.replace('/admin');
          }
        } catch (error) {
          console.error('Failed to get/create user role:', error);
        } finally {
          if (isMounted) {
            setCheckingRole(false);
          }
        }
      } else {
        if (isMounted) {
          setCheckingRole(false);
        }
      }
    };
    checkUserRole();
    return () => {
      isMounted = false;
    };
  }, [session.data, router]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    setAuthSuccess(null);

    try {
      const res = await authClient.signIn.email({
        email,
        password,
      });

      if (res?.error) {
        setAuthError(res.error.message || 'Access Denied. Check credentials.');
      } else {
        setAuthSuccess('Access Granted. Loading Portal...');
        setEmail('');
        setPassword('');
      }
    } catch (err: any) {
      setAuthError(err.message || 'An unexpected server error occurred.');
    } finally {
      setAuthLoading(false);
    }
  };

  // Loading Session State
  if (session.isPending || (session.data && checkingRole)) {
    return (
      <Box
        sx={{
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'background.default',
        }}
      >
        <Stack spacing={2} sx={{ alignItems: 'center' }}>
          <CircularProgress color="primary" size={50} />
          <Typography variant="body2" color="text.secondary" sx={{ fontWeight: '500' }}>
            Loading...
          </Typography>
        </Stack>
      </Box>
    );
  }

  // All authenticated users enter the shared portal. Individual features remain
  // controlled by the role checks within the portal and server actions.
  if (session.data) {
    return (
      <Box
        sx={{
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'background.default',
        }}
      >
        <Stack spacing={2} sx={{ alignItems: 'center' }}>
          <CircularProgress color="primary" size={50} />
          <Typography variant="body2" color="text.secondary" sx={{ fontWeight: '500' }}>
            Loading Portal...
          </Typography>
        </Stack>
      </Box>
    );
  }

  // Unauthenticated Kiosk 70/30 Split Login Screen
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', width: '100vw', overflow: 'hidden', bgcolor: 'background.default' }}>
      <Tooltip title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>
        <IconButton
          color="primary"
          onClick={handleFullscreen}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          sx={{ position: 'fixed', top: { xs: 12, md: 16 }, right: { xs: 12, md: 16 }, zIndex: 10, bgcolor: 'rgba(250, 252, 250, 0.92)', boxShadow: '0 2px 8px rgba(28, 40, 28, 0.12)', '&:hover': { bgcolor: '#fafcfa' } }}
        >
          {isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
        </IconButton>
      </Tooltip>
      {/* Left Panel: 70% Width Background Image */}
      <Box
        sx={{
          flex: 7,
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          justifyContent: 'space-between',
          p: 6,
          backgroundImage: 'url(/login_left_bg.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          position: 'relative',
          color: '#ffffff',
          '&::before': {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(27, 94, 32, 0.45)', // Translucent overlay using Forest Green
            zIndex: 1,
          },
        }}
      >
        {/* Upper Brand Section */}
        <Box sx={{ position: 'relative', zIndex: 2 }}>
          <Typography variant="h3" sx={{ fontWeight: '900', letterSpacing: '-1px' }}>
            LEAPRS
          </Typography>
          <Typography variant="subtitle1" sx={{ opacity: 0.9, fontWeight: '500' }}>
            Request for Training
          </Typography>
        </Box>

        {/* Middle Clock & Kiosk Information */}
        <Box sx={{ position: 'relative', zIndex: 2, my: 'auto' }}>
          <Stack spacing={1}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <AccessTimeIcon sx={{ fontSize: 32, opacity: 0.8 }} />
              <Typography variant="h6" sx={{ opacity: 0.8, textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '500' }}>
                Current Local Time
              </Typography>
            </Stack>
            <Typography variant="h2" sx={{ fontWeight: '800', lineHeight: 1 }}>
              {timeStr}
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: '400', opacity: 0.9 }}>
              {dateStr}
            </Typography>
          </Stack>
        </Box>

        {/* Empty space footer */}
        <Box sx={{ position: 'relative', zIndex: 2 }} />
      </Box>

      {/* Right Panel: 30% Width Login Form */}
      <Box
        sx={{
          flex: 3,
          width: { xs: '100%', md: '30%' },
          minWidth: { md: '380px' },
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          p: { xs: 4, sm: 6 },
          bgcolor: 'background.paper',
          borderLeft: '1px solid',
          borderColor: 'divider',
          boxShadow: { xs: 0, md: '-4px 20px 25px -5px rgba(0,0,0,0.05)' },
        }}
      >
        <Box sx={{ width: '100%', maxWidth: '340px', mx: 'auto' }}>
          {/* Header Mobile Brand */}
          <Box sx={{ display: { xs: 'block', md: 'none' }, mb: 4, textAlign: 'center' }}>
            <Typography variant="h4" color="primary" sx={{ fontWeight: '900' }}>
              LEAPRS
            </Typography>
            <Typography variant="subtitle2" color="text.secondary">
              Request for Training
            </Typography>
          </Box>

          {/* Form Header */}
          <Box sx={{ mb: 4 }}>
            <Typography variant="h4" color="text.primary" sx={{ fontWeight: '800', letterSpacing: '-0.5px' }}>
              Sign In
            </Typography>
          </Box>

          {authError && (
            <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
              {authError}
            </Alert>
          )}

          {authSuccess && (
            <Alert severity="success" sx={{ mb: 3, borderRadius: 2 }}>
              {authSuccess}
            </Alert>
          )}

          {/* Login Form */}
          <form onSubmit={handleSignIn}>
            <Stack spacing={3}>
              <TextField
                label="Email Address"
                type="email"
                required
                fullWidth
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={authLoading}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <EmailIcon color="action" />
                      </InputAdornment>
                    ),
                  },
                }}
              />

              <TextField
                label="Password"
                type="password"
                required
                fullWidth
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={authLoading}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <LockIcon color="action" />
                      </InputAdornment>
                    ),
                  },
                }}
              />

              <Button
                type="submit"
                variant="contained"
                color="primary"
                fullWidth
                size="large"
                disabled={authLoading}
                sx={{
                  py: 1.7,
                  fontSize: '1.05rem',
                  boxShadow: '0 4px 12px rgba(46, 125, 50, 0.25)',
                  '&:hover': {
                    boxShadow: '0 6px 16px rgba(46, 125, 50, 0.35)',
                  },
                }}
              >
                {authLoading ? <CircularProgress size={24} color="inherit" /> : 'Enter'}
              </Button>
            </Stack>
          </form>

          {/* Spacing bottom */}
          <Box sx={{ mt: 4 }} />
        </Box>
      </Box>
    </Box>
  );


}
