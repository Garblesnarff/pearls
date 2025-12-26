import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { getBearerToken, verifyToken, type AuthTokenPayload } from '../lib/jwt.js';
import { verifyWorkOSToken, resolveUserRoles } from '../services/workos.js';
import { pool } from '../db/client.js';

export interface AuthContext {
  userId: string | null;
  email: string | null;
  roles: string[];
  isAnonymous: boolean;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

async function verifyApiKey(token: string): Promise<AuthContext | null> {
  // Check if it looks like an API key (starts with pearl_)
  if (!token.startsWith('pearl_')) {
    return null;
  }

  try {
    const keyHash = crypto.createHash('sha256').update(token).digest('hex');
    const client = await pool.connect();

    try {
      const result = await client.query(`
        SELECT user_id, roles FROM api_keys
        WHERE key_hash = $1 AND disabled = false
      `, [keyHash]);

      if (result.rows.length === 0) {
        return null;
      }

      const { user_id, roles } = result.rows[0];

      // Update last_used_at
      await client.query(
        'UPDATE api_keys SET last_used_at = NOW() WHERE key_hash = $1',
        [keyHash]
      );

      return {
        userId: user_id,
        email: null,
        roles: roles || ['authenticated'],
        isAnonymous: false,
      };
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('API key verification error:', error);
    return null;
  }
}

export async function extractAuthContext(req: Request): Promise<AuthContext> {
  const token = getBearerToken(req.headers.authorization);

  if (!token) {
    return { userId: null, email: null, roles: ['anonymous'], isAnonymous: true };
  }

  // Try API key first (starts with pearl_)
  if (token.startsWith('pearl_')) {
    const apiKeyAuth = await verifyApiKey(token);
    if (apiKeyAuth) {
      return apiKeyAuth;
    }
    return { userId: null, email: null, roles: ['anonymous'], isAnonymous: true };
  }

  // Try our own JWT tokens first (issued by our OAuth flow)
  try {
    const payload = verifyToken(token) as AuthTokenPayload;
    if (payload && payload.userId) {
      // Re-resolve roles in case they've been updated
      const roles = resolveUserRoles(payload.userId);
      return {
        userId: payload.userId,
        email: payload.email || null,
        roles,
        isAnonymous: false,
      };
    }
  } catch {
    // Not one of our tokens, try WorkOS
  }

  // Try WorkOS token
  const user = await verifyWorkOSToken(token);
  if (!user) {
    return { userId: null, email: null, roles: ['anonymous'], isAnonymous: true };
  }

  const roles = resolveUserRoles(user.userId);
  return {
    userId: user.userId,
    email: user.email,
    roles,
    isAnonymous: false,
  };
}

export async function authMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void> {
  req.auth = await extractAuthContext(req);
  next();
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = await extractAuthContext(req);

  if (auth.isAnonymous) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  req.auth = auth;
  next();
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const auth = await extractAuthContext(req);

  if (!auth.roles.includes('admin')) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }

  req.auth = auth;
  next();
}
