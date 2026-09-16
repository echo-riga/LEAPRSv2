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
  Paper,
  InputAdornment,
  IconButton,
  MenuItem,
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
  ArrowBack as ArrowBackIcon,
  Key as KeyIcon,
} from '@mui/icons-material';
import { checkDrizzleConnection, completeSelfRegistration, DbStatus, getDepartmentOptions, getMaintenanceMode, getOrCreateUserRole, requestPasswordReset, verifyAndResetPassword } from './actions';
import { authClient } from '@/lib/auth/client';
import { ROLE_OPTIONS, roleLabel } from '@/lib/role-options';
import DepartmentCombobox from '@/components/DepartmentCombobox';
import { useRouter } from 'next/navigation';
import { getFriendlyPasswordError, getPasswordValidationError, PASSWORD_REQUIREMENTS } from '@/lib/password-validation';

const SELF_REGISTRATION_ROLE_OPTIONS = ROLE_OPTIONS.filter(({ value }) => value === 'employee' || value === 'employee-department' || value === 'viewer' || value === 'viewer-full');

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
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [isSignUpMode, setIsSignUpMode] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [fullName, setFullName] = useState('');
  const [signUpEmail, setSignUpEmail] = useState('');
  const [signUpPassword, setSignUpPassword] = useState('');
  const [signUpRole, setSignUpRole] = useState<'employee' | 'employee-department' | 'viewer' | 'viewer-full'>('employee');
  const [signUpDepartment, setSignUpDepartment] = useState('');
  const [signUpDepartmentIsOther, setSignUpDepartmentIsOther] = useState(false);
  const [departmentOptions, setDepartmentOptions] = useState<string[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Forgot Password States
  const [isForgotPasswordMode, setIsForgotPasswordMode] = useState(false);
  const [forgotStep, setForgotStep] = useState<1 | 2>(1);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotCode, setForgotCode] = useState('');
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotSuccess, setForgotSuccess] = useState<string | null>(null);


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
    void getDepartmentOptions().then(setDepartmentOptions);
    void getMaintenanceMode().then((result) => setMaintenanceMode(result.enabled));
  }, []);

  useEffect(() => {
    let isMounted = true;
    const checkUserRole = async () => {
      if (session.data) {
        if (isRegistering) return;
        setCheckingRole(true);
        try {
          const resolvedRole = await getOrCreateUserRole(session.data.user.id);
          if (resolvedRole === 'pending-approval') {
            if (isMounted) setAuthSuccess('Your Employee (All Department Requests) access is awaiting admin approval.');
            await authClient.signOut();
            return;
          }
          if (resolvedRole === 'rejected') {
            if (isMounted) setAuthError('Your Employee (All Department Requests) access request was rejected.');
            await authClient.signOut();
            return;
          }
          const maintenance = await getMaintenanceMode();
          if (maintenance.enabled && resolvedRole !== 'admin') {
            if (isMounted) {
              setMaintenanceMode(true);
              setAuthError(null);
              setAuthSuccess(null);
            }
            await authClient.signOut();
            return;
          }
          if (isMounted) {
            const next = new URLSearchParams(window.location.search).get('next');
            router.replace(next?.startsWith('/api/mcp/oauth/authorize?') ? next : '/portal');
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
  }, [isRegistering, session.data, router]);

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

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const passwordError = getPasswordValidationError(signUpPassword);
    if (passwordError) {
      setAuthError(passwordError);
      setAuthSuccess(null);
      return;
    }
    setAuthLoading(true);
    setIsRegistering(true);
    setAuthError(null);
    setAuthSuccess(null);

    try {
      const result = await authClient.signUp.email({
        name: fullName.trim(),
        email: signUpEmail.trim(),
        password: signUpPassword,
      });
      if (result?.error) {
        setAuthError(getFriendlyPasswordError(result.error.message, signUpPassword));
        setIsRegistering(false);
        return;
      }

      const profile = await completeSelfRegistration({ role: signUpRole, department: signUpDepartment });
      if (!profile.success) {
        await authClient.signOut();
        setAuthError(profile.error || 'Unable to complete registration.');
        setIsRegistering(false);
        return;
      }

      if ('pendingApproval' in profile && profile.pendingApproval) {
        setAuthSuccess('Registration submitted. An admin must approve Employee (All Department Requests) access before you can sign in.');
        setFullName('');
        setSignUpEmail('');
        setSignUpPassword('');
        setSignUpDepartment('');
        setSignUpDepartmentIsOther(false);
        setIsSignUpMode(false);
        setIsRegistering(false);
        await authClient.signOut();
        return;
      }

      const maintenance = await getMaintenanceMode();
      if (maintenance.enabled) {
        await authClient.signOut();
        setMaintenanceMode(true);
        setAuthSuccess('Account created. You can sign in after maintenance mode is turned off.');
        setFullName('');
        setSignUpEmail('');
        setSignUpPassword('');
        setSignUpDepartment('');
        setSignUpDepartmentIsOther(false);
        setIsSignUpMode(false);
        setIsRegistering(false);
        return;
      }

      setAuthSuccess('Account created. Loading Portal...');
      setFullName('');
      setSignUpEmail('');
      setSignUpPassword('');
      setSignUpDepartment('');
      setSignUpDepartmentIsOther(false);
      router.replace('/portal');
    } catch (err: any) {
      setAuthError(err.message || 'An unexpected server error occurred.');
      setIsRegistering(false);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotLoading(true);
    setForgotError(null);
    setForgotSuccess(null);

    try {
      const res = await requestPasswordReset(forgotEmail);
      if (!res.success) {
        setForgotError(res.error || 'Failed to send reset code.');
      } else {
        setForgotSuccess(res.message || 'Verification code sent to your email.');
        setForgotStep(2);
      }
    } catch (err: any) {
      setForgotError(err.message || 'An unexpected error occurred.');
    } finally {
      setForgotLoading(false);
    }
  };

  const handleVerifyAndReset = async (e: React.FormEvent) => {
    e.preventDefault();
    const passwordError = getPasswordValidationError(forgotNewPassword);
    if (passwordError) {
      setForgotError(passwordError);
      setForgotSuccess(null);
      return;
    }
    if (forgotNewPassword !== forgotConfirmPassword) {
      setForgotError('Passwords do not match.');
      return;
    }
    setForgotLoading(true);
    setForgotError(null);
    setForgotSuccess(null);

    try {
      const res = await verifyAndResetPassword(forgotEmail, forgotCode, forgotNewPassword);
      if (!res.success) {
        setForgotError(res.error || 'Failed to reset password.');
      } else {
        setAuthSuccess('Password reset successfully. You can now sign in.');
        setEmail(forgotEmail);
        setIsForgotPasswordMode(false);
        setForgotStep(1);
        setForgotCode('');
        setForgotNewPassword('');
        setForgotConfirmPassword('');
      }
    } catch (err: any) {
      setForgotError(err.message || 'An unexpected error occurred.');
    } finally {
      setForgotLoading(false);
    }
  };

  const handleOpenForgotPassword = () => {
    setAuthError(null);
    setAuthSuccess(null);
    setForgotError(null);
    setForgotSuccess(null);
    setForgotEmail(email || '');
    setForgotStep(1);
    setIsForgotPasswordMode(true);
  };

  const handleOpenSignUp = () => {
    setAuthError(null);
    setAuthSuccess(null);
    setIsForgotPasswordMode(false);
    setSignUpDepartmentIsOther(false);
    setIsSignUpMode(true);
  };

  const handleBackToSignIn = () => {
    setIsForgotPasswordMode(false);
    setIsSignUpMode(false);
    setSignUpDepartmentIsOther(false);
    setForgotStep(1);
    setForgotError(null);
    setForgotSuccess(null);
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
          <Typography variant="h4" sx={{ fontWeight: '900', letterSpacing: '-0.5px', lineHeight: 1.25, maxWidth: 680 }}>
            Lifelong Education Advancement
            <br />
            Program Requisition System
          </Typography>
          <Typography variant="subtitle1" sx={{ opacity: 0.9, fontWeight: '500', mt: 1 }}>
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
            <Typography variant="h6" color="primary" sx={{ fontWeight: '900', lineHeight: 1.3 }}>
              Lifelong Education Advancement
              <br />
              Program Requisition System
            </Typography>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 0.5 }}>
              Request for Training
            </Typography>
          </Box>

          {/* Form Header */}
          <Box sx={{ mb: 4 }}>
            <Typography variant="h4" color="text.primary" sx={{ fontWeight: '800', letterSpacing: '-0.5px' }}>
              {isForgotPasswordMode ? 'Reset Password' : isSignUpMode ? 'Sign Up' : 'Sign In'}
            </Typography>
          </Box>

          {isSignUpMode ? (
            <>
              {authError && <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>{authError}</Alert>}
              {authSuccess && <Alert severity="success" sx={{ mb: 3, borderRadius: 2 }}>{authSuccess}</Alert>}
              <form onSubmit={handleSignUp}>
                <Stack spacing={2.5}>
                  <TextField label="Full Name" required fullWidth value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={authLoading} slotProps={{ input: { startAdornment: <InputAdornment position="start"><PersonIcon color="action" /></InputAdornment> } }} />
                  <TextField label="Email Address" type="email" required fullWidth value={signUpEmail} onChange={(e) => setSignUpEmail(e.target.value)} disabled={authLoading} slotProps={{ input: { startAdornment: <InputAdornment position="start"><EmailIcon color="action" /></InputAdornment> } }} />
                  <TextField label="Password" type="password" required fullWidth value={signUpPassword} onChange={(e) => setSignUpPassword(e.target.value)} disabled={authLoading} helperText={PASSWORD_REQUIREMENTS} slotProps={{ input: { startAdornment: <InputAdornment position="start"><LockIcon color="action" /></InputAdornment> } }} />
                  <TextField select label="Role" required fullWidth value={signUpRole} onChange={(e) => setSignUpRole(e.target.value as 'employee' | 'employee-department' | 'viewer' | 'viewer-full')} disabled={authLoading} slotProps={{ select: { renderValue: (value) => roleLabel(String(value)) } }}>
                    {SELF_REGISTRATION_ROLE_OPTIONS.map((option) => (
                      <MenuItem key={option.value} value={option.value} sx={{ py: 1.25, whiteSpace: 'normal' }}>
                        <Box>
                          <Typography variant="body1">{option.label}</Typography>
                          <Typography variant="caption" color="text.secondary">{option.description}</Typography>
                        </Box>
                      </MenuItem>
                    ))}
                  </TextField>
                  <DepartmentCombobox options={departmentOptions} value={signUpDepartment} onChange={setSignUpDepartment} otherSelected={signUpDepartmentIsOther} onOtherSelectedChange={setSignUpDepartmentIsOther} required disabled={authLoading} />
                  <Button type="submit" variant="contained" color="primary" fullWidth size="large" disabled={authLoading || !fullName.trim() || !signUpDepartment.trim()} sx={{ py: 1.7, fontSize: '1.05rem', boxShadow: '0 4px 12px rgba(46, 125, 50, 0.25)' }}>
                    {authLoading ? <CircularProgress size={24} color="inherit" /> : 'Create Account'}
                  </Button>
                  <Button variant="text" color="secondary" fullWidth onClick={handleBackToSignIn} disabled={authLoading} startIcon={<ArrowBackIcon />} sx={{ textTransform: 'none', fontWeight: 600 }}>
                    Back to Sign In
                  </Button>
                </Stack>
              </form>
            </>
          ) : !isForgotPasswordMode ? (
            <>
              {maintenanceMode && (
                <Alert severity="warning" sx={{ mb: 3, borderRadius: 2 }}>
                  Maintenance mode is active. Only administrators can sign in.
                </Alert>
              )}
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

                  <Stack direction="row" sx={{ justifyContent: 'flex-end', mt: -1 }}>
                    <Button
                      variant="text"
                      color="primary"
                      onClick={handleOpenForgotPassword}
                      disabled={authLoading}
                      sx={{
                        textTransform: 'none',
                        p: 0,
                        minWidth: 'auto',
                        fontSize: '0.875rem',
                        fontWeight: 600,
                        '&:hover': { bgcolor: 'transparent', textDecoration: 'underline' },
                      }}
                    >
                      Forgot Password?
                    </Button>
                  </Stack>

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
              <Button variant="text" color="secondary" fullWidth onClick={handleOpenSignUp} disabled={authLoading} sx={{ mt: 2, textTransform: 'none', fontWeight: 600 }}>
                Create an account
              </Button>
            </>
          ) : (
            <>
              {forgotError && (
                <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
                  {forgotError}
                </Alert>
              )}

              {forgotSuccess && (
                <Alert severity="success" sx={{ mb: 3, borderRadius: 2 }}>
                  {forgotSuccess}
                </Alert>
              )}

              {forgotStep === 1 ? (
                /* Forgot Password Step 1: Request Code */
                <form onSubmit={handleRequestReset}>
                  <Stack spacing={3}>
                    <TextField
                      label="Email Address"
                      type="email"
                      required
                      fullWidth
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      disabled={forgotLoading}
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

                    <Button
                      type="submit"
                      variant="contained"
                      color="primary"
                      fullWidth
                      size="large"
                      disabled={forgotLoading}
                      sx={{
                        py: 1.7,
                        fontSize: '1.05rem',
                        boxShadow: '0 4px 12px rgba(46, 125, 50, 0.25)',
                        '&:hover': {
                          boxShadow: '0 6px 16px rgba(46, 125, 50, 0.35)',
                        },
                      }}
                    >
                      {forgotLoading ? <CircularProgress size={24} color="inherit" /> : 'Send Verification Code'}
                    </Button>

                    <Button
                      variant="text"
                      color="secondary"
                      fullWidth
                      onClick={handleBackToSignIn}
                      disabled={forgotLoading}
                      startIcon={<ArrowBackIcon />}
                      sx={{ textTransform: 'none', fontWeight: 600 }}
                    >
                      Back to Sign In
                    </Button>
                  </Stack>
                </form>
              ) : (
                /* Forgot Password Step 2: Verify Code & Reset */
                <form onSubmit={handleVerifyAndReset}>
                  <Stack spacing={2.5}>
                    <TextField
                      label="Verification Code"
                      placeholder="6-digit code"
                      required
                      fullWidth
                      value={forgotCode}
                      onChange={(e) => setForgotCode(e.target.value)}
                      disabled={forgotLoading}
                      slotProps={{
                        input: {
                          startAdornment: (
                            <InputAdornment position="start">
                              <KeyIcon color="action" />
                            </InputAdornment>
                          ),
                        },
                      }}
                    />

                    <TextField
                      label="New Password"
                      type="password"
                      required
                      fullWidth
                      value={forgotNewPassword}
                      onChange={(e) => setForgotNewPassword(e.target.value)}
                      disabled={forgotLoading}
                      helperText={PASSWORD_REQUIREMENTS}
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

                    <TextField
                      label="Confirm New Password"
                      type="password"
                      required
                      fullWidth
                      value={forgotConfirmPassword}
                      onChange={(e) => setForgotConfirmPassword(e.target.value)}
                      disabled={forgotLoading}
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
                      disabled={forgotLoading}
                      sx={{
                        py: 1.7,
                        fontSize: '1.05rem',
                        boxShadow: '0 4px 12px rgba(46, 125, 50, 0.25)',
                        '&:hover': {
                          boxShadow: '0 6px 16px rgba(46, 125, 50, 0.35)',
                        },
                      }}
                    >
                      {forgotLoading ? <CircularProgress size={24} color="inherit" /> : 'Update Password'}
                    </Button>

                    <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                      <Button
                        variant="text"
                        color="primary"
                        size="small"
                        onClick={handleRequestReset}
                        disabled={forgotLoading}
                        sx={{ textTransform: 'none', fontWeight: 600 }}
                      >
                        Resend Code
                      </Button>

                      <Button
                        variant="text"
                        color="secondary"
                        size="small"
                        onClick={handleBackToSignIn}
                        disabled={forgotLoading}
                        startIcon={<ArrowBackIcon />}
                        sx={{ textTransform: 'none', fontWeight: 600 }}
                      >
                        Sign In
                      </Button>
                    </Stack>
                  </Stack>
                </form>
              )}
            </>
          )}


          {/* Spacing bottom */}
          <Box sx={{ mt: 4 }} />
        </Box>
      </Box>
    </Box>
  );


}
