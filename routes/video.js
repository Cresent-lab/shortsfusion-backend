const express = require('express');
const router = express.Router();
const { videoQueue } = require("../queue");


module.exports = (pool, authenticateToken, videoGenerator) => {
  
  // ============================================
  // VIDEO GENERATION ROUTE
  // ============================================
router.post("/generate", authenticateToken, async (req, res) => {
  const { topic, visualStyle, duration } = req.body;
  const userId = req.user.id;

  if (!topic || !visualStyle || !duration) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const styleCosts = { cinematic: 5, animated: 5, realistic: 5, minimal: 3 };
  const durationCosts = { 30: 3, 60: 5, 90: 7 };

  const totalCost =
    (styleCosts[visualStyle] || 0) +
    (durationCosts[Number(duration)] || 0);

  if (!totalCost) {
    return res.status(400).json({ error: "Invalid visualStyle or duration" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock user row to prevent double-spend
    const u = await client.query(
      "SELECT tokens FROM users WHERE id=$1 FOR UPDATE",
      [userId]
    );

    if (!u.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "User not found" });
    }

    const tokens = u.rows[0].tokens ?? 0;
    if (tokens < totalCost) {
      await client.query("ROLLBACK");
      return res.status(402).json({
        error: "Insufficient tokens",
        required: totalCost,
        available: tokens,
      });
    }

    // Create video row immediately

const v = await client.query(
  `INSERT INTO videos (user_id, topic, style, status)
   VALUES ($1, $2, $3, 'queued')
   RETURNING *;`,
  [userId, topic, visualStyle]
);


    const video = v.rows[0];

    // Deduct tokens
    await client.query(
      "UPDATE users SET tokens=tokens-$1 WHERE id=$2",
      [totalCost, userId]
    );

    // Token ledger (idempotent)
    await client.query(
      `INSERT INTO token_ledger (user_id, delta, reason, video_id, idempotency_key)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [userId, -totalCost, "GENERATE_VIDEO", video.id, `gen:${userId}:${video.id}`]
    );

    await client.query("COMMIT");

    // Enqueue job AFTER commit
    await videoQueue.add(
      "generate_video",
      {
        type: "generate_video",
        videoId: video.id,
        userId,
        topic,
        visualStyle,
        duration: Number(duration),
      },
      { attempts: 3, backoff: { type: "exponential", delay: 8000 } }
    );

    return res.json({
      video: {
        id: video.id,
        topic: video.topic,
        visualStyle: video.visual_style,
        duration: video.duration,
        status: video.status,
        createdAt: video.created_at,
      },
      tokensUsed: totalCost,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Generate enqueue error:", err);
    return res.status(500).json({ error: "Failed to enqueue generation" });
  } finally {
    client.release();
  }
});


  // ============================================
  // GET USER'S VIDEOS
  // ============================================
  router.get('/', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;

      const result = await pool.query(
        'SELECT * FROM videos WHERE user_id = $1 ORDER BY created_at DESC',
        [userId]
      );

      res.json({ videos: result.rows });

    } catch (error) {
      console.error('Get videos error:', error);
      res.status(500).json({ error: 'Failed to fetch videos' });
    }
  });

  // ============================================
  // GET SINGLE VIDEO
  // ============================================
  router.get('/:id', authenticateToken, async (req, res) => {
    try {
      const videoId = req.params.id;
      const userId = req.user.id;

      const result = await pool.query(
        'SELECT * FROM videos WHERE id = $1 AND user_id = $2',
        [videoId, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Video not found' });
      }

      res.json({ video: result.rows[0] });

    } catch (error) {
      console.error('Get video error:', error);
      res.status(500).json({ error: 'Failed to fetch video' });
    }
  });

  return router;
};
