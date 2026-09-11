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
  uniqueIndex 
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Capdev dynamic fields definitions configuration
export const capdevFieldDefinitions = pgTable('capdev_field_definitions', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 50 }).notNull(), // 'text' | 'number' | 'date' | 'select' | 'file'
  options: jsonb('options'), // Dropdown options array
  isRequired: boolean('is_required').default(false).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  section: varchar('section', { length: 100 }).default('basic').notNull(), // 'basic' | 'supporting'
  width: varchar('width', { length: 50 }).default('full').notNull(), // 'half' | 'full'
  sortOrder: integer('sort_order').default(0).notNull(),
  placeholder: varchar('placeholder', { length: 255 }), // Placeholder text
  updatedById: text('updated_by_id').references(() => users.id).notNull(), // WHO EDITED CONFIG LAST
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Capdev projects
export const capdevs = pgTable('capdevs', {
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
});

// Request dynamic fields definitions configuration
export const requestFieldDefinitions = pgTable('request_field_definitions', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 50 }).notNull(),
  options: jsonb('options'),
  isRequired: boolean('is_required').default(false).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  section: varchar('section', { length: 100 }).default('basic').notNull(),
  width: varchar('width', { length: 50 }).default('full').notNull(), // 'half' | 'full'
  sortOrder: integer('sort_order').default(0).notNull(),
  placeholder: varchar('placeholder', { length: 255 }), // Placeholder text
  updatedById: text('updated_by_id').references(() => users.id).notNull(), // WHO EDITED CONFIG LAST
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Requests
export const requests = pgTable('requests', {
  id: serial('id').primaryKey(),
  capdevId: integer('capdev_id').references(() => capdevs.id).notNull(),
  userId: text('user_id').references(() => users.id).notNull(),
  requestorName: varchar('requestor_name', { length: 255 }),
  setting: varchar('setting', { length: 50 }).notNull(),
  description: text('description').notNull().default(''),
  requestedBudget: numeric('requested_budget', { precision: 12, scale: 2 }).notNull(),
  additionalInfo: jsonb('additional_info').default({}).notNull(),
  status: varchar('status', { length: 50 }).default('in_progress').notNull(),
  updatedById: text('updated_by_id').references(() => users.id).notNull(), // WHO EDITED FORM DATA LAST
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Request Status Updates (Timeline logs)
export const requestStatusUpdates = pgTable('request_status_updates', {
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
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
  code: varchar('code', { length: 10 }).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Notifications table
export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userId: text('user_id').references(() => users.id),
  actorId: text('actor_id').references(() => users.id),
  title: varchar('title', { length: 255 }).notNull(),
  message: text('message').notNull(),
  link: text('link').notNull(),
  type: varchar('type', { length: 50 }).default('status_update').notNull(),
  isRead: boolean('is_read').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

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


