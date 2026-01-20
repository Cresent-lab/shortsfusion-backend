js
// force redeploy: ensure /api/auth/me is deployed
const express = require('express');
const router = express.Router();
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../db');

// Initialize Google OAuth client
const googleClient = new OAuth2Client({
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: process.env.GOOGLE_REDIRECT_URI || `${process.env.BACKEND_URL}/api/auth/google/callback`
});

// POST /api/auth/register - Regular email/password registration
router.post('/register', async (req, res) => {
  try {
    const { email, password, fullName } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Check if user already exists
    const existing = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create user with free plan tokens
    const result = await db.query(
      `INSERT INTO users (email, password_hash, full_name, tokens_remaining, subscription_plan, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id, email, full_name, tokens_remaining, subscription_plan`,
      [email, passwordHash, fullName || null, 10, 'free'] // 10 free tokens
    );

    const user = result.rows[0];

    // Generate JWT
    const token = jwt.sign(
      { user: { id: user.id, email: user.email } },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        tokensRemaining: user.tokens_remaining,
        subscriptionPlan: user.subscription_plan
      }
    });

  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// POST /api/auth/login - Regular email/password login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Find user
    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // Check if user signed up with Google
    if (!user.password_hash) {
      return res.status(400).json({ error: 'Please sign in with Google' });
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    await db.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    // Generate JWT
    const token = jwt.sign(
      { user: { id: user.id, email: user.email } },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        tokensRemaining: user.tokens_remaining,
        subscriptionPlan: user.subscription_plan
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// GET /api/auth/me - Get current user info
router.get('/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const result = await db.query('SELECT id, email, full_name, tokens_remaining, subscription_plan FROM users WHERE id = $1', [decoded.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
});

// GET /api/auth/google - Initiate Google OAuth flow
router.get('/google', (req, res) => {
  const authUrl = googleClient.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile'
    ],
    redirect_uri: process.env.GOOGLE_REDIRECT_URI || `${process.env.BACKEND_URL}/api/auth/google/callback`
  });

  res.redirect(authUrl);
});

// GET /api/auth/google/callback - Handle Google OAuth callback
router.get('/google/callback', async (req, res) => {
  try {
    const { code } = req.query;

    if (!code) {
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_code`);
    }

    // Exchange code for tokens
    const { tokens } = await googleClient.getToken(code);
    googleClient.setCredentials(tokens);

    // Get user info from Google
    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const { email, name, picture } = payload;

    // Check if user exists
    let result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    let user;

    if (result.rows.length === 0) {
      // Create new user
      result = await db.query(
        `INSERT INTO users (email, full_name, google_id, profile_picture, tokens_remaining, subscription_plan, created_at, last_login)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         RETURNING id, email, full_name, tokens_remaining, subscription_plan`,
        [email, name, payload.sub, picture, 10, 'free'] // 10 free tokens for new Google users
      );
      user = result.rows[0];
    } else {
      user = result.rows[0];
      
      // Update last login and Google info if not set
      await db.query(
        'UPDATE users SET last_login = NOW(), google_id = COALESCE(google_id, $1), profile_picture = COALESCE(profile_picture, $2) WHERE id = $3',
        [payload.sub, picture, user.id]
      );
    }

    // Generate JWT
    const token = jwt.sign(
      { user: { id: user.id, email: user.email } },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    // Redirect to frontend with token
    res.redirect(`${process.env.FRONTEND_URL}/?token=${token}`);

  } catch (error) {
    console.error('Google OAuth error:', error);
    res.redirect(`${process.env.FRONTEND_URL}/login?error=oauth_failed`);
  }
});

// POST /api/auth/google/mobile - Handle Google OAuth from mobile/SPA (receives auth code from frontend)
router.post('/google/mobile', async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ error: 'ID token required' });
    }

    // Verify the ID token
    const ticket = await googleClient.verifyIdToken({
      idToken: idToken,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const { email, name, picture } = payload;

    // Check if user exists
    let result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    let user;

    if (result.rows.length === 0) {
      // Create new user
      result = await db.query(
        `INSERT INTO users (email, full_name, google_id, profile_picture, tokens_remaining, subscription_plan, created_at, last_login)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         RETURNING id, email, full_name, tokens_remaining, subscription_plan`,
        [email, name, payload.sub, picture, 10, 'free']
      );
      user = result.rows[0];
    } else {
      user = result.rows[0];
      
      // Update last login
      await db.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);
    }

    // Generate JWT
    const token = jwt.sign(
      { user: { id: user.id, email: user.email } },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        tokensRemaining: user.tokens_remaining,
        subscriptionPlan: user.subscription_plan
      }
    });

  } catch (error) {
    console.error('Google mobile auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

module.exports = router;

