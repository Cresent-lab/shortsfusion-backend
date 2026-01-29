// services/pipeline.js
class Pipeline {
  constructor({ videoGenerator, pool }) {
    this.videoGenerator = videoGenerator;
    this.pool = pool;
  }

  async run({ videoId, userId, topic, style, duration }) {
    // This is the "orchestrator". Replace method names as needed.

    // 1) Generate script
    const script = await this.videoGenerator.generateScript(topic, duration);

    // 2) Images
    const images = await this.videoGenerator.generateImages(script, style);

    // 3) Voiceover
    const voiceUrl = await this.videoGenerator.generateVoiceover(script);

    // 4) Render video
    const videoUrl = await this.videoGenerator.renderVideo({
      script,
      images,
      voiceUrl,
      duration,
    });

    // 5) Persist results
    await this.pool.query(
      `UPDATE videos
       SET status='completed', script=$2, video_url=$3, thumbnail_url=$4
       WHERE id=$1`,
      [videoId, JSON.stringify(script), videoUrl, images?.[0] || null]
    );

    return { videoUrl };
  }
}

module.exports = Pipeline;
