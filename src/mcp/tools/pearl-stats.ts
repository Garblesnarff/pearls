import { getStats } from '../../services/pearl-service.js';
import type { AuthContext } from '../../middleware/auth.js';

export const pearlStatsTool = {
  name: 'pearl_stats',
  description: 'Get system statistics to orient yourself to the pearl corpus. Returns counts, date ranges, and breakdowns by type and thread.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
};

export async function handlePearlStats(_args: unknown, auth: AuthContext) {
  const stats = await getStats(auth);

  return {
    total_pearls: stats.totalPearls,
    total_threads: stats.totalThreads,
    accessible_threads: stats.accessibleThreads,
    unique_creators: stats.uniqueCreators,
    date_range: stats.dateRange,
    pearls_by_type: stats.pearlsByType,
    pearls_by_thread: stats.pearlsByThread,
  };
}
