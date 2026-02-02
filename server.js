require("dotenv").config();

const express = require("express");
const cors = require("cors");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;

const { pool } = require("./db");
const { makeAuthRouter } = require("./routes/auth");

const app = express();

// CORS for Vercel frontend
app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: false
  })
);

app.use(express.json());

// Health check
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", db: "ok" });
  } catch (e) {
    res.status(500).json({ status: "ok", db: "error" });
  }
});

// Passport Google strategy (no sessions)
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL
    },
    async (accessToken, refreshToken, profile, done) => {
      // Just pass profile through; we upsert in callback route
      return done(null, profile);
    }
  )
);

app.use(passport.initialize());

// ✅ Auth base path (this is the one you’ll hit)
app.use("/api/auth", makeAuthRouter(pool));

// Root
app.get("/", (req, res) => {
  res.json({ status: "running" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});
