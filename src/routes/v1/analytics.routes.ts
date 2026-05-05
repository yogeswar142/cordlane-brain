import { Router } from 'express';
import { requireApiKey } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { trackCommandSchema, guildCountSchema, heartbeatSchema, trackBatchSchema, checkFollowSchema } from '../../validators/schemas';
import { trackCommand, legacyTrackUser, postGuildCount, heartbeat, trackBatch, getBotSummary, searchBots, checkFollow } from '../../controllers/analytics.controller';

const router = Router();

// Public routes (no API key required)
router.get('/search', searchBots);

// Apply the API Key middleware to all subsequent analytics routes
router.use(requireApiKey);

// Routes with Zod validation middleware applied before controllers
router.get('/bot/:id/summary', getBotSummary);
router.post('/track-command', validate(trackCommandSchema), trackCommand);
router.post('/track-user', legacyTrackUser); // Legacy Support — returns 200 OK
router.post('/guild-count', validate(guildCountSchema), postGuildCount);
router.post('/heartbeat', validate(heartbeatSchema), heartbeat);
router.post('/track-batch', validate(trackBatchSchema), trackBatch);
router.post('/check-follow', validate(checkFollowSchema), checkFollow);

export default router;
