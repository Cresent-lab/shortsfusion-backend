// worker.js
// ShortsFusion async video generation worker

require("dotenv").config();

const { Worker } = require("bullmq");
const IORedis = require("ioredis");
const { Pool } = require("pg");

const VideoGenerator = require("./services/videoGenerator");

// --------------------
// Redis connection
// --------------------
const redis = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

// --------------------
// Database
// --------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// --------------------
// Video generator
// --------------------
const videoGenerator = new VideoGenerator();

// --------------------
// Worker
// --------------------
const worker = new Worker(
  "videoQueue",
  async (job) => {
    const { videoId, userId } = job.data;

    console.log("🎬 Processing job", {
      jobId: job.id,
      videoId,
      userId,
    });

    const client = await pool.connect();

    try {
      // Mark video as processing
      await client.query(
        "UPDATE videos SET status='processing' WHERE id=$1",
        [videoId]
      );

      // Generate video (this is your heavy AI logic)
      const result = await videoGenerator.generate(videoId, userId);

      // Save results
      await client.query(
        `
        UPDATE videos
        SET status='completed',
            video_url=$2,
            thumbnail_url=$3
        WHERE id=$1
        `,
        [videoId, result.videoUrl, result.thumbnailUrl]
      );

      console.log("✅ Video completed", videoId);

      return { success: true };
    } catch (err) {
      console.error("❌ Worker error:", err);

      await client.query(
        "UPDATE videos SET status='failed' WHERE id=$1",
        [videoId]
      );

      throw err;
    } finally {
      client.release();
    }
  },
  {
    connection: redis,
    concurrency: 2,
  }
);

// --------------------
// Lifecycle logs
// --------------------
worker.on("ready", () => {
  console.log("🚀 Worker is ready and waiting for jobs");
});

worker.on("failed", (job, err) => {
  console.error(`❌ Job ${job.id} failed`, err);
});

worker.on("completed", (job) => {
  console.log(`🎉 Job ${job.id} completed`);
});
