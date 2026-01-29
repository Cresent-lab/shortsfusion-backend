// services/videoGenerator.js
// AI Video Generation Service

const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const FormData = require('form-data');
const Pipeline = require("./pipeline");


class VideoGenerator {
  constructor() {
    // Initialize AI clients
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    this.stabilityApiKey = process.env.STABILITY_API_KEY;
    this.elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
    this.creatomateApiKey = process.env.CREATOMATE_API_KEY;
    this.cloudinaryCloudName = process.env.CLOUDINARY_CLOUD_NAME;
    this.cloudinaryApiKey = process.env.CLOUDINARY_API_KEY;
    this.cloudinaryApiSecret = process.env.CLOUDINARY_API_SECRET;
  }

  /**
   * Main function to generate a complete video
   */
  async generateVideo(topic, visualStyle, duration) {
    console.log(`🎬 Starting video generation for: ${topic}`);

    try {
      // Step 1: Generate script with Claude
      const script = await this.generateScript(topic, duration);
      console.log('✅ Script generated');

      // Step 2: Parse script into scenes
      const scenes = await this.parseScriptIntoScenes(script, visualStyle);
      console.log(`✅ Parsed into ${scenes.length} scenes`);

      // Step 3: Generate images for each scene
      const imagesWithScenes = await this.generateImages(scenes, visualStyle);
      console.log('✅ Images generated');

      // Step 4: Generate voiceover
      const voiceoverUrl = await this.generateVoiceover(script.fullText);
      console.log('✅ Voiceover generated');

      // Step 5: Assemble video with Creatomate
      const videoUrl = await this.assembleVideo(imagesWithScenes, voiceoverUrl, duration);
      console.log('✅ Video assembled');

      // Step 6: Upload to Cloudinary
      const finalVideoUrl = await this.uploadToCloudinary(videoUrl);
      console.log('✅ Video uploaded');

      return {
        videoUrl: finalVideoUrl,
        script: script.fullText,
        scenes: scenes.length,
        duration
      };

    } catch (error) {
      console.error('❌ Video generation error:', error);
      throw error;
    }
  }

  /**
   * Step 1: Generate script using Claude
   */
  async generateScript(topic, duration) {
    const scenesCount = duration === 30 ? 3 : duration === 60 ? 5 : 7;

    const prompt = `You are a YouTube Shorts script writer. Create an engaging ${duration}-second script about: "${topic}"

Requirements:
- ${scenesCount} scenes (each ~${duration/scenesCount} seconds)
- Hook viewers in first 3 seconds
- Fast-paced, punchy sentences
- Include a call-to-action at the end
- Format as natural speech for voiceover
- Keep it conversational and energetic

Format your response as JSON:
{
  "hook": "Opening hook (first 3 seconds)",
  "scenes": [
    {
      "text": "Scene dialogue",
      "duration": seconds
    }
  ],
  "cta": "Call to action"
}`;

    const message = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    const responseText = message.content[0].text;
    
    // Parse JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Failed to parse script JSON');
    }

    const scriptData = JSON.parse(jsonMatch[0]);
    
    // Combine all text
    const fullText = [
      scriptData.hook,
      ...scriptData.scenes.map(s => s.text),
      scriptData.cta
    ].join(' ');

    return {
      ...scriptData,
      fullText
    };
  }

  /**
   * Step 2: Parse script into scenes with image prompts
   */
  async parseScriptIntoScenes(script, visualStyle) {
    const stylePrompts = {
      cinematic: 'cinematic movie-style, dramatic lighting, high quality',
      animated: 'cartoon animation style, vibrant colors, playful',
      realistic: 'photorealistic, detailed, natural lighting',
      minimal: 'minimalist design, clean, simple shapes, flat colors'
    };

    const prompt = `Given this video script, create a visual description for EACH scene that can be used to generate images.

Script scenes:
${script.scenes.map((s, i) => `Scene ${i + 1}: ${s.text}`).join('\n')}

Style: ${visualStyle} - ${stylePrompts[visualStyle]}

For each scene, create a detailed image prompt that:
- Describes what should be shown visually
- Matches the ${visualStyle} style
- Is suitable for AI image generation
- Avoids text/words in the image

Format as JSON:
{
  "scenes": [
    {
      "sceneNumber": 1,
      "text": "original scene text",
      "imagePrompt": "detailed visual description for image generation",
      "duration": seconds
    }
  ]
}`;

    const message = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    const responseText = message.content[0].text;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
      throw new Error('Failed to parse scenes JSON');
    }

    const scenesData = JSON.parse(jsonMatch[0]);
    return scenesData.scenes;
  }

  /**
   * Step 3: Generate images with Stability AI
   */
  async generateImages(scenes, visualStyle) {
    const imagePromises = scenes.map(async (scene, index) => {
      try {
        const response = await axios.post(
          'https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image',
          {
            text_prompts: [
              {
                text: scene.imagePrompt,
                weight: 1
              }
            ],
            cfg_scale: 7,
            height: 1024,
            width: 576, // 9:16 aspect ratio for vertical video
            samples: 1,
            steps: 30,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.stabilityApiKey}`,
            }
          }
        );

        const imageBase64 = response.data.artifacts[0].base64;
        const imageBuffer = Buffer.from(imageBase64, 'base64');

        // Upload to Cloudinary
        const imageUrl = await this.uploadImageToCloudinary(imageBuffer, `scene_${index}`);

        return {
          ...scene,
          imageUrl
        };

      } catch (error) {
        console.error(`Error generating image for scene ${index}:`, error.message);
        // Use placeholder if generation fails
        return {
          ...scene,
          imageUrl: 'https://via.placeholder.com/576x1024/667eea/ffffff?text=Scene+' + (index + 1)
        };
      }
    });

    return await Promise.all(imagePromises);
  }

  /**
   * Step 4: Generate voiceover with ElevenLabs
   */
  async generateVoiceover(text) {
    try {
      const response = await axios.post(
        'https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM', // Rachel voice
        {
          text: text,
          model_id: 'eleven_monolingual_v1',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75
          }
        },
        {
          headers: {
            'Accept': 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': this.elevenLabsApiKey
          },
          responseType: 'arraybuffer'
        }
      );

      // Upload audio to Cloudinary
      const audioBuffer = Buffer.from(response.data);
      const audioUrl = await this.uploadAudioToCloudinary(audioBuffer);

      return audioUrl;

    } catch (error) {
      console.error('Error generating voiceover:', error.message);
      throw error;
    }
  }

  /**
   * Step 5: Assemble video with Creatomate
   */
  async assembleVideo(scenes, voiceoverUrl, duration) {
    try {
      // Calculate timing for each scene
      const sceneDuration = duration / scenes.length;

      const elements = [];

      // Add background music (optional)
      // elements.push({
      //   type: 'audio',
      //   source: 'background-music-url',
      //   volume: 0.2,
      //   duration: duration
      // });

      // Add voiceover
      elements.push({
        type: 'audio',
        source: voiceoverUrl,
        volume: 1.0,
        duration: duration
      });

      // Add image scenes
      scenes.forEach((scene, index) => {
        const startTime = index * sceneDuration;
        
        elements.push({
          type: 'image',
          source: scene.imageUrl,
          x: '50%',
          y: '50%',
          width: '100%',
          height: '100%',
          fit: 'cover',
          time: startTime,
          duration: sceneDuration,
          animations: [
            {
              type: 'ken-burns',
              fade: true
            }
          ]
        });

        // Add text overlay
        elements.push({
          type: 'text',
          text: scene.text,
          x: '50%',
          y: '80%',
          width: '90%',
          height: 'auto',
          font_family: 'Montserrat',
          font_size: '48 px',
          font_weight: '700',
          text_align: 'center',
          fill_color: '#ffffff',
          stroke_color: '#000000',
          stroke_width: '4 px',
          time: startTime,
          duration: sceneDuration,
          animations: [
            {
              type: 'fade',
              duration: 0.5
            }
          ]
        });
      });

      // Create video with Creatomate
      const response = await axios.post(
        'https://api.creatomate.com/v1/renders',
        {
          template_id: null, // We're building from scratch
          modifications: {
            'width': 1080,
            'height': 1920, // 9:16 aspect ratio
            'duration': duration,
            'frame_rate': 30,
            'elements': elements
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.creatomateApiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const renderId = response.data.id;

      // Poll for completion
      const videoUrl = await this.pollCreatomateRender(renderId);

      return videoUrl;

    } catch (error) {
      console.error('Error assembling video:', error.message);
      throw error;
    }
  }

  /**
   * Poll Creatomate render status
   */
  async pollCreatomateRender(renderId, maxAttempts = 60) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await axios.get(
          `https://api.creatomate.com/v1/renders/${renderId}`,
          {
            headers: {
              'Authorization': `Bearer ${this.creatomateApiKey}`
            }
          }
        );

        const status = response.data.status;

        if (status === 'succeeded') {
          return response.data.url;
        } else if (status === 'failed') {
          throw new Error('Video render failed');
        }

        // Wait 5 seconds before next poll
        await new Promise(resolve => setTimeout(resolve, 5000));

      } catch (error) {
        console.error('Error polling render:', error.message);
        throw error;
      }
    }

    throw new Error('Video render timeout');
  }

  /**
   * Upload image to Cloudinary
   */
  async uploadImageToCloudinary(imageBuffer, filename) {
    const formData = new FormData();
    formData.append('file', imageBuffer, { filename: `${filename}.png` });
    formData.append('upload_preset', 'vidsora_images');

    const response = await axios.post(
      `https://api.cloudinary.com/v1_1/${this.cloudinaryCloudName}/image/upload`,
      formData,
      {
        headers: formData.getHeaders()
      }
    );

    return response.data.secure_url;
  }

  /**
   * Upload audio to Cloudinary
   */
  async uploadAudioToCloudinary(audioBuffer) {
    const formData = new FormData();
    formData.append('file', audioBuffer, { filename: 'voiceover.mp3' });
    formData.append('upload_preset', 'vidsora_audio');
    formData.append('resource_type', 'video');

    const response = await axios.post(
      `https://api.cloudinary.com/v1_1/${this.cloudinaryCloudName}/video/upload`,
      formData,
      {
        headers: formData.getHeaders()
      }
    );

    return response.data.secure_url;
  }

  /**
   * Upload final video to Cloudinary
   */
  async uploadToCloudinary(videoUrl) {
    const response = await axios.post(
      `https://api.cloudinary.com/v1_1/${this.cloudinaryCloudName}/video/upload`,
      {
        file: videoUrl,
        upload_preset: 'vidsora_videos'
      }
    );

    return response.data.secure_url;
  }
}
/**
 * ENTRY POINT FOR QUEUE WORKER
 * Worker should call ONLY this method
 */
async function generateFromVideoRow(videoRow) {
  const pipeline = new Pipeline({
    ai: module.exports.ai || this.ai,
    render: module.exports.render || this.render,
  });

  const { id, user_id, topic, style, duration } = videoRow;

  return pipeline.run({
    videoId: id,
    userId: user_id,
    topic,
    style,
    duration: Number(duration) || 60,
  });
}

module.exports = VideoGenerator;
