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
  Button,
  Avatar,
  Divider,
  Fab,
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
import {
  Add as AddIcon,
  ChevronRight as ChevronRightIcon,
  Search as SearchIcon,
  Lock as LockIcon,
  Email as EmailIcon,
  Person as PersonIcon,
  FilterList as FilterIcon,
} from '@mui/icons-material';
import { authClient } from '@/lib/auth/client';
import { createDirectoryUser, deleteDirectoryUser, getCurrentUserAccess, getUsersDirectory, updateDirectoryUser, createUser } from '@/app/actions';

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

export default function UsersManagementPage() {
  const router = useRouter();
  const session = authClient.useSession();
  const [loading, setLoading] = useState(true);
  const [usersList, setUsersList] = useState<UserEntity[]>([]);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftRoleFilter, setDraftRoleFilter] = useState<string[]>([]);
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
  const loadUsers = async () => {
    if (!session.data) return;

    setLoading(true);
    try {
      const directoryUsers = await getUsersDirectory();
      
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
    } catch (err) {
      console.error('Error loading users:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (session.data) {
      loadUsers();
    }
  }, [session.data]);

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
    } else {
      // ADD OPERATION
      if (!formPassword) return;
      const created = await createDirectoryUser({ name: formName, email: formEmail, password: formPassword, role: formRole, department: formDepartment || 'Unassigned' });
      if (!created.success || !created.user) { console.error('Error creating user:', created.error); return; }
      setUsersList((current) => [{ id: created.user.id, name: created.user.name || formName, email: created.user.email, role: formRole, password: 'â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢', createdAt: created.user.createdAt, department: formDepartment || 'Unassigned' }, ...current]);
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
    const matchesRole = roleFilter.length === 0 || roleFilter.includes(user.role);
    const added = new Date(user.createdAt).getTime();
    return matchesSearch && matchesRole && (departmentFilter.length === 0 || departmentFilter.includes(user.department)) && (!dateFrom || added >= new Date(dateFrom).getTime()) && (!dateTo || added <= new Date(`${dateTo}T23:59:59`).getTime());
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

          <Stack direction="row" spacing={2} sx={{ width: { xs: '100%', sm: 'auto' }, alignItems: 'center' }}>
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
                          label={user.role.toUpperCase()}
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

                    {/* Action buttons aligned at the bottom - Consistent text button design */}
                    <Stack direction="row" spacing={3} sx={{ mt: 'auto', justifyContent: 'flex-end' }}>
                      <Button
                        variant="text"
                        color="primary"
                        endIcon={<ChevronRightIcon />}
                        onClick={() => handleOpenEditDialog(user)}
                        sx={{
                          p: 0,
                          minWidth: 0,
                          fontWeight: '700',
                          '&:hover': { bgcolor: 'transparent', color: 'primary.dark' },
                        }}
                      >
                        Details
                      </Button>
                      
                      <Button
                        variant="text"
                        color="error"
                        onClick={() => handleDeleteUser(user.id, user.isMock)}
                        sx={{
                          p: 0,
                          minWidth: 0,
                          fontWeight: '700',
                          '&:hover': { bgcolor: 'transparent', color: '#b71c1c' },
                        }}
                      >
                        Delete
                      </Button>
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
            >
              <MenuItem value="employee">Employee</MenuItem>
              <MenuItem value="admin">Admin</MenuItem>
              <MenuItem value="viewer">Viewer</MenuItem>
              <MenuItem value="viewer-full">Viewer (All Departments)</MenuItem>
            </TextField>
            <TextField label="Department" fullWidth value={formDepartment} onChange={(e) => setFormDepartment(e.target.value)} />
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
      <Dialog open={filtersOpen} onClose={() => setFiltersOpen(false)} maxWidth="sm" fullWidth><DialogTitle sx={{ fontWeight: 800 }}>Filter Users</DialogTitle><DialogContent dividers><Stack spacing={2}><Box><Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>Roles</Typography>{['admin', 'employee', 'viewer', 'viewer-full'].map((role, _, roles) => <FormControlLabel key={role} control={<Checkbox checked={draftRoleFilter.length === 0 || draftRoleFilter.includes(role)} onChange={() => setDraftRoleFilter((current) => current.length === 0 ? roles.filter((item) => item !== role) : current.includes(role) ? current.filter((item) => item !== role) : [...current, role])} />} label={role === 'viewer-full' ? 'Viewer (All Departments)' : role.charAt(0).toUpperCase() + role.slice(1)} sx={{ display: 'flex', width: 'fit-content' }} />)}</Box><Box><Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>Departments</Typography>{Array.from(new Set(usersList.map((user) => user.department))).sort().map((department, _, departments) => <FormControlLabel key={department} control={<Checkbox checked={draftDepartmentFilter.length === 0 || draftDepartmentFilter.includes(department)} onChange={() => setDraftDepartmentFilter((current) => current.length === 0 ? departments.filter((item) => item !== department) : current.includes(department) ? current.filter((item) => item !== department) : [...current, department])} />} label={department} sx={{ display: 'flex', width: 'fit-content' }} />)}</Box><Grid container spacing={2}><Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth type="date" label="Date added from" slotProps={{ inputLabel: { shrink: true } }} value={draftDateFrom} onChange={(event) => setDraftDateFrom(event.target.value)} /></Grid><Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth type="date" label="Date added to" slotProps={{ inputLabel: { shrink: true } }} value={draftDateTo} onChange={(event) => setDraftDateTo(event.target.value)} /></Grid></Grid><Stack direction="row" spacing={1}><Button size="small" onClick={() => { const today = new Date().toISOString().slice(0, 10); setDraftDateFrom(today); setDraftDateTo(today); }}>Today</Button><Button size="small" onClick={() => { const now = new Date(); setDraftDateFrom(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`); setDraftDateTo(now.toISOString().slice(0, 10)); }}>This month</Button><Button size="small" onClick={() => { const now = new Date(); setDraftDateFrom(`${now.getFullYear()}-01-01`); setDraftDateTo(now.toISOString().slice(0, 10)); }}>This year</Button></Stack><TextField select fullWidth label="Sort" value={draftSortOrder} onChange={(event) => setDraftSortOrder(event.target.value as 'newest' | 'oldest')}><MenuItem value="newest">Newest to oldest</MenuItem><MenuItem value="oldest">Oldest to newest</MenuItem></TextField></Stack></DialogContent><DialogActions sx={{ p: 2.5 }}><Button onClick={() => { setDraftRoleFilter([]); setDraftDepartmentFilter([]); setDraftDateFrom(''); setDraftDateTo(''); setDraftSortOrder('newest'); }}>Reset</Button><Button variant="contained" onClick={() => { setRoleFilter([...draftRoleFilter]); setDepartmentFilter([...draftDepartmentFilter]); setDateFrom(draftDateFrom); setDateTo(draftDateTo); setSortOrder(draftSortOrder); setCurrentPage(1); setFiltersOpen(false); }}>Apply Filters</Button></DialogActions></Dialog>
    </Box>
  );
}
