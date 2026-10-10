import { 
  pgTable, 
  serial, 
  timestamp, 
  varchar, 
  text, 
  integer, 
  numeric, 
  boolean, 
  jsonb, 
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const connections = pgTable('connections', {
  id: serial('id').primaryKey(),
  testedAt: timestamp('tested_at').defaultNow().notNull(),
  status: varchar('status', { length: 50 }).notNull(),
});

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  role: varchar('role', { length: 50 }).default('employee').notNull(),
  department: varchar('department', { length: 255 }).default('Unassigned').notNull(),
  archivedAt: timestamp('archived_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const securityRateLimits = pgTable('security_rate_limits', {
  key: text('key').primaryKey(),
  attempts: integer('attempts').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
}, (table) => [index('security_rate_limits_expires_idx').on(table.expiresAt)]);

// Folder IDs are trusted only when recorded by the server, never from form JSON.
export const requestStorageFolders = pgTable('request_storage_folders', {
  folderId: text('folder_id').primaryKey(),
  requestId: integer('request_id').references(() => requests.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  rootFolderId: text('root_folder_id').notNull(),
}, (table) => [uniqueIndex('request_storage_folders_request_idx').on(table.requestId)]);

// OAuth grants for remote MCP clients. Only hashes of bearer credentials are stored.
export const mcpOAuthGrants = pgTable('mcp_oauth_grants', {
  tokenHash: text('token_hash').primaryKey(),
  kind: varchar('kind', { length: 16 }).notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  userName: text('user_name').notNull(),
  userEmail: text('user_email'),
  clientId: text('client_id').notNull(),
  redirectUri: text('redirect_uri'),
  codeChallenge: text('code_challenge'),
  resource: text('resource').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [index('mcp_oauth_grants_user_idx').on(table.userId)]);

export const systemSettings = pgTable('system_settings', {
  key: varchar('key', { length: 100 }).primaryKey(),
  enabled: boolean('enabled').default(false).notNull(),
  numberValue: integer('number_value'),
  updatedById: text('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const roleApprovalRequests = pgTable('role_approval_requests', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  department: varchar('department', { length: 255 }).notNull(),
  requestedRole: varchar('requested_role', { length: 50 }).notNull(),
  status: varchar('status', { length: 50 }).default('pending').notNull(),
  decidedById: text('decided_by_id').references(() => users.id),
  decidedAt: timestamp('decided_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('unique_role_approval_user_idx').on(table.userId),
  index('role_approval_status_idx').on(table.status),
]);

// Capdev dynamic fields definitions configuration
export const capdevFieldDefinitions = pgTable('capdev_field_definitions', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 50 }).notNull(), // 'text' | 'number' | 'date' | 'select' | 'file'
  options: jsonb('options'), // Dropdown options array
  isRequired: boolean('is_required').default(false).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  section: varchar('section', { length: 100 }).default('optional').notNull(), // legacy storage; derived from isRequired
  width: varchar('width', { length: 50 }).default('full').notNull(), // 'half' | 'full'
  columnPosition: varchar('column_position', { length: 10 }).default('left').notNull(), // 'left' | 'right' for unpaired half-width fields
  sortOrder: integer('sort_order').default(0).notNull(),
  placeholder: varchar('placeholder', { length: 255 }), // Placeholder text
  updatedById: text('updated_by_id').references(() => users.id).notNull(), // WHO EDITED CONFIG LAST
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Capdev projects
export const capdevs = pgTable('capdevs', {
  archivedAt: timestamp('archived_at'),
  id: serial('id').primaryKey(),
  aipCode: varchar('aip_code', { length: 100 }).notNull().unique(),
  description: text('description').notNull().default(''),
  initialBudget: numeric('initial_budget', { precision: 12, scale: 2 }).notNull().default('0'),
  budget: numeric('budget', { precision: 12, scale: 2 }).notNull(),
  department: varchar('department', { length: 255 }).notNull(),
  additionalInfo: jsonb('additional_info').default({}).notNull(),
  updatedById: text('updated_by_id').references(() => users.id).notNull(), // WHO EDITED FORM DATA LAST
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('capdevs_department_created_idx').on(table.department, table.createdAt, table.id),
  index('capdevs_created_idx').on(table.createdAt, table.id),
]);

// Request dynamic fields definitions configuration
export const requestFieldDefinitions = pgTable('request_field_definitions', {
  id: serial('id').primaryKey(),
  setting: varchar('setting', { length: 50 }).default('internal').notNull(), // 'internal' | 'external'
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 50 }).notNull(),
  options: jsonb('options'),
  isRequired: boolean('is_required').default(false).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  section: varchar('section', { length: 100 }).default('optional').notNull(), // legacy storage; derived from isRequired
  width: varchar('width', { length: 50 }).default('full').notNull(), // 'half' | 'full'
  columnPosition: varchar('column_position', { length: 10 }).default('left').notNull(), // 'left' | 'right' for unpaired half-width fields
  sortOrder: integer('sort_order').default(0).notNull(),
  placeholder: varchar('placeholder', { length: 255 }), // Placeholder text
  updatedById: text('updated_by_id').references(() => users.id).notNull(), // WHO EDITED CONFIG LAST
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [index('request_field_definitions_setting_idx').on(table.setting, table.isActive, table.sortOrder)]);

// Status update dynamic fields definitions configuration
export const statusUpdateFieldDefinitions = pgTable('status_update_field_definitions', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 50 }).notNull(),
  options: jsonb('options'),
  isRequired: boolean('is_required').default(false).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  section: varchar('section', { length: 100 }).default('optional').notNull(),
  width: varchar('width', { length: 50 }).default('full').notNull(),
  columnPosition: varchar('column_position', { length: 10 }).default('left').notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  placeholder: varchar('placeholder', { length: 255 }),
  updatedById: text('updated_by_id').references(() => users.id).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Requests
export const requests = pgTable('requests', {
  archivedAt: timestamp('archived_at'),
  budgetDeductedAt: timestamp('budget_deducted_at'),
  id: serial('id').primaryKey(),
  capdevId: integer('capdev_id').references(() => capdevs.id).notNull(),
  userId: text('user_id').references(() => users.id).notNull(),
  requestorName: varchar('requestor_name', { length: 255 }),
  setting: varchar('setting', { length: 50 }).notNull(),
  description: text('description').notNull().default(''),
  requestedBudget: numeric('requested_budget', { precision: 12, scale: 2 }).notNull(),
  additionalInfo: jsonb('additional_info').default({}).notNull(),
  status: varchar('status', { length: 50 }).default('in_progress').notNull(),
  isStopped: boolean('is_stopped').default(false).notNull(),
  activeStopperId: integer('active_stopper_id'),
  participantFeedbackFormId: text('participant_feedback_form_id'),
  participantFeedbackFormUrl: text('participant_feedback_form_url'),
  supervisorEvaluationFormId: text('supervisor_evaluation_form_id'),
  supervisorEvaluationFormUrl: text('supervisor_evaluation_form_url'),
  updatedById: text('updated_by_id').references(() => users.id).notNull(), // WHO EDITED FORM DATA LAST
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('requests_capdev_created_idx').on(table.capdevId, table.createdAt, table.id),
  index('requests_user_created_idx').on(table.userId, table.createdAt, table.id),
]);

// Request Status Updates (Timeline logs)
export const requestStatusUpdates = pgTable('request_status_updates', {
  archivedAt: timestamp('archived_at'),
  id: serial('id').primaryKey(),
  requestId: integer('request_id').references(() => requests.id).notNull(),
  userId: text('user_id').references(() => users.id).notNull(), // AUTHOR of the update
  authorName: varchar('author_name', { length: 255 }),
  statusUpdate: text('status_update').notNull(),
  remarks: text('remarks'),
  files: jsonb('files').default([]).notNull(),
  statusMark: varchar('status_mark', { length: 50 }),
  markAsComplete: boolean('mark_as_complete').default(false).notNull(),
  subtractsRequestedAmount: boolean('subtracts_requested_amount').default(false).notNull(),
  isStopper: boolean('is_stopper').default(false).notNull(),
  isStopperResponse: boolean('is_stopper_response').default(false).notNull(),
  isResume: boolean('is_resume').default(false).notNull(),
  stopperId: integer('stopper_id'),
  additionalInfo: jsonb('additional_info').default({}).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('request_status_updates_request_created_idx').on(table.requestId, table.createdAt),
  uniqueIndex('unique_request_complete_idx')
    .on(table.requestId)
    .where(sql`mark_as_complete = true`),
  uniqueIndex('unique_request_subtract_idx')
    .on(table.requestId)
    .where(sql`subtracts_requested_amount = true`),
]);

// Password Resets table
export const passwordResets = pgTable('password_resets', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull(),
  code: varchar('code', { length: 64 }).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [index('password_resets_email_idx').on(table.email)]);

// Signup Email Verifications table
export const signupVerifications = pgTable('signup_verifications', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull(),
  code: varchar('code', { length: 64 }).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  isVerified: boolean('is_verified').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('signup_verifications_email_idx').on(table.email),
]);

// Notifications table
export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userId: text('user_id').references(() => users.id),
  actorId: text('actor_id').references(() => users.id),
  capdevId: integer('capdev_id').references(() => capdevs.id, { onDelete: 'cascade' }),
  requestId: integer('request_id').references(() => requests.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 255 }).notNull(),
  message: text('message').notNull(),
  link: text('link').notNull(),
  type: varchar('type', { length: 50 }).default('status_update').notNull(),
  reminderKey: varchar('reminder_key', { length: 100 }),
  emailEligible: boolean('email_eligible').default(true).notNull(),
  isRead: boolean('is_read').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('notifications_reminder_key_idx').on(table.reminderKey),
]);

export const emailNotificationPreferences = pgTable('email_notification_preferences', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  enabledTypes: jsonb('enabled_types').$type<string[]>().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type NotificationEmailPayload = { from: string; to: string; subject: string; text: string };
export const notificationEmailDeliveries = pgTable('notification_email_deliveries', {
  id: serial('id').primaryKey(),
  notificationId: integer('notification_id').notNull().references(() => notifications.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  payload: jsonb('payload').$type<NotificationEmailPayload>().notNull(),
  status: varchar('status', { length: 20 }).default('pending').notNull(),
  attempts: integer('attempts').default(0).notNull(),
  claimToken: text('claim_token'),
  claimedAt: timestamp('claimed_at'),
  firstAttemptAt: timestamp('first_attempt_at'),
  nextAttemptAt: timestamp('next_attempt_at').defaultNow().notNull(),
  sentAt: timestamp('sent_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, table => [
  uniqueIndex('notification_email_deliveries_notification_id_user_id_key').on(table.notificationId, table.userId),
  index('notification_email_pending_idx').on(table.status, table.nextAttemptAt),
]);

// Immutable activity history. Actor and entity values are snapshots by design,
// so audit records survive deletion of users, CapDev projects, and requests.
export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  actorId: text('actor_id'),
  actorName: varchar('actor_name', { length: 255 }).notNull(),
  actorEmail: varchar('actor_email', { length: 255 }),
  action: varchar('action', { length: 50 }).notNull(),
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  entityId: text('entity_id'),
  entityLabel: varchar('entity_label', { length: 255 }).notNull(),
  details: jsonb('details').default({}).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('audit_logs_created_at_idx').on(table.createdAt),
  index('audit_logs_entity_idx').on(table.entityType, table.entityId),
]);

// Notification reads tracking per user
export const notificationReads = pgTable('notification_reads', {
  id: serial('id').primaryKey(),
  notificationId: integer('notification_id').references(() => notifications.id, { onDelete: 'cascade' }).notNull(),
  userId: text('user_id').references(() => users.id).notNull(),
  readAt: timestamp('read_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('unique_user_notification_idx')
    .on(table.notificationId, table.userId),
]);
