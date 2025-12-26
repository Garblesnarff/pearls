import { Router } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { PearlsMcpServer } from '../mcp/server.js';
import { extractMcpAuthContext } from '../middleware/mcp-auth.js';

const router = Router();

// MCP endpoint - handles JSON-RPC over HTTP
router.post('/mcp', async (req, res) => {
  try {
    const auth = await extractMcpAuthContext(req);
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
