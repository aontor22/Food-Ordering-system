import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();
router.use(requireAuth);

const empty = z.any();
const idParams = z.object({
  body: empty,
  params: z.object({ productId: z.string().trim().min(1).max(100) }),
  query: empty,
});
const syncSchema = z.object({
  body: z.object({ productIds: z.array(z.string().trim().min(1).max(100)).max(100) }),
  params: empty,
  query: empty,
});

const productSelect = {
  id: true,
  name: true,
  description: true,
  category: true,
  imageUrl: true,
  imagePublicId: true,
  priceCents: true,
  stock: true,
  isAvailable: true,
};

async function listWishlist(userId) {
  const items = await prisma.wishlistItem.findMany({
    where: { userId },
    include: { product: { select: productSelect } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  const productIds = items.map(item => item.productId);
  const ratings = productIds.length ? await prisma.review.groupBy({
    by: ['productId'],
    where: { status: 'PUBLISHED', productId: { in: productIds } },
    _avg: { rating: true },
    _count: { rating: true },
  }) : [];
  const ratingMap = new Map(ratings.map(row => [row.productId, {
    reviewRating: row._avg.rating || 0,
    reviewCount: row._count.rating || 0,
  }]));
  return items.map(item => ({
    ...item,
    product: {
      ...item.product,
      price: item.product.priceCents / 100,
      ...(ratingMap.get(item.productId) || { reviewRating: 0, reviewCount: 0 }),
    },
  }));
}

router.get('/', async (req, res) => {
  const items = await listWishlist(req.auth.sub);
  res.json({ items, count: items.length });
});

router.put('/:productId', validate(idParams), async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.validated.params.productId },
      select: { id: true, isAvailable: true },
    });
    if (!product?.isAvailable) throw new AppError(404, 'PRODUCT_NOT_AVAILABLE', 'This product is not available to save');

    const existing = await prisma.wishlistItem.findUnique({
      where: { userId_productId: { userId: req.auth.sub, productId: product.id } },
      select: { id: true },
    });
    if (!existing) {
      const savedCount = await prisma.wishlistItem.count({ where: { userId: req.auth.sub } });
      if (savedCount >= 200) throw new AppError(409, 'WISHLIST_LIMIT_REACHED', 'You can save up to 200 products');
    }

    const item = await prisma.wishlistItem.upsert({
      where: { userId_productId: { userId: req.auth.sub, productId: product.id } },
      update: {},
      create: { userId: req.auth.sub, productId: product.id },
    });
    res.json({ item, saved: true });
  } catch (error) { next(error); }
});

router.delete('/:productId', validate(idParams), async (req, res, next) => {
  try {
    await prisma.wishlistItem.deleteMany({ where: { userId: req.auth.sub, productId: req.validated.params.productId } });
    res.status(204).end();
  } catch (error) { next(error); }
});

router.post('/sync', validate(syncSchema), async (req, res, next) => {
  try {
    const productIds = [...new Set(req.validated.body.productIds)];
    if (productIds.length) {
      const available = await prisma.product.findMany({
        where: { id: { in: productIds }, isAvailable: true },
        select: { id: true },
      });
      await prisma.$transaction(available.map(product => prisma.wishlistItem.upsert({
        where: { userId_productId: { userId: req.auth.sub, productId: product.id } },
        update: {},
        create: { userId: req.auth.sub, productId: product.id },
      })));
    }
    const items = await listWishlist(req.auth.sub);
    res.json({ items, count: items.length });
  } catch (error) { next(error); }
});

export default router;
