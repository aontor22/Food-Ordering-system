import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { audit } from '../services/audit.js';

const router = Router();
const MAX_SAVED_ADDRESSES = 10;


async function addressTransaction(work, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await prisma.$transaction(work, { isolationLevel: 'Serializable' });
    } catch (error) {
      lastError = error;
      const retryable = ['P2034', 'P2002'].includes(error?.code);
      if (!retryable) throw error;
      if (attempt >= retries) throw new AppError(409, 'ADDRESS_CONFLICT', 'Saved addresses changed in another session. Refresh and try again.');
      await new Promise(resolve => setTimeout(resolve, 15 * (attempt + 1)));
    }
  }
  throw lastError;
}

const addressFields = {
  label: z.string().trim().min(1).max(30),
  firstName: z.string().trim().min(1).max(50),
  lastName: z.string().trim().min(1).max(50),
  phone: z.string().trim().min(7).max(24),
  street: z.string().trim().min(2).max(150),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  postalCode: z.string().trim().min(2).max(20),
  country: z.string().trim().min(2).max(80),
};
const createSchema = z.object({
  body: z.object({ ...addressFields, isDefault: z.boolean().optional().default(false) }),
  params: z.any(), query: z.any(),
});
const updateSchema = z.object({
  body: z.object(addressFields).partial().refine(value => Object.keys(value).length > 0, 'Provide at least one address field to update'),
  params: z.object({ id: z.string().min(1).max(100) }), query: z.any(),
});
const idSchema = z.object({ body: z.any(), params: z.object({ id: z.string().min(1).max(100) }), query: z.any() });

router.use(requireAuth);
router.use((_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  res.set('Pragma', 'no-cache');
  next();
});

router.get('/', async (req, res) => {
  const addresses = await prisma.savedAddress.findMany({
    where: { userId: req.auth.sub },
    orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }, { createdAt: 'desc' }],
  });
  res.json({ addresses, limit: MAX_SAVED_ADDRESSES });
});

router.post('/', validate(createSchema), async (req, res, next) => {
  try {
    const address = await addressTransaction(async tx => {
      const count = await tx.savedAddress.count({ where: { userId: req.auth.sub } });
      if (count >= MAX_SAVED_ADDRESSES) throw new AppError(409, 'ADDRESS_LIMIT_REACHED', `You can save up to ${MAX_SAVED_ADDRESSES} addresses`);
      const makeDefault = count === 0 || req.validated.body.isDefault === true;
      if (makeDefault) await tx.savedAddress.updateMany({ where: { userId: req.auth.sub, isDefault: true }, data: { isDefault: false } });
      return tx.savedAddress.create({
        data: { ...req.validated.body, isDefault: makeDefault, userId: req.auth.sub },
      });
    });
    await audit(req, 'SAVED_ADDRESS_CREATED', 'SavedAddress', address.id, { label: address.label, isDefault: address.isDefault });
    res.status(201).json({ address });
  } catch (error) { next(error); }
});

router.patch('/:id', validate(updateSchema), async (req, res, next) => {
  try {
    const current = await prisma.savedAddress.findFirst({ where: { id: req.validated.params.id, userId: req.auth.sub } });
    if (!current) throw new AppError(404, 'ADDRESS_NOT_FOUND', 'Saved address not found');
    const address = await prisma.savedAddress.update({ where: { id: current.id }, data: req.validated.body });
    await audit(req, 'SAVED_ADDRESS_UPDATED', 'SavedAddress', address.id, { label: address.label });
    res.json({ address });
  } catch (error) { next(error); }
});

router.put('/:id/default', validate(idSchema), async (req, res, next) => {
  try {
    const address = await addressTransaction(async tx => {
      const current = await tx.savedAddress.findFirst({ where: { id: req.validated.params.id, userId: req.auth.sub } });
      if (!current) throw new AppError(404, 'ADDRESS_NOT_FOUND', 'Saved address not found');
      if (current.isDefault) return current;
      await tx.savedAddress.updateMany({ where: { userId: req.auth.sub, isDefault: true }, data: { isDefault: false } });
      return tx.savedAddress.update({ where: { id: current.id }, data: { isDefault: true } });
    });
    await audit(req, 'SAVED_ADDRESS_DEFAULTED', 'SavedAddress', address.id, { label: address.label });
    res.json({ address });
  } catch (error) { next(error); }
});

router.delete('/:id', validate(idSchema), async (req, res, next) => {
  try {
    const deleted = await addressTransaction(async tx => {
      const current = await tx.savedAddress.findFirst({ where: { id: req.validated.params.id, userId: req.auth.sub } });
      if (!current) throw new AppError(404, 'ADDRESS_NOT_FOUND', 'Saved address not found');
      await tx.savedAddress.delete({ where: { id: current.id } });
      if (current.isDefault) {
        const replacement = await tx.savedAddress.findFirst({ where: { userId: req.auth.sub }, orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }] });
        if (replacement) await tx.savedAddress.update({ where: { id: replacement.id }, data: { isDefault: true } });
      }
      return current;
    });
    await audit(req, 'SAVED_ADDRESS_DELETED', 'SavedAddress', deleted.id, { label: deleted.label, wasDefault: deleted.isDefault });
    res.status(204).end();
  } catch (error) { next(error); }
});

export default router;
