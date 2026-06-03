import { Router } from 'express';
import { getPerformanceMetrics } from '../controllers/performanceController.js';

const router = Router();

router.get('/performance', getPerformanceMetrics);

export default router;
