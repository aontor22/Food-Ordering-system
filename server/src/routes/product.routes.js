import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { validate } from '../middleware/validate.js';

const router = Router();
const querySchema = z.object({ body: z.any(), params: z.any(), query: z.object({ category: z.string().max(50).optional(), search: z.string().max(100).optional() }) });
router.get('/', validate(querySchema), async (req, res) => {
  const { category, search } = req.validated.query;
  const products = await prisma.product.findMany({ where: { isAvailable: true, ...(category && category !== 'All' ? { category } : {}), ...(search ? { name: { contains: search } } : {}) }, orderBy: [{ category: 'asc' }, { name: 'asc' }] });
  res.json({ products: products.map(p => ({ ...p, price: p.priceCents / 100 })) });
});
router.get('/categories', async (_req, res) => {
  const values = await prisma.product.findMany({ where: { isAvailable: true }, distinct: ['category'], select: { category: true }, orderBy: { category: 'asc' } });
  res.json({ categories: values.map(v => v.category) });
});
export default router;
