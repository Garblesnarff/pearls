import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

async function migrate() {
  const client = await pool.connect();

  try {
    console.log('Running Pearls database migration...');

    await client.query('BEGIN');

    // Enable UUID extension if not exists
    await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    console.log('  ✓ UUID extension enabled');

    // Create threads table
    await client.query(`
      CREATE TABLE IF NOT EXISTS threads (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        is_public BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('  ✓ threads table created');

    // Create indexes for threads
    await client.query(`CREATE INDEX IF NOT EXISTS idx_threads_slug ON threads(slug)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_threads_public ON threads(is_public)`);
    console.log('  ✓ threads indexes created');

    // Create pearls table
    await client.query(`
      CREATE TABLE IF NOT EXISTS pearls (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        title TEXT,
        content TEXT NOT NULL,
        metadata JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by TEXT,
        instance_id TEXT,
        in_reply_to UUID REFERENCES pearls(id) ON DELETE SET NULL
      )
    `);
    console.log('  ✓ pearls table created');

    // Create indexes for pearls
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pearls_thread ON pearls(thread_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pearls_created ON pearls(created_at DESC)`);
    console.log('  ✓ pearls indexes created');

    // Create FTS index (using generated column approach for better performance)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pearls_fts ON pearls
      USING GIN(to_tsvector('english', COALESCE(title, '') || ' ' || content))
    `);
    console.log('  ✓ pearls full-text search index created');

    // Feature: Pearl Types
    await client.query(`ALTER TABLE pearls ADD COLUMN IF NOT EXISTS pearl_type TEXT`);
    await client.query(`ALTER TABLE pearls ADD COLUMN IF NOT EXISTS authorship_type TEXT`);
    console.log('  ✓ pearl_type and authorship_type columns added');

    // Feature: Pearl Status/Corrections
    await client.query(`ALTER TABLE pearls ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'`);
    await client.query(`ALTER TABLE pearls ADD COLUMN IF NOT EXISTS parent_pearl UUID REFERENCES pearls(id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_pearls_status ON pearls(status)`);
    console.log('  ✓ status and parent_pearl columns added');

    // Feature: Vector Search (pgvector)
    try {
      await client.query(`CREATE EXTENSION IF NOT EXISTS vector`);
      await client.query(`ALTER TABLE pearls ADD COLUMN IF NOT EXISTS embedding vector(1536)`);
      // Use HNSW index for better performance on smaller datasets
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_pearls_embedding ON pearls
        USING hnsw (embedding vector_cosine_ops)
      `);
      console.log('  ✓ pgvector extension and embedding column added');
    } catch (error) {
      console.log('  ⚠ pgvector not available - vector search will be disabled');
    }

    // Create thread_access table
    await client.query(`
      CREATE TABLE IF NOT EXISTS thread_access (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        permission TEXT NOT NULL CHECK (permission IN ('read', 'write', 'admin')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(thread_id, role, permission)
      )
    `);
    console.log('  ✓ thread_access table created');

    // Create index for thread_access
    await client.query(`CREATE INDEX IF NOT EXISTS idx_access_thread_role ON thread_access(thread_id, role)`);
    console.log('  ✓ thread_access index created');

    // Create updated_at trigger function
    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    // Add trigger to threads (drop first if exists to avoid conflicts)
    await client.query(`DROP TRIGGER IF EXISTS threads_updated_at ON threads`);
    await client.query(`
      CREATE TRIGGER threads_updated_at
        BEFORE UPDATE ON threads
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at()
    `);
    console.log('  ✓ updated_at trigger created');

    await client.query('COMMIT');
    console.log('\n✅ Migration completed successfully!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error('Migration error:', error);
  process.exit(1);
});
