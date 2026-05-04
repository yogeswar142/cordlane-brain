import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import analyticsRoutes from './routes/v1/analytics.routes';
import authRoutes from './routes/v1/auth.routes';
import adminRoutes from './routes/v1/admin.routes';
import { errorHandler } from './middleware/errorHandler';
import { rateLimiter } from './middleware/rateLimiter';

const app = express();

// Middleware
app.use(helmet()); // Security headers
app.use(cors()); // Allow cross-origin requests
app.use(express.json({ limit: '10mb' })); // Parse JSON bodies with increased limit
// Define a custom token for the Bot Name
morgan.token('bot-name', (req: any) => {
  return req.bot ? req.bot.name : 'Unknown/NoBot';
});

// Use custom logging format that includes the bot name
app.use(morgan(':method :url :status :response-time ms - :res[content-length] [:bot-name]'));
// Rate limiter: 120 requests/minute per API key
app.use('/api/v1', rateLimiter(120, 60_000));

// Backward compatibility: Catch unversioned legacy or incorrect endpoint calls
app.post('/track-batch', (req, res) => {
  res.redirect(307, '/api/v1/track-batch');
});

// API Routes
app.use('/api/v1', analyticsRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/admin', adminRoutes);

// Basic health check route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// Global error handler (MUST be last)
app.use(errorHandler);

export default app;
