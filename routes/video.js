const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { generateScript, generateImages, regenerateImage, generateVoiceover } = require('../services/ai');
const { renderVideo } = require('../services/creatomate');
const db = require('../db');

// POST /api/video/generate - Initial video generation (costs 10 tokens upfront)
router.post('/generate', auth, async (req, res) => {
  try {
    const { topic, visualStyle, voice, duration } = req.body;
    const userId = req.user.id;

    // Validate input
    if (!topic || !visualStyle || !voice) {
      return res.status(400).json({ error: 'Missing required fields: topic, visualStyle, voice' });
    }

    // Check user has enough tokens (10 tokens for base generation)
    const user = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (user.rows[0].tokens_remaining < 10) {
      return res.status(400).json({ 
        error: 'Insufficient tokens. Please upgrade your plan.',
        tokensRequired: 10,
        tokensAvailable: user.rows[0].tokens_remaining
      });
    }

    // Deduct 10 tokens immediately
    await db.query(
      'UPDATE users SET tokens_remaining = tokens_remaining - 10 WHERE id = $1',
      [userId]
    );

    // Log token transaction
    await db.query(
      'INSERT INTO token_transactions (user_id, tokens_spent, action, created_at) VALUES ($1, $2, $3, NOW())',
      [userId, 10, 'video_generation_base']
    );

    // Create video record in database
    const videoResult = await db.query(
      `INSERT INTO videos (
        user_id, topic, visual_style, voice_type, duration, 
        status, base_tokens, additional_tokens, total_tokens, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW()) 
      RETURNING id`,
      [userId, topic, visualStyle, voice, duration || 60, 'generating', 10, 0, 10]
    );

    const videoId = videoResult.rows[0].id;

    // Generate script using Claude
    console.log('Generating script with Claude...');
    const scriptResult = await generateScript(topic, duration || 60);

    // Update video with script
    await db.query(
      'UPDATE videos SET narration_text = $1, updated_at = NOW() WHERE id = $2',
      [scriptResult.narrationText, videoId]
    );

    // Generate images for each scene using Stable Diffusion
    console.log('Generating images...');
    const imagePromises = scriptResult.scenes.map(async (scene, index) => {
      const imageUrl = await generateImages(scene.imagePrompt, visualStyle);
      
      // Insert slide into database
      await db.query(
        `INSERT INTO video_slides (
          video_id, scene_number, scene_text, image_prompt, 
          image_url, is_animated, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [videoId, index + 1, scene.text, scene.imagePrompt, imageUrl, false]
      );

      return {
        sceneNumber: index + 1,
        text: scene.text,
        imagePrompt: scene.imagePrompt,
        imageUrl: imageUrl,
        isAnimated: false
      };
    });

    const slides = await Promise.all(imagePromises);

    // Generate voiceover using ElevenLabs
    console.log('Generating voiceover...');
    const voiceoverUrl = await generateVoiceover(scriptResult.narrationText, voice);

    // Update video with voiceover URL
    await db.query(
      'UPDATE videos SET voiceover_url = $1, status = $2, updated_at = NOW() WHERE id = $3',
      [voiceoverUrl, 'preview_ready', videoId]
    );

    // Return video data for preview
    res.json({
      success: true,
      message: 'Video generated successfully! Preview your video and make any edits.',
      videoId: videoId,
      tokensSpent: 10,
      video: {
        id: videoId,
        topic: topic,
        narrationText: scriptResult.narrationText,
        voiceoverUrl: voiceoverUrl,
        slides: slides,
        status: 'preview_ready',
        baseTokens: 10,
        additionalTokens: 0,
        totalTokens: 10
      }
    });

  } catch (error) {
    console.error('Video generation error:', error);
    res.status(500).json({ 
      error: 'Failed to generate video', 
      details: error.message 
    });
  }
});

// POST /api/video/:videoId/regenerate-slide - Regenerate a specific slide image (FREE)
router.post('/:videoId/regenerate-slide', auth, async (req, res) => {
  try {
    const { videoId } = req.params;
    const { slideId } = req.body;
    const userId = req.user.id;

    // Verify video belongs to user
    const video = await db.query(
      'SELECT * FROM videos WHERE id = $1 AND user_id = $2',
      [videoId, userId]
    );

    if (video.rows.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Get slide details
    const slide = await db.query(
      'SELECT * FROM video_slides WHERE id = $1 AND video_id = $2',
      [slideId, videoId]
    );

    if (slide.rows.length === 0) {
      return res.status(404).json({ error: 'Slide not found' });
    }

    const slideData = slide.rows[0];
    const visualStyle = video.rows[0].visual_style;

    // Regenerate image with same prompt
    console.log('Regenerating image for slide:', slideId);
    const newImageUrl = await regenerateImage(slideData.image_prompt, visualStyle);

    // Update slide with new image
    await db.query(
      'UPDATE video_slides SET image_url = $1, updated_at = NOW() WHERE id = $2',
      [newImageUrl, slideId]
    );

    res.json({
      success: true,
      message: 'Image regenerated successfully',
      slide: {
        id: slideId,
        imageUrl: newImageUrl,
        sceneNumber: slideData.scene_number
      }
    });

  } catch (error) {
    console.error('Regenerate slide error:', error);
    res.status(500).json({ 
      error: 'Failed to regenerate slide', 
      details: error.message 
    });
  }
});

// POST /api/video/:videoId/animate-slide - Toggle animation for a slide (+2 tokens)
router.post('/:videoId/animate-slide', auth, async (req, res) => {
  try {
    const { videoId } = req.params;
    const { slideId, isAnimated } = req.body;
    const userId = req.user.id;

    // Verify video belongs to user
    const video = await db.query(
      'SELECT * FROM videos WHERE id = $1 AND user_id = $2',
      [videoId, userId]
    );

    if (video.rows.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Get slide
    const slide = await db.query(
      'SELECT * FROM video_slides WHERE id = $1 AND video_id = $2',
      [slideId, videoId]
    );

    if (slide.rows.length === 0) {
      return res.status(404).json({ error: 'Slide not found' });
    }

    const currentlyAnimated = slide.rows[0].is_animated;
    const tokenChange = isAnimated && !currentlyAnimated ? 2 : (currentlyAnimated && !isAnimated ? -2 : 0);

    // Update slide animation status
    await db.query(
      'UPDATE video_slides SET is_animated = $1, updated_at = NOW() WHERE id = $2',
      [isAnimated, slideId]
    );

    // Update video additional tokens
    if (tokenChange !== 0) {
      await db.query(
        'UPDATE videos SET additional_tokens = additional_tokens + $1, total_tokens = total_tokens + $2, updated_at = NOW() WHERE id = $3',
        [tokenChange, tokenChange, videoId]
      );
    }

    // Get updated video
    const updatedVideo = await db.query(
      'SELECT additional_tokens, total_tokens FROM videos WHERE id = $1',
      [videoId]
    );

    res.json({
      success: true,
      message: isAnimated ? 'Slide animation enabled (+2 tokens)' : 'Slide animation disabled (-2 tokens)',
      slide: {
        id: slideId,
        isAnimated: isAnimated
      },
      additionalTokens: updatedVideo.rows[0].additional_tokens,
      totalTokens: updatedVideo.rows[0].total_tokens
    });

  } catch (error) {
    console.error('Animate slide error:', error);
    res.status(500).json({ 
      error: 'Failed to toggle animation', 
      details: error.message 
    });
  }
});

// POST /api/video/:videoId/finalize - Finalize video and render with Creatomate
router.post('/:videoId/finalize', auth, async (req, res) => {
  try {
    const { videoId } = req.params;
    const userId = req.user.id;

    // Get video data
    const video = await db.query(
      'SELECT * FROM videos WHERE id = $1 AND user_id = $2',
      [videoId, userId]
    );

    if (video.rows.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const videoData = video.rows[0];

    if (videoData.status === 'completed') {
      return res.status(400).json({ error: 'Video already finalized' });
    }

    // Check if user has enough tokens for additional features
    const user = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
    const additionalTokensNeeded = videoData.additional_tokens;

    if (user.rows[0].tokens_remaining < additionalTokensNeeded) {
      return res.status(400).json({ 
        error: 'Insufficient tokens for finalization',
        required: additionalTokensNeeded,
        available: user.rows[0].tokens_remaining
      });
    }

    // Deduct additional tokens if any
    if (additionalTokensNeeded > 0) {
      await db.query(
        'UPDATE users SET tokens_remaining = tokens_remaining - $1 WHERE id = $2',
        [additionalTokensNeeded, userId]
      );

      // Log transaction
      await db.query(
        'INSERT INTO token_transactions (user_id, tokens_spent, action, video_id, created_at) VALUES ($1, $2, $3, $4, NOW())',
        [userId, additionalTokensNeeded, 'video_animation_extras', videoId]
      );
    }

    // Update video status to finalizing
    await db.query(
      'UPDATE videos SET status = $1, updated_at = NOW() WHERE id = $2',
      ['finalizing', videoId]
    );

    // Get all slides
    const slides = await db.query(
      'SELECT * FROM video_slides WHERE video_id = $1 ORDER BY scene_number',
      [videoId]
    );

    // Render video with Creatomate
    console.log('Rendering final video with Creatomate...');
    const renderResult = await renderVideo({
      slides: slides.rows,
      voiceoverUrl: videoData.voiceover_url,
      narrationText: videoData.narration_text,
      duration: videoData.duration
    });

    // Update video with final URL
    await db.query(
      `UPDATE videos 
       SET status = $1, 
           video_url = $2, 
           render_id = $3,
           completed_at = NOW(),
           updated_at = NOW()
       WHERE id = $4`,
      ['completed', renderResult.url, renderResult.id, videoId]
    );

    // Get final video data
    const finalVideo = await getVideoWithSlides(videoId);

    res.json({
      success: true,
      message: 'Video finalized successfully!',
      video: finalVideo,
      tokensSpent: videoData.total_tokens,
      videoUrl: renderResult.url
    });

  } catch (error) {
    console.error('Finalize video error:', error);
    
    // Update status to failed
    await db.query(
      'UPDATE videos SET status = $1, error_message = $2, updated_at = NOW() WHERE id = $3',
      ['failed', error.message, videoId]
    );

    res.status(500).json({ 
      error: 'Failed to finalize video', 
      details: error.message 
    });
  }
});

// GET /api/video/:videoId - Get video details with slides
router.get('/:videoId', auth, async (req, res) => {
  try {
    const { videoId } = req.params;
    const userId = req.user.id;

    const videoData = await getVideoWithSlides(videoId, userId);

    if (!videoData) {
      return res.status(404).json({ error: 'Video not found' });
    }

    res.json({ video: videoData });

  } catch (error) {
    console.error('Get video error:', error);
    res.status(500).json({ error: 'Failed to fetch video' });
  }
});

// GET /api/videos - Get user's videos
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const videos = await db.query(
      `SELECT 
        id, topic, visual_style, status, 
        base_tokens, additional_tokens, total_tokens,
        video_url, created_at, completed_at
       FROM videos 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 50`,
      [userId]
    );

    res.json({ videos: videos.rows });

  } catch (error) {
    console.error('Get videos error:', error);
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
});

// Helper function to get video with all slides
async function getVideoWithSlides(videoId, userId = null) {
  const query = userId 
    ? 'SELECT * FROM videos WHERE id = $1 AND user_id = $2'
    : 'SELECT * FROM videos WHERE id = $1';
  
  const params = userId ? [videoId, userId] : [videoId];
  
  const video = await db.query(query, params);

  if (video.rows.length === 0) {
    return null;
  }

  const slides = await db.query(
    'SELECT * FROM video_slides WHERE video_id = $1 ORDER BY scene_number',
    [videoId]
  );

  return {
    ...video.rows[0],
    slides: slides.rows
  };
}

module.exports = router;
