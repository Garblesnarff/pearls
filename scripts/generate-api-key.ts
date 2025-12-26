import crypto from 'crypto';
import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL required');
  process.exit(1);
}

const name = process.argv[2];
const userId = process.argv[3];
const roles = process.argv[4]?.split(',') || ['authenticated'];

if (!name) {
  console.log('Usage: bun run scripts/generate-api-key.ts <name> [user_id] [roles]');
  console.log('Example: bun run scripts/generate-api-key.ts "Rob CLI" user_01KARG... admin,aurora:member');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

async function generateKey() {
  const client = await pool.connect();

  try {
    // Create api_keys table if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        key_prefix TEXT NOT NULL,
        user_id TEXT,
        roles TEXT[] NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_used_at TIMESTAMPTZ,
        disabled BOOLEAN NOT NULL DEFAULT false
      )
    `);

    // Generate key
    const rawKey = `pearl_${crypto.randomBytes(24).toString('base64url')}`;
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.substring(0, 12);

    // Insert
    await client.query(`
      INSERT INTO api_keys (name, key_hash, key_prefix, user_id, roles)
      VALUES ($1, $2, $3, $4, $5)
    `, [name, keyHash, keyPrefix, userId || null, roles]);

    console.log('\n✅ API Key Generated\n');
    console.log('Name:', name);
    console.log('User ID:', userId || '(none)');
    console.log('Roles:', roles.join(', '));
    console.log('\n🔑 API Key (save this - it won\'t be shown again):\n');
    console.log(`   ${rawKey}`);
    console.log('\n📋 Use in MCP config:\n');
    console.log(JSON.stringify({
      mcpServers: {
        pearls: {
          type: 'url',
          url: 'https://pearls.infiniterealms.tech/mcp',
          headers: {
            Authorization: `Bearer ${rawKey}`
          }
        }
      }
    }, null, 2));
    console.log('');
  } finally {
    client.release();
    await pool.end();
  }
}

generateKey().catch(console.error);
