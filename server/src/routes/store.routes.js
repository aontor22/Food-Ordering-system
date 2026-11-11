import { Router } from 'express';
import { getStoreAvailability } from '../services/store-availability.js';
import { listActiveDeliveryZones } from '../services/delivery-zones.js';
import { getFulfillmentOptions } from '../services/fulfillment-scheduling.js';

const router = Router();

router.get('/status', async (_req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ store: await getStoreAvailability() });
  } catch (error) { next(error); }
});


router.get('/fulfillment', async (_req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await getFulfillmentOptions());
  } catch (error) { next(error); }
});

router.get('/delivery-zones', async (_req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ zones: await listActiveDeliveryZones() });
  } catch (error) { next(error); }
});

export default router;
