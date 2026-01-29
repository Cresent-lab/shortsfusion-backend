// server.js — ShortsFusion Backend API (stable)
// Express + Postgres + JWT + CORS + Routes (auth + videos)

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

// Services
const VideoGenerator = require("./services/videoGenerator");

// ----------------------------
// App
// ----------------------------
const app = express();
app.set("trust proxy", 1);

// ----------------------------
// CORS
// ----------------------------
const allowedOrigins = [
  "https://vidsora.io",
  "https://www.vidsora.io",
  "http://localhost:3000",
  "http://localhost:5173",
];

app.use(
  cors({
    origin: (origin, cb) => {
      // allow non-browser tools (no origin) like curl/postman
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked origin: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json({ limit: "2mb" }));

// ----------------------------
// DB
// ----------------------------
if (!process.env.DATABASE_URL) {
  console.warn("⚠️ DATABASE_URL is not set (Railway variables).");
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
});

// ----------------------------
// JWT
// ----------------------------
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn("⚠️ JWT_SECRET is not set. Set it in Railway Variables.");
}

// ----------------------------
// Auth middleware
// ----------------------------
function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) return res.status(401).json({ error: "No token provided" });

  try {
    const user = jwt.verify(token, JWT_SECRET);
    req.user = user;
    return next();
  } catch (e) {
    return res.status(403).json({ error: "Invalid token" });
  }
}

// ----------------------------
// Health
// ----------------------------
app.get("/", (req, res) => {
  res.json({ name: "ShortsFusion Backend API", status: "running" });
});

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: "ok", ts: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, db: "failed", error: e.message });
  }
});

// ----------------------------
// Mount routes
// ----------------------------
const videoGenerator = new VideoGenerator();

// auth.js expected signature can vary; we support both common patterns.
try {
  const authRoutes = require("./routes/auth");
  const mounted = typeof authRoutes === "function" ? authRoutes(pool, jwt, JWT_SECRET) : authRoutes;
  app.use("/api/auth", mounted);
} catch (e) {
  console.warn("⚠️ routes/auth not mounted:", e.message);
}

try {
  const videoRoutesFactory = require("./routes/video");
  const videoRoutes =
    typeof videoRoutesFactory === "function"
      ? videoRoutesFactory(pool, authenticateToken, videoGenerator)
      : videoRoutesFactory;

  app.use("/api/videos", videoRoutes);
} catch (e) {
  console.warn("⚠️ routes/video not mounted:", e.message);
}

// ----------------------------
// Error handling
// ----------------------------
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error", message: err.message });
});

app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ----------------------------
// Start
// ----------------------------
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 ShortsFusion Backend running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || "development"}`);
});

module.exports = app;
