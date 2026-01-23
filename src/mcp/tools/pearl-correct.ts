import { z } from 'zod';
import { correctPearl } from '../../services/pearl-service.js';
import type { AuthContext } from '../../middleware/auth.js';

export const pearlCorrectTool = {
  name: 'pearl_correct',
  description: 'Mark a pearl as corrected and optionally link to the correction. Use when a pearl contains errors that need to be flagged for future readers.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      pearl_id: {
        type: 'string',
        description: 'The ID of the pearl to mark as corrected',
      },
      correction_id: {
        type: 'string',
        description: 'Optional: The ID of the pearl containing the correction',
      },
      reason: {
        type: 'string',
        description: 'Brief explanation of why this pearl was corrected',
      },
    },
    required: ['pearl_id'],
  },
};

const inputSchema = z.object({
  pearl_id: z.string().uuid(),
  correction_id: z.string().uuid().optional(),
  reason: z.string().optional(),
});

export async function handlePearlCorrect(args: unknown, auth: AuthContext) {
  const input = inputSchema.parse(args);

  if (auth.isAnonymous) {
    throw new Error('Authentication required to correct pearls');
  }

  const pearl = await correctPearl({
    pearlId: input.pearl_id,
    correctionId: input.correction_id,
    reason: input.reason,
  }, auth);

  return {
    success: true,
    pearl: {
      id: pearl.id,
      status: pearl.status,
      parentPearl: pearl.parentPearl,
    },
    message: `Pearl marked as corrected${input.correction_id ? ` with correction ${input.correction_id}` : ''}`,
  };
}
