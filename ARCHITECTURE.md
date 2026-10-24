# LEAPRS Architecture

Reviewed against the workspace on October 10, 2026, including uncommitted background-upload changes. This document describes the current implementation, not verified production deployment. See [REQUIREMENTS.md](REQUIREMENTS.md) for business rules and [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) for UI standards. The [project guidance skill](.agents/skills/leaprs-project-guidance/SKILL.md) directs coding agents to these documents when relevant.

## 1. Components and boundaries

### Dynamic Google storage

Admin System Settings uses `DriveStorageAction` to open a dialog that mounts `GoogleStorageSettings` on demand, backed by `/api/google-storage` routes. The dialog opens automatically on return from Google authorization. Its status endpoint returns only the active owner email and configuration availability; legacy placeholder identities are resolved once through Drive About and persisted. Previous connections stay retained server-side. `POST /connect` validates the same-origin request and live Admin role, then starts Google authorization with offline access, explicit consent/account selection, state, and S256 PKCE. An encrypted HttpOnly, SameSite=Lax cookie binds the verifier/state to the initiating Admin, canonical callback URI, and ten-minute expiry. The callback clears that exact cookie path, rechecks Admin access/state, exchanges the code, requires Drive/Forms scopes, and obtains account identity from Drive About. Tokens and authorization codes are never returned to the browser or logged.

`google-storage-oauth.ts` finds the saved folder ID or a private client-specific marker. A single owned, writable LEAPRS folder directly in My Drive can be adopted and marked; otherwise it creates LEAPRS. Multiple ambiguous matches fail safely. A PostgreSQL advisory lock serializes folder discovery/creation and activation across callbacks and manual selection. A partial unique index permits only one active connection. Provider failures/cancellation preserve the previous selection; an external folder created just before a database failure is found by its marker on retry.

`google_storage_connections` retains encrypted refresh tokens, original roots, account IDs/emails, activation flags, and legacy provenance. AES-256-GCM uses a key derived from `GOOGLE_STORAGE_ENCRYPTION_KEY`, falling back to the existing `NEON_AUTH_COOKIE_SECRET`; keep that key stable or re-encrypt credentials when rotating it. `google_drive_resources` binds file/Form IDs to immutable original roots. Legacy unregistered resources resolve to the retained legacy connection, never the newly active account. Upload preparation pins root/token; completion locates tagged files across retained accounts and checks existing record/user/upload/parent ownership before registering them. Multipart and older direct-upload helpers also register origins. Request folders are unique per `(request_id, root_folder_id)`. Cleanup and reference-file streaming use the original account. New Forms are registered and placed in the active root; existing Forms use their recorded/legacy connection.

Apply `npm run db:google-storage-migrate` before deploying this version. Migration 0024 creates the tables/indexes and imports the current environment refresh token/root as an encrypted active legacy connection without contacting Google. It is idempotent and does not overwrite reconnected credentials. Keep the old environment values until migration/import is verified; after that both are optional legacy fallbacks. Keep `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Set `APP_URL` to the website origin and register `<APP_URL>/api/google-storage/callback` as an authorized redirect URI on that OAuth client. Enable Drive and Forms APIs and configure the consent audience/scopes (including test users if the Google app is in Testing). Changing domains requires updating the allowed callback and APP_URL, not creating another OAuth client.

`scripts/google-storage.test.mjs` exercises encryption, state/PKCE binding, folder creation/reuse/adoption, authorization failures, and Admin permissions against a local HTTP provider. `scripts/google-storage-database.test.mjs` runs actual callback logic in disposable schemas to verify rollback, concurrent activation, reconnects, original-root resolution, and upload recovery. The provider subset and local fixture live under `postman/`; the fixture is also run directly by the tests because the local Postman dataset runner encountered TLS initialization failures. No real Google account is switched by these tests. `GOOGLE_STORAGE_TOKEN_URL` and `GOOGLE_STORAGE_DRIVE_API_URL` are server-only local test overrides; leave them unset in production.

### CapDev folders

`capdev_folders.reference_image` stores a single nullable Drive descriptor (ID, name, MIME type, original managed root, and version). Apply `0023_capdev_folder_reference_image.sql` through `npm run db:folder-reference-image-migrate`. `CapdevReferenceImage` is shared by the folder's active/archive views. Admin-only save/remove actions lock the folder and audit descriptor changes. Uploads accept PDF, JPG, PNG, and WebP, validate the file signature and 4 MiB limit, then wait for managed Drive storage before saving; they do not use the background business-record uploader. Replacement cleans the previous file after commit and tries to remove newly uploaded bytes on a failed save. Drive cleanup failures are logged and may leave unused bytes in storage; descriptor changes remain committed. Folder deletion also attempts image cleanup.

`GET /api/capdev-folders/[folderId]/reference-image` rechecks live account, maintenance, and active-folder permissions through the metadata action and streams Drive bytes with private/no-store and nosniff headers. The image is a folder-level shared reference for all authorized active roles, not a department-redacted version of the paper scan. Google access-token retrieval is shared in `google-drive-auth.ts`. `scripts/folder-reference-image.test.mjs` covers signature/size validation, role/folder access, replacement failure preservation, and image-route authorization/cache headers without writing real Drive files.

`/portal` routes all roles into the active folder. `CapdevFoldersPanel` is an Admin-only toolbar popover beside See Archives, using the existing folder actions for inline add/rename, permanent deletion, and selection. Clicking a row calls `markCapdevFolderActive` and replaces the project route; the selected row is the active folder. `/portal/folders` redirects old bookmarks to `/portal`. `/portal/folders/[folderId]` hosts the CapDev client screen with a server guard redirecting every role away from inactive folder lists. An Admin with no folders receives an empty project screen with the panel available to create the first folder. `capdev_folders` stores names and `is_active`; `capdevs.folder_id` is a required indexed foreign key with restricted deletion. Migration `0021_capdev_folders.sql` preserves existing projects in Existing CapDev. Migration `0022_active_capdev_folder.sql` selects the earliest existing folder and adds a partial unique index enforcing at most one active folder. Run `npm run db:active-capdev-folder-migrate` after the folder migration.

Folder listing and mutations are Admin-only server actions using the existing active-account and maintenance checks. Activation, initial folder creation, and deletion serialize through a transaction advisory lock. Active folders cannot be deleted. Non-Admin project/request SQL scopes include the active-folder predicate alongside department/ownership checks. Transactional writes take a shared lock on the active folder before committing, preventing an activation from overtaking an already authorized write. Analytics, workbook/PDF reports, AI project lists/lookups, request summaries, budgets, notification eligibility, and reminder checks use active-folder scope for all roles. Admin direct management retains access to inactive folders. Archives remain project-level. Create, move, and duplicate actions lock the destination folder; duplication can copy from any active project. CapDev filters include account and folder IDs. Request routes remain stable, with Back resolving the parent project's folder; no role has Back from the project list to folder management. Historical notification links resolve to the current folder subject to live permissions. The layout rechecks active selection on focus and every 30 seconds, returning sessions to the active folder when it changes.

Folder deletion explicitly permits removal of active and archived descendants. It locks the folder, projects, and requests, cleans trusted managed Drive folders and unshared CapDev attachments, then calls `deleteCapdevFolderRecords` to remove descendants and the folder with immutable audit snapshots in one database transaction. Notification foreign keys cascade reads and delivery jobs. Drive cleanup failures prevent database deletion; Drive operations cannot roll back with PostgreSQL, so a failure after partial storage cleanup may require retry. Legacy JSON folder IDs are never used to authorize folder deletion. Attachments referenced by projects in other folders are preserved. Evaluation Google Forms are not deleted by this storage cleanup.

`npm run test:capdev-folders` verifies non-Admin action rejection, migration backfill/idempotency, concurrent activation and uniqueness, inactive-folder read/write exclusion, department/ownership scope, Admin report scope, in-flight write locking, protected active-folder deletion, descendant and notification cascades, transaction rollback, and missing-folder rejection in disposable database schemas.

LEAPRS is a Next.js App Router application deployed to Vercel, with React/MUI client screens, authenticated server actions, and Node.js API routes. The installed versions in [package.json](package.json) are Next.js 16.3.2 and React 19.2.8; use Node.js 22.15 or newer.

```mermaid
flowchart LR
    Portal[Browser portal] --> Server[Next.js actions and routes]
    AI[External AI client] --> MCP[MCP HTTP route and OAuth]
    MCP --> Services[Shared LEAPRS services]
    Server --> Services
    Server --> Auth[Neon Auth]
    Server --> PG[Neon PostgreSQL]
    Services --> PG
    Server --> Google[Google Drive and Forms APIs]
    Portal -->|Resumable file bytes| Drive[Google Drive]
    Server --> Gemini[Gemini]
    Server --> Groq[Groq]
    Server --> Mail[Resend]
    Scheduler[Optional external scheduler] --> Server
```

- Browser code owns interactive forms, local file objects, and the attachment transfer queue.
- Next.js owns authorization, validation, database writes, Drive session preparation/finalization, notification processing, and AI provider calls.
- PostgreSQL stores business records, form definitions, grants, audit history, rate limits, and email delivery jobs. It stores attachment metadata, not file bytes.
- Neon Auth stores authentication identities and sessions; application roles/departments live in the application `users` table.
- Google Drive is durable attachment storage. Forms stores evaluation questions/responses. AI and email providers are external services.
- There is no Redis, Kafka, service-worker upload pipeline, or continuously running queue process in this implementation.

## 2. Source map

| Area | Main sources |
| --- | --- |
| Portal authentication/header/provider lifetime | [portal/layout.tsx](src/app/portal/layout.tsx), [auth/server.ts](src/lib/auth/server.ts), [auth/client.ts](src/lib/auth/client.ts) |
| Forms, administration, workflow actions | [actions.ts](src/app/actions.ts), `src/app/portal/` |
| Shared request and tool services | [leaprs-service.ts](src/lib/services/leaprs-service.ts) |
| Schema / queries / transactions | [schema.ts](src/db/schema.ts), [db/index.ts](src/db/index.ts), [transaction.ts](src/db/transaction.ts) |
| Budget / archive / deletion | [request-budget.ts](src/lib/request-budget.ts), [archive-policy.ts](src/lib/archive-policy.ts), [request-deletion.ts](src/lib/request-deletion.ts) |
| Dynamic field identity/validation | [dynamic-fields.ts](src/lib/dynamic-fields.ts), [request-validation.ts](src/lib/request-validation.ts) |
| Background file jobs and metadata | [background-upload-queue.ts](src/lib/background-upload-queue.ts), [background-attachments.ts](src/lib/background-attachments.ts), [BackgroundUploads.tsx](src/components/BackgroundUploads.tsx) |
| Trusted folders and older upload helper | [request-storage.ts](src/lib/request-storage.ts), [google-drive-client.ts](src/lib/google-drive-client.ts) |
| Notifications / email / reminders | [notification-audience.ts](src/lib/notification-audience.ts), [notification-email.ts](src/lib/notification-email.ts), [request-reminders.ts](src/lib/request-reminders.ts) |
| MCP transport / OAuth | [mcp/route.ts](src/app/api/mcp/route.ts), [mcp/server.ts](src/lib/mcp/server.ts), [mcp/oauth.ts](src/lib/mcp/oauth.ts), [client-registration.ts](src/lib/mcp/client-registration.ts) |
| AI help and setup guide | [PortalChatbot.tsx](src/components/PortalChatbot.tsx), [ConnectAiAppsDialog.tsx](src/components/ConnectAiAppsDialog.tsx), [ai-app-guides.ts](src/lib/ai-app-guides.ts) |
| Evaluation / reporting | [google-forms.ts](src/lib/google-forms.ts), [analytics-metrics.ts](src/lib/analytics-metrics.ts), report actions in `actions.ts` |
| Presentation | [ThemeRegistry.tsx](src/theme/ThemeRegistry.tsx), [Skeletons.tsx](src/components/Skeletons.tsx) |

### Portal read performance

`POST /api/portal/read` dispatches allowlisted CapDev, request-page, timeline, portal-context, notification, analytics, and monitoring-report reads with private/no-store responses. It rejects cross-origin calls, oversized input, unknown operations, and invalid IDs. Underlying actions retain live authorization checks. `read-context.ts` shares the access-check promise only within this HTTP request through AsyncLocalStorage; roles/sessions are never cached across requests. Bundles run independent database work concurrently and avoid the client Server Action dispatch queue. Mutations retain Server Actions.

`/portal` resolves the active folder on the server and renders its projects directly, preserving hash targets without a client landing redirect. Request lists use SQL filters/counts and stable date/ID ordering with six-row pagination. Notification targets resolve the correct archive view/page within live ownership/folder scope. CapDev and request search debounce for 300 ms. Form definitions load once per page mount rather than per poll; returning from configuration remounts the page. Dynamic request/timeline components are keyed by their IDs.

Header progress consumes the timeline page's loaded data. Existing evaluation links render immediately; missing links are prepared after the timeline appears. Periodic refreshes skip hidden tabs, coalesce focus/visibility events, and avoid overlapping refreshes. The read client deduplicates only in-flight calls with an explicit account key and retains no completed response cache.

Reminder synchronization selects only due, uncreated activity episodes. Inactivity summaries fetch the latest row per request plus a completion-existence check rather than full histories. Notification read state joins only returned notifications. Analytics restricts audit details to the chosen activity window and transfers milestone events plus the latest progress at the snapshot date, preserving historical status/budget reconstruction. Monthly reports filter their month in SQL. Spreadsheet/PDF modules load only for exports. Monitoring-report previews still load eligible records, and timelines still load their visible history; these remain growth costs. Deployment cold starts and network latency require production measurement.

`scripts/portal-reads.test.mjs` covers request-local access isolation, account-scoped in-flight deduplication/retry, and endpoint validation/cache headers. `scripts/request-reminders-database.test.mjs` also exercises request pagination/filter/focus permissions and compares optimized historical analytics with complete-history results in disposable schemas.

## 3. Data model

| Tables | Responsibility |
| --- | --- |
| `users` + `neon_auth.user` | Application role, department, archive state; authentication name/email/credentials |
| `capdevs` | Repeatable user-facing AIP Code, numeric primary key, initial/remaining budgets, department, configured JSON values |
| `requests` | Parent/owner, requestor name, setting, fixed title/event date, amount, workflow/stopper state, permanent deduction marker, form links, configured JSON |
| `request_status_updates` | Progress, author snapshot, marks, deduction flag, stopper/response/resume relations, attachments, configured JSON |
| `capdev_field_definitions`, `request_field_definitions`, `status_update_field_definitions` | Dynamic form schema, options, required/active state, layout/order |
| `request_storage_folders` | Server-controlled folder ownership/root and request binding |
| `system_settings` | Maintenance switch, numeric inactivity threshold, and other stored settings |
| `role_approval_requests` | Pending/accepted/rejected elevated role requests |
| `signup_verifications`, `password_resets`, `security_rate_limits` | Verification hashes, expiry, shared counters |
| `notifications`, `notification_reads` | Event record and per-user read state |
| `email_notification_preferences`, `notification_email_deliveries` | Per-user type opt-ins and durable per-recipient delivery state |
| `mcp_oauth_clients`, `mcp_oauth_grants` | DCR registrations and hashed code/access/refresh credentials |
| `audit_logs` | Immutable actor/entity snapshots and change details |

The schema also retains a connection-check table and legacy columns, including supervisor evaluation links, status-update archive flags, and legacy completion marks. Retaining a column does not imply an active UI workflow.

Dynamic values use the canonical key `field:<definition id>` in `additional_info`. `getDynamicFieldValue` falls back to the old field label when a canonical key is absent. The current helper does not implement a general `field-<id>` fallback. Request form definitions include `setting` to separate In-House and External schemas. Request Title is persisted in `requests.description`, and Event Date in `requests.event_date`, as fixed fields for both settings. Migrations 0018 and 0019 promote matching legacy dynamic values before deactivating those definitions.

Dynamic-field deletion retains the definition as an inactive identity tombstone, removes both its canonical key and legacy label from applicable records, and deletes completed file attachments after verifying their managed Drive parent. Status-field deletion also removes those attachment IDs from the denormalized status `files` list. Pending descriptors are removed with the field value, so the browser queue cancels them during reconciliation.

Requests and timeline entries keep numeric IDs for joins/routes. Requestor name is a display identifier, not a uniqueness constraint. Budget columns use PostgreSQL numeric values with two decimal places.

## 4. Authentication, authorization, and validation

- Neon Auth's Next.js handler serves `/api/auth/[...path]`. The sign-up wrapper additionally enforces the allowed email domain at the sign-up endpoint.
- Server actions resolve the current authenticated identity and current application role/department. Archived accounts and non-Admin access during maintenance fail authorization.
- Portal read/mutation helpers check project department, request ownership, role, and archive state. The shared tool services also enforce access. Role labels shown by the client are not authorization evidence.
- The portal header requests the configured root Drive URL through an Admin-only server action. The client receives only the folder URL, never Google credentials; Drive enforces its own account permissions after navigation.
- `validateRequestInput` allowlists request fields and rejects unsupported settings, invalid amounts, oversized description/JSON, and caller-supplied identity/workflow state. Suggestions-only combobox values are validated against definition options.
- Verification codes use keyed hashes based on purpose/email and `NEON_AUTH_COOKIE_SECRET`; rate-limit counters are PostgreSQL rows shared across instances.
- Forwarded IP/host checks depend on a deployment proxy that overwrites client-supplied forwarded headers. Database credentials, API keys, OAuth refresh credentials, and cookie secrets remain server-side.
- MCP bearer authorization is a separate grant from a browser session. Live role, department, archive, and maintenance state is reloaded for each call; logging out of the portal does not revoke those grants.

## 5. Database transactions and external effects

Ordinary reads/simple statements use Drizzle's Neon HTTP adapter. Multi-statement workflows use `withTransaction`, which creates a Neon WebSocket Pool scoped to that transaction and closes it in `finally`.

- Deduction locks the request and its CapDev, verifies eligibility/previous deduction, conditionally subtracts only if enough balance remains, records `budget_deducted_at`, and inserts the timeline entry in the same transaction.
- Admin CapDev edits accept an optional validated `initialBudget`. Under the project row lock, a changed numeric initial amount sets both `initial_budget` and `budget` together. Unchanged amounts omit both balance columns; ordinary client saves omit `initialBudget` to preserve concurrent resets and deductions. Audit changes use the locked previous row. Requests, history, and permanent deduction markers remain intact. The field stays fixed in form configuration; no migration is needed. `scripts/capdev-budget.test.mjs` exercises reset, audit, stale-save, retry, validation, and permission behavior through the actual update action.
- Partial unique indexes prevent duplicate deduction and legacy completion entries. The permanent request marker prevents a removed deduction entry from enabling another deduction.
- Stop/resume, request reopening, archive/restore, permanent deletion, folder claims, and attachment finalization use locks for their related invariants. Reopening changes only the request resolution status to `in_progress`; it preserves stopper state, timeline rows, deductions, and external evaluation-form references. Request workflows generally lock the request before the parent and timeline entry.
- Attachment completion merges only the matching pending descriptor. Updating a form reconciles a stale pending token to its completed attachment before writing.
- CapDev/request creation, role-approval registration, request resolution, stop/resume, timeline updates and AI submission insert their notification event inside the business transaction using `insertNotificationEvent`. Insert failures roll back business writes and deductions. Email processing is scheduled after commit and can reconstruct delivery jobs from saved events. Audit logging and external provider effects remain separate.
- Bulk CapDev duplication locks the selected active sources and inserts the new-year CapDev rows and their notification events in one transaction. It preserves each exact AIP Code, copies only CapDev columns, and resets each remaining balance to its initial balance. The numeric primary key distinguishes records that share an AIP Code.
- `bulkManageCapdevs` is Admin-only and delegates archive/delete to `manageCapdevRecords`. The transaction validates 1–500 unique IDs, locks the folder and selected projects, and checks folder membership and archive state before any mutation. Archive freezes descendants through their parent without rewriting individual flags. Delete locks child requests, runs shared `cleanupCapdevStorage`, deletes request descendants and selected projects, and writes immutable audit snapshots. Database changes commit or roll back together; Drive cleanup retains its existing external-effect limitation. Both folder deletion and bulk project deletion preserve CapDev files referenced by unselected projects, including projects in the same folder. The existing folder regression suite covers cross-folder/state rejection, archive preservation, selected-project deletion, and cleanup failure rollback.
- The same bulk action supports Move with `destinationFolderId`. It serializes with folder selection/deletion, locks source/destination folders in ID order, validates the source membership of all selected projects, then updates only `folder_id` and modification metadata. Project IDs and child relations remain unchanged, including Drive references, archive state, budgets/deduction markers, Date Added, and evaluation forms. Audit snapshots name source and destination folders. Active-folder flags are never modified. The Duplicate dialog passes its explicit destination through the existing `duplicateCapdevs.folderId` argument; destination choice does not activate that folder. Regression tests verify preservation and rejection of invalid/same/deleted destinations.
- External Drive/Form API calls cannot be rolled back with PostgreSQL. Request folder deletion failures are logged while database deletion continues. Form creation during resolution can produce an external form even if a later database step fails.

Do not describe all database/provider effects as one atomic transaction.

CapDev, request, and user page filters are stored in browser local storage under account-specific keys. Request preferences use one key across all CapDev request pages. They survive refresh and logout/login for the same account in that browser without leaking selections to another account; they do not synchronize across browsers or devices.

## 6. Background attachment pipeline

### Save first, transfer second

```mermaid
sequenceDiagram
    participant B as Browser form/queue
    participant S as Server actions
    participant P as PostgreSQL
    participant D as Google Drive
    B->>S: Save fields and pending descriptors
    S->>P: Persist authorized record
    S-->>B: Saved record ID
    Note over B: Close form; enqueue local File jobs
    B->>S: Prepare attachment session
    S->>P: Check record and pending uploader
    S->>D: Create resumable session in managed folder
    S-->>B: Session URL
    B->>D: PUT file bytes with progress
    D-->>B: Drive file ID
    B->>S: Finalize attachment
    S->>D: Fetch authoritative file metadata
    S->>P: Lock and replace pending descriptor
    S-->>B: Attachment saved
    Note over B: Notify open views to refresh
```

`stageAttachments` produces pending descriptors and local jobs before saving. A descriptor contains `pendingUploadId`, `pending`, `name`, `mimeType`, and `size`; the server records uploader identity. A job additionally contains the `File`, target kind/ID, field key, state, progress, attempt count, and reusable Drive session/file identifiers.

The account-keyed BackgroundUploads provider lives in the portal layout, keeping its queue through client-side portal navigation. Jobs persist in device IndexedDB, partitioned by account; a Web Lock serializes processing across tabs for that account. Saved pending names remain visible to other authorized readers, but those readers cannot monitor the uploader's queue.

### Transfers and retries

- Queue states are `pending`, `uploading`, `failed`, `completed`, and `cancelled`. One transport runs at a time.
- Each job gets up to three attempts with 1-second then 2-second delays. Manual Retry resets attempts for that job without resaving the business record.
- The server prepares a resumable Drive URL using server-held Google credentials. Browser XMLHttpRequest PUT transfers bytes directly to Drive and reports upload progress; the transfer has a ten-minute timeout.
- Retry probes an existing session with `Content-Range`. It can resume from Drive's acknowledged offset or recover the final file ID after a lost response. An expired session is cleared for preparation on a subsequent attempt.
- Once a Drive file ID is known, metadata-finalization retries reuse it rather than uploading bytes again. Completed jobs release their file bytes.
- Progress is capped at 99% until finalization succeeds. Completion dispatches `leaprs-attachments-updated`; subscribed pages reload and the router refreshes.
- Hide only changes presentation. Both panel and icon render only while an unfinished job exists; failures count as unfinished. The queue still retains completed job metadata in memory.

### Completion checks and storage

`prepareBackgroundAttachment` checks the live account, record permissions, archive state, pending uploader, and upload origin. It creates Drive app properties binding the upload token, record kind/ID, and uploader ID.

`finishBackgroundAttachment` fetches metadata from Drive and verifies those properties, trash state, expected name/size, and parent folder. Under row locks it replaces only the matching pending marker. Status uploads also update the status `files` list and preserve the parent request's folder reference. Repeated completion with an already attached file is harmless.

Request folders are named from requestor/date and recorded in `request_storage_folders`. `additional_info.googleDriveFolderId` supports existing UI consumers but is not trusted independently for claims or deletion. CapDev attachments are direct children of the configured root. Existing direct/resumable helpers and a server multipart fallback remain available; the new portal forms use the shared background path.

### Persistence and recovery

`upload-storage.ts` stores selected Files and resumable job checkpoints in IndexedDB, keyed by account and upload token. `BackgroundUploadQueue` restores unfinished jobs and uses a per-account Web Lock for exclusive processing. Uploading jobs resume as pending; failed jobs retain their Retry action. Completion retains a small tombstone and releases file bytes, preventing duplicate processing by another tab.

`reconcileBackgroundAttachment` verifies live permissions and saved descriptors before transfer. It recognizes completed tokens, recovers tagged Drive file IDs after lost responses, and cancels jobs whose records/attachments were removed. Cleanup only deletes unused Drive files tagged for that exact account, record and token. Archived or inaccessible records fail safely without deleting their files. Cleanup runs during recovery/retry; there is no unattended Drive sweeper.

Transfers pause while the browser is closed or signed out and resume when the same account reopens this browser. Clearing IndexedDB, storage eviction, changing devices or unsupported storage/Web Locks require recovery through file re-selection or a supported browser. Bytes are local to the device, not stored in PostgreSQL or a server worker. Pending descriptors require no schema migration.

## 7. Notifications and durable email jobs

`notificationAudienceCondition` is shared by in-app reads and email selection. It checks role, department/ownership, actor exclusion, existence of related records, and current reminder eligibility. Role approvals are an Admin exception. Historical request-number wording is adapted at read/delivery time without rewriting event history.

The portal refreshes notifications every 30 seconds and when appropriate controls open. Reminder synchronization uses the latest timeline entry or submission time, a persisted threshold, and a unique activity-episode key. New activity/conclusion/archive/threshold changes invalidate old reminders through live query conditions.

### Delivery flow

1. A new notification is stored. `scheduleNotificationEmails` registers a Next.js `after` callback; notification refreshes also schedule processing.
2. `deliverNotificationEmails` joins active application users with Neon Auth email addresses and their preferences. The join casts auth IDs to text to match application IDs.
3. For each recipient, it creates delivery rows for up to 50 unprocessed eligible events per invocation. The unique `(notification_id, user_id)` pair prevents duplicate jobs. Opt-outs get `skipped` rows, so processed skipped events do not become a historical email flood later.
4. It examines up to 20 due deliveries. A conditional SQL update claims each job with a token and increments attempts. A processing claim older than five minutes can be recovered.
5. It rechecks the user's active account/email, live audience, and current preferences, then sends the stored payload through Resend with `notification/<event>/<user>` as the idempotency key.
6. Success becomes `sent`. Provider failure schedules retry using `min(900, 30 * 2^attempt)` seconds. Jobs stop after five attempted sends or once processing finds the first attempt older than 20 hours. Processing pauses 600ms between sends.

Delivery states are `pending`, `processing`, `sent`, `skipped`, and `failed`. A row is one recipient's email job; the table is the durable queue. It is not a long-running standalone worker. Claim ownership controls final state updates, and the stable payload/key reduces duplicate sends after uncertain provider responses; it is not an unlimited exactly-once guarantee.

The migration flags existing notifications as email-ineligible and enables new notifications by default. Preferences affect notification mail only; verification/reset emails use a separate direct path in `email.ts`.

### Scheduling and diagnostics

- `GET /api/notifications/email` requires `Authorization: Bearer <CRON_SECRET>`, creates due reminders, and drains email deliveries. The route uses Node.js and a 60-second maximum duration.
- No recurring schedule is enabled by this code alone. Without a configured external scheduler, processing depends on user/event traffic.
- Missing mail credentials or a public origin returns an unconfigured result. A scheduler call then responds with 503.
- Email origin fallback order is `APP_URL`, `MCP_PUBLIC_URL`, then `https://VERCEL_PROJECT_PRODUCTION_URL`.
- Application logs report provider/database causes with secrets, URLs, and email addresses redacted. The delivery table records state/attempts but has no persisted `last_error` column. Use runtime logs and Resend records to investigate failures.
- `sent` means Resend accepted the message. It does not establish inbox placement, reading, or successful downstream delivery.

## 8. Automatic MCP OAuth and tools

The MCP route implements remote HTTP JSON-RPC with JSON responses. It handles `initialize`, `ping`, `tools/list`, and `tools/call`; protocol negotiation accepts the coded 2025-03-26, 2025-06-18, and 2025-11-25 versions. It does not expose a long-lived GET event stream: an authenticated GET returns 405, and an unauthenticated request receives the OAuth challenge.

| Endpoint | Purpose |
| --- | --- |
| `/api/mcp` | Authorized MCP tool transport |
| `/.well-known/oauth-protected-resource/api/mcp` | Resource metadata discovery |
| `/.well-known/oauth-authorization-server` | OAuth authorization-server metadata |
| `/api/mcp/oauth/register` | Automatic client registration |
| `/api/mcp/oauth/authorize` | LEAPRS login/consent and authorization code |
| `/api/mcp/oauth/token` | PKCE code exchange and refresh rotation |

### Client identity and grants

- `MCP_PUBLIC_URL` supplies the canonical origin. Discovery/resource URLs are derived from it.
- DCR stores each client's name, exact callbacks, auth method, and hashed secret when applicable. Supported token auth methods are `none`, `client_secret_basic`, and `client_secret_post`.
- Registration accepts 1–10 unique callbacks, requires HTTPS except loopback HTTP, rejects fragments/userinfo/wildcards, caps request metadata at 16 KiB, and applies shared per-IP/global rate limits.
- Client names are supplied by clients and are not verified brand identity. Registration grants no user access.
- Consent shows the signed-in account, client name, and callback origin. Its cookie binds the nonce to client/callback/PKCE/resource/state. Form approval is a normal POST/redirect flow.
- Authorization codes last five minutes and are consumed once. S256 PKCE, exact callback, client authentication, and resource binding are checked at exchange.
- Access tokens last one hour. Refresh tokens last 30 days and rotate on use. Only credential hashes persist in PostgreSQL.
- Bearer grants must reference an existing DCR client and current authorized user. Old manually configured clients are not accepted.
- Same-origin portal session access is supported by the MCP route; remote clients use bearer grants. A supplied untrusted Origin is rejected.
- Manual `MCP_OAUTH_CLIENT_ID`, `MCP_OAUTH_CLIENT_SECRET`, and `MCP_OAUTH_REDIRECT_URIS` are no longer read. Client ID Metadata Documents (CIMD) are not implemented.
- `ConnectedAiAppsDialog` lists the current account's clients with unexpired grants. `revokeAiApp` deletes that account/client's authorization codes, access and refresh grants. Revocation and token exchange lock the same client row, preventing a racing refresh from recreating revoked tokens. Other users' grants remain intact. An already authorized in-flight call may finish. Portal sign-out is not MCP revocation; no public OAuth revocation endpoint is provided.

### Tool surface

The nine tools are `find_capdev_by_aip_code`, `get_request_form_schema`, `get_request_status`, `get_my_requests_summary`, `get_department_budget_balance`, `list_available_capdev_projects`, `create_request_draft`, `upload_request_attachment`, and `submit_request`.

Only `submit_request` is annotated as a write. It uses shared submission validation and requires confirmation. `create_request_draft` does not persist. Despite its name, `upload_request_attachment` currently returns supplied metadata references; it neither transfers bytes nor verifies Drive ownership. Do not claim this tool provides the portal's background upload pipeline.

All roles can discover tools, while services determine which calls succeed. Claude and ChatGPT guides are local screenshot walkthroughs; other clients must support the required discovery/DCR/PKCE combination. Their product-specific setup UI is not controlled by LEAPRS.

## 9. AI intake, evaluations, and reports

- Portal help uses Gemini with grounded tool calls. Activity-design intake sends supported source content to Gemini, combines extraction with the active request schema, and returns an editable draft. Submission uses the shared request service only after user confirmation.
- Portal AI drafts keep a local source File through review and enqueue Drive storage after successful submission. The extraction request itself still depends on transferring source content before review.
- In-House completion creates/reuses one seminar evaluation Form. Legacy participant/supervisor pairs can be replaced by the current participant form and the supervisor fields cleared. External completion skips creation.
- Summary retrieval fetches Forms responses, removes placeholder answers and certificate names, computes numeric rating results locally, and sends only substantive written feedback to Groq. The UI shows friendly empty states for unsupported qualitative categories, while rating summaries remain available when AI is missing or fails.
- Analytics uses live authorized records and shared metric helpers. Monitoring exports use ExcelJS and selected fixed/configured fields. Request Reports are rendered in memory as landscape PDFs from the same authorized live data. Report/UI data is not a separate warehouse.

## 10. Environment configuration

Values are intentionally omitted. Local `.env.local` is for development; configure deployed environments separately and redeploy when required by the host.

| Variable | Classification | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Secret | PostgreSQL connection including credentials |
| `NEON_AUTH_BASE_URL` | Config | Neon Auth service URL |
| `NEON_AUTH_COOKIE_SECRET` | Secret | Auth cookies and verification hashing |
| `RESEND_API_KEY` | Secret | Email provider access |
| `RESEND_FROM` | Config | Sender identity/address |
| `APP_URL` | Config | Public portal origin for email links |
| `MCP_PUBLIC_URL` | Config | Canonical origin for MCP discovery/OAuth/server URL |
| `CRON_SECRET` | Secret | Authenticates scheduled email/reminder processing |
| `GOOGLE_CLIENT_ID` | Config | Google OAuth application identifier |
| `GOOGLE_CLIENT_SECRET` | Secret | Google OAuth application credential |
| `GOOGLE_REFRESH_TOKEN` | Optional legacy secret | Imported into encrypted storage by migration 0024; fallback for older installations |
| `GOOGLE_DRIVE_PARENT_FOLDER_ID` | Optional legacy config | Original root imported by migration 0024; new roots are discovered/created automatically |
| `GOOGLE_STORAGE_ENCRYPTION_KEY` | Optional secret | Stable 32+ character storage encryption secret; defaults to existing `NEON_AUTH_COOKIE_SECRET` |
| `GEMINI_API_KEY` | Secret | Gemini access |
| `GEMINI_CHAT_MODEL` | Config | Gemini model override; default coded as `gemini-2.5-flash` |
| `GROQ_API_KEY` | Secret | Written evaluation summary provider |
| `GROQ_SUMMARY_MODEL` | Config | Groq model override; default coded as `qwen/qwen3.8-27b` |
| `VERCEL_PROJECT_PRODUCTION_URL` | Host config | Fallback public email origin |

The code also accepts legacy `RESEND` and `GOOGLE_API_KEY` aliases. Prefer the named provider keys above. Config classification does not mean a value should be exposed to browser JavaScript; several configuration identifiers are still only needed on the server.

## 11. Schema changes and checks

SQL migrations are in [drizzle](drizzle). Review the database's actual schema and migration history before applying anything; a SQL file in Git is not proof it has been applied. Drizzle configuration reads `.env.local` and targets `src/db/schema.ts`.

| Concern | Migration / helper |
| --- | --- |
| MCP grants | `0006_mcp_oauth_grants.sql` |
| Security, trusted folders, query indexes | `0011_security_and_query_indexes.sql`; `scripts/migrate-security.mjs --apply` |
| User/resource archives | `0012_user_archiving.sql`, `0013_resource_archiving.sql`; resource helper `scripts/migrate-resource-archiving.mjs` |
| Permanent deduction markers | `0014_permanent_budget_deductions.sql`; `scripts/migrate-permanent-deductions.mjs` |
| Inactivity reminders | `0015_request_inactivity_reminders.sql`; `scripts/migrate-request-reminders.mjs` |
| Notification email jobs/preferences | `0016_notification_email.sql`; `scripts/migrate-notification-email.mjs` |
| Automatic MCP clients | `0017_mcp_oauth_clients.sql`; `scripts/migrate-mcp-clients.mjs` |
| Background uploads | No additional migration; existing JSON fields |

The dedicated scripts load `.env.local` and affect its configured database. Some apply immediately; only the security helper shown above has an explicit `--apply` switch. Preserve existing data and review additive migration prerequisites. Do not use schema synchronization as a substitute for reviewed production migrations.

Useful workspace checks:

```powershell
node --test scripts/background-uploads.test.mjs
node --use-system-ca --test scripts/workflow-integrity-database.test.mjs scripts/mcp-automatic-oauth.test.mjs
node --experimental-strip-types --test scripts/security-regression.test.mjs scripts/status-update-display.test.mjs
node --use-system-ca --experimental-strip-types --test scripts/mcp-automatic-oauth.test.mjs scripts/mcp-consent.test.mjs
node --use-system-ca --experimental-strip-types --test scripts/notification-email-database.test.mjs scripts/request-reminders-database.test.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/next/dist/bin/next build
```

Database regression tests use disposable schemas; review each script and its configuration before running against a production-hosted connection. Pure queue tests inject transports and do not prove a live browser-to-Drive upload. Production build does not verify production migrations, external credentials, scheduler configuration, or inbox delivery. Read relevant installed Next.js guides in `node_modules/next/dist/docs/` before changing framework code, as required by [AGENTS.md](AGENTS.md).

## 12. Known implementation differences and limits

These remaining limits should be considered when extending the system.

- **Archived AI reads are inconsistent.** Project listing filters active projects, but exact project lookup and several other shared reads can include archived records. Archived submissions remain blocked. Some tool descriptions therefore promise a narrower result than their implementation returns.
- **Creation-time budget validation has a race window.** Portal and AI create actions check balance before taking the parent lock and do not repeat that balance check inside the creation transaction. Actual deduction is protected against overdrawing; creating a request does not reserve funds.
- **Upload durability depends on the device.** IndexedDB recovery needs the same browser/account and retained local storage. Transfers and cleanup do not run while every portal tab is closed. Recovery cleans tagged files for removed jobs; there is no scheduled global orphan sweep.
- **Email processing needs activity or a scheduler.** Business mutations and their events are atomic, and delivery rows are durable. There is no automatically installed cron schedule; background retries while the portal is closed require an external scheduler.
- **Provider/database atomicity is limited.** Folder deletion can fail while record deletion succeeds; external form creation cannot roll back with the database. Drive permissions are independently governed by Google, not by a portal link alone.
- **UI standards are broader than audited compliance.** The current theme Paper surface differs from the older skill, compact controls have local overrides, and existing screens may still contain legacy technical/error copy. This review establishes documentation, not a complete accessibility audit.

Update the relevant canonical document alongside future workflow, permission, integration, or UI changes. Keep references to implementation limits until the code and meaningful verification show they have been resolved.
