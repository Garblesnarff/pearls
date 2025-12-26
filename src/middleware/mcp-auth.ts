import type { Request } from 'express';
import { extractAuthContext, type AuthContext } from './auth.js';

export type { AuthContext };

export async function extractMcpAuthContext(req: Request): Promise<AuthContext> {
  return extractAuthContext(req);
}
