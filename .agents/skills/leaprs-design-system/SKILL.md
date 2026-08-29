---
name: leaprs-design-system
description: >-
  Use this skill when designing or implementing user interfaces, pages, or components
  for the LEAPRS (Lifelong Education Advancement Program Requisition System) project.
---

# LEAPRS Design System & Guidelines

This document outlines the core design system and principles for the LEAPRS (Lifelong Education Advancement Program Requisition System) application. Follow these guidelines strictly to maintain a unified, distraction-free, and kiosk-like user experience across all modules (e.g., login, users management, requisitions).

---

## 1. Core Principle: "Don't State What's Implied"

The primary goal of LEAPRS is utility. Seminar coordinators and government staff are recurring users who already know the purpose of the screens they visit.
- **Zero Fluff**: Eliminate all unnecessary help text, descriptions, footnotes, or decorative text.
- **Self-Explanatory UI**: Design interfaces where actions are clear based on the controls themselves (e.g., standard text fields, clearly labeled action buttons).
- **Legible Layout**: Rely on spacing, font sizes, and layout to guide the user rather than paragraphs of text.

---

## 2. White-Green Kiosk Color Palette

The colors are defined in the [Theme Registry](file:///c:/Projects/LEAPRSv2/src/theme/ThemeRegistry.tsx) to ensure a clean, corporate, high-contrast aesthetic:

| Token | Color Code | Purpose |
| :--- | :--- | :--- |
| **Primary (Leaf Green)** | `#2e7d32` | Primary buttons, active state highlights, success indicators |
| **Secondary (Forest Green)** | `#1b5e20` | Brand text, headers, and secondary actions |
| **Background Default** | `#f4f7f4` | Soft light-green/grey tint for default page layouts (restful on eyes) |
| **Background Paper / Soft White** | `#fafcfa` | Off-white with soft green-grey tint to prevent eye strain (avoid pure `#ffffff` which hurts eyes) |
| **Text Primary** | `#1c281c` | High legibility dark green-grey for all standard text (not harsh black) |
| **Text Secondary** | `#4a5d4a` | Subtle secondary metadata or captions |

---

## 3. Touch-Friendly Kiosk Usability

Since the portal is accessed by employees, staffs, and older seminar coordinators (often on shared kiosk screens or tablets):
- **Click Targets**: Always make buttons and text fields large. Buttons should have a minimum padding of `12px 24px` and a font size of `1rem`.
- **Inputs**: Add clear icons (e.g., email icon, lock icon, search icon) at the start of text inputs to signify their purpose without relying on large text descriptions.
- **Corners**: All interactive elements (cards, text fields, buttons) should use a consistent `borderRadius` of `8px` for a modern, friendly feel.
- **Floating Action Buttons**: Main operational pages that support resource creation (e.g., adding a user, creating a custom field) must render their creation trigger as a fixed, floating extended FAB in the bottom-right corner of the viewport (using `variant="extended"`, `AddIcon`, and a explicit text label like "+ Add User"). This keeps actions highly visible and touch-accessible.

---

## 4. Grid-Based "Box-by-Box" Page Layout

To prevent users from being bombarded with different layouts, all main operational pages (such as **Users Page** or **Requests Page**) must use a consistent, grid-based "box-by-box" layout pattern.

### The Grid Layout Concept
- **Top Header**: A clean, single-colored header bar showing the system title, current time, active coordinator email, and a red Sign Out button.
- **Kiosk Full-Screen Layout**: Zero empty margins or huge blank white spaces. Expand content to fill the screen space, showing big content instead of large empty gaps. Avoid standard narrow wrappers; use fluid full-width or high-percentage width layout containers.
- **Page Alignment Consistency**: Admin page titles and their primary content must share the same left edge as sibling admin pages. Reuse the established admin page content container and its gutters; do not omit it for a page title unless a deliberately narrower, centered reading layout is explicitly required.
- **Layout Content**: Distinct, independent, eye-friendly soft-white panels (Cards/Papers, using `#fafcfa`) arranged in a grid or stack. For resource listings (e.g. Users), the page layout must always render as a 2-row, 3-column box grid (maximum 6 items per page) on desktop, using pagination to prevent vertical scrolling. Cards must display only core properties (e.g. name, email, role, password) without fluff (such as account status), with actions aligned at the bottom.
- **Summary Cards vs. Edit Views**: Resource cards/boxes are concise summaries and display fixed, core fields only. Do not render configurable/dynamic fields, uploaded attachments, or long custom values inside those cards. The create/edit dialog is the detailed view: it must display every fixed field and every active configured field, including attachment links for already uploaded files.

### Code Pattern Template (Material UI)

Use the following React/MUI template for new pages:

```tsx
'use client';

import React from 'react';
import { Container, Box, Card, CardContent, Typography, Stack, Grid, Button } from '@mui/material';

export default function StandardPage() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', bgcolor: '#fafcfa' }}>
      {/* 1. Header Bar */}
      <Card sx={{ bgcolor: 'primary.dark', color: 'primary.contrastText', borderRadius: 0, p: 2 }}>
        <Container maxWidth={false}>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6" sx={{ fontWeight: '800' }}>
              LEAPRS Portal
            </Typography>
            <Button variant="contained" color="error" size="small">
              Sign Out
            </Button>
          </Stack>
        </Container>
      </Card>

      {/* 2. Main Page Grid Content - Kiosk Fluid Full-Width */}
      <Container maxWidth={false} sx={{ p: 2, flexGrow: 1 }}>
        <Grid container spacing={2}>
          
          {/* Box 1: e.g. Directory Grid / Main Action List */}
          <Grid size={{ xs: 12, md: 8 }}>
            <Card variant="outlined" sx={{ borderRadius: 2, height: '100%' }}>
              <CardContent>
                <Typography variant="h5" sx={{ fontWeight: 'bold', mb: 2 }} color="text.primary">
                  Main Content Header
                </Typography>
                {/* Content table or list goes here */}
              </CardContent>
            </Card>
          </Grid>

          {/* Box 2: e.g. Action Panel / Sidebar Details */}
          <Grid size={{ xs: 12, md: 4 }}>
            <Card variant="outlined" sx={{ borderRadius: 2, height: '100%' }}>
              <CardContent>
                <Typography variant="h5" sx={{ fontWeight: 'bold', mb: 2 }} color="text.primary">
                  Actions
                </Typography>
                {/* Action buttons or quick info goes here */}
              </CardContent>
            </Card>
          </Grid>

        </Grid>
      </Container>
    </Box>
  );
}
```

## 5. Date Display Format

- **Human-readable dates**: Whenever a stored date is shown for reading, format it as `Month day, year` (for example, `May 10, 2005`). Keep ISO-style values such as `2005-05-10` only inside date inputs or technical data views.
