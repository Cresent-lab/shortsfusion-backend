// services/pipeline.js
//
// Pipeline orchestrates the full generation flow:
// 1) script
// 2) images
// 3) voiceover
// 4) render final video
//
// This file is intentionally structured so you can plug in your existing providers
// (Claude/Stability/ElevenLabs/Cloudinary/Creatomate) without rewriting worker logic.

class Pipeline {
  constructor({ ai, render }) {
    // ai: your AI layer (script/images/voice/storage)
    // render: your rendering layer (Creatomate)
    this.ai = ai;
    this.render = render;
  }

  /**
   * Run full pipeline. Returns urls + artifacts.
   * @param {object} input
   * @param {string} input.videoId
   * @param {string} input.userId
   * @param {string} input.topic
   * @param {string} input.style
   * @param {number} input.duration
   */
  async run({ videoId, userId, topic, style, duration }) {
    // 1) Script
    const script = await this.ai.generateScript({ topic, style, duration });

    // 2) Images (one per scene)
    // Expecting script.scenes = [{ prompt, ...}, ...]
    const images = await this.ai.generateImages({
      scenes: script.scenes,
      style,
      videoId,
      userId,
    });

    // 3) Voiceover
    const voice = await this.ai.generateVoiceover({
      scriptText: script.voiceoverText ?? script.text ?? "",
      videoId,
      userId,
    });

    // 4) Render final video
    const rendered = await this.render.renderVideo({
      videoId,
      topic,
      duration,
      images,
      voiceoverUrl: voice.voiceoverUrl,
      script,
    });

    return {
      script,
      images, // [{ sceneIndex, imageUrl, ... }]
      voiceoverUrl: voice.voiceoverUrl,
      videoUrl: rendered.videoUrl,
      thumbnailUrl: rendered.thumbnailUrl ?? null,
    };
  }
}

module.exports = Pipeline;
