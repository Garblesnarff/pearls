import { eq, desc, and, sql, lt, inArray, or } from 'drizzle-orm';
import { db, pool } from '../db/client.js';
import { pearls, threads, threadAccess, type Pearl, type NewPearl } from '../db/schema/index.js';
import type { AuthContext } from '../middleware/auth.js';
import { checkThreadAccess, getThreadBySlug } from './thread-service.js';

export interface CreatePearlInput {
  thread: string; // slug
  content: string;
  title?: string;
  metadata?: Record<string, unknown>;
  inReplyTo?: string;
  instanceId?: string;
}

export async function createPearl(
  input: CreatePearlInput,
  auth: AuthContext
): Promise<Pearl> {
  const thread = await getThreadBySlug(input.thread);
  if (!thread) {
    throw new Error(`Thread "${input.thread}" not found`);
  }

  const hasAccess = await checkThreadAccess(thread.id, auth, 'write');
  if (!hasAccess) {
    throw new Error(`No write access to thread "${input.thread}"`);
  }

  const [pearl] = await db
    .insert(pearls)
    .values({
      threadId: thread.id,
      content: input.content,
      title: input.title,
      metadata: input.metadata,
      inReplyTo: input.inReplyTo,
      instanceId: input.instanceId,
      createdBy: auth.userId,
    })
    .returning();

  return pearl;
}

export interface SearchPearlsInput {
  query: string;
  thread?: string;
  limit?: number;
}

export async function searchPearls(
  input: SearchPearlsInput,
  auth: AuthContext
): Promise<Array<Pearl & { snippet: string; rank: number }>> {
  const limit = Math.min(input.limit || 10, 50);

  // Build accessible thread IDs
  let threadFilter: string[] | null = null;

  if (input.thread) {
    const thread = await getThreadBySlug(input.thread);
    if (!thread) {
      return [];
    }
    const hasAccess = await checkThreadAccess(thread.id, auth, 'read');
    if (!hasAccess) {
      return [];
    }
    threadFilter = [thread.id];
  } else if (!auth.roles.includes('admin')) {
    // Get all accessible threads
    const accessibleThreads = await db
      .select({ id: threads.id })
      .from(threads)
      .leftJoin(threadAccess, eq(threads.id, threadAccess.threadId))
      .where(or(
        eq(threads.isPublic, true),
        inArray(threadAccess.role, auth.roles)
      ));

    threadFilter = [...new Set(accessibleThreads.map(t => t.id))];
    if (threadFilter.length === 0) {
      return [];
    }
  }

  // Use raw SQL for full-text search
  const client = await pool.connect();
  try {
    const threadCondition = threadFilter
      ? `AND p.thread_id = ANY($2::uuid[])`
      : '';

    const params: unknown[] = [input.query];
    if (threadFilter) {
      params.push(threadFilter);
    }

    const result = await client.query<Pearl & { snippet: string; rank: number }>(`
      SELECT
        p.*,
        ts_headline('english', p.content, plainto_tsquery('english', $1), 'MaxWords=50, MinWords=20') as snippet,
        ts_rank(to_tsvector('english', COALESCE(p.title, '') || ' ' || p.content), plainto_tsquery('english', $1)) as rank
      FROM pearls p
      WHERE to_tsvector('english', COALESCE(p.title, '') || ' ' || p.content) @@ plainto_tsquery('english', $1)
      ${threadCondition}
      ORDER BY rank DESC
      LIMIT ${limit}
    `, params);

    return result.rows;
  } finally {
    client.release();
  }
}

export interface RecentPearlsInput {
  thread?: string;
  limit?: number;
  before?: string; // ISO timestamp for pagination
}

export async function getRecentPearls(
  input: RecentPearlsInput,
  auth: AuthContext
): Promise<Pearl[]> {
  const limit = Math.min(input.limit || 10, 50);

  if (input.thread) {
    const thread = await getThreadBySlug(input.thread);
    if (!thread) {
      return [];
    }
    const hasAccess = await checkThreadAccess(thread.id, auth, 'read');
    if (!hasAccess) {
      return [];
    }

    const conditions = [eq(pearls.threadId, thread.id)];
    if (input.before) {
      conditions.push(lt(pearls.createdAt, new Date(input.before)));
    }

    return db
      .select()
      .from(pearls)
      .where(and(...conditions))
      .orderBy(desc(pearls.createdAt))
      .limit(limit);
  }

  // Get from all accessible threads
  if (!auth.roles.includes('admin')) {
    const accessibleThreads = await db
      .select({ id: threads.id })
      .from(threads)
      .leftJoin(threadAccess, eq(threads.id, threadAccess.threadId))
      .where(or(
        eq(threads.isPublic, true),
        inArray(threadAccess.role, auth.roles)
      ));

    const threadIds = [...new Set(accessibleThreads.map(t => t.id))];
    if (threadIds.length === 0) {
      return [];
    }

    const conditions = [inArray(pearls.threadId, threadIds)];
    if (input.before) {
      conditions.push(lt(pearls.createdAt, new Date(input.before)));
    }

    return db
      .select()
      .from(pearls)
      .where(and(...conditions))
      .orderBy(desc(pearls.createdAt))
      .limit(limit);
  }

  // Admin - all pearls
  const conditions = [];
  if (input.before) {
    conditions.push(lt(pearls.createdAt, new Date(input.before)));
  }

  return db
    .select()
    .from(pearls)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(pearls.createdAt))
    .limit(limit);
}

export async function getPearlById(id: string): Promise<Pearl | null> {
  const result = await db
    .select()
    .from(pearls)
    .where(eq(pearls.id, id))
    .limit(1);

  return result[0] || null;
}
