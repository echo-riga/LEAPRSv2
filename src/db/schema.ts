import { pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core';

export const connections = pgTable('connections', {
  id: serial('id').primaryKey(),
  testedAt: timestamp('tested_at').defaultNow().notNull(),
  status: varchar('status', { length: 50 }).notNull(),
});
