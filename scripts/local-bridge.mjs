#!/usr/bin/env node
/**
 * Pearls MCP Bridge - Local proxy for Claude Desktop
 *
 * This script runs locally and proxies MCP requests to the remote Pearls server.
 * It handles the stdio transport that Claude Desktop expects and converts to HTTP.
 *
 * Usage:
 *   1. Copy this file to your Mac
 *   2. Run: chmod +x local-bridge.mjs
 *   3. Add to Claude Desktop config with command pointing to this script
 */

import { stdin, stdout, stderr } from 'process';
import { createInterface } from 'readline';

const PEARLS_URL = process.env.PEARLS_URL || 'https://pearls.infiniterealms.tech/mcp';
const PEARLS_TOKEN = process.env.PEARLS_TOKEN || '';

const rl = createInterface({ input: stdin });

async function sendToServer(request) {
  try {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    };

    if (PEARLS_TOKEN) {
      headers['Authorization'] = `Bearer ${PEARLS_TOKEN}`;
    }

    const response = await fetch(PEARLS_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });

    const text = await response.text();

    // Handle SSE format (event: message\ndata: {...})
    if (text.startsWith('event:')) {
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.startsWith('data:')) {
          return JSON.parse(line.slice(5).trim());
        }
      }
    }

    // Handle plain JSON
    return JSON.parse(text);
  } catch (error) {
    stderr.write(`Bridge error: ${error.message}\n`);
    return {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32000,
        message: `Bridge error: ${error.message}`,
      },
    };
  }
}

rl.on('line', async (line) => {
  try {
    const request = JSON.parse(line);
    const response = await sendToServer(request);
    stdout.write(JSON.stringify(response) + '\n');
  } catch (error) {
    stderr.write(`Parse error: ${error.message}\n`);
  }
});

rl.on('close', () => {
  process.exit(0);
});

stderr.write('Pearls MCP Bridge started\n');
