'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Alert,
  Container,
  Box,
  Typography,
  Stack,
  Chip,
  Grid,
  Card,
  CardContent,
  Button,
  Avatar,
  Divider,
  Fab,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Checkbox,
  FormControlLabel,
  TextField,
  MenuItem,
  InputAdornment,
} from '@mui/material';
import { ResourceGridSkeleton } from '@/components/Skeletons';
import {
  Add as AddIcon,
  ArchiveOutlined as ArchiveIcon,
  DeleteOutlined as DeleteIcon,
  RestoreOutlined as RestoreIcon,
  Search as SearchIcon,
  Lock as LockIcon,
  Email as EmailIcon,
  Person as PersonIcon,
  FilterList as FilterIcon,
  VisibilityOutlined as VisibilityIcon,
  ManageAccountsOutlined as PendingApprovalIcon,
} from '@mui/icons-material';
import { authClient } from '@/lib/auth/client';
import { archiveDirectoryUser, deleteArchivedDirectoryUser, createDirectoryUser, decideRoleApproval, getCurrentUserAccess, getDepartmentOptions, getPendingRoleApprovals, getUsersDirectory, restoreDirectoryUser, updateDirectoryUser, createUser, type PendingRoleApproval } from '@/app/actions';
import ActionErrorDialog from '@/components/ActionErrorDialog';
import DeleteConfirmationDialog from '@/components/DeleteConfirmationDialog';
import DateField from '@/components/DateField';
import { ROLE_OPTIONS, roleLabel } from '@/lib/role-options';
import DepartmentCombobox from '@/components/DepartmentCombobox';
import { getFriendlyPasswordError, getPasswordValidationError, PASSWORD_REQUIREMENTS } from '@/lib/password-validation';
import { focusFormError } from '@/lib/form-error-focus';

interface UserEntity {
  id: string;
  role: string;
  email: string;
  name: string;
  password?: string;
  isMock?: boolean;
  createdAt: Date | string;
  department: string;
  isArchived: boolean;
  archivedAt: Date | string | null;
}

const ALL_ROLES = ROLE_OPTIONS.map(({ value }) => value);

export default function UsersManagementPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const session = authClient.useSession();
  const [loading, setLoading] = useState(true);
  const [usersList, setUsersList] = useState<UserEntity[]>([]);
  const [archivingUser, setArchivingUser] = useState<UserEntity | null>(null);
  const [deletingUser, setDeletingUser] = useState<UserEntity | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState('');
  const [restoringUserId, setRestoringUserId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [departmentOptions, setDepartmentOptions] = useState<string[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingRoleApproval[]>([]);
  const [approvalActionId, setApprovalActionId] = useState<number | null>(null);
  const [pendingApprovalsOpen, setPendingApprovalsOpen] = useState(false);
  const [approvalFocus, setApprovalFocus] = useState<{ id: number; nonce: number } | null>(null);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string[]>(ALL_ROLES);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftRoleFilter, setDraftRoleFilter] = useState<string[]>(ALL_ROLES);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [draftDateFrom, setDraftDateFrom] = useState('');
  const [draftDateTo, setDraftDateTo] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState<string[]>([]);
  const [draftDepartmentFilter, setDraftDepartmentFilter] = useState<string[]>([]);
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [draftSortOrder, setDraftSortOrder] = useState<'newest' | 'oldest'>('newest');

  // Pagination State (6 items per page to prevent scrolling)
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 6;

  // Add / Edit Dialog States
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserEntity | null>(null);

  // Form Field States
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formNameError, setFormNameError] = useState('');
  const [formEmailError, setFormEmailError] = useState('');
  const [formPasswordError, setFormPasswordError] = useState('');
  const [formError, setFormError] = useState('');
  const showUserFormError = (message: string) => {
    setFormError(message);
    focusFormError('user-form-error');
  };
  const [formRole, setFormRole] = useState('employee');
  const [formDepartment, setFormDepartment] = useState('');
  const [formDepartmentIsOther, setFormDepartmentIsOther] = useState(false);

  // Redirect if not logged in
  useEffect(() => {
    if (!session.isPending && !session.data) {
      router.push('/');
    }
  }, [session.isPending, session.data, router]);

  useEffect(() => {
    if (!session.data) return;
    void getCurrentUserAccess().then((access) => { if (access.success && access.role !== 'admin') router.replace('/portal'); });
  }, [router, session.data]);

  // Load users from DB
  const loadUsers = async (showLoading = true) => {
    if (!session.data) return;

    if (showLoading) setLoading(true);
    try {
      const [directoryUsers, departments, approvalResult] = await Promise.all([getUsersDirectory(), getDepartmentOptions(), getPendingRoleApprovals()]);

      const formattedDbUsers = directoryUsers.map(u => ({
        id: u.id,
        role: u.role,
        name: u.name || 'Unnamed user',
        email: u.email,
        password: '••••••••',
        isMock: false,
        createdAt: u.createdAt,
        department: u.department,
        isArchived: u.isArchived,
        archivedAt: u.archivedAt,
      }));

      setUsersList(formattedDbUsers);
      setDepartmentOptions(departments);
      if (approvalResult.success) setPendingApprovals(approvalResult.approvals);
      const initialDepartments = Array.from(new Set(formattedDbUsers.map((user) => user.department))).sort();
      setDepartmentFilter(initialDepartments);
      setDraftDepartmentFilter(initialDepartments);
    } catch (err) {
      console.error('Error loading users:', err);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const handleApprovalDecision = async (approvalId: number, decision: 'accepted' | 'rejected') => {
    setApprovalActionId(approvalId);
    const result = await decideRoleApproval(approvalId, decision);
    if (result.success) {
      setPendingApprovals((current) => current.filter((approval) => approval.id !== approvalId));
      if (pendingApprovals.length === 1) setPendingApprovalsOpen(false);
      if (decision === 'accepted') await loadUsers(false);
    } else {
      console.error('Failed to decide role approval:', result.error);
    }
    setApprovalActionId(null);
  };

  useEffect(() => {
    if (session.data) {
      loadUsers();
    }
  }, [session.data]);

  useEffect(() => {
    if (searchParams.has('approval')) setPendingApprovalsOpen(true);
  }, [searchParams]);

  useEffect(() => {
    const focusApproval = (targetId: string) => {
      const match = /^role-approval-(\d+)$/.exec(targetId);
      if (!match) return;
      setPendingApprovalsOpen(true);
      setApprovalFocus({ id: Number(match[1]), nonce: Date.now() });
    };
    const focusFromHash = () => {
      const targetId = decodeURIComponent(window.location.hash.slice(1));
      if (targetId) focusApproval(targetId);
    };
    const handleNotificationFocus = (event: Event) => {
      const detail = (event as CustomEvent<{ targetId?: string }>).detail;
      if (detail?.targetId) focusApproval(detail.targetId);
    };

    window.addEventListener('hashchange', focusFromHash);
    window.addEventListener('leaprs:notification-focus', handleNotificationFocus);
    focusFromHash();
    return () => {
      window.removeEventListener('hashchange', focusFromHash);
      window.removeEventListener('leaprs:notification-focus', handleNotificationFocus);
    };
  }, []);

  useEffect(() => {
    if (!approvalFocus || !pendingApprovalsOpen || loading) return;
    const target = document.getElementById(`role-approval-${approvalFocus.id}`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const timeoutId = window.setTimeout(() => {
      setApprovalFocus((current) => current?.nonce === approvalFocus.nonce ? null : current);
    }, 2500);
    return () => window.clearTimeout(timeoutId);
  }, [approvalFocus, loading, pendingApprovalsOpen, pendingApprovals]);

  // Open dialog for adding a new user
  const handleOpenAddDialog = () => {
    setEditingUser(null);
    setFormName('');
    setFormEmail('');
    setFormPassword('');
    setFormNameError('');
    setFormEmailError('');
    setFormPasswordError('');
    setFormError('');
    setFormRole('employee');
    setFormDepartment('');
    setFormDepartmentIsOther(false);
    setDialogOpen(true);
  };

  // Open dialog for editing a user
  const handleOpenEditDialog = (user: UserEntity) => {
    setEditingUser(user);
    setFormName(user.name);
    setFormEmail(user.email);
    setFormPassword(''); // Clear password field, indicating "keep current"
    setFormNameError('');
    setFormEmailError('');
    setFormPasswordError('');
    setFormError('');
    setFormRole(user.role);
    setFormDepartment(user.department);
    setFormDepartmentIsOther(false);
    setDialogOpen(true);
  };

  // Save Add / Edit Form
  const handleSaveUser = async () => {
    if (showArchived || editingUser?.isArchived) return;
    if (!formName || !formEmail) return;
    if (formRole === 'viewer' && !formDepartment.trim()) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formEmail.trim())) {
      setFormEmailError('Enter a valid email address.');
      focusFormError('user-field-email');
      return;
    }
    if (formPassword) {
      const passwordError = getPasswordValidationError(formPassword);
      if (passwordError) {
        setFormPasswordError(passwordError);
        focusFormError('user-field-password');
        return;
      }
    }
    setFormError('');

    if (editingUser) {
      // EDIT OPERATION
      const updatedUser = {
        ...editingUser,
        name: formName,
        email: formEmail,
        role: formRole,
        department: formDepartment || 'Unassigned',
        password: '••••••••',
      };

      if (!editingUser.isMock) {
        const result = await updateDirectoryUser(editingUser.id, { name: formName, email: formEmail, role: formRole, department: formDepartment || 'Unassigned', ...(formPassword ? { password: formPassword } : {}) });
        if (!result.success) {
          const message = result.error || 'Unable to update this user.';
          if (message.toLowerCase().includes('password')) {
            setFormPasswordError(getFriendlyPasswordError(message, formPassword));
            focusFormError('user-field-password');
          } else if (message.toLowerCase().includes('email') || message.toLowerCase().includes('duplicate')) {
            setFormEmailError(message);
            focusFormError('user-field-email');
          } else if (message.toLowerCase().includes('name')) {
            setFormNameError(message);
            focusFormError('user-field-name');
          } else {
            showUserFormError(message);
          }
          return;
        }
      }
      setUsersList(prev => prev.map(u => u.id === editingUser.id ? updatedUser : u));
      setDialogOpen(false);
    } else {
      // ADD OPERATION
      if (!formPassword) return;
      const passwordError = getPasswordValidationError(formPassword);
      if (passwordError) {
        setFormPasswordError(passwordError);
        focusFormError('user-field-password');
        return;
      }
      const created = await createDirectoryUser({ name: formName, email: formEmail, password: formPassword, role: formRole, department: formDepartment || 'Unassigned' });
      if (!created.success || !created.user) {
        const message = getFriendlyPasswordError(created.error, formPassword);
        const normalized = message.toLowerCase();
        if (normalized.includes('password')) {
          setFormPasswordError(message);
          focusFormError('user-field-password');
        } else if (normalized.includes('email') || normalized.includes('duplicate') || normalized.includes('already')) {
          setFormEmailError(message);
          focusFormError('user-field-email');
        } else if (normalized.includes('name')) {
          setFormNameError(message);
          focusFormError('user-field-name');
        } else {
          showUserFormError(message);
        }
        console.error('Error creating user:', created.error);
        return;
      }
      setUsersList((current) => [{ id: created.user.id, name: created.user.name || formName, email: created.user.email, role: formRole, password: '••••••••', createdAt: created.user.createdAt, department: formDepartment || 'Unassigned', isArchived: false, archivedAt: null }, ...current]);
      setDialogOpen(false);
      return;
      const newId = `user-${Math.random().toString(36).substr(2, 9)}`;
      const newUser: UserEntity = {
        id: newId,
        name: formName,
        email: formEmail,
        role: formRole,
        password: formPassword || '••••••••',
        isMock: true, // New local users are mock by default for presentation
        createdAt: new Date(),
        department: formDepartment || 'Unassigned',
        isArchived: false,
        archivedAt: null,
      };

      setUsersList(prev => [newUser, ...prev]);

      try {
        await createUser(newId, formRole, formDepartment || 'Unassigned');
      } catch (err) {
        console.error('Error creating user in DB:', err);
      }
    }

    setDialogOpen(false);
  };

  const handleArchiveUser = async () => {
    if (!archivingUser || archiveBusy) return;
    setArchiveBusy(true);
    const result = await archiveDirectoryUser(archivingUser.id);
    setArchiveBusy(false);
    if (!result.success) {
      setArchiveError(result.error || 'Unable to archive this user.');
      return;
    }
    setUsersList((current) => current.map((user) => user.id === archivingUser.id ? { ...user, isArchived: true, archivedAt: result.archivedAt || new Date() } : user));
    setArchivingUser(null);
  };

  const handleRestoreUser = async (user: UserEntity) => {
    if (restoringUserId) return;
    setRestoringUserId(user.id);
    const result = await restoreDirectoryUser(user.id);
    setRestoringUserId(null);
    if (!result.success) {
      setArchiveError(result.error || 'Unable to restore this user.');
      return;
    }
    setUsersList((current) => current.map((item) => item.id === user.id ? { ...item, isArchived: false, archivedAt: null } : item));
  };

  // Filter & Search Logic
  const filteredUsers = usersList.filter(user => {
    const matchesSearch =
      user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = roleFilter.includes(user.role);
    const added = new Date(user.createdAt).getTime();
    return user.isArchived === showArchived && matchesSearch && matchesRole && departmentFilter.includes(user.department) && (!dateFrom || added >= new Date(dateFrom).getTime()) && (!dateTo || added <= new Date(`${dateTo}T23:59:59`).getTime());
  }).sort((a, b) => sortOrder === 'newest' ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  // Pagination Logic
  const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = filteredUsers.slice(indexOfFirstItem, indexOfLastItem);

  // Reset page when filter/search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  if (session.isPending || loading) {
    return <ResourceGridSkeleton titleWidth={180} />;
  }

  if (!session.data) {
    return null;
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 'calc(100vh - 72px)',
      }}
    >
      {/* Main Grid Content - Full-width kiosk container */}
      <Container maxWidth={false} sx={{ p: 0, width: '100%', flexGrow: 1, display: 'flex', flexDirection: 'column' }}>

        {/* Filters and Search Row */}
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{
            alignItems: 'center',
            justifyContent: 'space-between',
            mb: 3,
          }}
        >
          <Typography
            variant="h4"
            sx={{
              fontWeight: '800',
              color: 'text.primary',
              letterSpacing: '-1px',
            }}
          >
            Users Management
          </Typography>

          <Stack direction="row" spacing={2} sx={{ width: { xs: '100%', sm: 'auto' }, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Search Input */}
            <TextField
              placeholder="Search user..."
              size="small"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon color="action" />
                    </InputAdornment>
                  ),
                },
              }}
              sx={{
                bgcolor: '#ffffff',
                borderRadius: 2,
                '& .MuiOutlinedInput-root': { borderRadius: 2 },
              }}
            />

            <Button variant="outlined" color="primary" startIcon={<PendingApprovalIcon />} onClick={() => setPendingApprovalsOpen(true)} sx={{ height: 40, whiteSpace: 'nowrap' }}>
              Pending Department Employees
              <Chip label={pendingApprovals.length} size="small" color={pendingApprovals.length > 0 ? 'warning' : 'default'} sx={{ ml: 1, height: 22, fontWeight: 700 }} />
            </Button>

            <Button size="small" sx={{ height: 40 }} variant="outlined" startIcon={<FilterIcon />} onClick={() => { setDraftRoleFilter([...roleFilter]); setDraftDepartmentFilter([...departmentFilter]); setDraftDateFrom(dateFrom); setDraftDateTo(dateTo); setDraftSortOrder(sortOrder); setFiltersOpen(true); }}>Filter</Button>
            <Button size="small" sx={{ height: 40, whiteSpace: 'nowrap' }} variant="outlined" startIcon={showArchived ? <PersonIcon /> : <ArchiveIcon />} onClick={() => { setShowArchived((current) => !current); setCurrentPage(1); }}>
              {showArchived ? 'See Active Users' : 'See Archives'}
            </Button>
          </Stack>
        </Stack>

        {/* 3x2 Kiosk Box Grid (Exactly 6 users to prevent scrolling) */}
        {currentItems.length > 0 ? (
          <Grid container spacing={3} sx={{ flexGrow: 1, alignContent: 'flex-start' }}>
            {currentItems.map((user) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={user.id} sx={{ position: 'relative', pt: 3 }}>
                <Box sx={{ position: 'absolute', top: 0, left: 0, zIndex: 0, height: 48, p: '1px', bgcolor: 'divider', clipPath: 'polygon(10px 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 10px 100%, 0 50%)' }}><Box sx={{ height: '100%', px: 2, pt: .5, bgcolor: '#fafcfa', clipPath: 'polygon(10px 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 10px 100%, 0 50%)', display: 'flex', alignItems: 'flex-start' }}><Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap', lineHeight: 1.3 }}>{user.isArchived && user.archivedAt ? 'Archived' : 'Added'} {new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(user.isArchived && user.archivedAt ? user.archivedAt : user.createdAt))}</Typography></Box></Box>
                <Card
                  variant="outlined"
                  sx={{
                    position: 'relative', zIndex: 1, borderRadius: 2,
                    bgcolor: user.isArchived ? 'grey.100' : '#ffffff',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    transition: 'all 0.2s',
                    '&:hover': {
                      boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
                      borderColor: user.isArchived ? 'grey.500' : 'primary.main',
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
                    {/* User Profile Header */}
                    <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 2 }}>
                      <Avatar
                        sx={{
                          bgcolor: user.isArchived ? 'grey.500' : user.role === 'admin' ? 'primary.main' : 'secondary.main',
                          width: 48,
                          height: 48,
                          fontWeight: '700',
                        }}
                      >
                        {user.name ? user.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : 'U'}
                      </Avatar>
                      <Box sx={{ flexGrow: 1 }}>
                        <Typography
                          variant="h6"
                          sx={{
                            fontWeight: '700',
                            color: 'text.primary',
                            lineHeight: 1.2,
                          }}
                        >
                          {user.name}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {user.email}
                        </Typography>
                      </Box>
                    </Stack>

                    {/* Details Panel */}
                    <Stack spacing={1.5} sx={{ my: 1 }}>
                    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" color="text.secondary">
                          Role
                        </Typography>
                        <Chip
                          label={roleLabel(user.role)}
                          size="small"
                          color={user.isArchived ? 'default' : user.role === 'admin' ? 'primary' : 'default'}
                          sx={{ fontWeight: '700', borderRadius: '6px' }}
                        />
                      </Stack>
                      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" color="text.secondary">
                          Password
                        </Typography>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
                          {user.password || '••••••••'}
                        </Typography>
                      </Stack>
                    </Stack>
                    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}><Typography variant="body2" color="text.secondary">Department</Typography><Typography variant="body2" sx={{ fontWeight: 700 }}>{user.department}</Typography></Stack>

                    <Divider sx={{ my: 2 }} />

                    {/* Action buttons aligned at the bottom - Icon button design */}
                    <Stack direction="row" spacing={0.5} sx={{ mt: 'auto', justifyContent: 'flex-end', alignItems: 'center' }}>
                      <Tooltip title={user.isArchived ? 'View User' : 'View & Edit User'}>
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => handleOpenEditDialog(user)}
                          aria-label={`View details for ${user.name}`}
                        >
                          <VisibilityIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      {user.isArchived ? (
                        <>
                          <Tooltip title="Restore User">
                            <IconButton size="small" color="info" disabled={restoringUserId !== null} onClick={() => void handleRestoreUser(user)} aria-label={`Restore user ${user.name}`}>
                              <RestoreIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Delete Permanently">
                            <IconButton size="small" color="error" disabled={restoringUserId !== null} onClick={() => setDeletingUser(user)} aria-label={`Permanently delete user ${user.name}`}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </>
                      ) : session.data?.user.id !== user.id && (
                        <Tooltip title="Archive User">
                          <IconButton size="small" color="warning" onClick={() => setArchivingUser(user)} aria-label={`Archive user ${user.name}`}>
                            <ArchiveIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Stack>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        ) : (
          <Box sx={{ py: 8, textAlign: 'center', flexGrow: 1 }}>
            <Typography variant="h6" color="text.secondary">
              {showArchived ? 'No archived users match the search filters.' : 'No users match the search filters.'}
            </Typography>
          </Box>
        )}

        {/* Symmetrical Pagination Controls */}
        {totalPages > 1 && (
          <Stack
            direction="row"
            spacing={2}
            sx={{
              justifyContent: 'center',
              alignItems: 'center',
              mt: 4,
              mb: 2,
            }}
          >
            <Button
              variant="outlined"
              color="primary"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(prev => prev - 1)}
              sx={{ fontWeight: '700' }}
            >
              Previous
            </Button>
            <Typography variant="body2" sx={{ fontWeight: '700', color: 'text.secondary' }}>
              Page {currentPage} of {totalPages}
            </Typography>
            <Button
              variant="outlined"
              color="primary"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(prev => prev + 1)}
              sx={{ fontWeight: '700' }}
            >
              Next
            </Button>
          </Stack>
        )}
      </Container>

      {/* Floating Fixed Add Button */}
      {!showArchived && <Fab
        variant="extended"
        color="primary"
        onClick={handleOpenAddDialog}
        sx={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          boxShadow: '0 4px 14px rgba(46, 125, 50, 0.4)',
          px: 2.5,
          zIndex: 1100,
        }}
      >
        <AddIcon sx={{ mr: 1 }} />
        Add User
      </Fab>}

      {/* Dialog for Add / Edit User */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: '800' }}>
          {editingUser?.isArchived ? 'User Details' : editingUser ? 'Edit User details' : 'Add New User'}
        </DialogTitle>
        <DialogContent dividers>
          <Box component="fieldset" disabled={showArchived || Boolean(editingUser?.isArchived)} sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
          <Stack spacing={3} sx={{ py: 1 }}>
            {formError && (
              <Alert id="user-form-error" tabIndex={-1} severity="error" onClose={() => setFormError('')}>
                {formError}
              </Alert>
            )}
            {editingUser && <Typography variant="caption" color="text.secondary">Added {new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(editingUser.createdAt))}</Typography>}
            {/* Name Input */}
            <TextField
              disabled={showArchived || Boolean(editingUser?.isArchived)}
              id="user-field-name"
              label="Full Name"
              required
              fullWidth
              value={formName}
              onChange={(e) => {
                setFormName(e.target.value);
                setFormNameError('');
              }}
              error={Boolean(formNameError)}
              helperText={formNameError}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <PersonIcon color="action" />
                    </InputAdornment>
                  ),
                },
              }}
            />

            {/* Email Input */}
            <TextField
              disabled={showArchived || Boolean(editingUser?.isArchived)}
              id="user-field-email"
              label="Email Address"
              type="email"
              required
              fullWidth
              value={formEmail}
              onChange={(e) => {
                setFormEmail(e.target.value);
                setFormEmailError('');
              }}
              error={Boolean(formEmailError)}
              helperText={formEmailError}
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

            {/* Password Input */}
            <TextField
              disabled={showArchived || Boolean(editingUser?.isArchived)}
              id="user-field-password"
              label={editingUser ? "New Password (optional)" : "Password"}
              type="text"
              fullWidth
              value={formPassword}
              onChange={(e) => {
                setFormPassword(e.target.value);
                setFormPasswordError('');
              }}
              error={Boolean(formPasswordError)}
              helperText={formPasswordError || PASSWORD_REQUIREMENTS}
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

            {/* Role Select Dropdown */}
            <TextField
              disabled={showArchived || Boolean(editingUser?.isArchived)}
              select
              label="Role"
              fullWidth
              value={formRole}
              onChange={(e) => setFormRole(e.target.value)}
              slotProps={{ select: { renderValue: (value) => roleLabel(String(value)) } }}
            >
              {ROLE_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value} sx={{ py: 1.25, whiteSpace: 'normal' }}>
                  <Box>
                    <Typography variant="body1">{option.label}</Typography>
                    <Typography variant="caption" color="text.secondary">{option.description}</Typography>
                  </Box>
                </MenuItem>
              ))}
            </TextField>
            <DepartmentCombobox disabled={showArchived || Boolean(editingUser?.isArchived)} options={departmentOptions} value={formDepartment} onChange={setFormDepartment} otherSelected={formDepartmentIsOther} onOtherSelectedChange={setFormDepartmentIsOther} required={formRole === 'viewer'} />
          </Stack>

          </Box></DialogContent>
        <DialogActions sx={{ p: 2.5 }}>
          <Button onClick={() => setDialogOpen(false)} color="inherit" sx={{ fontWeight: '700' }}>
            Cancel
          </Button>
          <Button onClick={handleSaveUser} variant="contained" color="primary" disabled={showArchived || editingUser?.isArchived || !formName.trim() || !formEmail.trim() || (!editingUser && !formPassword) || (formRole === 'viewer' && !formDepartment.trim()) || Boolean(formNameError || formEmailError || formPasswordError)} sx={{ fontWeight: '700' }}>
            Save User
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={pendingApprovalsOpen} onClose={() => setPendingApprovalsOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>Employee (All Department Requests) Approvals</DialogTitle>
        <DialogContent dividers>
          {pendingApprovals.length > 0 ? (
            <Stack spacing={1.5}>
              {pendingApprovals.map((approval) => {
                const isHighlighted = Number(searchParams.get('approval')) === approval.id;
                const isFocused = approvalFocus?.id === approval.id;
                return (
                  <Stack
                    key={approval.id}
                    id={`role-approval-${approval.id}`}
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={2}
                    sx={{
                      p: 2,
                      border: '1px solid',
                      borderColor: isHighlighted ? 'primary.main' : 'divider',
                      borderRadius: 2,
                      alignItems: { sm: 'center' },
                      bgcolor: isHighlighted ? 'rgba(46, 125, 50, 0.04)' : '#fafcfa',
                      scrollMarginBlock: 24,
                      animation: isFocused ? 'approvalNotificationFocus 2500ms ease-in-out' : 'none',
                      '@keyframes approvalNotificationFocus': {
                        '0%': { transform: 'scale(1)' },
                        '30%': { transform: 'scale(0.975)' },
                        '65%': { transform: 'scale(1.025)' },
                        '100%': { transform: 'scale(1)' },
                      },
                    }}
                  >
                    <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                      <Typography variant="body1" sx={{ fontWeight: 700 }}>{approval.name}</Typography>
                      <Typography variant="body2" color="text.secondary">{approval.email}</Typography>
                      <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 600 }}>{approval.department}</Typography>
                    </Box>
                    <Stack direction="row" spacing={1}>
                      <Button color="error" variant="outlined" onClick={() => void handleApprovalDecision(approval.id, 'rejected')} disabled={approvalActionId !== null}>Reject</Button>
                      <Button color="primary" variant="contained" onClick={() => void handleApprovalDecision(approval.id, 'accepted')} disabled={approvalActionId !== null}>Accept</Button>
                    </Stack>
                  </Stack>
                );
              })}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>No pending approval requests.</Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2.5 }}>
          <Button onClick={() => setPendingApprovalsOpen(false)} color="inherit" sx={{ fontWeight: 700 }}>Close</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={filtersOpen} onClose={() => setFiltersOpen(false)} maxWidth="sm" fullWidth><DialogTitle sx={{ fontWeight: 800 }}>Filter Users</DialogTitle><DialogContent dividers><Stack spacing={2}><Box><Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>Roles</Typography>{ALL_ROLES.map((role) => <FormControlLabel key={role} control={<Checkbox checked={draftRoleFilter.includes(role)} onChange={() => setDraftRoleFilter((current) => current.includes(role) ? current.filter((item) => item !== role) : [...current, role])} />} label={roleLabel(role)} sx={{ display: 'flex', width: 'fit-content' }} />)}</Box><Box><Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>Departments</Typography>{Array.from(new Set(usersList.map((user) => user.department))).sort().map((department) => <FormControlLabel key={department} control={<Checkbox checked={draftDepartmentFilter.includes(department)} onChange={() => setDraftDepartmentFilter((current) => current.includes(department) ? current.filter((item) => item !== department) : [...current, department])} />} label={department} sx={{ display: 'flex', width: 'fit-content' }} />)}</Box><Grid container spacing={2}><Grid size={{ xs: 12, sm: 6 }}><DateField label="Date added from" value={draftDateFrom} onChange={setDraftDateFrom} /></Grid><Grid size={{ xs: 12, sm: 6 }}><DateField label="Date added to" value={draftDateTo} onChange={setDraftDateTo} /></Grid></Grid><Stack direction="row" spacing={1}><Button size="small" onClick={() => { const today = new Date().toISOString().slice(0, 10); setDraftDateFrom(today); setDraftDateTo(today); }}>Today</Button><Button size="small" onClick={() => { const now = new Date(); setDraftDateFrom(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`); setDraftDateTo(now.toISOString().slice(0, 10)); }}>This month</Button><Button size="small" onClick={() => { const now = new Date(); setDraftDateFrom(`${now.getFullYear()}-01-01`); setDraftDateTo(now.toISOString().slice(0, 10)); }}>This year</Button></Stack><TextField select fullWidth label="Sort" value={draftSortOrder} onChange={(event) => setDraftSortOrder(event.target.value as 'newest' | 'oldest')}><MenuItem value="newest">Newest to oldest</MenuItem><MenuItem value="oldest">Oldest to newest</MenuItem></TextField></Stack></DialogContent><DialogActions sx={{ p: 2.5 }}><Button onClick={() => { setDraftRoleFilter([...ALL_ROLES]); setDraftDepartmentFilter(Array.from(new Set(usersList.map((user) => user.department))).sort()); setDraftDateFrom(''); setDraftDateTo(''); setDraftSortOrder('newest'); }}>Reset</Button><Button variant="contained" onClick={() => { setRoleFilter([...draftRoleFilter]); setDepartmentFilter([...draftDepartmentFilter]); setDateFrom(draftDateFrom); setDateTo(draftDateTo); setSortOrder(draftSortOrder); setCurrentPage(1); setFiltersOpen(false); }}>Apply Filters</Button></DialogActions></Dialog>
      <Dialog open={Boolean(archivingUser)} onClose={() => { if (!archiveBusy) setArchivingUser(null); }} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>Archive User?</DialogTitle>
        <DialogContent dividers><Typography>Are you sure you want to archive the user {archivingUser?.name}?</Typography></DialogContent>
        <DialogActions sx={{ p: 2.5 }}>
          <Button onClick={() => setArchivingUser(null)} disabled={archiveBusy}>Cancel</Button>
          <Button variant="contained" color="warning" onClick={() => void handleArchiveUser()} disabled={archiveBusy}>{archiveBusy ? 'Archiving...' : 'Archive'}</Button>
        </DialogActions>
      </Dialog>
      <DeleteConfirmationDialog
        open={Boolean(deletingUser)}
        title="Permanently Delete User?"
        recordLabel={`Are you sure you want to permanently delete the user ${deletingUser?.name || ''}? This cannot be undone.`}
        confirmLabel="Delete Permanently"
        onClose={() => setDeletingUser(null)}
        onConfirm={async () => {
          if (!deletingUser) return;
          const result = await deleteArchivedDirectoryUser(deletingUser.id);
          if (!result.success) throw new Error(result.error || 'Unable to delete this user.');
          setUsersList((current) => current.filter((user) => user.id !== deletingUser.id));
          if (currentItems.length === 1 && currentPage > 1) setCurrentPage(currentPage - 1);
        }}
      />
      <ActionErrorDialog open={Boolean(archiveError)} title="Unable to Update User" message={archiveError} onClose={() => setArchiveError('')} />
    </Box>
  );
}
