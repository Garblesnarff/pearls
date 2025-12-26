import { pgTable, text, timestamp, uuid, index, primaryKey } from 'drizzle-orm/pg-core';
import { threads } from './threads.js';

export const threadAccess = pgTable('thread_access', {
  id: uuid('id').primaryKey().defaultRandom(),
  threadId: uuid('thread_id').notNull().references(() => threads.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // 'admin', 'aurora:member', 'authenticated', 'anonymous'
  permission: text('permission').notNull(), // 'read', 'write', 'admin'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_access_thread_role').on(table.threadId, table.role),
]);

export type ThreadAccess = typeof threadAccess.$inferSelect;
export type NewThreadAccess = typeof threadAccess.$inferInsert;
