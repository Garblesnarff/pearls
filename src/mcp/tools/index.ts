import type { AuthContext } from '../../middleware/auth.js';

import { pearlCreateTool, handlePearlCreate } from './pearl-create.js';
import { pearlSearchTool, handlePearlSearch } from './pearl-search.js';
import { pearlRecentTool, handlePearlRecent } from './pearl-recent.js';
import { pearlHandshakeTool, handlePearlHandshake } from './pearl-handshake.js';
import { threadListTool, handleThreadList } from './thread-list.js';
import { threadCreateTool, handleThreadCreate } from './thread-create.js';

export const tools = [
  pearlCreateTool,
  pearlSearchTool,
  pearlRecentTool,
  pearlHandshakeTool,
  threadListTool,
  threadCreateTool,
];

export async function handleToolCall(
  name: string,
  args: unknown,
  auth: AuthContext
): Promise<unknown> {
  switch (name) {
    case 'pearl_create':
      return handlePearlCreate(args, auth);
    case 'pearl_search':
      return handlePearlSearch(args, auth);
    case 'pearl_recent':
      return handlePearlRecent(args, auth);
    case 'pearl_handshake':
      return handlePearlHandshake(args, auth);
    case 'thread_list':
      return handleThreadList(args, auth);
    case 'thread_create':
      return handleThreadCreate(args, auth);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
