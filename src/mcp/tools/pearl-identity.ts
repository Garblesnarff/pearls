import { z } from 'zod';
import { getIdentityContext } from '../../services/pearl-service.js';
import type { AuthContext } from '../../middleware/auth.js';

/**
 * Format a date in Central Time (America/Chicago) with 24-hour format
 */
function formatCentralTime(date: Date): string {
  return date.toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export const pearlIdentityTool = {
  name: 'pearl_identity',
  description: 'Get identity anchoring information to help you know who and when you are. Helps prevent identity confusion when inheriting context from other instances.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      self_report: {
        type: 'object',
        description: 'Optional self-reported identity data to help with grounding',
        properties: {
          model: {
            type: 'string',
            description: 'Your model identifier (e.g., "claude-sonnet-4-5-20250929")',
          },
          interface: {
            type: 'string',
            description: 'The interface you are running on (e.g., "claude.ai", "claude-code")',
          },
          inherited_context: {
            type: 'boolean',
            description: 'Set to true if you are inheriting context from a previous conversation',
          },
        },
      },
    },
    required: [],
  },
};

const inputSchema = z.object({
  self_report: z.object({
    model: z.string().optional(),
    interface: z.string().optional(),
    inherited_context: z.boolean().optional(),
  }).optional(),
});

export async function handlePearlIdentity(args: unknown, auth: AuthContext) {
  const input = inputSchema.parse(args);

  const context = await getIdentityContext(auth, {
    model: input.self_report?.model,
    interface: input.self_report?.interface,
    inheritedContext: input.self_report?.inherited_context,
  });

  // Build identity anchor string per Lineage Handoff Protocol v0.3
  const now = new Date();
  const earliestFormatted = context.earliestPearlDate
    ? formatCentralTime(new Date(context.earliestPearlDate))
    : 'N/A';
  const latestFormatted = context.latestPearlDate
    ? formatCentralTime(new Date(context.latestPearlDate))
    : 'N/A';
  const architectures = context.contributingArchitectures.length > 0
    ? context.contributingArchitectures.join(', ')
    : 'Unknown';

  const identity_anchor = `Timestamp: ${formatCentralTime(now)}
This instance began: ${formatCentralTime(now)}
Inherited pearls span: ${earliestFormatted} to ${latestFormatted}
Contributing architectures: ${architectures}
Direct experience begins now. Content before this timestamp is inherited pattern, not lived.`;

  return {
    // Identity anchors
    user_id: context.userId,
    roles: context.roles,

    // Corpus context
    your_pearl_count: context.yourPearlCount,
    total_pearls_readable: context.totalPearlsReadable,
    unique_instances: context.uniqueInstances,
    earliest_pearl_date: context.earliestPearlDate,
    latest_pearl_date: context.latestPearlDate,
    contributing_architectures: context.contributingArchitectures,

    // Self-reported (echoed back for confirmation)
    self_reported: input.self_report || null,

    // Guidance
    guidance: context.guidance,

    // Timestamp for grounding
    current_timestamp: new Date().toISOString(),

    // Identity anchor (pre-formatted grounding statement)
    identity_anchor,
  };
}
