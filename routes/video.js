const express = require('express');
const router = express.Router();

module.exports = (pool, authenticateToken, videoGenerator) => {
  
  // ============================================
  // VIDEO GENERATION ROUTE
  // ============================================
  router.post('/generate', authenticateToken, async (req, res) => {
    try {
      const { topic, visualStyle, duration } = req.body;
      const userId = req.user.id;

      // Validate inputs
      if (!topic || !visualStyle || !duration) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Calculate token cost
      const styleCosts = {
        cinematic: 5,
        animated: 5,
        realistic: 5,
        minimal: 3
      };

      const durationCosts = {
        30: 3,
        60: 5,
        90: 7
      };

      const totalCost = styleCosts[visualStyle] + durationCosts[duration];

      // Check user's token balance
      const userResult = await pool.query(
        'SELECT tokens FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const userTokens = userResult.rows[0].tokens;

      if (userTokens < totalCost) {
        return res.status(400).json({ 
          error: 'Insufficient tokens',
          required: totalCost,
          available: userTokens
        });
      }

      // Deduct tokens
      await pool.query(
        'UPDATE users SET tokens = tokens - $1 WHERE id = $2',
        [totalCost, userId]
      );

      // Generate video (this takes 2-3 minutes)
      console.log(`🎬 Starting video generation for user ${userId}`);
      
      const videoData = await videoGenerator.generateVideo(topic, visualStyle, duration);

      // Save video to database
      const videoResult = await pool.query(
        `INSERT INTO videos (user_id, topic, visual_style, duration, video_url, status, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, NOW()) 
         RETURNING *`,
        [userId, topic, visualStyle, duration, videoData.videoUrl, 'completed']
      );

      const video = videoResult.rows[0];

      // Get updated user token balance
      const updatedUser = await pool.query(
        'SELECT tokens FROM users WHERE id = $1',
        [userId]
      );

      res.json({
        video: {
          id: video.id,
          topic: video.topic,
          visualStyle: video.visual_style,
          duration: video.duration,
          videoUrl: video.video_url,
          createdAt: video.created_at
        },
        tokensUsed: totalCost,
        tokensRemaining: updatedUser.rows[0].tokens
      });

    } catch (error) {
      console.error('Video generation error:', error);
      
      // Refund tokens on error
      try {
        const { visualStyle, duration } = req.body;
        const styleCosts = { cinematic: 5, animated: 5, realistic: 5, minimal: 3 };
        const durationCosts = { 30: 3, 60: 5, 90: 7 };
        const totalCost = styleCosts[visualStyle] + durationCosts[duration];

        await pool.query(
          'UPDATE users SET tokens = tokens + $1 WHERE id = $2',
          [totalCost, req.user.id]
        );
        console.log(`Refunded ${totalCost} tokens to user ${req.user.id}`);
      } catch (refundError) {
        console.error('Failed to refund tokens:', refundError);
      }

      res.status(500).json({ 
        error: 'Video generation failed',
        message: error.message 
      });
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
