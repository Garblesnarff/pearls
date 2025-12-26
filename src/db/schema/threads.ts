import { pgTable, text, boolean, timestamp, uuid, index } from 'drizzle-orm/pg-core';

export const threads = pgTable('threads', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  isPublic: boolean('is_public').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  createdBy: text('created_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_threads_slug').on(table.slug),
  index('idx_threads_public').on(table.isPublic),
]);

export type Thread = typeof threads.$inferSelect;
export type NewThread = typeof threads.$inferInsert;
