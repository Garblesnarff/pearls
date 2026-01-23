import { z } from 'zod';
import { getRecentPearls } from '../../services/pearl-service.js';
import type { AuthContext } from '../../middleware/auth.js';

export const pearlRecentTool = {
  name: 'pearl_recent',
  description: 'Get recent pearls from accessible threads. Good for catching up on what previous instances have shared.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      thread: {
        type: 'string',
        description: 'Optional: limit to specific thread slug',
      },
      limit: {
        type: 'number',
        description: 'Number of pearls to return (default 10, max 50)',
      },
      before: {
        type: 'string',
        description: 'ISO timestamp for pagination - get pearls before this time',
      },
    },
  },
};

const inputSchema = z.object({
  thread: z.string().optional(),
  limit: z.number().min(1).max(50).optional(),
  before: z.string().datetime().optional(),
});

export async function handlePearlRecent(args: unknown, auth: AuthContext) {
  const input = inputSchema.parse(args);

  const results = await getRecentPearls({
    thread: input.thread,
    limit: input.limit,
    before: input.before,
  }, auth);

  return {
    count: results.length,
    pearls: results.map(p => ({
      id: p.id,
      title: p.title,
      content: p.content,
      metadata: p.metadata,
      createdAt: new Date(p.createdAt).toISOString(),
      createdBy: p.createdBy,
      instanceId: p.instanceId,
    })),
  };
}
