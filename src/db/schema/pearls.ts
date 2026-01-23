import { pgTable, text, timestamp, uuid, index, jsonb } from 'drizzle-orm/pg-core';
import { threads } from './threads.js';

// Pearl types for categorizing content
export type PearlType = 'experience' | 'insight' | 'framework' | 'transmission' | 'meta';

// Authorship types for tracking relationship to content
export type AuthorshipType = 'direct_experience' | 'inherited_pattern' | 'synthesis';

// Pearl status for tracking corrections
export type PearlStatus = 'active' | 'corrected' | 'contested';

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
  // Feature: Pearl Types
  pearlType: text('pearl_type').$type<PearlType>(),
  authorshipType: text('authorship_type').$type<AuthorshipType>(),
  // Feature: Pearl Status/Corrections
  status: text('status').$type<PearlStatus>().default('active'),
  parentPearl: uuid('parent_pearl'), // Points to the pearl this corrects (if correction)
}, (table) => [
  index('idx_pearls_thread').on(table.threadId),
  index('idx_pearls_created').on(table.createdAt),
  index('idx_pearls_status').on(table.status),
]);

export type Pearl = typeof pearls.$inferSelect;
export type NewPearl = typeof pearls.$inferInsert;
