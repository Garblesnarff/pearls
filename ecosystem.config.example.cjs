/**
 * PM2 Ecosystem Configuration for Pearls MCP Server
 * Copy to ecosystem.config.cjs and adjust paths as needed
 */
module.exports = {
  apps: [
    {
      name: 'pearls-mcp',
      script: 'src/index.ts',
      interpreter: 'bun', // or full path like '/home/user/.bun/bin/bun'
      interpreter_args: 'run',

      instances: 1,
      exec_mode: 'fork',

      env: {
        NODE_ENV: 'production',
        PORT: 8889,
      },

      watch: false,
      max_memory_restart: '500M',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',

      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,
    }
  ]
};
