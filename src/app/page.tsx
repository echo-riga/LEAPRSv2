'use client';

import React, { useEffect, useState } from 'react';
import {
  Container,
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Stack,
  TextField,
  Alert,
  Tabs,
  Tab,
  CircularProgress,
  Divider,
  Chip,
  Paper,
} from '@mui/material';
import {
  Storage as StorageIcon,
  Lock as LockIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Refresh as RefreshIcon,
  Person as PersonIcon,
  ExitToApp as ExitToAppIcon,
  FiberManualRecord as DotIcon,
} from '@mui/icons-material';
import { checkDrizzleConnection, DbStatus } from './actions';
import { authClient } from '@/lib/auth/client';

export default function Home() {
  // DB Status States
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);
  const [checkingDb, setCheckingDb] = useState(false);

  // Auth States
  const session = authClient.useSession();
  const [authTab, setAuthTab] = useState(0);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);

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
    handleCheckDb();
  }, []);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    setAuthSuccess(null);

    try {
      const res = await authClient.signUp.email({
        email,
        password,
        name,
      });

      if (res?.error) {
        setAuthError(res.error.message || 'Registration failed');
      } else {
        setAuthSuccess('Successfully registered! You are now logged in.');
        setEmail('');
        setPassword('');
        setName('');
        // Refresh db status to show new write checks if needed
        handleCheckDb();
      }
    } catch (err: any) {
      setAuthError(err.message || 'An unexpected error occurred');
    } finally {
      setAuthLoading(false);
    }
  };

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
        setAuthError(res.error.message || 'Sign in failed');
      } else {
        setAuthSuccess('Successfully signed in!');
        setEmail('');
        setPassword('');
      }
    } catch (err: any) {
      setAuthError(err.message || 'An unexpected error occurred');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    setAuthLoading(true);
    try {
      await authClient.signOut();
      setAuthSuccess('Logged out successfully.');
      setAuthError(null);
    } catch (err: any) {
      setAuthError(err.message || 'Failed to log out');
    } finally {
      setAuthLoading(false);
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 6, display: 'flex', flexDirection: 'column', minHeight: '100vh', justifyContent: 'center' }}>
      {/* Title Header */}
      <Box sx={{ mb: 6, textAlign: 'center' }}>
        <Typography variant="h3" component="h1" sx={{ fontWeight: '800' }} gutterBottom color="primary">
          Neon PG & Neon Auth Status
        </Typography>
        <Typography variant="subtitle1" color="text.secondary">
          Fullstack connection verification powered by Drizzle ORM and Material UI
        </Typography>
      </Box>

      {/* Grid Layout for Status Cards */}
      <Stack spacing={4}>
        {/* Status Highlights (The requested simple text indicating status) */}
        <Paper variant="outlined" sx={{ p: 3, borderLeft: '6px solid', borderColor: 'primary.main', bgcolor: 'background.paper' }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={4} divider={<Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', sm: 'block' } }} />}>
            {/* Database Simple Status */}
            <Box sx={{ flex: 1 }}>
              <Typography variant="overline" color="text.secondary" sx={{ fontWeight: '700' }}>
                Neon Database Connection
              </Typography>
              <Stack direction="row" sx={{ alignItems: 'center', mt: 1 }} spacing={1}>
                <DotIcon color={dbStatus?.success ? 'primary' : 'error'} sx={{ fontSize: 18 }} />
                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                  {dbStatus?.success ? 'DATABASE CONNECTED' : 'DATABASE DISCONNECTED'}
                </Typography>
              </Stack>
              {dbStatus?.success && (
                <Typography variant="body2" component="div" color="text.secondary" sx={{ mt: 0.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  Read Latency: <Chip size="small" label={`${dbStatus.latencyMs}ms`} color="success" variant="outlined" /> | DB Writes: {dbStatus.writeSuccess ? 'OK' : 'FAIL'}
                </Typography>
              )}
            </Box>

            {/* Auth Simple Status */}
            <Box sx={{ flex: 1 }}>
              <Typography variant="overline" color="text.secondary" sx={{ fontWeight: '700' }}>
                Neon Auth Session Status
              </Typography>
              <Stack direction="row" sx={{ alignItems: 'center', mt: 1 }} spacing={1}>
                <DotIcon color={session.data ? 'primary' : 'secondary'} sx={{ fontSize: 18 }} />
                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                  {session.isPending ? 'CHECKING SESSION...' : session.data ? 'AUTHENTICATED' : 'NOT AUTHENTICATED'}
                </Typography>
              </Stack>
              {session.data && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  User: <Box component="span" sx={{ fontWeight: 'bold', color: 'primary.main' }}>{session.data.user.email}</Box>
                </Typography>
              )}
            </Box>
          </Stack>
        </Paper>

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={4}>
          {/* Card 1: Neon PG Details */}
          <Card variant="outlined" sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <CardContent sx={{ flexGrow: 1 }}>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 2 }}>
                <Box sx={{ bgcolor: 'rgba(0, 0, 0, 0.05)', p: 1, borderRadius: 2, display: 'flex' }}>
                  <StorageIcon color="primary" />
                </Box>
                <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
                  Neon PostgreSQL
                </Typography>
              </Stack>

              <Divider sx={{ my: 2 }} />

              <Stack spacing={2}>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    ORM Configured
                  </Typography>
                  <Typography variant="body1" sx={{ fontWeight: 'medium' }}>
                    Drizzle ORM (Serverless HTTP Driver)
                  </Typography>
                </Box>

                <Box>
                  <Typography variant="body2" color="text.secondary">
                    Last Checked
                  </Typography>
                  <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
                    {dbStatus?.testedAt ? new Date(dbStatus.testedAt).toLocaleTimeString() : 'Never'}
                  </Typography>
                </Box>

                {dbStatus?.success && (
                  <>
                    <Box>
                      <Typography variant="body2" color="text.secondary">
                        Total Connection Health Logs
                      </Typography>
                      <Typography variant="h6" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                        {dbStatus.totalChecks} checks
                      </Typography>
                    </Box>
                  </>
                )}

                {dbStatus?.errorMessage && (
                  <Alert severity="error" icon={<ErrorIcon />} sx={{ mt: 1 }}>
                    {dbStatus.errorMessage}
                  </Alert>
                )}
              </Stack>
            </CardContent>
            <Box sx={{ p: 2, pt: 0 }}>
              <Button
                fullWidth
                variant="contained"
                startIcon={checkingDb ? <CircularProgress size={20} color="inherit" /> : <RefreshIcon />}
                onClick={handleCheckDb}
                disabled={checkingDb}
              >
                {checkingDb ? 'Testing Connection...' : 'Test Connection'}
              </Button>
            </Box>
          </Card>

          {/* Card 2: Neon Auth Operations */}
          <Card variant="outlined" sx={{ flex: 1 }}>
            <CardContent>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 2 }}>
                <Box sx={{ bgcolor: 'rgba(0, 0, 0, 0.05)', p: 1, borderRadius: 2, display: 'flex' }}>
                  <LockIcon color="secondary" />
                </Box>
                <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
                  Neon Auth Control
                </Typography>
              </Stack>

              <Divider sx={{ my: 2 }} />

              {authError && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {authError}
                </Alert>
              )}
              {authSuccess && (
                <Alert severity="success" sx={{ mb: 2 }}>
                  {authSuccess}
                </Alert>
              )}

              {session.data ? (
                /* Authenticated State */
                <Stack spacing={3} sx={{ py: 1 }}>
                  <Paper sx={{ p: 2, bgcolor: 'background.default', borderRadius: 2 }}>
                    <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                      <PersonIcon color="primary" sx={{ fontSize: 32 }} />
                      <Box>
                        <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                          {session.data.user.name || 'No Name'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {session.data.user.email}
                        </Typography>
                      </Box>
                    </Stack>
                  </Paper>

                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      Session Created At
                    </Typography>
                    <Typography variant="body2">
                      {new Date(session.data.session.createdAt).toLocaleString()}
                    </Typography>
                  </Box>

                  <Button
                    variant="outlined"
                    color="error"
                    fullWidth
                    startIcon={authLoading ? <CircularProgress size={20} color="inherit" /> : <ExitToAppIcon />}
                    onClick={handleSignOut}
                    disabled={authLoading}
                  >
                    {authLoading ? 'Signing Out...' : 'Sign Out'}
                  </Button>
                </Stack>
              ) : (
                /* Unauthenticated State: Sign In / Sign Up Forms */
                <Box>
                  <Tabs
                    value={authTab}
                    onChange={(_, val) => {
                      setAuthTab(val);
                      setAuthError(null);
                      setAuthSuccess(null);
                    }}
                    variant="fullWidth"
                    sx={{ mb: 2 }}
                  >
                    <Tab label="Sign In" />
                    <Tab label="Register" />
                  </Tabs>

                  {authTab === 0 ? (
                    /* Sign In Form */
                    <form onSubmit={handleSignIn}>
                      <Stack spacing={2}>
                        <TextField
                          label="Email Address"
                          type="email"
                          size="small"
                          fullWidth
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                        />
                        <TextField
                          label="Password"
                          type="password"
                          size="small"
                          fullWidth
                          required
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                        <Button
                          type="submit"
                          variant="contained"
                          color="primary"
                          fullWidth
                          disabled={authLoading}
                        >
                          {authLoading ? <CircularProgress size={24} /> : 'Sign In'}
                        </Button>
                      </Stack>
                    </form>
                  ) : (
                    /* Register Form */
                    <form onSubmit={handleSignUp}>
                      <Stack spacing={2}>
                        <TextField
                          label="Full Name"
                          type="text"
                          size="small"
                          fullWidth
                          required
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                        />
                        <TextField
                          label="Email Address"
                          type="email"
                          size="small"
                          fullWidth
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                        />
                        <TextField
                          label="Password"
                          type="password"
                          size="small"
                          fullWidth
                          required
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                        <Button
                          type="submit"
                          variant="contained"
                          color="primary"
                          fullWidth
                          disabled={authLoading}
                        >
                          {authLoading ? <CircularProgress size={24} /> : 'Register Account'}
                        </Button>
                      </Stack>
                    </form>
                  )}
                </Box>
              )}
            </CardContent>
          </Card>
        </Stack>
      </Stack>

      <Box sx={{ mt: 8, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          Ready for deployment to <Box component="span" sx={{ fontWeight: 'bold', color: 'primary.main' }}>Vercel</Box>. Configured with static optimization and dynamic API routing adapters.
        </Typography>
      </Box>
    </Container>
  );
}
