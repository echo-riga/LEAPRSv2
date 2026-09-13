'use client';

import React, { useState } from 'react';
import { SmartToyOutlined as RobotIcon, Send as SendIcon } from '@mui/icons-material';
import { Box, Button, Divider, IconButton, Paper, Popover, Stack, TextField, Tooltip, Typography } from '@mui/material';

type Message = { sender: 'assistant' | 'user'; text: string };

const welcomeMessage: Message = {
  sender: 'assistant',
  text: 'Hi. I can help with CapDev projects, requests, attachments, and navigation.',
};

function getReply(message: string) {
  const text = message.toLowerCase();
  if (text.includes('file') || text.includes('upload') || text.includes('attachment')) return 'Attach the file in the form, then wait for the upload to finish before opening it.';
  if (text.includes('capdev') || text.includes('aip')) return 'Open the CapDev dashboard to add or view projects. Each AIP Code can be used only once.';
  if (text.includes('request')) return 'Open a CapDev project, then select Requests to create or manage its requests.';
  if (text.includes('status') || text.includes('progress')) return 'Open a request and select its status timeline to view or add updates.';
  if (text.includes('setting') || text.includes('config')) return 'Administrators can configure CapDev and Request form fields from Settings.';
  return 'I can help with CapDev projects, requests, attachments, status updates, and settings.';
}

export default function PortalChatbot() {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Message[]>([welcomeMessage]);
  const open = Boolean(anchorEl);

  const sendMessage = () => {
    const text = message.trim();
    if (!text) return;
    setMessages((current) => [...current, { sender: 'user', text }, { sender: 'assistant', text: getReply(text) }]);
    setMessage('');
  };

  return (
    <>
      <Tooltip title="Help chat">
        <IconButton color="primary" onClick={(event) => setAnchorEl(event.currentTarget)} aria-label="Open help chat">
          <RobotIcon />
        </IconButton>
      </Tooltip>
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: { xs: 'calc(100vw - 32px)', sm: 360 }, borderRadius: 2, overflow: 'hidden', mt: 1 } } }}
      >
        <Stack sx={{ height: 410 }}>
          <Box sx={{ px: 2, py: 1.5, bgcolor: 'primary.dark', color: 'primary.contrastText' }}>
            <Typography sx={{ fontWeight: 800 }}>LEAPRS Help</Typography>
          </Box>
          <Stack spacing={1.25} sx={{ flexGrow: 1, overflowY: 'auto', p: 1.5, bgcolor: 'background.default' }}>
            {messages.map((item, index) => (
              <Paper key={`${item.sender}-${index}`} variant="outlined" sx={{ alignSelf: item.sender === 'user' ? 'flex-end' : 'flex-start', maxWidth: '86%', px: 1.25, py: 0.9, borderRadius: 2, bgcolor: item.sender === 'user' ? 'primary.main' : 'background.paper', color: item.sender === 'user' ? 'primary.contrastText' : 'text.primary', borderColor: item.sender === 'user' ? 'primary.main' : 'divider' }}>
                <Typography variant="body2">{item.text}</Typography>
              </Paper>
            ))}
          </Stack>
          <Divider />
          <Stack direction="row" spacing={1} sx={{ p: 1.25 }}>
            <TextField
              fullWidth
              size="small"
              placeholder="Ask about LEAPRS"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  sendMessage();
                }
              }}
            />
            <Button variant="contained" onClick={sendMessage} disabled={!message.trim()} aria-label="Send message" sx={{ minWidth: 44, px: 1 }}>
              <SendIcon fontSize="small" />
            </Button>
          </Stack>
        </Stack>
      </Popover>
    </>
  );
}
