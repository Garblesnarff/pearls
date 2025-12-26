import { eq, and, inArray, or } from 'drizzle-orm';
import { db } from '../db/client.js';
import { threads, threadAccess, type Thread, type NewThread } from '../db/schema/index.js';
import type { AuthContext } from '../middleware/auth.js';

export type Permission = 'read' | 'write' | 'admin';

export async function listAccessibleThreads(auth: AuthContext): Promise<Thread[]> {
  // Admin sees all threads
  if (auth.roles.includes('admin')) {
    return db.select().from(threads).orderBy(threads.name);
  }

  // Get threads where user has access OR thread is public
  const accessibleThreadIds = await db
    .select({ threadId: threadAccess.threadId })
    .from(threadAccess)
    .where(inArray(threadAccess.role, auth.roles));

  const threadIds = accessibleThreadIds.map(a => a.threadId);

  if (threadIds.length === 0) {
    // Only public threads
    return db
      .select()
      .from(threads)
      .where(eq(threads.isPublic, true))
      .orderBy(threads.name);
  }

  return db
    .select()
    .from(threads)
    .where(or(
      eq(threads.isPublic, true),
      inArray(threads.id, threadIds)
    ))
    .orderBy(threads.name);
}

export async function getThreadBySlug(slug: string): Promise<Thread | null> {
  const result = await db
    .select()
    .from(threads)
    .where(eq(threads.slug, slug))
    .limit(1);

  return result[0] || null;
}

export async function checkThreadAccess(
  threadId: string,
  auth: AuthContext,
  requiredPermission: Permission
): Promise<boolean> {
  // Admin has full access
  if (auth.roles.includes('admin')) {
    return true;
  }

  // Check if thread is public (for read access)
  if (requiredPermission === 'read') {
    const thread = await db
      .select()
      .from(threads)
      .where(eq(threads.id, threadId))
      .limit(1);

    if (thread[0]?.isPublic) {
      return true;
    }
  }

  // Check explicit permissions
  const permissionHierarchy: Record<Permission, Permission[]> = {
    read: ['read', 'write', 'admin'],
    write: ['write', 'admin'],
    admin: ['admin'],
  };

  const validPermissions = permissionHierarchy[requiredPermission];

  const access = await db
    .select()
    .from(threadAccess)
    .where(and(
      eq(threadAccess.threadId, threadId),
      inArray(threadAccess.role, auth.roles),
      inArray(threadAccess.permission, validPermissions)
    ))
    .limit(1);

  return access.length > 0;
}

export async function createThread(
  data: { slug: string; name: string; description?: string; isPublic?: boolean },
  auth: AuthContext
): Promise<Thread> {
  const [thread] = await db
    .insert(threads)
    .values({
      slug: data.slug,
      name: data.name,
      description: data.description,
      isPublic: data.isPublic ?? false,
      createdBy: auth.userId,
    })
    .returning();

  return thread;
}

export async function grantThreadAccess(
  threadId: string,
  role: string,
  permission: Permission
): Promise<void> {
  await db
    .insert(threadAccess)
    .values({ threadId, role, permission })
    .onConflictDoNothing();
}
