// worker.js — BullMQ Worker for ShortsFusion
require("dotenv").config();

const express = require("express");
const { Pool } = require("pg");
const { Worker } = require("bullmq");
const IORedis = require("ioredis");

const VideoGenerator = require("./services/videoGenerator");

// ---- ENV checks
if (!process.env.DATABASE_URL) console.warn("⚠️ DATABASE_URL missing");
if (!process.env.REDIS_URL) console.warn("⚠️ REDIS_URL missing");

// ---- DB
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
});

// ---- Redis
const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

// ---- Video generator
const videoGenerator = new VideoGenerator();

// ---- Worker
const worker = new Worker(
  "videoQueue",
  async (job) => {
    console.log(`🧵 Job received: ${job.name} (${job.id})`, job.data);

    const { videoId } = job.data;
    if (!videoId) throw new Error("Missing videoId in job.data");

    // Load video row
    const v = await pool.query("SELECT * FROM videos WHERE id=$1", [videoId]);
    if (!v.rows.length) throw new Error(`Video not found: ${videoId}`);

    const videoRow = v.rows[0];

    // Mark processing
    await pool.query("UPDATE videos SET status='processing' WHERE id=$1", [videoId]);

    // Run generation (your service method)
    await videoGenerator.generateFromVideoRow(videoRow, { pool });

    console.log(`✅ Job complete: ${job.id} videoId=${videoId}`);
    return { ok: true };
  },
  { connection }
);

worker.on("completed", (job) => console.log(`✅ completed ${job.id}`));
worker.on("failed", (job, err) => console.error(`❌ failed ${job?.id}`, err));

// ---- Keepalive health server (important on Railway)
const app = express();
app.get("/health", (req, res) => res.json({ ok: true, service: "worker" }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🩺 Worker health listening on ${PORT}`));

console.log("👷 Worker started. Listening for jobs on queue: videoQueue");
