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
- Requestor name identifies a request in user-facing lists and notifications. AIP Code identifies CapDev. Internal IDs still belong in technical routes and exact API inputs.

## 4. Page shell and cards

- Use fluid portal containers with the established responsive gutters. Titles and content share the left edge.
- Preserve the current fixed, light portal header: greeting, role/department indicators, help, notifications, eligible Settings, fullscreen, and sign-out controls. Do not restore the legacy description of a solid green header with a clock.
- Resource pages show up to six concise summary boxes in a desktop three-column, two-row grid with pagination. Reduce columns responsively.
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
- System Settings places Configure Email Notifications and the Maintenance Mode switch/label beside each other in its footer. Do not repeat an obvious active/inactive subtitle.
- Status Update Configuration places Configure Fields and Configure Inactivity Reminders in the same footer.
- Request Configuration provides Configure External Fields and Configure In-House Fields as equal actions.
- Viewers receive the Reports & Analytics card only. Employees do not get Settings access; their email preferences and AI guide remain reachable from header tools.

## 6. Forms and dialogs

- Reuse MUI Dialog title, divided content, and bottom-right action row. Cancel is secondary; the commit action is primary.
- Show fixed and active configured fields using the existing required/optional sections and form grid.
- Read-only metadata is text, not a disabled input pretending to be editable.
- Required indicators use the established red asterisk. Do not duplicate required status in helper paragraphs.
- Dynamic fields use saved order and full/half widths. An unpaired half-width field honors its saved left/right position; tables occupy a full row.
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
- Email Notifications uses one concise purpose sentence with an email icon, All and the same seven category checkboxes, then Cancel/Save. Do not add recipient chips or implementation details.
- Inactivity settings uses a bell icon, a concise trigger description, a days value with decrement/increment controls, and Cancel/Save.
- Eligible inactive request cards and the latest activity card receive a red outline and prominent red bell. The outline stays red on hover.
- Clicking an inactivity reminder opens No Progress with “No progress for N days.” After dismissal, focus the latest activity and pulse its entire containing card. With no history, show the modal without inventing a submission card.

## 9. Timeline and record focus

- Render populated configured progress values in configuration order, including files. Avoid hardcoded Action/Office priority, repeated headings/remarks, and generic Status updated for attachment-only entries.
- Keep stoppers, nested responses, resume history, and final resolution visually connected using existing timeline/card patterns.
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
