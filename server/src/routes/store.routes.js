import { Router } from 'express';
import { getStoreAvailability } from '../services/store-availability.js';

const router = Router();

router.get('/status', async (_req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ store: await getStoreAvailability() });
  } catch (error) { next(error); }
});

export default router;
