'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Box,
  Button,
  Chip,
  Checkbox,
  FormControlLabel,
  FormGroup,
  IconButton,
  Popover,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  NotificationsOutlined as NotificationsIcon,
  CheckCircleOutlined as CompletedIcon,
  CancelOutlined as DeniedIcon,
  AssignmentOutlined as RequestIcon,
  FolderOpenOutlined as CapdevIcon,
  UpdateOutlined as UpdateIcon,
  DoneAll as DoneAllIcon,
  NotificationsNoneOutlined as EmptyBellIcon,
  ManageAccountsOutlined as RoleApprovalIcon,
  NotificationsActiveRounded as ReminderIcon,
} from '@mui/icons-material';
import {
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  type NotificationItem,
} from '@/app/actions';

const NOTIFICATION_FILTERS = [
  { type: 'inactivity_reminder', label: 'Inactivity Reminders' },
  { type: 'new_request', label: 'Request Submissions' },
  { type: 'status_update', label: 'Status Updates' },
  { type: 'completed', label: 'Completed Requests' },
  { type: 'denied', label: 'Denied Requests' },
  { type: 'capdev_created', label: 'CapDev Creation' },
  { type: 'role_approval', label: 'Role Approvals' },
] as const;

type NotificationFilterType = (typeof NOTIFICATION_FILTERS)[number]['type'];

function formatRelativeTime(dateInput: Date | string): string {
  const date = new Date(dateInput);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return 'Just now';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
  if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
}

function getNotificationIcon(type: string) {
  switch (type) {
    case 'inactivity_reminder':
      return <ReminderIcon sx={{ fontSize: 18, color: '#d32f2f' }} />;
    case 'completed':
      return <CompletedIcon sx={{ fontSize: 18, color: '#2e7d32' }} />;
    case 'denied':
      return <DeniedIcon sx={{ fontSize: 18, color: '#d32f2f' }} />;
    case 'new_request':
      return <RequestIcon sx={{ fontSize: 18, color: '#1565c0' }} />;
    case 'capdev_created':
      return <CapdevIcon sx={{ fontSize: 18, color: '#00796b' }} />;
    case 'role_approval':
      return <RoleApprovalIcon sx={{ fontSize: 18, color: '#ed6c02' }} />;
    default:
      return <UpdateIcon sx={{ fontSize: 18, color: '#2e7d32' }} />;
  }
}

function getIconBgColor(type: string) {
  switch (type) {
    case 'completed':
      return 'rgba(46, 125, 50, 0.12)';
    case 'denied':
      return 'rgba(211, 47, 47, 0.12)';
    case 'new_request':
      return 'rgba(21, 101, 192, 0.12)';
    case 'capdev_created':
      return 'rgba(0, 121, 107, 0.12)';
    case 'role_approval':
      return 'rgba(237, 108, 2, 0.12)';
    default:
      return 'rgba(46, 125, 50, 0.12)';
  }
}

function getNotificationDestination(item: NotificationItem) {
  if (item.type === 'capdev_created' && item.capdevId) {
    return `/portal#capdev-record-${item.capdevId}`;
  }
  if (item.type === 'new_request' && item.capdevId && item.requestId) {
    return `/portal/capdev/${item.capdevId}/requests#request-record-${item.requestId}`;
  }
  if (item.type === 'role_approval') {
    if (item.link.includes('#')) return item.link;
    const approvalId = new URL(item.link, window.location.origin).searchParams.get('approval');
    return approvalId ? `${item.link}#role-approval-${approvalId}` : item.link;
  }
  if (item.type === 'completed' || item.type === 'denied') {
    return item.link.includes('#') ? item.link : `${item.link}#request-status-resolution`;
  }
  if (item.type === 'status_update' && item.capdevId && item.requestId) {
    if (/#request-status-update-\d+$/.test(item.link)) return item.link;
    return `/portal/capdev/${item.capdevId}/requests#request-record-${item.requestId}`;
  }
  if (item.link.includes('#')) return item.link;
  return item.link;
}

export default function NotificationsMenu() {
  const router = useRouter();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedTypes, setSelectedTypes] = useState<NotificationFilterType[]>(
    () => NOTIFICATION_FILTERS.map((filter) => filter.type)
  );
  const allTypesSelected = selectedTypes.length === NOTIFICATION_FILTERS.length;
  const filteredNotifications = allTypesSelected
    ? notifications
    : notifications.filter((item) => selectedTypes.some((type) => type === item.type));

  const toggleType = (type: NotificationFilterType) => {
    setSelectedTypes((previous) => previous.includes(type)
      ? previous.filter((selected) => selected !== type)
      : [...previous, type]);
  };

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await getNotifications();
      if (res.success) {
        setNotifications(res.notifications);
        setUnreadCount(res.unreadCount);
      }
    } catch (e) {
      console.error('Failed to load notifications:', e);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(fetchNotifications);
    const interval = window.setInterval(() => {
      void fetchNotifications();
    }, 30_000);
    window.addEventListener('leaprs:reminder-settings-changed', fetchNotifications);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('leaprs:reminder-settings-changed', fetchNotifications);
    };
  }, [fetchNotifications]);

  const handleOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
    setLoading(true);
    void fetchNotifications().finally(() => setLoading(false));
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleNotificationClick = async (item: NotificationItem) => {
    // 1. Instantly mark as seen in local state to clear unread badge/icon
    if (!item.isRead) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === item.id ? { ...n, isRead: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
      void markNotificationAsRead(item.id);
    }
    // 2. Close menu
    handleClose();
    // 3. Navigate to action link
    if (item.link) {
      const destination = getNotificationDestination(item);
      router.push(destination);

      const hashIndex = destination.indexOf('#');
      if (hashIndex >= 0) {
        const targetId = decodeURIComponent(destination.slice(hashIndex + 1));
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent('leaprs:notification-focus', { detail: { targetId, reminder: item.type === 'inactivity_reminder' } }));
        }, 0);
      }
    }
  };

  const handleMarkAllRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
    await markAllNotificationsAsRead();
  };

  const isOpen = Boolean(anchorEl);

  return (
    <>
      <Tooltip title={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}>
        <IconButton
          color="primary"
          onClick={handleOpen}
          aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
          sx={{ position: 'relative' }}
        >
          <Badge
            badgeContent={unreadCount}
            color="error"
            max={99}
            invisible={unreadCount === 0}
            sx={{
              '& .MuiBadge-badge': {
                fontSize: '0.7rem',
                height: 18,
                minWidth: 18,
                fontWeight: 700,
                px: 0.5,
              },
            }}
          >
            <NotificationsIcon />
          </Badge>
        </IconButton>
      </Tooltip>

      <Popover
        open={isOpen}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
        slotProps={{
          paper: {
            sx: {
              width: { xs: 'calc(100vw - 32px)', sm: 720 },
              maxWidth: 'calc(100vw - 32px)',
              maxHeight: 'min(640px, calc(100dvh - 96px))',
              borderRadius: 2,
              boxShadow: '0 12px 32px rgba(28, 40, 28, 0.12)',
              border: '1px solid rgba(28, 40, 28, 0.08)',
              display: 'flex',
              flexDirection: 'column',
              bgcolor: '#ffffff',
              mt: 1.5,
              overflow: 'hidden',
            },
          },
        }}
      >
        {/* Header */}
        <Stack
          direction="row"
          sx={{
            px: 2.5,
            py: 1.75,
            flexShrink: 0,
            flexWrap: 'wrap',
            gap: 1,
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid rgba(0,0,0,0.06)',
            bgcolor: '#fafcfa',
          }}
        >
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, color: 'text.primary' }}>
              Notifications
            </Typography>
            {unreadCount > 0 && (
              <Chip
                label={`${unreadCount} new`}
                size="small"
                color="primary"
                sx={{ height: 20, fontSize: '0.7rem', fontWeight: 700 }}
              />
            )}
          </Stack>
          {unreadCount > 0 && (
            <Button
              size="small"
              variant="text"
              color="primary"
              startIcon={<DoneAllIcon sx={{ fontSize: 16 }} />}
              onClick={handleMarkAllRead}
              sx={{ p: 0.5, fontSize: '0.75rem', fontWeight: 700 }}
            >
              Mark all read
            </Button>
          )}
        </Stack>

        <Box sx={{ display: 'flex', height: 500, minHeight: 0, overflow: 'hidden' }}>
          <Box
            sx={{
              px: { xs: 0.5, sm: 1.5 },
              py: 1,
              width: { xs: 132, sm: 220 },
              flexShrink: 0,
              overflowY: 'auto',
              borderRight: '1px solid rgba(0,0,0,0.06)',
              '& .MuiFormControlLabel-label': { fontSize: { xs: '0.8rem', sm: '0.875rem' } },
              bgcolor: '#fafcfa',
            }}
          >
            <FormGroup aria-label="Filter notifications by type">
              <FormControlLabel
                label="All"
                control={
                  <Checkbox
                    checked={allTypesSelected}
                    indeterminate={selectedTypes.length > 0 && !allTypesSelected}
                    onChange={(_, checked) => setSelectedTypes(
                      checked ? NOTIFICATION_FILTERS.map((filter) => filter.type) : []
                    )}
                  />
                }
                sx={{ minHeight: 44, m: 0, '& .MuiFormControlLabel-label': { fontWeight: 700 } }}
              />
              {NOTIFICATION_FILTERS.map((filter) => (
                <FormControlLabel
                  key={filter.type}
                  label={filter.label}
                  control={
                    <Checkbox
                      checked={selectedTypes.includes(filter.type)}
                      onChange={() => toggleType(filter.type)}
                    />
                  }
                  sx={{ minHeight: 44, m: 0 }}
                />
              ))}
            </FormGroup>
          </Box>
  
          {/* Content list */}
          <Box sx={{ overflowY: 'auto', flex: 1, minWidth: 0, minHeight: 0 }}>
            {loading && notifications.length === 0 ? (
              <Stack spacing={1.5} sx={{ p: 2 }}>
                <Skeleton variant="rounded" height={60} />
                <Skeleton variant="rounded" height={60} />
                <Skeleton variant="rounded" height={60} />
              </Stack>
            ) : filteredNotifications.length === 0 ? (
              <Stack
                spacing={1}
                sx={{
                  py: 6,
                  px: 3,
                  alignItems: 'center',
                  textAlign: 'center',
                  color: 'text.secondary',
                }}
              >
                <EmptyBellIcon sx={{ fontSize: 40, color: 'text.disabled' }} />
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {notifications.length === 0 ? 'No notifications yet'
                    : selectedTypes.length === 0 ? 'Select a notification type'
                    : 'No matching notifications'}
                </Typography>
              </Stack>
            ) : (
              filteredNotifications.map((n) => (
                <Box
                  key={n.id}
                  onClick={() => void handleNotificationClick(n)}
                  sx={{
                    p: { xs: 1, sm: 2 },
                    display: 'flex',
                    gap: { xs: 0.75, sm: 1.5 },
                    alignItems: 'flex-start',
                    cursor: 'pointer',
                    bgcolor: n.isRead ? '#ffffff' : 'rgba(46, 125, 50, 0.05)',
                    transition: 'background-color 0.15s ease-in-out',
                    '&:hover': {
                      bgcolor: n.isRead ? 'rgba(0,0,0,0.03)' : 'rgba(46, 125, 50, 0.1)',
                    },
                    borderBottom: '1px solid rgba(0,0,0,0.05)',
                  }}
                >
                  {/* Type Icon */}
                  <Box
                    sx={{
                      width: 34,
                      height: 34,
                      borderRadius: '8px',
                      bgcolor: getIconBgColor(n.type),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      mt: 0.25,
                    }}
                  >
                    {getNotificationIcon(n.type)}
                  </Box>
  
                  {/* Details */}
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', gap: { xs: 0.25, sm: 1 }, flexDirection: { xs: 'column', sm: 'row' } }}>
                      <Typography
                        variant="body2"
                        noWrap
                        sx={{
                          fontWeight: n.isRead ? 600 : 800,
                          color: n.isRead ? 'text.primary' : 'primary.dark',
                          fontSize: '0.85rem',
                        }}
                      >
                        {n.title}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{
                          color: 'text.secondary',
                          fontSize: '0.7rem',
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                        }}
                      >
                        {formatRelativeTime(n.createdAt)}
                      </Typography>
                    </Stack>
                    <Typography
                      variant="body2"
                      sx={{
                        color: 'text.secondary',
                        fontSize: '0.8rem',
                        lineHeight: 1.35,
                        mt: 0.25,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {n.message}
                    </Typography>
                  </Box>
  
                  {/* Unread indicator dot */}
                  {!n.isRead && (
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        bgcolor: 'primary.main',
                        flexShrink: 0,
                        mt: 0.75,
                      }}
                    />
                  )}
                </Box>
              ))
            )}
          </Box>
        </Box>
      </Popover>
    </>
  );
}
