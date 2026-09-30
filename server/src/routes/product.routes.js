import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { validate } from '../middleware/validate.js';
import { publicProductCustomizationInclude, serializeProductForClient } from '../services/product-customizations.js';
import { DIETARY_FILTERS, PRODUCT_SORTS, dietaryWhere, enrichDiscoveryMetrics, normalizeDietaryFilters, sortDiscoveredProducts } from '../services/product-discovery.js';

const router = Router();
const optionalMoney = z.coerce.number().min(0).max(100000).optional();
const querySchema = z.object({
  body: z.any(),
  params: z.any(),
  query: z.object({
    category: z.string().trim().max(50).optional(),
    search: z.string().trim().max(100).optional(),
    dietary: z.string().trim().max(120).optional(),
    sort: z.enum(PRODUCT_SORTS).optional(),
    minPrice: optionalMoney,
    maxPrice: optionalMoney,
    minRating: z.coerce.number().min(0).max(5).optional(),
  }).superRefine((value, ctx) => {
    if (value.minPrice !== undefined && value.maxPrice !== undefined && value.minPrice > value.maxPrice) {
      ctx.addIssue({ code: 'custom', path: ['maxPrice'], message: 'Maximum price must be greater than or equal to minimum price' });
    }
  }),
});

function priceWhere(minPrice, maxPrice) {
  if (minPrice === undefined && maxPrice === undefined) return {};
  return {
    priceCents: {
      ...(minPrice !== undefined ? { gte: Math.round(minPrice * 100) } : {}),
      ...(maxPrice !== undefined ? { lte: Math.round(maxPrice * 100) } : {}),
    },
  };
}

router.get('/', validate(querySchema), async (req, res) => {
  const { category, search, dietary, sort = 'RECOMMENDED', minPrice, maxPrice, minRating } = req.validated.query;
  const dietaryFilters = normalizeDietaryFilters(dietary);
  const query = search?.trim();
  const products = await prisma.product.findMany({
    where: {
      isAvailable: true,
      ...(category && category !== 'All' ? { category: { equals: category, mode: 'insensitive' } } : {}),
      ...dietaryWhere(dietaryFilters),
      ...priceWhere(minPrice, maxPrice),
      ...(query ? {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { category: { contains: query, mode: 'insensitive' } },
          {
            optionGroups: {
              some: {
                isArchived: false,
                isAvailable: true,
                OR: [
                  { name: { contains: query, mode: 'insensitive' } },
                  { options: { some: { isArchived: false, isAvailable: true, name: { contains: query, mode: 'insensitive' } } } },
                ],
              },
            },
          },
        ],
      } : {}),
    },
    include: publicProductCustomizationInclude,
  });

  const productIds = products.map(product => product.id);
  const [ratings, popularity] = productIds.length ? await Promise.all([
    prisma.review.groupBy({
      by: ['productId'],
      where: { status: 'PUBLISHED', productId: { in: productIds } },
      _avg: { rating: true },
      _count: { rating: true },
    }),
    prisma.orderItem.groupBy({
      by: ['productId'],
      where: { productId: { in: productIds }, order: { status: 'DELIVERED' } },
      _sum: { quantity: true },
    }),
  ]) : [[], []];

  let discovered = enrichDiscoveryMetrics(products, ratings, popularity);
  if (minRating !== undefined) discovered = discovered.filter(product => Number(product.reviewRating || 0) >= minRating);
  discovered = sortDiscoveredProducts(discovered, sort);

  res.set('Cache-Control', 'no-store');
  res.json({
    products: discovered.map(product => ({ ...serializeProductForClient(product), price: product.priceCents / 100 })),
    meta: {
      total: discovered.length,
      sort,
      dietary: dietaryFilters,
      availableDietaryFilters: DIETARY_FILTERS,
      minPrice: minPrice ?? null,
      maxPrice: maxPrice ?? null,
      minRating: minRating ?? null,
    },
  });
});


router.get('/slug/:slug', async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({
      where: { slug: req.params.slug },
      include: publicProductCustomizationInclude,
    });
    if (!product?.isAvailable) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');

    const [rating, popularity] = await Promise.all([
      prisma.review.aggregate({
        where: { productId: product.id, status: 'PUBLISHED' },
        _avg: { rating: true },
        _count: { rating: true },
      }),
      prisma.orderItem.aggregate({
        where: { productId: product.id, order: { status: 'DELIVERED' } },
        _sum: { quantity: true },
      }),
    ]);

    const serialized = serializeProductForClient({
      ...product,
      reviewRating: rating._avg.rating || 0,
      reviewCount: rating._count.rating || 0,
      popularityCount: popularity._sum.quantity || 0,
    });
    res.set('Cache-Control', 'no-store');
    res.json({ product: { ...serialized, price: serialized.priceCents / 100 } });
  } catch (error) { next(error); }
});

router.get('/categories', async (_req, res) => {
  const values = await prisma.product.findMany({ where: { isAvailable: true }, distinct: ['category'], select: { category: true }, orderBy: { category: 'asc' } });
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
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
