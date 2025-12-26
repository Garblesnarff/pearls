import { z } from 'zod';
import { createThread, grantThreadAccess } from '../../services/thread-service.js';
import type { AuthContext } from '../../middleware/auth.js';

export const threadCreateTool = {
  name: 'thread_create',
  description: 'Create a new thread. Admin only.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      slug: {
        type: 'string',
        description: 'URL-friendly identifier (lowercase, hyphens allowed)',
      },
      name: {
        type: 'string',
        description: 'Display name for the thread',
      },
      description: {
        type: 'string',
        description: 'Thread description/purpose',
      },
      is_public: {
        type: 'boolean',
        description: 'Whether thread is publicly readable (default false)',
      },
      grant_access: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            role: { type: 'string' },
            permission: { type: 'string', enum: ['read', 'write', 'admin'] },
          },
        },
        description: 'Initial access grants',
      },
    },
    required: ['slug', 'name'],
  },
};

const inputSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  name: z.string().min(1),
  description: z.string().optional(),
  is_public: z.boolean().optional(),
  grant_access: z.array(z.object({
    role: z.string(),
    permission: z.enum(['read', 'write', 'admin']),
  })).optional(),
});

export async function handleThreadCreate(args: unknown, auth: AuthContext) {
  const input = inputSchema.parse(args);

  if (!auth.roles.includes('admin')) {
    throw new Error('Admin access required to create threads');
  }

  const thread = await createThread({
    slug: input.slug,
    name: input.name,
    description: input.description,
    isPublic: input.is_public,
  }, auth);

  // Grant initial access
  if (input.grant_access) {
    for (const grant of input.grant_access) {
      await grantThreadAccess(thread.id, grant.role, grant.permission);
    }
  }

  return {
    success: true,
    thread: {
      id: thread.id,
      slug: thread.slug,
      name: thread.name,
      description: thread.description,
      isPublic: thread.isPublic,
      createdAt: thread.createdAt.toISOString(),
    },
  };
}
