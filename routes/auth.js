const express = require("express");
const jwt = require("jsonwebtoken");
const passport = require("passport");

function makeAuthRouter(pool) {
  const router = express.Router();

  // Start OAuth
  router.get(
    "/google",
    passport.authenticate("google", {
      scope: ["profile", "email"],
      session: false
    })
  );

  // OAuth callback
  router.get(
    "/google/callback",
    passport.authenticate("google", {
      session: false,
      failureRedirect: `${process.env.FRONTEND_URL}/?error=google_auth_failed`
    }),
    async (req, res) => {
      // passport puts user profile in req.user
      const profile = req.user;

      const googleId = profile?.id || null;
      const email = profile?.emails?.[0]?.value || null;
      const name = profile?.displayName || null;

      if (!googleId || !email) {
        return res.redirect(`${process.env.FRONTEND_URL}/?error=missing_google_profile`);
      }

      try {
        // Upsert user
        const upsertSql = `
          INSERT INTO users (google_id, email, name, tokens)
          VALUES ($1, $2, $3, COALESCE($4, 0))
          ON CONFLICT (email)
          DO UPDATE SET google_id = EXCLUDED.google_id, name = EXCLUDED.name
          RETURNING id, email, name, tokens;
        `;

        const result = await pool.query(upsertSql, [googleId, email, name, 0]);
        const user = result.rows[0];

        const token = jwt.sign(
          { userId: user.id, email: user.email },
          process.env.JWT_SECRET,
          { expiresIn: "7d" }
        );

        // Redirect back to frontend with token
        return res.redirect(`${process.env.FRONTEND_URL}/?token=${encodeURIComponent(token)}`);
      } catch (err) {
        console.error("Auth callback error:", err);
        return res.redirect(`${process.env.FRONTEND_URL}/?error=server_auth_error`);
      }
    }
  );

  // Who am I
  router.get("/me", async (req, res) => {
    const hdr = req.headers.authorization || "";
    const token = hdr.startsWith("Bearer ") ? hdr.slice("Bearer ".length) : null;

    if (!token) return res.status(401).json({ error: "Missing Bearer token" });

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);

      const r = await pool.query(
        "SELECT id, email, name, tokens, created_at FROM users WHERE id = $1",
        [payload.userId]
      );

      if (!r.rows[0]) return res.status(401).json({ error: "User not found" });
      return res.json({ user: r.rows[0] });
    } catch (err) {
      return res.status(401).json({ error: "Invalid token" });
    }
  });

  return router;
}

module.exports = { makeAuthRouter };
