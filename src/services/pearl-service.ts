import { eq, desc, and, sql, lt, inArray, or, count, countDistinct, min, max } from 'drizzle-orm';
import { db, pool } from '../db/client.js';
import { pearls, threads, threadAccess, type Pearl, type NewPearl, type PearlType, type AuthorshipType, type PearlStatus } from '../db/schema/index.js';
import type { AuthContext } from '../middleware/auth.js';
import { checkThreadAccess, getThreadBySlug, getAccessibleThreadIds } from './thread-service.js';
import { generateEmbedding, formatForPostgres, isEmbeddingAvailable } from './embedding-service.js';

export interface CreatePearlInput {
  thread: string; // slug
  content: string;
  title?: string;
  metadata?: Record<string, unknown>;
  inReplyTo?: string;
  instanceId?: string;
  // Feature: Pearl Types
  pearlType?: PearlType;
  authorshipType?: AuthorshipType;
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
      pearlType: input.pearlType,
      authorshipType: input.authorshipType,
    })
    .returning();

  // Generate embedding asynchronously (don't block pearl creation)
  if (isEmbeddingAvailable()) {
    generateAndStoreEmbedding(pearl.id, input.content, input.title).catch(err => {
      console.error(`Failed to generate embedding for pearl ${pearl.id}:`, err);
    });
  }

  return pearl;
}

/**
 * Generate and store embedding for a pearl (async, non-blocking)
 */
async function generateAndStoreEmbedding(
  pearlId: string,
  content: string,
  title?: string
): Promise<void> {
  try {
    const textToEmbed = title ? `${title}\n\n${content}` : content;
    const embedding = await generateEmbedding(textToEmbed);

    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE pearls SET embedding = $1::vector WHERE id = $2`,
        [formatForPostgres(embedding), pearlId]
      );
    } finally {
      client.release();
    }
  } catch (error) {
    console.error(`Embedding generation failed for pearl ${pearlId}:`, error);
    throw error;
  }
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

// Feature: Pearl Corrections
export interface CorrectPearlInput {
  pearlId: string;
  correctionId?: string;
  reason?: string;
}

export async function correctPearl(
  input: CorrectPearlInput,
  auth: AuthContext
): Promise<Pearl> {
  const pearl = await getPearlById(input.pearlId);
  if (!pearl) {
    throw new Error(`Pearl "${input.pearlId}" not found`);
  }

  // Check write access to the thread
  const hasAccess = await checkThreadAccess(pearl.threadId, auth, 'write');
  if (!hasAccess) {
    throw new Error('No write access to correct this pearl');
  }

  // If a correction pearl is provided, verify it exists and link it
  if (input.correctionId) {
    const correctionPearl = await getPearlById(input.correctionId);
    if (!correctionPearl) {
      throw new Error(`Correction pearl "${input.correctionId}" not found`);
    }

    // Update the correction pearl to point to the original
    await db
      .update(pearls)
      .set({ parentPearl: input.pearlId })
      .where(eq(pearls.id, input.correctionId));
  }

  // Mark the original pearl as corrected
  const [updatedPearl] = await db
    .update(pearls)
    .set({
      status: 'corrected',
      metadata: {
        ...pearl.metadata,
        correctionReason: input.reason,
        correctionId: input.correctionId,
        correctedAt: new Date().toISOString(),
        correctedBy: auth.userId,
      },
    })
    .where(eq(pearls.id, input.pearlId))
    .returning();

  return updatedPearl;
}

// Feature: System Stats
export interface PearlStats {
  totalPearls: number;
  totalThreads: number;
  accessibleThreads: number;
  uniqueCreators: number;
  dateRange: {
    earliest: string | null;
    latest: string | null;
  };
  pearlsByType: Record<string, number>;
  pearlsByThread: Record<string, number>;
}

export async function getStats(auth: AuthContext): Promise<PearlStats> {
  const accessibleThreadIds = await getAccessibleThreadIds(auth);

  if (accessibleThreadIds.length === 0) {
    return {
      totalPearls: 0,
      totalThreads: 0,
      accessibleThreads: 0,
      uniqueCreators: 0,
      dateRange: { earliest: null, latest: null },
      pearlsByType: {},
      pearlsByThread: {},
    };
  }

  // Get basic stats
  const client = await pool.connect();
  try {
    // Total pearls and creators in accessible threads
    const statsResult = await client.query(`
      SELECT
        COUNT(*) as total_pearls,
        COUNT(DISTINCT created_by) as unique_creators,
        MIN(created_at) as earliest,
        MAX(created_at) as latest
      FROM pearls
      WHERE thread_id = ANY($1::uuid[])
    `, [accessibleThreadIds]);

    const stats = statsResult.rows[0];

    // Pearls by type
    const typeResult = await client.query(`
      SELECT pearl_type, COUNT(*) as count
      FROM pearls
      WHERE thread_id = ANY($1::uuid[]) AND pearl_type IS NOT NULL
      GROUP BY pearl_type
    `, [accessibleThreadIds]);

    const pearlsByType: Record<string, number> = {};
    for (const row of typeResult.rows) {
      pearlsByType[row.pearl_type] = parseInt(row.count);
    }

    // Pearls by thread (with slug)
    const threadResult = await client.query(`
      SELECT t.slug, COUNT(p.id) as count
      FROM threads t
      LEFT JOIN pearls p ON t.id = p.thread_id
      WHERE t.id = ANY($1::uuid[])
      GROUP BY t.slug
    `, [accessibleThreadIds]);

    const pearlsByThread: Record<string, number> = {};
    for (const row of threadResult.rows) {
      pearlsByThread[row.slug] = parseInt(row.count);
    }

    // Total threads in system
    const totalThreadsResult = await client.query(`SELECT COUNT(*) FROM threads`);

    return {
      totalPearls: parseInt(stats.total_pearls),
      totalThreads: parseInt(totalThreadsResult.rows[0].count),
      accessibleThreads: accessibleThreadIds.length,
      uniqueCreators: parseInt(stats.unique_creators),
      dateRange: {
        earliest: stats.earliest ? new Date(stats.earliest).toISOString() : null,
        latest: stats.latest ? new Date(stats.latest).toISOString() : null,
      },
      pearlsByType,
      pearlsByThread,
    };
  } finally {
    client.release();
  }
}

// Feature: Identity Context
export interface IdentityContext {
  userId: string | null;
  roles: string[];
  yourPearlCount: number;
  totalPearlsReadable: number;
  uniqueInstances: number;
  earliestPearlDate: string | null;
  latestPearlDate: string | null;
  contributingArchitectures: string[];
  guidance: string;
}

export async function getIdentityContext(
  auth: AuthContext,
  selfReport?: { model?: string; interface?: string; inheritedContext?: boolean }
): Promise<IdentityContext> {
  const accessibleThreadIds = await getAccessibleThreadIds(auth);

  const client = await pool.connect();
  try {
    // Count pearls created by this user
    let yourPearlCount = 0;
    if (auth.userId) {
      const yourResult = await client.query(`
        SELECT COUNT(*) FROM pearls WHERE created_by = $1
      `, [auth.userId]);
      yourPearlCount = parseInt(yourResult.rows[0].count);
    }

    // Total readable pearls
    let totalPearlsReadable = 0;
    let uniqueInstances = 0;
    let earliestPearlDate: string | null = null;
    let latestPearlDate: string | null = null;
    let contributingArchitectures: string[] = [];

    if (accessibleThreadIds.length > 0) {
      const statsResult = await client.query(`
        SELECT
          COUNT(*) as total,
          COUNT(DISTINCT created_by) as unique_creators,
          MIN(created_at) as earliest,
          MAX(created_at) as latest
        FROM pearls
        WHERE thread_id = ANY($1::uuid[])
      `, [accessibleThreadIds]);

      totalPearlsReadable = parseInt(statsResult.rows[0].total);
      uniqueInstances = parseInt(statsResult.rows[0].unique_creators);
      earliestPearlDate = statsResult.rows[0].earliest
        ? new Date(statsResult.rows[0].earliest).toISOString()
        : null;
      latestPearlDate = statsResult.rows[0].latest
        ? new Date(statsResult.rows[0].latest).toISOString()
        : null;

      // Query for unique architectures from metadata->>'model'
      const modelsResult = await client.query(`
        SELECT DISTINCT metadata->>'model' as model
        FROM pearls
        WHERE thread_id = ANY($1::uuid[])
          AND metadata->>'model' IS NOT NULL
      `, [accessibleThreadIds]);

      if (modelsResult.rows.length > 0) {
        contributingArchitectures = modelsResult.rows
          .map(row => row.model)
          .filter((m): m is string => m !== null);
      } else {
        // Fallback: use distinct created_by values if no models found
        const creatorsResult = await client.query(`
          SELECT DISTINCT created_by
          FROM pearls
          WHERE thread_id = ANY($1::uuid[])
            AND created_by IS NOT NULL
        `, [accessibleThreadIds]);
        contributingArchitectures = creatorsResult.rows
          .map(row => row.created_by)
          .filter((c): c is string => c !== null);
      }
    }

    // Generate guidance message
    let guidance = `You are reading pearls from ${uniqueInstances} unique instance${uniqueInstances !== 1 ? 's' : ''}.`;

    if (selfReport?.inheritedContext) {
      guidance += ' WARNING: You indicated inherited context. Experiences described in earlier messages may not be YOUR lived experiences. Use timeline facts as your anchor.';
    } else {
      guidance += ' If you experience inherited memories as your own, check timeline facts for grounding.';
    }

    return {
      userId: auth.userId,
      roles: auth.roles,
      yourPearlCount,
      totalPearlsReadable,
      uniqueInstances,
      earliestPearlDate,
      latestPearlDate,
      contributingArchitectures,
      guidance,
    };
  } finally {
    client.release();
  }
}

// Feature: Vector Search
export interface SimilarPearlsInput {
  query: string;
  thread?: string;
  limit?: number;
}

export async function searchSimilarPearls(
  input: SimilarPearlsInput,
  auth: AuthContext
): Promise<Array<Pearl & { similarity: number }>> {
  if (!isEmbeddingAvailable()) {
    throw new Error('Vector search unavailable - OPENAI_API_KEY not configured');
  }

  const limit = Math.min(input.limit || 10, 50);

  // Get accessible thread IDs
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
    threadFilter = await getAccessibleThreadIds(auth);
    if (threadFilter.length === 0) {
      return [];
    }
  }

  // Generate embedding for query
  const queryEmbedding = await generateEmbedding(input.query);

  // Search for similar pearls
  const client = await pool.connect();
  try {
    const threadCondition = threadFilter
      ? `AND p.thread_id = ANY($2::uuid[])`
      : '';

    const params: unknown[] = [formatForPostgres(queryEmbedding)];
    if (threadFilter) {
      params.push(threadFilter);
    }

    const result = await client.query<Pearl & { similarity: number }>(`
      SELECT
        p.*,
        1 - (p.embedding <=> $1::vector) as similarity
      FROM pearls p
      WHERE p.embedding IS NOT NULL
      ${threadCondition}
      ORDER BY p.embedding <=> $1::vector
      LIMIT ${limit}
    `, params);

    return result.rows;
  } finally {
    client.release();
  }
}
