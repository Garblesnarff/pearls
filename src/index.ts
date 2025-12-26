import express from 'express';
import path from 'path';
import { env } from './config/env.js';
import healthRouter from './routes/health.js';
import mcpRouter from './routes/mcp.js';
import adminRouter from './routes/admin.js';
import oauthRouter from './routes/oauth.js';
import { authMiddleware } from './middleware/auth.js';

const app = express();

// Middleware
app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(import.meta.dir, '../public')));

// CORS for MCP clients
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }

  next();
});

// Routes
app.use(healthRouter);
app.use(mcpRouter);
app.use('/api', adminRouter);
app.use(oauthRouter);

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// Start server
const port = parseInt(env.PORT);
app.listen(port, () => {
  console.log(`Pearls MCP server running on port ${port}`);
  console.log(`Health: http://localhost:${port}/health`);
  console.log(`MCP endpoint: http://localhost:${port}/mcp`);
  console.log(`Admin API: http://localhost:${port}/api/`);
});
