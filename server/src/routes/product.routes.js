import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { validate } from '../middleware/validate.js';

const router = Router();
const querySchema = z.object({ body: z.any(), params: z.any(), query: z.object({ category: z.string().max(50).optional(), search: z.string().max(100).optional() }) });

router.get('/', validate(querySchema), async (req, res) => {
  const { category, search } = req.validated.query;
  const products = await prisma.product.findMany({ where: { isAvailable: true, ...(category && category !== 'All' ? { category } : {}), ...(search ? { name: { contains: search } } : {}) }, orderBy: [{ category: 'asc' }, { name: 'asc' }] });
  const ratings = products.length ? await prisma.review.groupBy({
    by: ['productId'],
    where: { status: 'PUBLISHED', productId: { in: products.map(product => product.id) } },
    _avg: { rating: true },
    _count: { rating: true },
  }) : [];
  const ratingMap = new Map(ratings.map(row => [row.productId, { reviewRating: row._avg.rating || 0, reviewCount: row._count.rating || 0 }]));
  res.json({ products: products.map(product => ({ ...product, price: product.priceCents / 100, ...(ratingMap.get(product.id) || { reviewRating: 0, reviewCount: 0 }) })) });
});

router.get('/categories', async (_req, res) => {
  const values = await prisma.product.findMany({ where: { isAvailable: true }, distinct: ['category'], select: { category: true }, orderBy: { category: 'asc' } });
  res.json({ categories: values.map(v => v.category) });
});

router.get('/:id/reviews', async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, isAvailable: true } });
    if (!product?.isAvailable) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    const [reviews, summary] = await Promise.all([
      prisma.review.findMany({
        where: { productId: product.id, status: 'PUBLISHED' },
        select: { id: true, rating: true, comment: true, createdAt: true, user: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.review.aggregate({ where: { productId: product.id, status: 'PUBLISHED' }, _avg: { rating: true }, _count: { rating: true } }),
    ]);
    res.json({ product, averageRating: summary._avg.rating || 0, reviewCount: summary._count.rating || 0, reviews });
  } catch (error) { next(error); }
});

export default router;
