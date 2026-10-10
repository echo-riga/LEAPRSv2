---
name: leaprs-system-concept
description: >-
  Use when changing LEAPRS workflows, permissions, entities, notifications, file
  uploads, authentication rules, dynamic forms, AI-assisted request intake, or reporting.
---

# LEAPRS System Concept & Core Workflow

This document explains the conceptual architecture and functional flows of the **Lifelong Education Advancement Program Requisition System (LEAPRS)**.
It describes the current implementation; distinguish live features from sample or placeholder data when using it as a system reference.

---

## 1. System Overview

LEAPRS is designed to manage Capacity Development projects (CapDev), employee requests (requisitions) associated with those projects, and status timelines of individual requests.

```mermaid
graph TD
    Admin[Admin] -->|Creates/Configures| CapDev[CapDev Project]
    Admin -->|Configures forms| Config[Field Configurations]
    User[User / Staff] -->|Submits Request against CapDev| Request[Request]
    Request -->|Follows| Config
    User & Admin -->|Post updates| Timeline[Timeline Logs]
```

---

## 2. Core Entities

### A. CapDev (Capacity Development)
A CapDev is a parent project or educational program.
* **Fixed Fields (In Codebase)**:
  * `AIP Code` (Unique project code)
  * **UI Identifier**: Always display and reference a CapDev by its `AIP Code`; never expose the internal database ID as the CapDev identifier in user-facing UI, audit history, notifications, or reports.
  * `Description` (Project description)
  * `Initial Budget` (Original project fund)
  * `Remaining Budget` (`budget` column: available project fund after deductions)
  * `Department` (Owner department)
  * Fixed fields shown in the form preview remain interactive, but their layout is not configurable: they cannot be edited, deleted, or dragged.
* **Dynamic Fields (Configurable by Admin)**:
  * Custom tags, target audience, and other configured information.
  * Stored in `additional_info` JSONB column.
  * Fields marked `isRequired = true` are displayed in the **Required Information** section with fixed required fields and must be completed before a project can be created or updated. Other configured fields are displayed in the **Optional Information** section.
  * Dynamic fields remain fully configurable—including edit, delete, width toggling (full/half), and drag-and-drop reordering.

### B. Requests
Requisitions filed by employees against a specific CapDev.
* **Fixed Fields (In Codebase)**:
  * `Setting` (In-House or External in the UI; `internal` or `external` in storage)
  * `Description` (Request title or activity description)
  * `Requested Budget` (Cost estimation)
  * `Requestor Name` (Display name of the submitting user)
  * Fixed fields shown in the form preview remain interactive, but their layout is not configurable: they cannot be edited, deleted, or dragged.
* **Dynamic Fields (Configurable by Admin)**:
  * Attendance sheets (file type), feedback links, venue details, etc.
  * Internal and External requests have independent dynamic-field configurations. Changing the fixed `Setting` field immediately switches the dynamic fields shown by the request form; fixed request fields remain unchanged.
  * Stored in `additional_info` JSONB column.
  * Fields marked `isRequired = true` are grouped in the required section, while optional fields appear in optional sections.
  * Dynamic fields remain fully configurable—including edit, delete, width toggling, and drag-and-drop reordering.
* **Google Drive Folder ID**:
  * Stored in `additional_info.googleDriveFolderId`.

### C. Status Updates (Timeline)
Chronological logs track request progression. Ordinary status updates use configured dynamic fields, displayed in their configured order in both timeline cards and detail dialogs. Stable field IDs preserve values when labels change; historical values from removed fields remain readable after current configured fields. Attachment-only updates are supported and do not display the internal Status updated fallback. Attachment metadata is displayed once, even when stored in both dynamic fields and the aggregate files column. Timeline records also include:
* Status update text
* Remarks
* Multi-file uploads (via Google Drive integration)
* `status_mark` (`pending`, `completed`, or `denied`) is selected in the ordinary **Add Status** form. The database column is nullable because special timeline entries (stoppers, stopper responses, resume logs) do not use an ordinary status mark. A mark describes that step and does not by itself close or deny the whole request.
* `mark_as_complete` (legacy boolean column; the current Add Status form does not expose it or set it)
* `subtracts_requested_amount` (boolean with configurable deduction amount modal)
* `is_stopper`, `is_stopper_response`, `is_resume`, and `stopper_id` for blocker tracking.

---

## 3. Key Business Constraints & Logic

### A. One-Time Timeline Flags & Budget Deduction
* **Request Completion**: The current UI concludes a request through the explicit **Complete** or **Deny** resolution action, which updates the request's overall status (`in_progress`, `completed`, `denied`). Ordinary status marks do not conclude it. Once concluded, the server blocks further ordinary status updates.
* **Budget Deduction**: Once a status update has `subtracts_requested_amount = true`, the deduction modal opens allowing the user to review/edit the amount deducted before it is subtracted from the parent CapDev's balance. Only one status update per request can trigger this deduction.
* **Budget Availability**: A request's requested budget cannot exceed its parent CapDev's remaining budget. The same check is enforced again when a deduction status update is saved.
* **Budget History**: A CapDev stores its initial and remaining budgets. Its details view lists every deducted request amount and the status-update author.
* **Permanent Deductions**: Committed deductions never return to the CapDev balance, including after deleting a request or progress update. A persistent request `budget_deducted_at` marker prevents repeat deductions even if the original timeline entry is deleted. Selecting the deduction checkbox opens a one-time, irreversible deduction warning before confirmation.
* **Enforcement**: PostgreSQL partial unique indexes prevent duplicate `subtracts_requested_amount` status updates (`unique_request_subtract_idx`) and duplicate legacy `mark_as_complete` status updates (`unique_request_complete_idx`).

### B. File Uploads & Google Drive Storage Hierarchy
Google Drive is the durable file store; Vercel and the database do not store attachment bytes.

* **Folder Hierarchy**:
  * **Per-Request Dedicated Folders**: When files are uploaded for a request (e.g. dynamic file fields during request creation, multimodal AI request intake, status timeline attachments, and stoppers/stopper responses), the system creates a dedicated Google Drive folder named `[RequestorName]_[DateRequested]` (sanitized, e.g. `Jane Doe_2026-09-17`) located inside `GOOGLE_DRIVE_PARENT_FOLDER_ID`.
  * **Folder Persistence & Reuse**: The generated folder ID is cached and saved into the request's `additional_info.googleDriveFolderId`. All subsequent uploads for that request (all file inputs during creation, subsequent status updates, stoppers, and stopper responses) are placed into this same dedicated folder.
  * **Outside Request Context (Root Child)**: If an upload is performed outside a request context (such as CapDev project attachments or when no requestor/date/requestId context is provided), files are placed directly as children of `GOOGLE_DRIVE_PARENT_FOLDER_ID`.
  * **Cascade Folder Deletion**: When a request is deleted, its dedicated Google Drive folder (and all files contained within it) is automatically deleted from Google Drive via the Drive API before database records are deleted.
* **Database Reference**: Persist only Drive metadata (`id`, `name`, `mimeType`, and `url`) in the relevant JSONB value, including the `files` column of a status update and `additional_info` of requests/CapDev.
* **Upload Pathways**:
  * **Direct Resumable Upload (Primary)**: The active browser workflow requests Google Drive resumable-upload sessions (`createGoogleDriveUploadSessions`) with origin verification from the authenticated server, then PUTs file bytes directly to Google Drive via `uploadFilesDirectlyToGoogleDrive`.
  * **Server Action Upload (Fallback)**: `uploadFilesToGoogleDrive` server action handles multipart form upload through the server when needed.
* **Limits**: A single attachment selection supports at most 10 files whose combined size is **100 MB or less**.
* **Execution Model**: Uploads run as part of the active client workflow. LEAPRS does not require Redis, a message queue, or a long-running background worker for Drive uploads.

### C. Form Configuration & Custom Layouts
* Admins can configure the forms for CapDev and Requests.
* Request configuration is split into independent Internal and External field layouts, exposed as separate actions on the Settings page.
* Configurable field types: `text` (free text with optional suggestions), `combobox` (configured suggestions only), `number`, `date` (datepicker), `file`, and `table` (editable grid). Legacy `select` fields remain supported. Suggestions-only comboboxes require at least one configured option and validate submitted values against those options. Table fields occupy a full row.
* In operational forms, each configured `file` field is presented as a checklist row. Its indicator is checked when one or more existing or pending files are present; selecting the row opens the field's attachment dialog for viewing, adding, or removing files.
* Pending attachment names are clickable before saving. PDFs, plain text, and supported raster images open locally in a new tab; other formats download for opening. Local object URLs are revoked when attachment links unmount or files change. This does not upload files early; saved attachments retain their Drive links.
* Dynamic fields support full-width or half-width layout. An unpaired half-width field can occupy either the left or right column (`columnPosition: 'left' | 'right'`). Field order and column position persist in both configuration preview and operational forms.
* Adding/editing a field is a client-side draft operation. The bottom-right **Save Configuration** action is the explicit persistence point for staged additions, edits, and reordering.

### D. Cascading Entity Deletions
* **CapDev Deletion**: Automatically removes child requests, status updates, notifications, and notification reads in the same operation.
* **Request Deletion**: Automatically deletes its dedicated Google Drive folder via Drive API, child status updates, notifications, and notification reads, and records an immutable audit log entry.
* Never block parent deletion due to existing child history logs.

### E. Request Status vs. Status Update Marks
* **Whole Request Statuses**: `in_progress`, `completed`, `denied`.
* **Individual Status Update Marks**: The ordinary UI offers `pending`, `completed`, and `denied` (with legacy support for `accepted`).
* Marking a status update as `denied` or `completed` documents that specific milestone without terminating or overriding the overarching request timeline. Only explicit concluding actions (**Complete** or **Deny** resolution) finalize the request.

### F. Post-Completion Seminar Evaluation
* Upon concluding a request as **Completed**, LEAPRS creates and publishes **one seminar evaluation Google Form** for that request.
* The form contains sections for Guest Speaker, Learnings and Content, Overall Satisfaction, Comments and Suggestions, and Skills or Training Areas. It includes 1-to-5 ratings and written questions.
* The form ID and responder link are stored in `participant_feedback_form_id` and `participant_feedback_form_url`.
* The completion modal and final timeline card show **Open Form**, **Edit Form**, link-copy action, and **See Summary**.
* **See Summary** fetches current responses on demand. Rating distributions and averages are calculated from Google Forms responses. Groq AI generates strengths, improvements, and recommendations from written answers when configured; rating charts remain available if AI summarization fails.

---

## 4. Access, Registration, and Departments

The shared authenticated workspace uses the role-neutral `/portal` route. Access to pages and actions within the portal is determined by the signed-in user's role.

### A. Roles & Permissions

LEAPRS defines 5 distinct application roles:
* **Admin (`admin`)**: Full access. Manages users, role approvals, form configurations, CapDev projects, requests, maintenance mode, and audit logs.
* **Employee (`employee`)**: Can view all CapDev projects, but can create, edit, delete, and post status updates only on their own requests.
* **Employee (All Department Requests) (`employee-department`)**: Cross-department request management role. Can view all CapDev projects, manage all employees' requests across departments, post timeline updates, and control stoppers across the system.
* **Viewer (`viewer`)**: Read-only access to CapDev projects and requests within their assigned department.
* **Viewer (All Departments) (`viewer-full`)**: Read-only access across all departments.

### Notification Involvement

Notifications are event records, visible only while their associated CapDev/request still exists and only to involved users. An actor never receives a notification for their own action.
* **Admin**: Receives new-request and request-status activity across all departments.
* **Employee**: Receives status activity posted by someone else on requests they own.
* **Employee (All Department Requests)**: Receives new-request and request-status activity across all departments.
* **Viewer**: Receives CapDev, request, and status activity in their department.
* **Viewer (All Departments)**: Receives CapDev, request, and status activity across all departments.
* Notification reads are tracked per user via `notification_reads`.
* Clicking a notification marks it read and routes to its associated record with a highlighted pulsing card.
* The panel filters up to 30 accessible notifications, prioritizing active inactivity reminders using vertical checkboxes on the left: Inactivity Reminders, Request Submissions, Status Updates, Completed Requests, Denied Requests, CapDev Creation, and Role Approvals. All types are selected initially; filtering does not change audience permissions, the unread badge, or the scope of Mark All Read.

### Status Update Inactivity Reminders

* Settings → Status Update Configuration → Configure Notifications loads and saves the persisted threshold in `system_settings.number_value` under `request_inactivity_days`. Admin-only server actions validate whole numbers from 1 to 365; the default is 7 days. Cancel discards edits, and Save records the change in audit history.
* Inactivity starts at the latest timeline entry's creation time, including stoppers, responses, and resumes, or at request submission if no timeline entry exists. Count full elapsed 24-hour days. Active in-progress requests become eligible at the configured threshold; concluded, legacy-completed, archived requests and descendants of archived CapDev projects do not remind.
* Reminder recipients follow request involvement permissions: Admin and Employee (All Department Requests) across departments, Employees for their own requests, department Viewers within their department, and Viewer (All Departments) across departments. Admin is always included, including for their own requests. These are system events, so the actor self-exclusion for ordinary event notifications does not apply.
* The portal checks for reminders through notification refreshes every 30 seconds and when the panel opens. Creation is on demand; no external cron or delivery service is required for these in-app notifications. Request cards and timelines refresh every 30 seconds and on window focus.
* Persist one `inactivity_reminder` notification per request/activity episode. A unique `notifications.reminder_key` makes concurrent refreshes idempotent. Reads use the existing per-user `notification_reads` table. New activity, conclusion, archiving, or an increased threshold hides obsolete reminders through live query conditions; a later activity episode can create a new unread reminder.
* Notifications have an Inactivity Reminders filter. Inactive request cards and the latest activity card have red outlines and prominent red bell buttons on their top-right edges. Clicking the bell on the timeline card opens the same reminder modal. Both links navigate to the timeline and open a compact No Progress modal showing No progress for N days. On dismissal, scroll to the current latest timeline entry and pulse its entire card. Nested stopper responses have their own focus anchor and pulse the containing stopper card. For empty timelines, use the modal without adding a submission card. Ordinary timeline navigation does not open this modal, and closing it consumes the reminder query parameter so refreshes do not reopen it.
* The additive schema migration is `drizzle/0015_request_inactivity_reminders.sql`; apply it with `node scripts/migrate-request-reminders.mjs` before using the reminder actions.

### B. Self-Registration & Role Approvals

* The login page supports self-registration with full name, email, password, role, and department.
* Self-registration accepts only the exact `@plpasig.edu.ph` email domain (case-insensitive). Enforce this in the form, verification actions, auth sign-up endpoint, and profile completion. Admin-created accounts in Users Management may use other email domains.
* **Email Verification**: Registration enforces two-step email verification. Entering details dispatches a 6-digit verification code to the applicant's email (valid for 15 minutes) via Resend. The user must confirm this verification code before the account is created in Neon Auth and the database.
* Self-registration offers **Employee**, **Employee (All Department Requests)**, **Viewer**, and **Viewer (All Departments)**. Admin is assignable only through Users Management.
* Registrations for Employee, Viewer, and Viewer (All Departments) receive their role and profile immediately after email code verification.
* Registrations for **Employee (All Department Requests)** create a pending record in `role_approval_requests` after email code verification. Admins receive a notification linking to Users Management to accept or reject the request. Acceptance creates the user profile with the requested role; rejection deletes the pending auth account.
* Password validation enforces **8 to 128 characters** with specific error messaging.
* In Users Management, an Admin can set an active user's password through the optional New Password field. The edit form forwards a nonempty password to `updateDirectoryUser`, which validates it and calls Neon Auth's `admin.setUserPassword`. A blank password preserves the current credential; archived-user edits are blocked. API failures must be surfaced instead of reporting success. Directory cards mask passwords, and audit history records only whether the password changed, never its value.

### C. Shared Department Values
* Department is a fixed important field, not a configurable dynamic field.
* Department inputs use a shared combobox populated from previously saved user profiles and CapDev projects, with a **Not listed (please specify)** option to enter new departments.
* Admins may hide or restore department suggestions in CapDev form configuration.

### D. Maintenance Mode
* Maintenance mode is a persistent system setting (`system_settings.maintenance_mode`) toggled by an **Admin** from Portal Settings.
* While active, Admins retain full access. All other roles are denied sign-in and existing non-Admin sessions lose portal and server action access immediately.

### User Archiving
* Admins archive user accounts instead of deleting them from Users Management.
* Archived users remain in authentication and business history, but cannot access portal actions while archived.
* Users Management has separate Active and Archived views. Restoring an archived user returns the account to the Active view with its role and department intact.
* Only archived accounts offer permanent deletion, with a named confirmation dialog. Deletion removes the authentication account, sessions, and MCP grants; the archived application row remains to preserve existing requests and history. Permanently deleted accounts cannot be restored.
* CapDev and requests have active/archive views. Archived records are read-only: no creation, editing, uploads, or workflow changes. Archiving a parent freezes its descendants without changing their own archive flags; restore the parent before modifying or restoring its descendants.
* The progress timeline has no separate archive screen or archive/restore/delete controls. It displays the full history, including previously archived updates. Under an archived request or CapDev, progress is gray and read-only, with no Add Status, stopper response, Resume, or conclusion actions.
* Archive actions are orange, Restore is blue, permanent Delete is red, and View stays green. Archived icons and badges are gray. Permanent deletion is offered only for archived records or descendants of an archived parent and requires confirmation.
* Archiving preserves budget deductions and workflow history. Permanent deletion never refunds deducted amounts; deleting an active stopper clears the stopped state and removes its response/resume records.

### E. Dynamic Field Storage Identity
* Dynamic form values are stored in `additional_info` JSONB keyed by the field definition's stable database ID (`field-${id}` or `field:${id}`), never by its editable display label.
* A legacy label-key fallback is maintained for records created prior to stable field IDs.

### F. Audit History
* The application records immutable actor and record snapshots in `audit_logs` for user, CapDev, request, status-update, form-configuration, and maintenance actions.
* Audit records persist after related business records or users are deleted.
* Accessible only to Admins via a searchable, paginated audit log interface referencing readable identifiers (e.g. AIP Code).

---

## 5. Stopper and Resume Workflow

* An **Admin** or **Employee (All Department Requests)** can add a stopper (`is_stopper = true`) to an in-progress request with a reason and optional attachments.
* A stopper is retained on the timeline with a **Stopped** badge, a pin visual, its reason, and attachments.
* While stopped, regular Employees cannot post ordinary status updates. Instead, the active stopper card provides a response area for the employee to submit a stopper response (`is_stopper_response = true`) with text and attachments.
* Admin and Employee (All Department Requests) see **Resume Progress** (`is_resume = true`), which clears the active stopper and re-enables normal status updates.

---

## 6. Timeline Navigation and AI-Assisted Workflows

* The interactive progress bar in the request-status header mirrors timeline milestones and links directly to timeline updates, stoppers, or final resolution cards.
* **Portal AI Help Chatbot**:
  * Accessible from the portal header robot icon to all authenticated roles.
  * Powered by Gemini (e.g. `gemini-2.5-flash`), with grounded read-only tool calling (`get_request_status`, `get_my_requests_summary`, `get_department_budget_balance`, `list_available_capdev_projects`, `find_capdev_by_aip_code`, `get_request_form_schema`).
* **Multimodal Activity Design Intake**:
  * Users can upload or paste (Ctrl+V) activity design images, posters, screenshots, or PDFs into the chat.
  * Multimodal Gemini extracts requisition fields (AIP Code, setting, budget, description, dynamic fields) against the active form schema into a structured draft.
  * Users review, adjust, and confirm the draft in an editable modal before creating the request.
* **MCP OAuth Endpoint**:
  * Exposes `/api/mcp` and `/api/mcp/oauth/*` endpoints for external MCP clients.
  * Enforces role, department, and maintenance mode restrictions for external agent tool calls.

---

## 7. CapDev Uniqueness

* `AIP Code` is unique across CapDev projects. Creation performs a pre-check, backed by the PostgreSQL unique constraint on `capdevs.aip_code`.
* Conflicts are reported with specific business error messages naming the conflicting AIP Code in an action-error modal.

---

## 8. Analytics and Reports

* Admins and Viewers can view CapDev and request analytics and export an Excel monitoring workbook (`.xlsx`) generated via ExcelJS from live database records and dynamic field values.
* Department Viewers see only their department data; Admin and Viewer (All Departments) see all departments.
* Analytics charts reflect live database metrics for budget distribution, request statuses, and departmental utilization.

---

## 9. Data and Deployment Boundaries

* **Database**: Neon Postgres accessed via Drizzle ORM (`DATABASE_URL`).
* **Authentication**: Neon Auth (`NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`) with custom user metadata and role approval tables.
* **File Storage**: Google Drive API (OAuth 2.0 refresh token) with dedicated request folders (`[RequestorName]_[DateRequested]`) and root fallback for non-request files.
* **AI Services**: Google Gemini API for portal chatbot and multimodal activity design intake; Groq API for post-completion evaluation summary generation.
* **Forms & Reporting**: Google Forms API for seminar evaluations; ExcelJS for Excel monitoring workbook generation.

