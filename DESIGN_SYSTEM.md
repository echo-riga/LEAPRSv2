# LEAPRS Design System

Reviewed against the workspace on October 10, 2026. This is the current UI guide for LEAPRS. [REQUIREMENTS.md](REQUIREMENTS.md) defines business rules; [ARCHITECTURE.md](ARCHITECTURE.md) describes the implementation.

This document replaces the earlier UI design guide. The [project guidance skill](.agents/skills/leaprs-project-guidance/SKILL.md) directs coding agents here for UI tasks. Rules here express the design standard; the implementation notes distinguish existing exceptions.

## 1. Design principles

**Don't state what's implied.** Build a task-focused interface for nontechnical users. Users should understand the action from the control and context, without repeated explanations or technical background.

- Use familiar labels and plain language. Prefer “Upload pending” to infrastructure terminology.
- Remove text that repeats a title, button, field label, or obvious purpose. Avoid decorative subtitles and generic instructional paragraphs.
- Explain unfamiliar settings with one short sentence when needed. Keep field correction beside the affected input and action failures in the established error treatment.
- Reveal detail when needed: summary cards first, full forms and history on demand, one screenshot instruction at a time.
- Use consistent controls and placement so users can recognize actions without learning a new layout on each page.
- Never remove essential warnings, status feedback, account identity, or confirmation just to reduce text.

## 2. How to extend an existing screen

1. Inspect the page and its nearest sibling component.
2. Preserve its spacing, typography, palette, navigation, and action placement.
3. Reuse the nearest matching component before creating another pattern.
4. Add accessibility and responsive behavior within that pattern.
5. Introduce a different visual treatment only when the product change calls for it.

A new setting belongs in the matching card footer. It does not justify a new card style, a seventh settings box, or a different button hierarchy.

## 3. Color and typography

Use [ThemeRegistry.tsx](src/theme/ThemeRegistry.tsx) and existing page tokens.

| Token / treatment | Current value | Use |
| --- | --- | --- |
| `primary.main` | `#2e7d32` | Main actions, active controls, success |
| `primary.dark` | `#005005` | Strong green emphasis and hover |
| `secondary.main` | `#1b5e20` | Secondary green emphasis |
| `background.default` | `#f4f7f4` | Soft background areas |
| Portal surface | `#fafcfa` | Established portal/page background |
| `background.paper` | `#ffffff` | Current theme Paper/Dialog surface |
| `text.primary` | `#1c281c` | Main text |
| `text.secondary` | `#4a5d4a` | Secondary information |
| `error.main` | Theme error color | Errors, denial, depleted budget |

The legacy guide describes Paper as `#fafcfa`; the theme currently uses white Paper. Preserve the actual surrounding surface rather than silently changing the global theme.

- Inherit the application font. Portal headings use the established `h4` with heavy weight; card titles and dialog titles use strong weight at their existing sizes.
- Button labels use sentence/title case without automatic uppercase. Theme buttons use weight 600, `1rem`, `12px 24px` padding, and 8px corners; compact header/text/icon actions follow their local overrides.
- Use readable role/status labels from shared mappings. Keep database codes internal.
- Use CapDev for both singular and plural records (including count badges); use CapDev folders for containers. Use Progress Update, Request Title, Requested Amount, Initial Balance, Remaining Balance, and Viewer (All Departments) consistently across forms, filters, reports, and audit details. Action labels use Select All and Apply Filters. Preserve saved field names and internal keys when updating display wording.
- Requestor name identifies a request in user-facing lists and notifications. AIP Code identifies CapDev. Internal IDs still belong in technical routes and exact API inputs.

## 4. Page shell and cards

- Admin System Settings includes Change Drive Storage opening a simple dialog showing only the current storage owner email, centered beneath a centered title. Place Close and Change account together at the right of the dialog footer, with Change account as the primary action. Omit connection lists, Active badges, folder links, and explanatory paragraphs. Reopen the dialog after Google authorization to show its result. Load storage settings only when opened; retain the existing card grid without a separate storage card. Explain automatic folder creation/reuse and preservation of older files. Never show credentials or ask for folder IDs.

- `/portal` sends every role inside the active CapDev folder. The project list has no folder-root Back action for any role. Preserve normal Back navigation in requests and timelines.
- An Admin-only stacked-folder icon (`FolderCopyOutlined`) beside See Archives opens a floating panel styled like LEAPRS Help, with a green header, Add folder (+), Close, and a scrollable list. Highlight the active row in green with a check; selecting a row activates that folder system-wide. Each row has Rename and Delete icons. Rename replaces the name with a focused input and Save/Cancel icons; Enter saves and Escape cancels. Add uses an inline input in the panel. Disable deletion of the selected folder and retain the shared permanent-deletion confirmation. There is no separate activation action or folder-management page; legacy `/portal/folders` links redirect to the project list.
- Project editors include a Folder selector for Admins. Folder deletion explicitly names the folder and warns that active and archived projects, requests, progress, notifications, and managed attachments will be permanently deleted.
- Use only bold `LBP` text for the reference-image control immediately beside the Active/Archives toggle, before the folder selector. Admins see Add reference image when none exists; all roles see View reference image when one exists. The viewer fits image scans to the available space, embeds PDFs in the browser PDF viewer, offers Open full size, and gives Admins Add/Replace/Remove controls with an upload spinner and size/type guidance. Confirm removal with the image name. Keep the existing image visible during replacement and retain it on failed saves.
- The fixed Initial Balance field is editable in the Admin CapDev editor. When its numeric value changes, preview Remaining Balance at the same amount and show that saving resets it. Save opens a confirmation showing the project, current remaining balance, and new initial and remaining balances. Focus Cancel by default; offer an explicit warning-colored "Reset balance and save" action. Cancel returns to the unsaved editor. Creation and unchanged amounts do not prompt. Other roles and archived records retain read-only balance text. Keep this field outside dynamic configuration; historical deductions remain visible after resets.
- Use fluid portal containers with the established responsive gutters. Titles and content share the left edge.
- Preserve the current fixed, light portal header: greeting, role/department indicators, help, Admin-only Open Drive Folder, notifications, eligible Settings, fullscreen, and sign-out controls. Open Drive Folder uses the three-color triangular Google Drive logo, opens a new tab, and does not imply that the link grants Google permissions. Do not restore the legacy description of a solid green header with a clock.
- Resource pages show up to six concise summary boxes in a desktop three-column, two-row grid with pagination. Reduce columns responsively.
- CapDev and request searches wait 300 ms after typing before fetching. Request pagination and filters apply on the server, including archive views and notification focus targets. Keep saved filter preferences and existing six-card navigation. Timeline content appears before missing evaluation links finish preparation; header progress shares the loaded timeline. Background refreshes pause while the tab is hidden.
- Keep card actions aligned at the bottom. Show only fixed core summary properties; configured values and attachments belong in full views/forms.
- Primary creation actions use the existing green extended FAB with Add icon and label at bottom-right.
- Use compact MUI chips for status and role indicators. Do not introduce a competing badge system.
- Zero/depleted balances use error color in summary and detail views.

## 5. Settings

Admin Settings retains six equal outlined cards in a desktop three-column, two-row grid:

1. Users & Access
2. Reports & Analytics
3. System Settings
4. CapDev Configuration
5. Request Configuration
6. Status Update Configuration

- Cards share an icon tile, title, concise description, optional metadata space, divider, and green text-action footer with chevrons.
- Reserve equivalent content/footer space so dividers and actions align across a row, including cards without metadata chips.
- System Settings places the compact Maintenance switch in its body, beneath the description. Group Email Notifications and Change Drive Storage as matching green text links in the footer with consistent gaps, wrapping on narrow screens. Keep the full Configure Email Notifications label elsewhere. Do not stretch actions across the card or repeat an active/inactive subtitle.
- Status Update Configuration places Configure Fields and Configure Inactivity Reminders in the same footer.
- Request Configuration provides Configure External Fields and Configure In-House Fields as equal actions.
- Viewers receive the Reports & Analytics card only. Employees do not get Settings access; their email preferences and AI guide remain reachable from header tools.
- Reports presents Monitoring Sheet and Request Reports through the standard page-level Filter dialog and gives the selected report the full content width without a persistent side selector or active-type badge. Request Reports uses month/year controls, the heading `Report as of Month, Year`, and outlined table sections with green for Completed, orange for In Progress, and red for Rejected. Its download action produces a landscape PDF with the same section colors; Monitoring Sheet keeps its spreadsheet export.

## 6. Forms and dialogs

- Reuse MUI Dialog title, divided content, and bottom-right action row. Cancel is secondary; the commit action is primary.
- Evaluation summaries place one clearly labeled AI Summary card before rating charts. Group it into What participants liked, Suggested improvements, and Topics requested; use friendly empty states instead of exposing placeholder or raw responses. Keep charts visible when AI is unavailable, and never show or summarize certificate names.
- The CapDev toolbar places an Admin-only checklist icon (`ChecklistOutlined`) at the far right for Manage CapDev projects, in both active and archived views. Its dialog provides Action, Select all/Clear, and AIP-based checkboxes with department/folder/date context. The active view offers Duplicate, Move, and Archive; Archives offers Move and Delete permanently. Duplicate and Move show a required Destination folder dropdown, with the source folder excluded for Move. Use duplicate/move/archive/delete icons and primary/primary/warning/error colors on the commit button. Move, Archive, and Delete open a confirmation listing selected AIP Codes; Move also names the destination and explains that related records/balances are preserved. Duplication provides target Date Added and explains that requests/progress are excluded and balances reset. After Move or Duplicate, keep the active folder selected and show a success message naming the destination. The standard CapDev filter uses Date Added from/to fields and date shortcuts; it does not include a separate Year Added selector.
- CapDev, request, and user filter dialogs save applied selections per account in the same browser. Date shortcuts use a contained/highlighted state when their exact Today, This month, or This year range is selected.
- Show fixed and active configured fields using the existing required/optional sections and form grid.
- Read-only metadata is text, not a disabled input pretending to be editable.
- Required indicators use the established red asterisk. Do not duplicate required status in helper paragraphs.
- Request previews show Title and required Event Date as fixed fields for both In-House and External configurations. Dynamic fields use saved order and full/half widths. An unpaired half-width field honors its saved left/right position; tables occupy a full row.
- Use the shared DateField/MUI date picker, not native date inputs. Read-only dates use `Mon day, year`; ISO dates belong in input/technical values.
- Department is the existing shared combobox with Not listed (please specify).
- Add Field stages a draft. Save Configuration stays fixed at bottom-right; Cancel beside Add Field discards/restores the current edit. Avoid per-field Save buttons or header save indicators.

### Attachment fields

- File fields are checklist rows. Existing or selected/pending files check the indicator; clicking the row opens its attachment dialog.
- Show saved files as clickable names. Local selected files can open a preview/download before saving.
- Saved background descriptors show the file name and Upload pending. They have no Drive link yet; do not display a fake link or a loading viewer.
- After saving, release the form's saving state once the record is saved and hand files to the shared upload panel.

### Errors and confirmations

- Use ActionErrorDialog for confirmed save/action failures and established validation dialogs for business errors such as insufficient budget or duplicate AIP Code. Avoid top-of-form business-error banners.
- Keep correctable field feedback beside the field. Explain concrete failed rules, not “security standards” or opaque technical messages.
- Password guidance is “Use 8 to 128 characters.” Report actual length/mismatch when correction is necessary. Directory passwords remain masked.
- Permanent deletion uses the established named confirmation. Preserve useful upload-interruption warnings.
- The background panel is the retry surface for upload failures. This asynchronous case differs from a failed form save: keep the already saved record usable.

## 7. Background upload panel

Source: [BackgroundUploads.tsx](src/components/BackgroundUploads.tsx).

- Bottom-left outlined panel titled Attachments, separate from the bottom-right creation FAB.
- Show only file names, current state, upload progress, and Retry when necessary. Do not show requestor names or Clear completed.
- Hide uses a compact, labeled icon control. While hidden and unfinished, a small green attachment icon at bottom-left reopens the panel.
- Hiding keeps transfers running. Remove both panel and icon automatically when all jobs are completed; retain failed jobs for recovery.
- Uploaded means the file was attached successfully, not merely that bytes reached 100%. Progress remains below 100% until finalization.
- The panel is local to the uploading tab. Other authorized record viewers see pending attachment metadata, not another user's queue.
- Keep it responsive, scrollable, and below dialogs (`zIndex: 1200` in the current component). The current panel is 340px wide on larger screens and uses viewport width minus gutters on small screens.
- Do not imply transfers survive refresh or tab closure. Keep the interruption warning functional.

## 8. Notifications and preferences

- The notification popover uses vertical category checkboxes on the left and notifications on the right. Each area can scroll and must remain usable on narrow screens.
- All categories start selected. All selects/clears everything and shows an indeterminate state for partial selection.
- The header shows unread count, Configure Email Notifications, and Mark all read. In-app filters and saved email preferences are independent controls.
- Request-linked notification titles put the requestor first. Inactivity uses “Requestor's Request,” status updates use “Requestor's Request Update,” and resolutions use “Requestor's Request Completed/Denied.” Marked update details use “Pending • Actor: Update” without an “Update status” prefix. Stopped requests use “Progress stopped • Reason”; resumed and reopened requests use only “Progress resumed” or “Request reopened.” Keep other details short: show only the amount or actor when needed. Do not repeat the request type, description or AIP Code as request identifiers.
- Email Notifications uses one concise purpose sentence with an email icon, All and the same seven category checkboxes, then Cancel/Save. Do not add recipient chips or implementation details.
- Inactivity settings uses a bell icon, a concise trigger description, a days value with decrement/increment controls, and Cancel/Save.
- Eligible inactive request cards and the latest activity card receive a red outline and prominent red bell. The outline stays red on hover.
- Clicking an inactivity reminder opens No Progress with “No progress for N days.” After dismissal, focus the latest activity and pulse its entire containing card. With no history, show the modal without inventing a submission card.

## 9. Timeline and record focus

- Render populated configured progress values in configuration order, including files. Avoid hardcoded Action/Office priority, repeated headings/remarks, and generic Status updated for attachment-only entries.
- Keep stoppers, nested responses, and final resolution visually connected using existing timeline/card patterns. Show a resumed stopper on its existing card instead of adding a separate Progress Resumed card.
- A completed or denied timeline shows a fixed Reopen Request action for authorized users. Require confirmation and explain that history, deductions, and evaluation forms remain; if the request is also stopped, explain that reopening does not resume the stopper.
- End timeline connectors at an active stopper when the current role has no following action or resolution card; never point an arrow into empty space.
- Progress circles are keyboard-accessible summary controls with tooltips; activate them to scroll to their corresponding entry or resolution.
- Deep links first make a filtered/paginated target visible, then scroll to it.
- Pulse the whole destination card briefly: slight shrink, slight enlargement, then normal. Do not animate the title, a text fragment, or the surrounding page.
- Nested stopper responses focus their own anchor and emphasize the containing stopper card. Older notifications without exact update identity may fall back to the request card.
- Archived timelines use gray/read-only styling and omit mutation controls. Do not add a separate timeline archive page.

## 10. LEAPRS Help and AI app setup

- Reuse the header robot icon and compact white-green help popover for every role.
- Connect to AI Apps belongs in the LEAPRS Help header so employees can reach it without Settings.
- The dialog contains Server URL and Copy URL, Claude/ChatGPT tabs, and one numbered instruction with a real screenshot at a time.
- Screenshots are maintained in [public/mcp-guides](public/mcp-guides/README.md), with order/captions in [ai-app-guides.ts](src/lib/ai-app-guides.ts). Use genuine UI screenshots, not generated imitations.
- Current guides contain nine Claude steps and eight ChatGPT steps, including enabling the connection and sending a sample request.
- Images use a 500 by 400, 5:4 frame, `objectFit: contain`, responsive sizing, and a full-image link. Keep the image and instruction area stable between steps so the modal does not jump.
- Footer actions are Close, Back, and Next/Done. Provider changes reset to step one.
- Instructions use the provider's visible controls and automatic registration. Avoid asking users for client secrets or explaining OAuth internals in the walkthrough.
- Connected AI Apps opens from the connection guide. Use a compact list of app names and callback origins, an empty state, and Revoke access with a concise confirmation. Do not expose tokens or client secrets. Show only the current account's connections.
- AI draft review remains editable and requires explicit submission confirmation. Responses must reflect confirmed results.

## 11. Loading, accessibility, and action colors

- Use the shared [Skeletons.tsx](src/components/Skeletons.tsx) for route transitions and page loading: ResourceGridSkeleton, SettingsGridSkeleton, TimelineGridSkeleton, FormConfigSkeleton, AnalyticsSkeleton, and ReportsSkeleton.
- Match the actual destination layout. Reserve spinners/progress for ongoing actions; do not replace page navigation with a generic full-screen spinner.
- Maintain readable labels, meaningful image alt text, dialog titles, keyboard navigation, visible focus, icon tooltips/accessible names, and touch-friendly targets.
- Archive is orange, Restore blue, permanent Delete/sign-out red, and View green. Archived indicators are gray.
- Keep labels alongside color feedback; color must not be the only way to identify a state.

## 12. Review checklist

- Does every line of text help a user make a decision or complete the task?
- Does the change match its page and sibling controls?
- Are card footers, titles, and gutters aligned at desktop and narrow widths?
- Can users recognize the action without knowing technical vocabulary?
- Are pending, completed, failed, archived, and read-only states distinguishable?
- Can the flow be used by keyboard and with the existing touch targets?
- Does an asynchronous action report the correct stage, preserve the record, and offer recovery?
- Are screenshots genuine, legible, ordered, and displayed without layout jumps?

These are design review criteria, not a claim that every existing screen has already passed an accessibility or visual audit.

- Analytics normalizes blank or whitespace-only departments to None before creating badges, filter options, and department selections, so the None group stays visible and filters its projects correctly.
