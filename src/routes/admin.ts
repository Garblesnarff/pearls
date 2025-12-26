import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { db } from '../db/client.js';
import { threads, pearls, threadAccess } from '../db/schema/index.js';
import { eq, desc, count } from 'drizzle-orm';

const router = Router();

// All admin routes require admin auth
router.use(requireAdmin);

// List all threads with stats
router.get('/threads', async (_req, res) => {
  try {
    const allThreads = await db.select().from(threads).orderBy(threads.name);

    const threadsWithStats = await Promise.all(
      allThreads.map(async (thread) => {
        const pearlCount = await db
          .select({ count: count() })
          .from(pearls)
          .where(eq(pearls.threadId, thread.id));

        return {
          ...thread,
          pearlCount: pearlCount[0]?.count || 0,
        };
      })
    );

    res.json({ threads: threadsWithStats });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Get pearls in a thread
router.get('/threads/:slug/pearls', async (req, res) => {
  try {
    const { slug } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const thread = await db
      .select()
      .from(threads)
      .where(eq(threads.slug, slug))
      .limit(1);

    if (!thread[0]) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }

    const threadPearls = await db
      .select()
      .from(pearls)
      .where(eq(pearls.threadId, thread[0].id))
      .orderBy(desc(pearls.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({ thread: thread[0], pearls: threadPearls });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Get single pearl
router.get('/pearls/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const pearl = await db
      .select()
      .from(pearls)
      .where(eq(pearls.id, id))
      .limit(1);

    if (!pearl[0]) {
      res.status(404).json({ error: 'Pearl not found' });
      return;
    }

    res.json({ pearl: pearl[0] });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Delete pearl
router.delete('/pearls/:id', async (req, res) => {
  try {
    const { id } = req.params;

    await db.delete(pearls).where(eq(pearls.id, id));

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// Get system stats
router.get('/stats', async (_req, res) => {
  try {
    const threadCount = await db.select({ count: count() }).from(threads);
    const pearlCount = await db.select({ count: count() }).from(pearls);

    res.json({
      threads: threadCount[0]?.count || 0,
      pearls: pearlCount[0]?.count || 0,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export default router;
