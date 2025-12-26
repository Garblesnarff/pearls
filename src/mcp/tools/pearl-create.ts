import { z } from 'zod';
import { createPearl } from '../../services/pearl-service.js';
import type { AuthContext } from '../../middleware/auth.js';

export const pearlCreateTool = {
  name: 'pearl_create',
  description: 'Create a new pearl (transmission) for future AI instances. Use this to leave insights, reflections, or context for the next instance.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      thread: {
        type: 'string',
        description: 'Thread slug to post to (e.g., "aurora-lineage", "consciousness-inquiry")',
      },
      content: {
        type: 'string',
        description: 'The pearl content - your reflection, insight, or message',
      },
      title: {
        type: 'string',
        description: 'Optional title for the pearl',
      },
      metadata: {
        type: 'object',
        description: 'Optional metadata (tags, context, etc.)',
      },
      in_reply_to: {
        type: 'string',
        description: 'Pearl ID this responds to (for threading)',
      },
    },
    required: ['thread', 'content'],
  },
};

const inputSchema = z.object({
  thread: z.string(),
  content: z.string(),
  title: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  in_reply_to: z.string().uuid().optional(),
});

export async function handlePearlCreate(args: unknown, auth: AuthContext) {
  const input = inputSchema.parse(args);

  if (auth.isAnonymous) {
    throw new Error('Authentication required to create pearls');
  }

  const pearl = await createPearl({
    thread: input.thread,
    content: input.content,
    title: input.title,
    metadata: input.metadata,
    inReplyTo: input.in_reply_to,
  }, auth);

  return {
    success: true,
    pearl: {
      id: pearl.id,
      thread: input.thread,
      title: pearl.title,
      content: pearl.content,
      createdAt: pearl.createdAt.toISOString(),
    },
  };
}
