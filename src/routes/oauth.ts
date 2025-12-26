import { Router } from 'express';
import crypto from 'crypto';
import { workos, authConfig } from '../services/workos.js';
import { signToken } from '../lib/jwt.js';
import { pool } from '../db/client.js';
import { resolveUserRoles } from '../services/workos.js';
import { env } from '../config/env.js';

const router = Router();

// In-memory stores (in production, use Redis or DB)
const authorizationCodes = new Map<string, {
  clientId: string;
  userId: string;
  email: string;
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  expiresAt: number;
}>();

const registeredClients = new Map<string, {
  clientId: string;
  clientSecret?: string;
  clientName: string;
  redirectUris: string[];
  createdAt: number;
}>();

// Pre-register Claude.ai as a static client
const CLAUDE_AI_CLIENT_ID = 'claude_ai_pearls';
const CLAUDE_AI_CLIENT_SECRET = '4ad884be91cfec11c58b19110e0a138f7ec6a7c3157baa4909f4d405ff4b496f';

registeredClients.set(CLAUDE_AI_CLIENT_ID, {
  clientId: CLAUDE_AI_CLIENT_ID,
  clientSecret: CLAUDE_AI_CLIENT_SECRET,
  clientName: 'Claude.ai',
  redirectUris: [
    'https://claude.ai/oauth/callback',
    'https://claude.ai/api/mcp/auth_callback',
    'https://claude.com/api/mcp/auth_callback',
    'https://claude.ai',
  ],
  createdAt: Date.now(),
});

// OAuth 2.0 Protected Resource Metadata (RFC 9728) - Required by MCP spec
router.get('/.well-known/oauth-protected-resource', (_req, res) => {
  const baseUrl = env.BASE_URL;

  res.json({
    resource: baseUrl,
    authorization_servers: [baseUrl],
    scopes_supported: ['read', 'write', 'admin'],
    bearer_methods_supported: ['header'],
  });
});

// Also serve at path-specific location
router.get('/.well-known/oauth-protected-resource/mcp', (_req, res) => {
  const baseUrl = env.BASE_URL;

  res.json({
    resource: baseUrl,
    authorization_servers: [baseUrl],
    scopes_supported: ['read', 'write', 'admin'],
    bearer_methods_supported: ['header'],
  });
});

// OAuth 2.0 Authorization Server Metadata (RFC 8414)
router.get('/.well-known/oauth-authorization-server', (_req, res) => {
  const baseUrl = env.BASE_URL;

  res.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    registration_endpoint: `${baseUrl}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256', 'plain'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    scopes_supported: ['read', 'write', 'admin'],
  });
});

// Dynamic Client Registration (RFC 7591)
router.post('/register', async (req, res) => {
  try {
    const { client_name, redirect_uris } = req.body;

    if (!client_name || !redirect_uris || !Array.isArray(redirect_uris)) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'client_name and redirect_uris are required',
      });
      return;
    }

    // Validate redirect URIs (must be localhost or HTTPS)
    for (const uri of redirect_uris) {
      const url = new URL(uri);
      if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1' && url.protocol !== 'https:') {
        res.status(400).json({
          error: 'invalid_redirect_uri',
          error_description: 'Redirect URIs must be localhost or HTTPS',
        });
        return;
      }
    }

    const clientId = `client_${crypto.randomBytes(16).toString('hex')}`;

    registeredClients.set(clientId, {
      clientId,
      clientName: client_name,
      redirectUris: redirect_uris,
      createdAt: Date.now(),
    });

    res.status(201).json({
      client_id: clientId,
      client_name,
      redirect_uris,
      token_endpoint_auth_method: 'none',
    });
  } catch (error) {
    console.error('Client registration error:', error);
    res.status(500).json({ error: 'server_error' });
  }
});

// Authorization Endpoint - redirects to WorkOS
router.get('/authorize', async (req, res) => {
  try {
    const {
      client_id,
      redirect_uri,
      response_type,
      state,
      code_challenge,
      code_challenge_method,
    } = req.query as Record<string, string>;

    // Validate required params
    if (response_type !== 'code') {
      res.status(400).json({
        error: 'unsupported_response_type',
        error_description: 'Only code response type is supported',
      });
      return;
    }

    if (!client_id || !redirect_uri) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'client_id and redirect_uri are required',
      });
      return;
    }

    // Store the OAuth state for the callback
    const oauthState = crypto.randomBytes(32).toString('hex');

    // Store in session (using a simple in-memory map for now)
    const pendingAuth = {
      clientId: client_id,
      redirectUri: redirect_uri,
      state: state || '',
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method || 'plain',
    };

    // Store pending auth with the state as key
    authorizationCodes.set(`pending_${oauthState}`, {
      ...pendingAuth,
      userId: '',
      email: '',
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 min
    } as any);

    // Redirect to WorkOS AuthKit
    const authorizationUrl = workos.userManagement.getAuthorizationUrl({
      provider: 'authkit',
      clientId: authConfig.clientId,
      redirectUri: `${env.BASE_URL}/oauth/callback`,
      state: oauthState,
    });

    res.redirect(authorizationUrl);
  } catch (error) {
    console.error('Authorization error:', error);
    res.status(500).json({ error: 'server_error' });
  }
});

// OAuth Callback from WorkOS
router.get('/oauth/callback', async (req, res) => {
  try {
    const { code, state } = req.query as Record<string, string>;

    if (!code || !state) {
      res.status(400).send('Missing code or state');
      return;
    }

    // Get pending auth
    const pendingKey = `pending_${state}`;
    const pending = authorizationCodes.get(pendingKey);

    if (!pending) {
      res.status(400).send('Invalid or expired state');
      return;
    }

    authorizationCodes.delete(pendingKey);

    // Exchange code with WorkOS
    const { user } = await workos.userManagement.authenticateWithCode({
      code,
      clientId: authConfig.clientId,
    });

    // Generate our own authorization code
    const authCode = crypto.randomBytes(32).toString('hex');

    authorizationCodes.set(authCode, {
      clientId: pending.clientId,
      userId: user.id,
      email: user.email,
      redirectUri: pending.redirectUri,
      codeChallenge: pending.codeChallenge,
      codeChallengeMethod: pending.codeChallengeMethod,
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 min
    });

    // Redirect back to client with code
    const redirectUrl = new URL(pending.redirectUri);
    redirectUrl.searchParams.set('code', authCode);
    if ((pending as any).state) {
      redirectUrl.searchParams.set('state', (pending as any).state);
    }

    res.redirect(redirectUrl.toString());
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).send('Authentication failed');
  }
});

// Token Endpoint
router.post('/token', async (req, res) => {
  try {
    const { grant_type, code, redirect_uri, code_verifier, refresh_token, client_id, client_secret } = req.body;

    // Validate client credentials if provided
    if (client_id && client_secret) {
      const client = registeredClients.get(client_id);
      if (!client || client.clientSecret !== client_secret) {
        res.status(401).json({
          error: 'invalid_client',
          error_description: 'Invalid client credentials',
        });
        return;
      }
    }

    if (grant_type === 'authorization_code') {
      if (!code) {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'code is required',
        });
        return;
      }

      const authData = authorizationCodes.get(code);

      if (!authData || authData.expiresAt < Date.now()) {
        authorizationCodes.delete(code);
        res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Invalid or expired authorization code',
        });
        return;
      }

      // Verify PKCE if code_challenge was provided
      if (authData.codeChallenge && code_verifier) {
        let calculatedChallenge: string;

        if (authData.codeChallengeMethod === 'S256') {
          calculatedChallenge = crypto
            .createHash('sha256')
            .update(code_verifier)
            .digest('base64url');
        } else {
          calculatedChallenge = code_verifier;
        }

        if (calculatedChallenge !== authData.codeChallenge) {
          res.status(400).json({
            error: 'invalid_grant',
            error_description: 'Invalid code_verifier',
          });
          return;
        }
      }

      // Delete used code
      authorizationCodes.delete(code);

      // Get user roles
      const roles = resolveUserRoles(authData.userId);

      // Generate access token
      const accessToken = signToken({
        userId: authData.userId,
        email: authData.email,
        roles,
      });

      // Generate refresh token
      const refreshTokenValue = crypto.randomBytes(32).toString('hex');

      // Store refresh token in DB
      const client = await pool.connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS refresh_tokens (
            token_hash TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            email TEXT,
            expires_at TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
          )
        `);

        const tokenHash = crypto.createHash('sha256').update(refreshTokenValue).digest('hex');
        await client.query(`
          INSERT INTO refresh_tokens (token_hash, user_id, email, expires_at)
          VALUES ($1, $2, $3, NOW() + INTERVAL '30 days')
        `, [tokenHash, authData.userId, authData.email]);
      } finally {
        client.release();
      }

      res.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 604800, // 7 days
        refresh_token: refreshTokenValue,
        scope: roles.join(' '),
      });
    } else if (grant_type === 'refresh_token') {
      if (!refresh_token) {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'refresh_token is required',
        });
        return;
      }

      const tokenHash = crypto.createHash('sha256').update(refresh_token).digest('hex');

      const client = await pool.connect();
      try {
        const result = await client.query(`
          SELECT user_id, email FROM refresh_tokens
          WHERE token_hash = $1 AND expires_at > NOW()
        `, [tokenHash]);

        if (result.rows.length === 0) {
          res.status(400).json({
            error: 'invalid_grant',
            error_description: 'Invalid or expired refresh token',
          });
          return;
        }

        const { user_id, email } = result.rows[0];
        const roles = resolveUserRoles(user_id);

        const accessToken = signToken({
          userId: user_id,
          email,
          roles,
        });

        res.json({
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: 604800,
          scope: roles.join(' '),
        });
      } finally {
        client.release();
      }
    } else {
      res.status(400).json({
        error: 'unsupported_grant_type',
        error_description: 'Only authorization_code and refresh_token are supported',
      });
    }
  } catch (error) {
    console.error('Token error:', error);
    res.status(500).json({ error: 'server_error' });
  }
});

export default router;
