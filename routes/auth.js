// routes/auth.js
const express = require("express");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");

/**
 * Auth routes factory (expects a pg Pool).
 * Mounted in server.js like:
 *   const authRoutes = require("./routes/auth");
 *   app.use("/api/auth", authRoutes(pool));
 */
module.exports = function authRoutes(pool) {
  const router = express.Router();

  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClient = googleClientId ? new OAuth2Client(googleClientId) : null;

  router.get("/health", (_req, res) => res.json({ ok: true }));

  /**
   * POST /api/auth/google
   *
   * Accepts either:
   *  A) { credential: "<google_id_token_jwt>" }   (recommended)
   *  B) { email, name, googleId, picture }        (fallback)
   */
  router.post("/google", async (req, res) => {
    try {
      if (!process.env.JWT_SECRET) {
        return res.status(500).json({ error: "JWT_SECRET is not set" });
      }

      let email, name, picture, googleId;

      const body = req.body || {};

      // A) Preferred: verify Google ID token (credential)
      if (body.credential) {
        if (!googleClient) {
          return res
            .status(500)
            .json({ error: "GOOGLE_CLIENT_ID is not set on backend" });
        }

        const ticket = await googleClient.verifyIdToken({
          idToken: body.credential,
          audience: googleClientId,
        });

        const payload = ticket.getPayload() || {};
        email = payload.email;
        name = payload.name || payload.given_name || null;
        picture = payload.picture || null;
        googleId = payload.sub || null; // Google user id
      } else {
        // B) Fallback: accept explicit fields
        email = body.email;
        name = body.name || null;
        picture = body.picture || null;
        googleId = body.googleId || null;
      }

      if (!email) {
        return res.status(400).json({
          error: "email is required",
          hint:
            "Frontend likely needs to send { credential } (Google ID token) OR { email, name, googleId, picture }",
        });
      }

      // Upsert user by email
      // NOTE: requires UNIQUE(email) on users table.
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
        [email, googleId, picture]
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
