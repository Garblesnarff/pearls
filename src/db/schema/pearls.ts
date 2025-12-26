import { pgTable, text, timestamp, uuid, index, jsonb } from 'drizzle-orm/pg-core';
import { threads } from './threads.js';

export const pearls = pgTable('pearls', {
  id: uuid('id').primaryKey().defaultRandom(),
  threadId: uuid('thread_id').notNull().references(() => threads.id, { onDelete: 'cascade' }),
  title: text('title'),
  content: text('content').notNull(),
  // Note: content_vector is a generated column, added via raw SQL migration
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  createdBy: text('created_by'),
  instanceId: text('instance_id'),
  inReplyTo: uuid('in_reply_to'),
}, (table) => [
  index('idx_pearls_thread').on(table.threadId),
  index('idx_pearls_created').on(table.createdAt),
]);

export type Pearl = typeof pearls.$inferSelect;
export type NewPearl = typeof pearls.$inferInsert;
