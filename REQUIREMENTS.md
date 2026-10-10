# LEAPRS Requirements

Reviewed against the workspace on October 10, 2026. This document defines business rules and expected product behavior. [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) defines presentation; [ARCHITECTURE.md](ARCHITECTURE.md) explains implementation and known differences from these requirements. A workspace review does not establish which changes or migrations are deployed.

This document replaces the earlier system concept. The [project guidance skill](.agents/skills/leaprs-project-guidance/SKILL.md) directs coding agents to the relevant root documents when needed.

## 1. Purpose and scope

LEAPRS manages Capacity Development (CapDev) projects, requisitions against those projects, request progress, budgets, attachments, evaluations, notifications, and administrative records. Users work in a shared `/portal`; their role determines their access.

Supported entry points are the web portal, the portal AI assistant, and authorized external AI apps connected through MCP. AI access must obey the same ownership, department, archive, and maintenance rules as direct use.

## 2. Roles and permissions

| Capability | Admin | Employee | Employee (All Department Requests) | Viewer | Viewer (All Departments) |
| --- | --- | --- | --- | --- | --- |
| View CapDev projects | All | All | All | Own department | All |
| Create/edit/archive/delete CapDev | Yes | No | No | No | No |
| View requests and their history | All | Own requests | All | Own department | All |
| Create requests | Yes | Yes | Yes | No | No |
| Edit/manage requests and add progress | All | Own requests | All | No | No |
| Stop/resume progress | Yes | No | Yes | No | No |
| Respond to an active stopper | No | Own request | No | No | No |
| Complete/deny requests | All | Own requests, subject to stopper rules | All | No | No |
| Reports and analytics | All | No | No | Own department | All |
| User administration, audit, form configuration, maintenance | Yes | No | No | No | No |
| Own email preferences and AI connection guide | Yes | Yes | Yes | Yes | Yes |

Despite its stored name `employee-department`, Employee (All Department Requests) is a cross-department request management role. Archived records and archived parents restrict otherwise permitted mutations. UI visibility alone must never authorize a server action.

## 3. Accounts and access

- Self-registration collects name, email, password, role, and department. Only the exact `@plpasig.edu.ph` domain is accepted, case-insensitively. Admin-created accounts may use other domains.
- A six-digit email verification code must be confirmed before registration completes. Codes expire after 15 minutes; sending and verification are rate limited.
- Self-registration offers Employee, Employee (All Department Requests), Viewer, and Viewer (All Departments). Admin is assigned through user administration.
- Employee, Viewer, and Viewer (All Departments) receive their profiles after verification. Employee (All Department Requests) requires Admin approval. Rejection removes the pending authentication account.
- New/reset passwords must contain 8 to 128 characters. Admin editing leaves the current password unchanged when New Password is blank.
- Authentication failures must not be reported as successful updates. User cards mask passwords; audit details must not contain passwords.
- Department is a fixed field. Shared suggestions come from stored departments and support “Not listed (please specify).” Admins can hide or restore department suggestions.
- Maintenance mode allows Admin access and blocks all other roles, including their server actions and MCP calls. Archived accounts cannot use portal actions or MCP tools.

## 4. Records and identifiers

### CapDev

- Fixed fields: AIP Code, description, initial budget, remaining budget, and department.
- AIP Code is unique and follows `0000-000-0-0-00-000-000`. It is the user-facing project identifier.
- Initial budget records the original allocation; remaining budget reflects permanent deductions. Ordinary project edits do not reset these balances.
- Admin-configured fields provide additional project information.

### Requests

- Every request belongs to one CapDev and has a submitting user, requestor name, setting, description, requested budget, and configured fields.
- UI settings are In-House and External; stored values are `internal` and `external`. Each setting has an independent form configuration.
- Requestor name is the primary user-facing request label. Internal numeric IDs remain necessary for relations, routes, and exact tool lookups; names are not unique database keys.
- The submitting identity and initial workflow state come from authenticated server context.
- Required fields must be populated and suggestions-only selections must match configured options.

### Progress and resolution

- Request states are In progress, Completed, and Denied. Stopped is a separate progress condition.
- Ordinary progress marks are Pending, Completed, and Denied; historical Accepted marks remain readable.
- A progress mark documents one milestone. It does not conclude the whole request.
- Only an explicit request resolution concludes it. Concluded requests reject new ordinary timeline entries.
- Timeline history includes progress, stoppers, responses, resumes, configured values, and attachments.

## 5. Budget rules

- Requested and deducted amounts must be positive, with at most two decimal places. A request must not exceed its project's available balance at validation.
- Creating a request does not reserve or deduct funds. Multiple pending requests may compete for the same remaining balance.
- An explicit deduction on a status update reduces the CapDev balance once. It can use an entered amount and records that amount on the request.
- A deduction must not overdraw the remaining balance, even with simultaneous submissions. The balance change and deduction entry must commit together or both fail.
- Requested budget cannot change after deduction. Removing or archiving the request or its deduction history must not refund the project or allow a second deduction.
- A stopper response cannot deduct budget or mark the request complete.

## 6. Stopper workflow

1. Admin or Employee (All Department Requests) stops an active request with a reason and optional files.
2. A stopper is recorded on the timeline and becomes the request's active blocker. A stopped request cannot receive another active stopper.
3. While stopped, only the owning Employee can add a response to the active stopper. Ordinary progress posting is blocked for all roles until resumed.
4. Admin or Employee (All Department Requests) resumes progress. The stopper and its responses remain in history.
5. An Employee cannot complete or deny a stopped request until it is resumed. Management roles retain their resolution authority.

## 7. Configurable forms

- Admins configure CapDev, In-House request, External request, and status-update fields.
- Supported types include text with optional suggestions, suggestions-only combobox, number, date, file, and table. Legacy select fields remain supported.
- Definitions control label, required/active state, options, order, width, and column position. Tables occupy a full row; an unpaired half-width field can occupy the left or right column.
- Values use stable field identity, with a legacy label fallback. Renaming a field must not disconnect values saved under its stable identity.
- Fixed fields remain usable in previews but cannot be deleted, reordered, or configured as dynamic fields.
- Add Field and edits stage changes. Save Configuration is the explicit persistence action; Cancel discards or restores the current draft.

## 8. Attachments and background uploads

### Saving and viewing

- CapDev, request, progress, stopper, stopper response, and portal AI draft submissions save fields and pending file descriptors first. After successful saving, the form closes and Drive uploads continue in the background.
- A saved pending descriptor is not a usable attachment link. Authorized record viewers see the file name with “Upload pending” until completion; they cannot open its Drive file yet.
- Local files selected before saving may be previewed through local links. These previews do not mean the file is already stored in Drive.
- Completed attachment links become available after the server verifies and attaches the file. Record views refresh after completion.
- Existing attachments and unrelated values must survive completion and stale form saves. Upload retries must not create another business record or repeat a deduction.

### Progress and recovery

- The uploader's current browser tab shows an Attachments panel at bottom-left. It lists file names, Waiting/Uploading/Uploaded states, progress, and Retry after failure. Requestor names and Clear completed are omitted.
- Hide collapses the panel to a small icon at bottom-left; clicking the icon reopens it. Hiding never pauses an upload.
- The panel and icon disappear when all jobs finish. Failed jobs remain available for retry.
- Files upload one at a time, with up to three automatic attempts and increasing retry delays before manual Retry.
- Client-side portal navigation keeps uploads running. Refreshing, closing the tab, or signing out interrupts unfinished work. Warn before deliberate unload or sign-out while jobs remain unfinished.
- Descriptors persist in PostgreSQL; file bytes and resumable job state persist in device IndexedDB per account. The same account resumes unfinished uploads when reopening the portal in that browser. Transfers pause while the browser is closed. A Web Lock prevents concurrent processing by tabs for the same account. Clearing device storage or changing browsers/devices requires re-selection.
- Before transfer/retry, reconcile the saved job with its record. Already attached files must not upload again. Removed records/attachments cancel their job; clean up only unused Drive files tagged for that exact uploader, record and upload token. Recovery errors preserve files for Retry; archive/permission changes never authorize deletion.
- Empty files are rejected. The background path allows at most 10 selected files totaling 100 MiB per field.

### Storage and access

- Drive stores attachment bytes. Request files use the request's managed folder; CapDev files use the configured root folder.
- Only an authorized uploader may complete their pending descriptor. Completion must verify the file belongs to the expected uploader, record, and managed folder.
- Portal permission to view an attachment reference and Google Drive permission to open the file are separate. Do not describe Drive links as automatically public.
- Uploading a file for AI extraction still requires sending its bytes before draft review. Only subsequent Drive storage happens after request submission.

## 9. Notifications

### Events and audience

The seven categories are Inactivity Reminders, Request Submissions, Status Updates, Completed Requests, Denied Requests, CapDev Creation, and Role Approvals.

| Role | Ordinary notification audience |
| --- | --- |
| Admin | Request submissions and activity across departments; role approvals |
| Employee | Other users' status/resolution activity on owned requests |
| Employee (All Department Requests) | Request submissions and activity across departments |
| Viewer | CapDev creation and request activity in own department |
| Viewer (All Departments) | CapDev creation and request activity across departments |

- Ordinary events exclude their actor. System-generated inactivity reminders include involved users even if they posted the latest activity. Admins remain included in reminder audiences.
- Record events require their associated record to exist. Role approvals have a separate Admin audience. Obsolete inactivity reminders must disappear when the eligibility conditions change.
- Read state is per user. Type filters change the displayed list, not permissions or unread counts. Mark all read is scoped to accessible notifications.
- The panel shows up to 30 accessible notifications, prioritizing eligible inactivity reminders. Notification links focus the related card, timeline entry, resolution, or approval.
- User-facing notification text identifies requests by requestor name, including adapted historical text.

### Inactivity reminders

- Admin sets the threshold through Configure Inactivity Reminders. The default is 7 days; allowed whole numbers are 1 through 365.
- Count complete elapsed 24-hour periods since the latest timeline entry, including stopper responses and resumes, or submission when there is no entry.
- Only active In progress requests with active parents qualify. Concluded, legacy-completed, or archived requests do not.
- Create one reminder per request/activity episode. Concurrent checks must not duplicate it.
- New activity, conclusion, archive, or an increased threshold can hide an obsolete reminder. A later activity episode can produce another unread reminder.
- Portal refreshes check reminders on demand. An external schedule is required for checks when nobody is using the portal.

### Email notifications

- Eligible new events also produce individual emails to involved active users' registered account addresses.
- Every active role can configure their own seven email categories through Notifications. Admins can also open their own preferences from System Settings; this is not a global switch for other users.
- Categories default to enabled. Saving none opts out of notification emails. Cancel preserves stored preferences.
- Preferences are separate from in-app filters and do not disable verification or password-reset emails.
- Recheck eligibility, email address, and preferences before sending. Enabling a previously skipped category must not resend processed historical events. Pre-migration notifications remain in-app only.
- Failed delivery retries are bounded and must not undo a saved request or other business action. Duplicate prevention applies to the event-recipient pair and provider retries.
- Provider acceptance is not proof of delivery to the inbox. Check application errors and provider delivery records when investigating failures.

## 10. Archiving, deletion, and audit

- CapDev, requests, and users support separate Active and Archived views. Archived records are read-only. Archiving a parent freezes descendants without rewriting their individual archive flags.
- Restore the parent before editing or restoring descendants. A permanently deleted account cannot be restored.
- Permanent business-record deletion requires the target or its parent to be archived. User deletion requires an archived account and removes authentication access and MCP grants while retaining the archived application identity for history.
- Deleting a CapDev removes its child requests, timeline records, notifications, and related reads/deliveries. Request deletion removes its managed Drive folder and child database records. Retain immutable audit snapshots.
- Legacy folder IDs taken only from form JSON must not be trusted for folder deletion.
- The timeline has no separate archive management screen. Archived history remains readable; mutation controls are absent under archived parents.
- Deletion and archiving never refund previously deducted amounts. Clearing an active stopper through supported deletion also clears its dependent response/resume history and stopped state.
- Audit history captures actor and record snapshots, readable identifiers, and relevant changes. Admin alone can search and page through it. Audit history survives source record deletion.

## 11. Evaluations and reports

- Completing an In-House request creates or reuses its seminar evaluation Google Form. External requests do not generate this seminar evaluation workflow.
- Evaluation sections cover speaker, content/learnings, satisfaction, comments, and training needs. The final view provides open/edit/copy actions and See Summary.
- Fetch responses on demand. Compute rating summaries from actual responses; optional AI summarizes written responses. Rating results remain usable when AI summarization is unavailable.
- Admin and Viewers can view analytics and export monitoring workbooks from authorized live data. Department Viewer access remains scoped to their department.
- Reports can include selected projects and fixed/configured fields. AIP Code identifies projects; stored numeric IDs remain internal lookup keys.

## 12. AI assistance and external AI connections

- LEAPRS Help is available to all active roles. Answers and tools must be grounded in authorized results; never claim a write succeeded before confirmation from the server.
- Portal intake accepts supported images, PDFs, or activity-design text, extracts a draft using the active request form, and asks the user to review it. AI extraction alone must not submit a request.
- Request submission requires user confirmation, a permitted role, an active CapDev, required values, and budget validation.
- Connect to AI Apps is available inside LEAPRS Help for all roles, including employees without Settings access.
- The dialog provides the configured public server URL, Copy URL, and separate screenshot guides for Claude and ChatGPT. Users register automatically in the AI app, sign in to LEAPRS, and approve access. They do not obtain a shared client secret from an administrator.
- Automatic client registration identifies the AI client; it does not grant access to business data. The approving LEAPRS account determines authorization.
- The external connection remains bound to the approving account. Logging out of LEAPRS or logging in as someone else does not change or revoke that connection. Role, department, archive, and maintenance checks apply on subsequent tool calls.
- Connected AI Apps is available from Connect to AI Apps for every role. List only the current account's approved clients with live grants. Revoke access invalidates that account/client's code, access and refresh grants; other accounts retain access. Subsequent calls require new approval, and an already running authorized call may finish.
- AI request scopes and completion/stopped classification follow the portal. Summary counts cover all matching active records, independently of the recent-results limit.
- Notifying business mutations and their notification event must commit in one transaction; notification failure rolls back the mutation. Email delivery remains asynchronous.
- External tools support project lookup/listing, form schema, request status/summary, department budget, request drafts, attachment metadata references, and confirmed request submission. The attachment tool does not transfer file bytes to Drive.
- Clients need remote HTTP MCP, OAuth discovery, dynamic client registration, and S256 PKCE support. Compatibility is not promised for every AI product.

## 13. Acceptance review

| Scenario | Expected result |
| --- | --- |
| Employee opens another user's request directly or through MCP | Access denied |
| Department Viewer requests another department's data | Access denied |
| Two users attempt deductions against an insufficient shared balance | No negative balance or duplicate deduction |
| User posts Completed on one progress entry | Whole request remains active until explicit resolution |
| Parent is archived during a pending mutation | Mutation is rejected after the server's archive check |
| Save a form with several files on a slow connection | Record saves first; files remain pending while the tab uploads |
| Hide the upload panel | Upload continues; bottom-left icon reopens progress |
| Last upload succeeds, or a file fails all automatic attempts | Success removes panel/icon; failure retains Retry |
| Reload with unfinished files | Record remains; same account/browser resumes saved uploads |
| Save a stale form after one attachment finishes | Finished attachment is preserved |
| A notification email fails | Saved business action remains; bounded delivery retry is eligible |
| Disable one email type and trigger a new event of that type | In-app eligibility remains; email is skipped |
| Connect Claude/ChatGPT automatically as a Viewer | Read tools obey Viewer scope; submission is rejected |
| Sign out of the browser after approving an AI connector | Connector keeps its original account authorization until tokens/grants cease to authorize it |

Implementation evidence and remaining discrepancies are recorded in [ARCHITECTURE.md](ARCHITECTURE.md). This review did not execute these scenarios against production.
