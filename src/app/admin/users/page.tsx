'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
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
  Autocomplete,
} from '@mui/material';
import { ResourceGridSkeleton } from '@/components/Skeletons';
import {
  Add as AddIcon,
  ChevronRight as ChevronRightIcon,
  DeleteOutlined as DeleteIcon,
  Search as SearchIcon,
  Lock as LockIcon,
  Email as EmailIcon,
  Person as PersonIcon,
  FilterList as FilterIcon,
  VisibilityOutlined as VisibilityIcon,
  ManageAccountsOutlined as PendingApprovalIcon,
} from '@mui/icons-material';
import { authClient } from '@/lib/auth/client';
import { createDirectoryUser, decideRoleApproval, deleteDirectoryUser, getCurrentUserAccess, getDepartmentOptions, getPendingRoleApprovals, getUsersDirectory, updateDirectoryUser, createUser, type PendingRoleApproval } from '@/app/actions';
import DateField from '@/components/DateField';
import { ROLE_OPTIONS, roleLabel } from '@/lib/role-options';

interface UserEntity {
  id: string;
  role: string;
  email: string;
  name: string;
  password?: string;
  isMock?: boolean;
  createdAt: Date | string;
  department: string;
}

const ALL_ROLES = ROLE_OPTIONS.map(({ value }) => value);

export default function UsersManagementPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const session = authClient.useSession();
  const [loading, setLoading] = useState(true);
  const [usersList, setUsersList] = useState<UserEntity[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<string[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingRoleApproval[]>([]);
  const [approvalActionId, setApprovalActionId] = useState<number | null>(null);
  const [pendingApprovalsOpen, setPendingApprovalsOpen] = useState(false);

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
  const [formRole, setFormRole] = useState('employee');
  const [formDepartment, setFormDepartment] = useState('');

  // Redirect if not logged in
  useEffect(() => {
    if (!session.isPending && !session.data) {
      router.push('/');
    }
  }, [session.isPending, session.data, router]);

  useEffect(() => {
    if (!session.data) return;
    void getCurrentUserAccess().then((access) => { if (access.success && access.role !== 'admin') router.replace('/admin'); });
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

  // Open dialog for adding a new user
  const handleOpenAddDialog = () => {
    setEditingUser(null);
    setFormName('');
    setFormEmail('');
    setFormPassword('');
    setFormRole('employee');
    setFormDepartment('');
    setDialogOpen(true);
  };

  // Open dialog for editing a user
  const handleOpenEditDialog = (user: UserEntity) => {
    setEditingUser(user);
    setFormName(user.name);
    setFormEmail(user.email);
    setFormPassword(''); // Clear password field, indicating "keep current"
    setFormRole(user.role);
    setFormDepartment(user.department);
    setDialogOpen(true);
  };

  // Save Add / Edit Form
  const handleSaveUser = async () => {
    if (!formName || !formEmail) return;

    if (editingUser) {
      // EDIT OPERATION
      const updatedUser = {
        ...editingUser,
        name: formName,
        email: formEmail,
        role: formRole,
        department: formDepartment || 'Unassigned',
        // Only update password if a new one is typed in the field
        ...(formPassword ? { password: formPassword } : {}),
      };

      if (!editingUser.isMock) {
        const result = await updateDirectoryUser(editingUser.id, { name: formName, email: formEmail, role: formRole, department: formDepartment || 'Unassigned' });
        if (!result.success) { console.error('Error updating user:', result.error); return; }
      }
      setUsersList(prev => prev.map(u => u.id === editingUser.id ? updatedUser : u));
      if (formDepartment.trim()) setDepartmentOptions((current) => Array.from(new Set([...current, formDepartment.trim()])).sort((a, b) => a.localeCompare(b)));
    } else {
      // ADD OPERATION
      if (!formPassword) return;
      const created = await createDirectoryUser({ name: formName, email: formEmail, password: formPassword, role: formRole, department: formDepartment || 'Unassigned' });
      if (!created.success || !created.user) { console.error('Error creating user:', created.error); return; }
      setUsersList((current) => [{ id: created.user.id, name: created.user.name || formName, email: created.user.email, role: formRole, password: 'â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢', createdAt: created.user.createdAt, department: formDepartment || 'Unassigned' }, ...current]);
      if (formDepartment.trim()) setDepartmentOptions((current) => Array.from(new Set([...current, formDepartment.trim()])).sort((a, b) => a.localeCompare(b)));
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

  // Delete User
  const handleDeleteUser = async (userId: string, isMock?: boolean) => {
    setUsersList(prev => prev.filter(u => u.id !== userId));

    if (!isMock) {
      try {
        await deleteDirectoryUser(userId);
      } catch (err) {
        console.error('Failed to delete user from DB:', err);
      }
    }
  };

  // Filter & Search Logic
  const filteredUsers = usersList.filter(user => {
    const matchesSearch =
      user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = roleFilter.includes(user.role);
    const added = new Date(user.createdAt).getTime();
    return matchesSearch && matchesRole && departmentFilter.includes(user.department) && (!dateFrom || added >= new Date(dateFrom).getTime()) && (!dateTo || added <= new Date(`${dateTo}T23:59:59`).getTime());
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
          </Stack>
        </Stack>

        {/* 3x2 Kiosk Box Grid (Exactly 6 users to prevent scrolling) */}
        {currentItems.length > 0 ? (
          <Grid container spacing={3} sx={{ flexGrow: 1, alignContent: 'flex-start' }}>
            {currentItems.map((user) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={user.id} sx={{ position: 'relative', pt: 3 }}>
                <Box sx={{ position: 'absolute', top: 0, left: 0, zIndex: 0, height: 48, p: '1px', bgcolor: 'divider', clipPath: 'polygon(10px 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 10px 100%, 0 50%)' }}><Box sx={{ height: '100%', px: 2, pt: .5, bgcolor: '#fafcfa', clipPath: 'polygon(10px 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 10px 100%, 0 50%)', display: 'flex', alignItems: 'flex-start' }}><Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap', lineHeight: 1.3 }}>Added {new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(user.createdAt))}</Typography></Box></Box>
                <Card
                  variant="outlined"
                  sx={{
                    position: 'relative', zIndex: 1, borderRadius: 2,
                    bgcolor: '#ffffff',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    transition: 'all 0.2s',
                    '&:hover': {
                      boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
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
                    {/* User Profile Header */}
                    <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 2 }}>
                      <Avatar
                        sx={{
                          bgcolor: user.role === 'admin' ? 'primary.main' : 'secondary.main',
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
                          color={user.role === 'admin' ? 'primary' : 'default'}
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
                      <Tooltip title="View & Edit User">
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => handleOpenEditDialog(user)}
                          aria-label={`View details for ${user.name}`}
                        >
                          <VisibilityIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete User">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDeleteUser(user.id, user.isMock)}
                          aria-label={`Delete user ${user.name}`}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        ) : (
          <Box sx={{ py: 8, textAlign: 'center', flexGrow: 1 }}>
            <Typography variant="h6" color="text.secondary">
              No users match the search filters.
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
      <Fab
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
      </Fab>

      {/* Dialog for Add / Edit User */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: '800' }}>
          {editingUser ? 'Edit User details' : 'Add New User'}
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={3} sx={{ py: 1 }}>
            {editingUser && <Typography variant="caption" color="text.secondary">Added {new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(editingUser.createdAt))}</Typography>}
            {/* Name Input */}
            <TextField
              label="Full Name"
              required
              fullWidth
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
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
              label="Email Address"
              type="email"
              required
              fullWidth
              value={formEmail}
              onChange={(e) => setFormEmail(e.target.value)}
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
              label={editingUser ? "New Password (optional)" : "Password"}
              type="text"
              fullWidth
              value={formPassword}
              onChange={(e) => setFormPassword(e.target.value)}
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
            <Autocomplete freeSolo options={departmentOptions} value={formDepartment} inputValue={formDepartment} onChange={(_, value) => setFormDepartment(typeof value === 'string' ? value : '')} onInputChange={(_, value) => setFormDepartment(value)} renderInput={(params) => <TextField {...params} label="Department" fullWidth />} />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2.5 }}>
          <Button onClick={() => setDialogOpen(false)} color="inherit" sx={{ fontWeight: '700' }}>
            Cancel
          </Button>
          <Button onClick={handleSaveUser} variant="contained" color="primary" sx={{ fontWeight: '700' }}>
            Save User
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={pendingApprovalsOpen} onClose={() => setPendingApprovalsOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>Employee (Department Requests) Approvals</DialogTitle>
        <DialogContent dividers>
          {pendingApprovals.length > 0 ? (
            <Stack spacing={1.5}>
              {pendingApprovals.map((approval) => {
                const isHighlighted = Number(searchParams.get('approval')) === approval.id;
                return (
                  <Stack key={approval.id} direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ p: 2, border: '1px solid', borderColor: isHighlighted ? 'primary.main' : 'divider', borderRadius: 2, alignItems: { sm: 'center' }, bgcolor: isHighlighted ? 'rgba(46, 125, 50, 0.04)' : '#fafcfa' }}>
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
    </Box>
  );
}
