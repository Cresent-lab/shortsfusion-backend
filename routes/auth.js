// routes/auth.js
const express = require("express");
const jwt = require("jsonwebtoken");

/**
 * Auth routes factory (expects a pg Pool).
 * Mounted in server.js like:
 *   const authRoutes = require("./routes/auth");
 *   app.use("/api/auth", authRoutes(pool));
 */
module.exports = function authRoutes(pool) {
  const router = express.Router();

  // Health check (optional but useful)
  router.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  /**
   * POST /api/auth/google
   * Expects JSON body like:
   *   { email, name, googleId, picture }
   *
   * NOTE: This is not the full OAuth "code exchange" flow.
   * It's the endpoint your frontend calls after it already got Google user info.
   */
  router.post("/google", async (req, res) => {
    try {
      const { email, name, googleId, picture } = req.body || {};

      if (!email) {
        return res.status(400).json({ error: "email is required" });
      }

      if (!process.env.JWT_SECRET) {
        return res.status(500).json({ error: "JWT_SECRET is not set" });
      }

      // Ensure users table has: id uuid, email unique, google_id text unique (optional), profile_picture text (optional)
      // Your schema screenshot showed: users.id uuid, users.google_id text, users.profile_picture text, users.tokens int default 10
      const upsert = await pool.query(
        `
        INSERT INTO users (email, plan, videos_created, videos_limit, created_at, google_id, profile_picture, last_login)
        VALUES ($1, 'free', 0, 3, NOW(), $2, $3, NOW())
        ON CONFLICT (email)
        DO UPDATE SET
          google_id = COALESCE(EXCLUDED.google_id, users.google_id),
          profile_picture = COALESCE(EXCLUDED.profile_picture, users.profile_picture),
          last_login = NOW()
        RETURNING id, email, plan, videos_created, videos_limit, tokens, google_id, profile_picture, created_at, last_login
        `,
        [email, googleId || null, picture || null]
      );

      const user = upsert.rows[0];

      const token = jwt.sign(
        { userId: user.id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );

      return res.json({ token, user });
    } catch (err) {
      console.error("POST /api/auth/google error:", err);
      return res.status(500).json({ error: "Auth failed" });
    }
  });

  return router;
};
