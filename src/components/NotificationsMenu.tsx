'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Box,
  Button,
  Chip,
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
} from '@mui/icons-material';
import {
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  type NotificationItem,
} from '@/app/actions';

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

export default function NotificationsMenu() {
  const router = useRouter();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

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
    void fetchNotifications();
    const interval = window.setInterval(() => {
      void fetchNotifications();
    }, 30_000);
    return () => window.clearInterval(interval);
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
      router.push(item.link);
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
              width: { xs: 320, sm: 390 },
              maxHeight: 500,
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

        {/* Content list */}
        <Box sx={{ overflowY: 'auto', flexGrow: 1, maxHeight: 400 }}>
          {loading && notifications.length === 0 ? (
            <Stack spacing={1.5} sx={{ p: 2 }}>
              <Skeleton variant="rounded" height={60} />
              <Skeleton variant="rounded" height={60} />
              <Skeleton variant="rounded" height={60} />
            </Stack>
          ) : notifications.length === 0 ? (
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
                No notifications yet
              </Typography>
              <Typography variant="caption">
                Updates regarding requisitions and projects will appear here.
              </Typography>
            </Stack>
          ) : (
            notifications.map((n) => (
              <Box
                key={n.id}
                onClick={() => void handleNotificationClick(n)}
                sx={{
                  p: 2,
                  display: 'flex',
                  gap: 1.5,
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
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 1 }}>
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
      </Popover>
    </>
  );
}
