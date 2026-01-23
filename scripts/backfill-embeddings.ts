/**
 * Backfill embeddings for existing pearls
 * Run with: bun run scripts/backfill-embeddings.ts
 */

import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

if (!OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY environment variable is required');
  process.exit(1);
}

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;
const BATCH_SIZE = 20;

const pool = new Pool({ connectionString: DATABASE_URL });

interface Pearl {
  id: string;
  title: string | null;
  content: string;
}

async function generateEmbedding(text: string): Promise<number[]> {
  const truncatedText = text.slice(0, 30000);

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: truncatedText,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${error}`);
  }

  const data = await response.json() as {
    data: Array<{ embedding: number[] }>;
  };

  return data.data[0].embedding;
}

function formatForPostgres(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

async function backfillEmbeddings() {
  const client = await pool.connect();

  try {
    console.log('Starting embedding backfill...');

    // Check if pgvector is available
    try {
      await client.query(`SELECT '[1,2,3]'::vector`);
    } catch (err) {
      console.error('pgvector extension not available:', err);
      process.exit(1);
    }

    // Get pearls without embeddings
    const result = await client.query<Pearl>(`
      SELECT id, title, content
      FROM pearls
      WHERE embedding IS NULL
      ORDER BY created_at DESC
    `);

    const pearls = result.rows;
    console.log(`Found ${pearls.length} pearls without embeddings`);

    if (pearls.length === 0) {
      console.log('Nothing to backfill!');
      return;
    }

    let processed = 0;
    let failed = 0;

    for (let i = 0; i < pearls.length; i += BATCH_SIZE) {
      const batch = pearls.slice(i, i + BATCH_SIZE);

      for (const pearl of batch) {
        try {
          const textToEmbed = pearl.title
            ? `${pearl.title}\n\n${pearl.content}`
            : pearl.content;

          const embedding = await generateEmbedding(textToEmbed);

          await client.query(
            `UPDATE pearls SET embedding = $1::vector WHERE id = $2`,
            [formatForPostgres(embedding), pearl.id]
          );

          processed++;
          console.log(`  ✓ Pearl ${pearl.id} (${processed}/${pearls.length})`);
        } catch (error) {
          failed++;
          console.error(`  ✗ Pearl ${pearl.id}: ${error}`);
        }

        // Rate limiting: ~3 requests per second
        await new Promise(resolve => setTimeout(resolve, 350));
      }

      console.log(`Batch complete: ${processed} processed, ${failed} failed`);
    }

    console.log(`\n✅ Backfill complete: ${processed} processed, ${failed} failed`);
  } finally {
    client.release();
    await pool.end();
  }
}

backfillEmbeddings().catch(error => {
  console.error('Backfill failed:', error);
  process.exit(1);
});
