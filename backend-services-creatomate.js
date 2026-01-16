const axios = require('axios');

// Creatomate API configuration
const CREATOMATE_API_KEY = process.env.CREATOMATE_API_KEY;
const CREATOMATE_API_URL = 'https://api.creatomate.com/v1';

if (!CREATOMATE_API_KEY) {
  console.error('WARNING: CREATOMATE_API_KEY not set in environment variables');
}

/**
 * Render video using Creatomate API
 * @param {Object} videoData - Video data containing slides, voiceover, etc.
 * @returns {Promise<Object>} - Rendered video URL and render ID
 */
async function renderVideo(videoData) {
  try {
    const { slides, voiceoverUrl, narrationText, duration } = videoData;

    // Calculate timing for each slide
    const slideDuration = duration / slides.length;

    // Build Creatomate composition
    const composition = buildComposition(slides, voiceoverUrl, slideDuration);

    // Create render request
    const response = await axios.post(
      `${CREATOMATE_API_URL}/renders`,
      {
        template_id: null, // We're using a dynamic composition
        modifications: composition
      },
      {
        headers: {
          'Authorization': `Bearer ${CREATOMATE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const renderId = response.data.id;

    // Poll for render completion
    const renderResult = await pollRenderStatus(renderId);

    return {
      id: renderId,
      url: renderResult.url,
      status: renderResult.status
    };

  } catch (error) {
    console.error('Creatomate render error:', error.response?.data || error.message);
    throw new Error(`Failed to render video: ${error.response?.data?.message || error.message}`);
  }
}

/**
 * Build Creatomate composition from slides
 */
function buildComposition(slides, voiceoverUrl, slideDuration) {
  const elements = [];
  let currentTime = 0;

  // Add voiceover audio track
  elements.push({
    type: 'audio',
    source: voiceoverUrl,
    time: 0,
    duration: null, // Use full audio duration
    volume: 1.0
  });

  // Add each slide as an image element
  slides.forEach((slide, index) => {
    const imageElement = {
      type: 'image',
      source: slide.image_url,
      time: currentTime,
      duration: slideDuration,
      width: '100%',
      height: '100%',
      fit: 'cover'
    };

    // Add animation if enabled
    if (slide.is_animated) {
      imageElement.animations = [
        {
          type: 'scale',
          fade: false,
          easing: 'linear',
          start: '0%',
          end: '100%',
          scope: 'element',
          from: 1.0,
          to: 1.2 // Ken Burns zoom effect
        }
      ];
    }

    // Add fade transition
    imageElement.animations = imageElement.animations || [];
    imageElement.animations.push(
      {
        type: 'fade',
        fade: true,
        easing: 'linear',
        start: '0%',
        end: '5%',
        scope: 'element'
      },
      {
        type: 'fade',
        fade: true,
        easing: 'linear',
        start: '95%',
        end: '100%',
        scope: 'element'
      }
    );

    elements.push(imageElement);

    // Add caption/subtitle for this slide
    const captionElement = {
      type: 'text',
      text: slide.scene_text,
      time: currentTime,
      duration: slideDuration,
      x: '50%',
      y: '85%',
      width: '90%',
      height: 'auto',
      x_alignment: '50%',
      y_alignment: '50%',
      fill_color: '#FFFFFF',
      font_family: 'Montserrat',
      font_weight: '700',
      font_size: '48px',
      text_align: 'center',
      stroke_color: '#000000',
      stroke_width: '4px',
      animations: [
        {
          type: 'fade',
          fade: true,
          easing: 'cubic-out',
          start: '0%',
          end: '10%',
          scope: 'element'
        },
        {
          type: 'fade',
          fade: true,
          easing: 'cubic-in',
          start: '90%',
          end: '100%',
          scope: 'element'
        }
      ]
    };

    elements.push(captionElement);

    currentTime += slideDuration;
  });

  return {
    output_format: 'mp4',
    width: 1080,
    height: 1920, // Vertical format for shorts
    frame_rate: 30,
    duration: null, // Auto-calculate from elements
    elements: elements
  };
}

/**
 * Poll render status until complete
 */
async function pollRenderStatus(renderId, maxAttempts = 60, interval = 5000) {
  let attempts = 0;

  while (attempts < maxAttempts) {
    try {
      const response = await axios.get(
        `${CREATOMATE_API_URL}/renders/${renderId}`,
        {
          headers: {
            'Authorization': `Bearer ${CREATOMATE_API_KEY}`
          }
        }
      );

      const status = response.data.status;

      if (status === 'succeeded') {
        return {
          url: response.data.url,
          status: 'completed'
        };
      } else if (status === 'failed') {
        throw new Error('Render failed: ' + (response.data.error || 'Unknown error'));
      }

      // Still rendering, wait and try again
      await sleep(interval);
      attempts++;

    } catch (error) {
      console.error('Poll render status error:', error.message);
      throw error;
    }
  }

  throw new Error('Render timeout: Maximum polling attempts reached');
}

/**
 * Get render status
 */
async function getRenderStatus(renderId) {
  try {
    const response = await axios.get(
      `${CREATOMATE_API_URL}/renders/${renderId}`,
      {
        headers: {
          'Authorization': `Bearer ${CREATOMATE_API_KEY}`
        }
      }
    );

    return {
      id: renderId,
      status: response.data.status,
      url: response.data.url,
      progress: response.data.progress
    };

  } catch (error) {
    console.error('Get render status error:', error.response?.data || error.message);
    throw new Error(`Failed to get render status: ${error.message}`);
  }
}

/**
 * Cancel a render
 */
async function cancelRender(renderId) {
  try {
    await axios.delete(
      `${CREATOMATE_API_URL}/renders/${renderId}`,
      {
        headers: {
          'Authorization': `Bearer ${CREATOMATE_API_KEY}`
        }
      }
    );

    return { success: true, message: 'Render cancelled' };

  } catch (error) {
    console.error('Cancel render error:', error.response?.data || error.message);
    throw new Error(`Failed to cancel render: ${error.message}`);
  }
}

// Helper function
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  renderVideo,
  getRenderStatus,
  cancelRender
};
