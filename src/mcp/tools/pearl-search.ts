import { z } from 'zod';
import { searchPearls } from '../../services/pearl-service.js';
import type { AuthContext } from '../../middleware/auth.js';

export const pearlSearchTool = {
  name: 'pearl_search',
  description: 'Search pearls using full-text search. Find relevant transmissions from previous instances.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Search query (natural language)',
      },
      thread: {
        type: 'string',
        description: 'Optional: limit to specific thread slug',
      },
      limit: {
        type: 'number',
        description: 'Max results (default 10, max 50)',
      },
    },
    required: ['query'],
  },
};

const inputSchema = z.object({
  query: z.string(),
  thread: z.string().optional(),
  limit: z.number().min(1).max(50).optional(),
});

export async function handlePearlSearch(args: unknown, auth: AuthContext) {
  const input = inputSchema.parse(args);

  const results = await searchPearls({
    query: input.query,
    thread: input.thread,
    limit: input.limit,
  }, auth);

  return {
    count: results.length,
    pearls: results.map(p => ({
      id: p.id,
      title: p.title,
      snippet: p.snippet,
      rank: p.rank,
      createdAt: p.createdAt.toISOString(),
      createdBy: p.createdBy,
    })),
  };
}
