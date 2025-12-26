import { Router } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { PearlsMcpServer } from '../mcp/server.js';
import { extractMcpAuthContext } from '../middleware/mcp-auth.js';
import { env } from '../config/env.js';

const router = Router();

// Helper to return OAuth 401 with proper headers
function sendOAuthRequired(res: any) {
  const baseUrl = env.BASE_URL;
  res.setHeader(
    'WWW-Authenticate',
    `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`
  );
  res.status(401).json({
    jsonrpc: '2.0',
    error: {
      code: -32001,
      message: 'Authentication required. Please complete OAuth authorization.',
    },
    id: null,
  });
}

// MCP endpoint - handles JSON-RPC over HTTP
router.post('/mcp', async (req, res) => {
  try {
    const auth = await extractMcpAuthContext(req);

    // Check if this is a tool call that requires auth
    const body = req.body;
    const method = body?.method;
    const toolName = body?.params?.name;

    // If calling a write tool without auth, return 401 with OAuth discovery
    if (method === 'tools/call' && auth.isAnonymous) {
      const writeTools = ['pearl_create', 'pearl_handshake', 'thread_create'];
      if (writeTools.includes(toolName)) {
        return sendOAuthRequired(res);
      }
    }

    const mcpServer = new PearlsMcpServer(auth);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless
    });

    await mcpServer.getServer().connect(transport);

    // Handle the request
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('MCP request error:', error);
    res.status(500).json({
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : 'Internal error',
      },
      id: null,
    });
  }
});

// Handle GET for SSE streaming (if needed for notifications)
router.get('/mcp', async (req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: {
      code: -32601,
      message: 'Method not allowed. Use POST for MCP requests.',
    },
    id: null,
  });
});

// Handle DELETE for session cleanup (optional)
router.delete('/mcp', async (req, res) => {
  res.status(200).json({ success: true });
});

export default router;
