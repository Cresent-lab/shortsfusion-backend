const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const cloudinary = require('cloudinary').v2;

// API Keys
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const STABILITY_API_KEY = process.env.STABILITY_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: ANTHROPIC_API_KEY
});

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// API endpoints
const STABILITY_API_URL = 'https://api.stability.ai/v2beta/stable-image/generate/sd3';
const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';

/**
 * Generate video script using Claude
 * @param {string} topic - Video topic
 * @param {number} duration - Video duration in seconds
 * @returns {Promise<Object>} - Script with scenes and narration
 */
async function generateScript(topic, duration = 60) {
  try {
    const numScenes = Math.floor(duration / 10); // ~10 seconds per scene

    const prompt = `You are a YouTube Shorts script writer. Create an engaging ${duration}-second video script about: "${topic}"

Requirements:
- Create exactly ${numScenes} scenes
- Each scene should be 8-12 seconds
- Write concise, punchy narration (conversational tone)
- Each scene needs a detailed image prompt for AI image generation
- Make it engaging and viral-worthy

Format your response as JSON:
{
  "narrationText": "Full narration text for voiceover",
  "scenes": [
    {
      "sceneNumber": 1,
      "text": "Caption text to display",
      "narration": "What the voiceover says",
      "imagePrompt": "Detailed prompt for AI image generation"
    }
  ]
}

Image prompt guidelines:
- Be specific and detailed
- Include style, lighting, composition
- Describe the main subject clearly
- Add mood and atmosphere
- Example: "A futuristic city skyline at sunset, neon lights reflecting off glass buildings, cyberpunk aesthetic, dramatic lighting, wide angle shot, highly detailed, 8k quality"`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    // Parse Claude's response
    const responseText = message.content[0].text;
    
    // Extract JSON from response (handle markdown code blocks)
    let jsonText = responseText;
    if (responseText.includes('```json')) {
      jsonText = responseText.split('```json')[1].split('```')[0].trim();
    } else if (responseText.includes('```')) {
      jsonText = responseText.split('```')[1].split('```')[0].trim();
    }

    const scriptData = JSON.parse(jsonText);

    return {
      narrationText: scriptData.narrationText,
      scenes: scriptData.scenes
    };

  } catch (error) {
    console.error('Script generation error:', error);
    throw new Error(`Failed to generate script: ${error.message}`);
  }
}

/**
 * Generate images using Stable Diffusion
 * @param {string} prompt - Image generation prompt
 * @param {string} style - Visual style preset
 * @returns {Promise<string>} - Image URL
 */
async function generateImages(prompt, style = 'cinematic') {
  try {
    // Style presets
    const stylePresets = {
      'cinematic': 'cinematic, film grain, dramatic lighting, 8k',
      'anime': 'anime style, vibrant colors, detailed, high quality',
      'realistic': 'photorealistic, high detail, professional photography, 8k',
      'cartoon': 'cartoon style, colorful, fun, vibrant',
      'cyberpunk': 'cyberpunk, neon, futuristic, dark, moody',
      '3d': '3D render, unreal engine, octane render, highly detailed'
    };

    const styleModifier = stylePresets[style] || stylePresets['cinematic'];
    const fullPrompt = `${prompt}, ${styleModifier}`;

    const formData = new FormData();
    formData.append('prompt', fullPrompt);
    formData.append('output_format', 'png');
    formData.append('aspect_ratio', '9:16'); // Vertical for shorts

    const response = await axios.post(
      STABILITY_API_URL,
      formData,
      {
        headers: {
          'Authorization': `Bearer ${STABILITY_API_KEY}`,
          'Accept': 'application/json'
        },
        validateStatus: undefined
      }
    );

    if (response.status !== 200) {
      throw new Error(`Stability API error: ${response.status} - ${JSON.stringify(response.data)}`);
    }

    // Stability API returns base64 image data
    const imageBase64 = response.data.image;
    
    // Upload to Cloudinary
    const imageUrl = await uploadImageToCloudinary(imageBase64);

    return imageUrl;

  } catch (error) {
    console.error('Image generation error:', error.response?.data || error.message);
    throw new Error(`Failed to generate image: ${error.message}`);
  }
}

/**
 * Regenerate a single image (same function but logged separately)
 */
async function regenerateImage(prompt, style = 'cinematic') {
  console.log('Regenerating image with prompt:', prompt);
  return generateImages(prompt, style);
}

/**
 * Generate voiceover using ElevenLabs
 * @param {string} text - Text to convert to speech
 * @param {string} voiceId - Voice ID or preset name
 * @returns {Promise<string>} - Audio file URL
 */
async function generateVoiceover(text, voiceId = 'default') {
  try {
    // Voice ID mapping
    const voiceMap = {
      'default': 'pNInz6obpgDQGcFmaJgB', // Adam
      'male-1': 'pNInz6obpgDQGcFmaJgB', // Adam
      'male-2': 'yoZ06aMxZJJ28mfd3POQ', // Sam
      'female-1': 'EXAVITQu4vr4xnSDxMaL', // Sarah
      'female-2': 'cgSgspJ2msm6clMCkdW9', // Jessica
      'british': 'iP95p4xoKVk53GoZ742B', // Chris (British)
    };

    const selectedVoiceId = voiceMap[voiceId] || voiceMap['default'];

    const response = await axios.post(
      `${ELEVENLABS_API_URL}/text-to-speech/${selectedVoiceId}`,
      {
        text: text,
        model_id: 'eleven_turbo_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.5,
          use_speaker_boost: true
        }
      },
      {
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg'
        },
        responseType: 'arraybuffer'
      }
    );

    // Upload audio to Cloudinary
    const audioUrl = await uploadAudioToCloudinary(response.data);

    return audioUrl;

  } catch (error) {
    console.error('Voiceover generation error:', error.response?.data || error.message);
    throw new Error(`Failed to generate voiceover: ${error.message}`);
  }
}

/**
 * Upload image to Cloudinary
 * @param {string} imageBase64 - Base64 encoded image
 * @returns {Promise<string>} - Public URL
 */
async function uploadImageToCloudinary(imageBase64) {
  try {
    const result = await cloudinary.uploader.upload(
      `data:image/png;base64,${imageBase64}`,
      {
        folder: 'shortsfusion/images',
        resource_type: 'image'
      }
    );
    
    console.log('Image uploaded to Cloudinary:', result.secure_url);
    return result.secure_url;
    
  } catch (error) {
    console.error('Cloudinary image upload error:', error);
    throw new Error(`Failed to upload image: ${error.message}`);
  }
}

/**
 * Upload audio to Cloudinary
 * @param {Buffer} audioBuffer - Audio data buffer
 * @returns {Promise<string>} - Public URL
 */
async function uploadAudioToCloudinary(audioBuffer) {
  try {
    // Convert buffer to base64
    const base64Audio = audioBuffer.toString('base64');
    
    const result = await cloudinary.uploader.upload(
      `data:audio/mp3;base64,${base64Audio}`,
      {
        folder: 'shortsfusion/audio',
        resource_type: 'video', // Cloudinary uses 'video' resource type for audio
        format: 'mp3'
      }
    );
    
    console.log('Audio uploaded to Cloudinary:', result.secure_url);
    return result.secure_url;
    
  } catch (error) {
    console.error('Cloudinary audio upload error:', error);
    throw new Error(`Failed to upload audio: ${error.message}`);
  }
}

/**
 * Get available voices from ElevenLabs
 */
async function getAvailableVoices() {
  try {
    const response = await axios.get(
      `${ELEVENLABS_API_URL}/voices`,
      {
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY
        }
      }
    );

    return response.data.voices;

  } catch (error) {
    console.error('Get voices error:', error);
    throw new Error(`Failed to fetch voices: ${error.message}`);
  }
}

module.exports = {
  generateScript,
  generateImages,
  regenerateImage,
  generateVoiceover,
  getAvailableVoices
};
