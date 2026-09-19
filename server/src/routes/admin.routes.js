import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { audit } from '../services/audit.js';

const router = Router(); router.use(requireAuth, requireRole('ADMIN'));
const productFields = { name: z.string().trim().min(2).max(100), description: z.string().trim().min(5).max(500), category: z.string().trim().min(2).max(50), imageUrl: z.string().max(300).nullable().optional(), priceCents: z.number().int().positive(), stock: z.number().int().nonnegative(), isAvailable: z.boolean().default(true) };
router.post('/products', validate(z.object({ body: z.object({ id: z.string().min(1).max(50), ...productFields }), params: z.any(), query: z.any() })), async (req, res, next) => { try { const product = await prisma.product.create({ data: req.validated.body }); await audit(req, 'PRODUCT_CREATED', 'Product', product.id); res.status(201).json({ product }); } catch(e) { next(e); } });
router.patch('/products/:id', validate(z.object({ body: z.object(productFields).partial(), params: z.object({ id: z.string() }), query: z.any() })), async (req, res, next) => { try { const product = await prisma.product.update({ where: { id: req.validated.params.id }, data: req.validated.body }); await audit(req, 'PRODUCT_UPDATED', 'Product', product.id, req.validated.body); res.json({ product }); } catch(e) { next(e); } });
router.delete('/products/:id', async (req, res, next) => { try { const product = await prisma.product.update({ where: { id: req.params.id }, data: { isAvailable: false } }); await audit(req, 'PRODUCT_ARCHIVED', 'Product', product.id); res.status(204).end(); } catch(e) { next(e); } });
router.get('/orders', async (req, res) => res.json({ orders: await prisma.order.findMany({ include: { items: true, user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: 'desc' }, take: 100 }) }));
const statuses = ['PENDING','CONFIRMED','PREPARING','OUT_FOR_DELIVERY','DELIVERED','CANCELLED'];
router.patch('/orders/:id/status', validate(z.object({ body: z.object({ status: z.enum(statuses) }), params: z.object({ id: z.string() }), query: z.any() })), async (req, res, next) => { try { const existing = await prisma.order.findUnique({ where: { id: req.validated.params.id } }); if (!existing) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found'); const order = await prisma.order.update({ where: { id: existing.id }, data: { status: req.validated.body.status, ...(req.validated.body.status === 'DELIVERED' && existing.paymentMethod === 'COD' ? { paymentStatus: 'PAID' } : {}) }, include: { items: true } }); await audit(req, 'ORDER_STATUS_UPDATED', 'Order', order.id, { from: existing.status, to: order.status }); res.json({ order }); } catch(e) { next(e); } });
router.get('/dashboard', async (_req, res) => { const [users, orders, products, revenue] = await Promise.all([prisma.user.count(), prisma.order.count(), prisma.product.count({ where: { isAvailable: true } }), prisma.order.aggregate({ where: { status: 'DELIVERED' }, _sum: { totalCents: true } })]); res.json({ users, orders, products, revenueCents: revenue._sum.totalCents || 0 }); });
export default router;
