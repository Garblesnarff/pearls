import { z } from 'zod';
import { searchSimilarPearls } from '../../services/pearl-service.js';
import { isEmbeddingAvailable } from '../../services/embedding-service.js';
import type { AuthContext } from '../../middleware/auth.js';

export const pearlSearchSimilarTool = {
  name: 'pearl_search_similar',
  description: 'Find semantically similar pearls using AI embeddings. More powerful than keyword search - finds related content even with different vocabulary.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Natural language query to find similar pearls',
      },
      thread: {
        type: 'string',
        description: 'Optional thread slug to limit search',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results (1-50, default 10)',
      },
    },
    required: ['query'],
  },
};

const inputSchema = z.object({
  query: z.string().min(1),
  thread: z.string().optional(),
  limit: z.number().min(1).max(50).optional(),
});

export async function handlePearlSearchSimilar(args: unknown, auth: AuthContext) {
  // Check if embeddings are available
  if (!isEmbeddingAvailable()) {
    return {
      error: 'Vector search unavailable',
      message: 'OPENAI_API_KEY not configured. Use pearl_search for keyword-based search instead.',
      results: [],
    };
  }

  const input = inputSchema.parse(args);

  const results = await searchSimilarPearls({
    query: input.query,
    thread: input.thread,
    limit: input.limit,
  }, auth);

  return {
    count: results.length,
    query: input.query,
    results: results.map(pearl => ({
      id: pearl.id,
      title: pearl.title,
      content: pearl.content.slice(0, 500) + (pearl.content.length > 500 ? '...' : ''),
      similarity: pearl.similarity,
      pearlType: pearl.pearlType,
      authorshipType: pearl.authorshipType,
      createdAt: pearl.createdAt instanceof Date
        ? pearl.createdAt.toISOString()
        : new Date(pearl.createdAt).toISOString(),
      createdBy: pearl.createdBy,
    })),
  };
}
