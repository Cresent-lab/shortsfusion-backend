// ShortsFusion AI - Backend API

const express = require('express');
const cors = require('cors');

const videoRoutes = require('./routes/video');
const authRoutes = require('./routes/auth');

const app = express();

/**
 * CORS
 * - Uses CORS_ORIGIN env var (comma-separated) if present
 * - Otherwise allows known frontends + local dev
 */
const allowedOrigins = (
  process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',')
    : [
        'https://shortsfusion-frontend.vercel.app',
        'https://shortsfusion-frontend-h7m29211f-shahbazs-projects-de4d64c7.vercel.app',
        'https://vidsora.io',
        'https://www.vidsora.io',
        'http://localhost:3000',
        'http://localhost:5173',
      ]
).map(s => s.trim()).filter(Boolean);

const corsOptions = {
  origin: (origin, cb) => {
    // Allow server-to-server / curl / Postman (no Origin header)
    if (!origin) return cb(null, true);

    if (allowedOrigins.includes(origin)) return cb(null, true);

    // IMPORTANT: Returning an error here can show up as a CORS failure in browser.
    // This is fine for security; for debugging you can log it.
    console.warn('CORS blocked for origin:', origin);
    return cb(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // preflight

// Body parsing (must be AFTER cors)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/video', videoRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'shortsfusion-backend',
  });
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`ShortsFusion API running on port ${PORT}`);
  console.log(`Allowed origins: ${allowedOrigins.join(', ')}`);
});

module.exports = app;
