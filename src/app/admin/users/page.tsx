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
import { getAllUsers, updateUserRole, createUser, deleteUser } from '@/app/actions';

interface UserEntity {
  id: string;
  role: string;
  email: string;
  name: string;
  password?: string;
  isMock?: boolean;
}

export default function UsersManagementPage() {
  const router = useRouter();
  const session = authClient.useSession();
  const [loading, setLoading] = useState(true);
  const [usersList, setUsersList] = useState<UserEntity[]>([]);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');

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

  // Redirect if not logged in
  useEffect(() => {
    if (!session.isPending && !session.data) {
      router.push('/');
    }
  }, [session.isPending, session.data, router]);

  // Load users from DB
  const loadUsers = async () => {
    if (!session.data) return;

    setLoading(true);
    try {
      const dbUsers = await getAllUsers();
      
      const formattedDbUsers = dbUsers.map(u => ({
        id: u.id,
        role: u.role,
        name: u.id === session.data?.user.id ? (session.data?.user.name || 'Admin User') : 'Registered Staff',
        email: u.id === session.data?.user.id ? session.data?.user.email : `user-${u.id.substring(0, 5)}@leaprs.gov`,
        password: '••••••••',
        isMock: false,
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
    setDialogOpen(true);
  };

  // Open dialog for editing a user
  const handleOpenEditDialog = (user: UserEntity) => {
    setEditingUser(user);
    setFormName(user.name);
    setFormEmail(user.email);
    setFormPassword(''); // Clear password field, indicating "keep current"
    setFormRole(user.role);
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
        // Only update password if a new one is typed in the field
        ...(formPassword ? { password: formPassword } : {}),
      };

      setUsersList(prev => prev.map(u => u.id === editingUser.id ? updatedUser : u));

      if (!editingUser.isMock) {
        try {
          await updateUserRole(editingUser.id, formRole);
        } catch (err) {
          console.error('Error updating role in DB:', err);
        }
      }
    } else {
      // ADD OPERATION
      const newId = `user-${Math.random().toString(36).substr(2, 9)}`;
      const newUser: UserEntity = {
        id: newId,
        name: formName,
        email: formEmail,
        role: formRole,
        password: formPassword || '••••••••',
        isMock: true, // New local users are mock by default for presentation
      };

      setUsersList(prev => [newUser, ...prev]);

      try {
        await createUser(newId, formRole);
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
        await deleteUser(userId);
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
    const matchesRole = roleFilter === 'all' || user.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  // Pagination Logic
  const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = filteredUsers.slice(indexOfFirstItem, indexOfLastItem);

  // Reset page when filter/search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, roleFilter]);

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

            {/* Filter Selector */}
            <TextField
              select
              size="small"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <FilterIcon color="action" />
                    </InputAdornment>
                  ),
                },
              }}
              sx={{
                bgcolor: '#ffffff',
                borderRadius: 2,
                minWidth: '130px',
                '& .MuiOutlinedInput-root': { borderRadius: 2 },
              }}
            >
              <MenuItem value="all">All Roles</MenuItem>
              <MenuItem value="admin">Admin</MenuItem>
              <MenuItem value="employee">Employee</MenuItem>
              <MenuItem value="viewer">Viewer</MenuItem>
            </TextField>
          </Stack>
        </Stack>

        {/* 3x2 Kiosk Box Grid (Exactly 6 users to prevent scrolling) */}
        {currentItems.length > 0 ? (
          <Grid container spacing={3} sx={{ flexGrow: 1, alignContent: 'flex-start' }}>
            {currentItems.map((user) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={user.id}>
                <Card
                  variant="outlined"
                  sx={{
                    borderRadius: 2,
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

                    <Divider sx={{ my: 2 }} />

                    {/* Action buttons aligned at the bottom - Consistent text button design */}
                    <Stack direction="row" spacing={3} sx={{ mt: 'auto' }}>
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
                        Edit User
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
            </TextField>
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
    </Box>
  );
}
