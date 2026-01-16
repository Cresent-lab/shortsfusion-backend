// ShortsFusion AI - Backend API
// This is a starter template - you'll need to add your API keys and complete the implementation

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const videoRoutes = require('./routes/video');

const app = express();
// Video routes configured

// Middleware
app.use(cors());
app.use(express.json());

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// ============================================
// AUTHENTICATION ROUTES
// ============================================

// Register new user
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check if user exists
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, plan, videos_limit) 
       VALUES ($1, $2, 'free', 3) 
       RETURNING id, email, plan, videos_created, videos_limit`,
      [email, hashedPassword]
    );

    const user = result.rows[0];

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, user });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // Check password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        plan: user.plan,
        videos_created: user.videos_created,
        videos_limit: user.videos_limit
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, plan, videos_created, videos_limit FROM users WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// ============================================
// VIDEO GENERATION ROUTES
// ============================================

// Generate video
app.post('/api/videos/generate', authenticateToken, async (req, res) => {
  try {
    const { script, topic, style, voice } = req.body;

    // Get user's current video count
    const userResult = await pool.query(
      'SELECT videos_created, videos_limit FROM users WHERE id = $1',
      [req.user.id]
    );

    const user = userResult.rows[0];

    // Check if user has reached limit
    if (user.videos_created >= user.videos_limit) {
      return res.status(403).json({ 
        error: 'Video limit reached. Please upgrade your plan.' 
      });
    }

    // Create video record
    const videoResult = await pool.query(
      `INSERT INTO videos (user_id, script, topic, style, voice, status) 
       VALUES ($1, $2, $3, $4, $5, 'processing') 
       RETURNING id`,
      [req.user.id, script, topic, style, voice]
    );

    const videoId = videoResult.rows[0].id;

    // Start video generation in background
    generateVideo(videoId, { script, topic, style, voice });

    // Increment user's video count
    await pool.query(
      'UPDATE users SET videos_created = videos_created + 1 WHERE id = $1',
      [req.user.id]
    );

    res.json({
      video_id: videoId,
      status: 'processing',
      message: 'Video generation started'
    });
  } catch (error) {
    console.error('Video generation error:', error);
    res.status(500).json({ error: 'Failed to start video generation' });
  }
});

// Get video status
app.get('/api/videos/:id/status', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT id, status, video_url, thumbnail_url, created_at 
       FROM videos 
       WHERE id = $1 AND user_id = $2`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }

    res.json({ video: result.rows[0] });
  } catch (error) {
    console.error('Get video status error:', error);
    res.status(500).json({ error: 'Failed to get video status' });
  }
});

// Get user's videos
app.get('/api/videos', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, topic, style, status, video_url, thumbnail_url, created_at 
       FROM videos 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT 50`,
      [req.user.id]
    );

    res.json({ videos: result.rows });
  } catch (error) {
    console.error('Get videos error:', error);
    res.status(500).json({ error: 'Failed to get videos' });
  }
});

// ============================================
// SUBSCRIPTION ROUTES
// ============================================

// Create checkout session
app.post('/api/subscription/create-checkout', authenticateToken, async (req, res) => {
  try {
    const { plan } = req.body;

    if (!['basic', 'pro'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    const priceId = plan === 'basic' 
      ? process.env.STRIPE_PRICE_BASIC 
      : process.env.STRIPE_PRICE_PRO;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price: priceId,
        quantity: 1,
      }],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/cancel`,
      customer_email: req.user.email,
      metadata: {
        user_id: req.user.id,
        plan: plan
      }
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Create checkout error:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Cancel subscription
app.post('/api/subscription/cancel', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT stripe_subscription_id FROM subscriptions WHERE user_id = $1 AND status = $2',
      [req.user.id, 'active']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    const subscriptionId = result.rows[0].stripe_subscription_id;

    await stripe.subscriptions.cancel(subscriptionId);

    await pool.query(
      'UPDATE subscriptions SET status = $1 WHERE stripe_subscription_id = $2',
      ['cancelled', subscriptionId]
    );

    await pool.query(
      'UPDATE users SET plan = $1, videos_limit = $2 WHERE id = $3',
      ['free', 3, req.user.id]
    );

    res.json({ message: 'Subscription cancelled successfully' });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// Stripe webhook
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata.user_id;
        const plan = session.metadata.plan;

        // Update user's plan
        const videosLimit = plan === 'basic' ? 30 : 999;
        await pool.query(
          'UPDATE users SET plan = $1, videos_limit = $2 WHERE id = $3',
          [plan, videosLimit, userId]
        );

        // Create subscription record
        await pool.query(
          `INSERT INTO subscriptions (user_id, stripe_subscription_id, plan, status)
           VALUES ($1, $2, $3, $4)`,
          [userId, session.subscription, plan, 'active']
        );

        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;

        // Update subscription status
        await pool.query(
          'UPDATE subscriptions SET status = $1 WHERE stripe_subscription_id = $2',
          ['cancelled', subscription.id]
        );

        // Downgrade user to free
        const subResult = await pool.query(
          'SELECT user_id FROM subscriptions WHERE stripe_subscription_id = $1',
          [subscription.id]
        );

        if (subResult.rows.length > 0) {
          await pool.query(
            'UPDATE users SET plan = $1, videos_limit = $2 WHERE id = $3',
            ['free', 3, subResult.rows[0].user_id]
          );
        }

        break;
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook handling error:', error);
    res.status(500).json({ error: 'Webhook handling failed' });
  }
});

// ============================================
// VIDEO GENERATION FUNCTION (Background Process)
// ============================================

async function generateVideo(videoId, params) {
  try {
    const { script, topic, style, voice } = params;

    // Step 1: Generate script if topic provided
    let finalScript = script;
    if (topic && !script) {
      finalScript = await generateScriptWithClaude(topic);
    }

    // Step 2: Parse script into scenes
    const scenes = parseScriptIntoScenes(finalScript);

    // Step 3: Generate images for each scene
    const images = await generateImagesWithStableDiffusion(scenes, style);

    // Step 4: Generate voiceover
    const audioUrl = await generateVoiceoverWithElevenLabs(finalScript, voice);

    // Step 5: Assemble video with FFmpeg
    const videoUrl = await assembleVideoWithFFmpeg(images, audioUrl, finalScript);

    // Step 6: Upload to CDN and update database
    await pool.query(
      'UPDATE videos SET status = $1, video_url = $2 WHERE id = $3',
      ['completed', videoUrl, videoId]
    );

    console.log(`Video ${videoId} generated successfully`);
  } catch (error) {
    console.error(`Video generation failed for ${videoId}:`, error);
    
    await pool.query(
      'UPDATE videos SET status = $1 WHERE id = $2',
      ['failed', videoId]
    );
  }
}

// Helper functions (you need to implement these with actual API calls)
async function generateScriptWithClaude(topic) {
  // TODO: Implement Claude API call
  // See SETUP_GUIDE.md for example
  return `Sample script about ${topic}...`;
}

function parseScriptIntoScenes(script) {
  // TODO: Split script into 4-6 scenes
  const sentences = script.split('. ');
  const scenesPerPart = Math.ceil(sentences.length / 5);
  
  const scenes = [];
  for (let i = 0; i < sentences.length; i += scenesPerPart) {
    scenes.push(sentences.slice(i, i + scenesPerPart).join('. '));
  }
  
  return scenes;
}

async function generateImagesWithStableDiffusion(scenes, style) {
  // TODO: Implement Stable Diffusion API calls
  // See SETUP_GUIDE.md for example
  return scenes.map((scene, i) => `/tmp/scene_${i}.png`);
}

async function generateVoiceoverWithElevenLabs(script, voice) {
  // TODO: Implement ElevenLabs API call
  // See SETUP_GUIDE.md for example
  return '/tmp/voiceover.mp3';
}

async function assembleVideoWithFFmpeg(images, audioUrl, script) {
  // TODO: Implement FFmpeg video assembly
  // See SETUP_GUIDE.md for example
  return 'https://cdn.yoursite.com/video_123.mp4';
}
}
// =============================================
// VIDEO GENERATION ROUTES
// =============================================
app.use('/api/video', videoRoutes);
// ============================================
// START SERVER
// ============================================

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`ShortsFusion API running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
