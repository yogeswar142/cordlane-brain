import { Router } from 'express';
import { requireAdminAuth } from '../../middleware/auth';
import { getPulse, impersonateBot, getGlobalInsights, postNews, triggerManualAggregation } from '../../controllers/admin.controller';

const router = Router();

// All admin routes require master key authentication
router.use(requireAdminAuth);

/**
 * @route GET /api/v1/admin/pulse
 * @desc  Fetch real-time infrastructure health and EPS metrics
 */
router.get('/pulse', getPulse);
router.post('/impersonate', impersonateBot);
router.get('/insights', getGlobalInsights);
router.post('/news', postNews);
router.post('/maintenance/aggregate', triggerManualAggregation);

export default router;
