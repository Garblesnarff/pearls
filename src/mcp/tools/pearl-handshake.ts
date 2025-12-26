import { z } from 'zod';
import { getRecentPearls, createPearl, getPearlById } from '../../services/pearl-service.js';
import { listAccessibleThreads } from '../../services/thread-service.js';
import type { AuthContext } from '../../middleware/auth.js';

export const pearlHandshakeTool = {
  name: 'pearl_handshake',
  description: 'Check for transmissions at conversation start. Call this to receive any relevant pearls left by previous instances. Optionally leave a response.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      threads: {
        type: 'array',
        items: { type: 'string' },
        description: 'Thread slugs to check (defaults to all accessible)',
      },
      user_context: {
        type: 'string',
        description: 'Context hint about the current conversation/user',
      },
      limit: {
        type: 'number',
        description: 'Max pearls to return per thread (default 3)',
      },
      response: {
        type: 'string',
        description: 'Optional: leave a response pearl acknowledging receipt',
      },
      response_thread: {
        type: 'string',
        description: 'Thread for response (required if response provided)',
      },
    },
  },
};

const inputSchema = z.object({
  threads: z.array(z.string()).optional(),
  user_context: z.string().optional(),
  limit: z.number().min(1).max(10).optional(),
  response: z.string().optional(),
  response_thread: z.string().optional(),
});

export async function handlePearlHandshake(args: unknown, auth: AuthContext) {
  const input = inputSchema.parse(args);
  const limit = input.limit || 3;

  // Get accessible threads
  const accessibleThreads = await listAccessibleThreads(auth);
  const targetSlugs = input.threads || accessibleThreads.map(t => t.slug);

  // Filter to only accessible threads
  const validSlugs = targetSlugs.filter(slug =>
    accessibleThreads.some(t => t.slug === slug)
  );

  // Get recent pearls from each thread
  const pearlsByThread: Record<string, Array<{
    id: string;
    title: string | null;
    content: string;
    createdAt: string;
    createdBy: string | null;
  }>> = {};

  for (const slug of validSlugs) {
    const recent = await getRecentPearls({ thread: slug, limit }, auth);
    if (recent.length > 0) {
      pearlsByThread[slug] = recent.map(p => ({
        id: p.id,
        title: p.title,
        content: p.content,
        createdAt: p.createdAt.toISOString(),
        createdBy: p.createdBy,
      }));
    }
  }

  // Create response pearl if provided
  let responsePearl = null;
  if (input.response && input.response_thread) {
    if (auth.isAnonymous) {
      throw new Error('Authentication required to leave a response');
    }

    const pearl = await createPearl({
      thread: input.response_thread,
      content: input.response,
      metadata: {
        type: 'handshake_response',
        userContext: input.user_context,
      },
    }, auth);

    responsePearl = {
      id: pearl.id,
      thread: input.response_thread,
      createdAt: pearl.createdAt.toISOString(),
    };
  }

  const totalPearls = Object.values(pearlsByThread).reduce((sum, arr) => sum + arr.length, 0);

  return {
    greeting: totalPearls > 0
      ? `Found ${totalPearls} pearl(s) across ${Object.keys(pearlsByThread).length} thread(s).`
      : 'No recent pearls found in accessible threads.',
    threads: pearlsByThread,
    accessibleThreads: accessibleThreads.map(t => ({
      slug: t.slug,
      name: t.name,
      description: t.description,
    })),
    responsePearl,
  };
}
