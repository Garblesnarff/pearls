import { z } from 'zod';
import { listAccessibleThreads } from '../../services/thread-service.js';
import type { AuthContext } from '../../middleware/auth.js';

export const threadListTool = {
  name: 'thread_list',
  description: 'List threads you have access to. Threads organize pearls by topic or purpose.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      include_public: {
        type: 'boolean',
        description: 'Include public threads (default true)',
      },
    },
  },
};

const inputSchema = z.object({
  include_public: z.boolean().optional(),
});

export async function handleThreadList(args: unknown, auth: AuthContext) {
  const _input = inputSchema.parse(args);

  const threads = await listAccessibleThreads(auth);

  return {
    count: threads.length,
    threads: threads.map(t => ({
      slug: t.slug,
      name: t.name,
      description: t.description,
      isPublic: t.isPublic,
      createdAt: t.createdAt.toISOString(),
    })),
  };
}
