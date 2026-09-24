import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { serializePayment } from './payment.js';
import { config } from '../config.js';
import { trackingEventData, trackingTimestampData } from './order-tracking.js';

export const channelSchema = z.object({
  provider: z.enum(['BKASH', 'NAGAD', 'ROCKET', 'BANK']),
  label: z.string().trim().min(2).max(80),
  account: z.string().trim().min(5).max(100),
  instructions: z.string().trim().min(5).max(1000),
  active: z.boolean().default(true),
});
export const submissionSchema = z.object({
  reference: z.string().trim().min(4).max(80).regex(/^[a-zA-Z0-9 /-]+$/, 'Use letters, digits, spaces, hyphens or slashes').transform(value => value.toUpperCase()).refine(value => value.replace(/[^A-Z0-9]/g, '').length >= 4, 'Reference must contain at least four letters or digits'),
  sender: z.string().trim().min(4).max(100),
  note: z.string().trim().max(500).optional(),
});
export const reviewSchema = z.object({
  submissionId: z.string().min(1),
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().trim().min(5).max(500),
  confirmedReceived: z.boolean().default(false),
}).refine(value => value.decision !== 'APPROVE' || value.confirmedReceived, 'Confirm verification of money received before approving');

export function serializeSubmission({ referenceKey, reviewedBy, ...submission }) { return submission; }

export function validateChannel(input) {
  const data = channelSchema.parse(input);
  if (data.active && data.provider !== 'BANK' && config.PAYMENT_CURRENCY !== 'BDT') throw new AppError(400, 'CURRENCY_MISMATCH', 'Mobile payment accounts require BDT prices. Set server PAYMENT_CURRENCY and frontend VITE_CURRENCY to BDT and review your product prices before enabling.');
  return data;
}

export async function manualOrder(orderId, userId, db = prisma) {
  const order = await db.order.findFirst({ where: { id: orderId, userId }, include: { payment: true } });
  if (!order || order.paymentMethod !== 'MANUAL' || !order.payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Manual payment order not found');
  return order;
}

export async function getManualOrder(orderId, userId) {
  const order = await manualOrder(orderId, userId);
  const submissions = await prisma.manualPaymentSubmission.findMany({ where: { paymentId: order.payment.id }, orderBy: { createdAt: 'desc' } });
  return { order: { id: order.id, orderNumber: order.orderNumber, status: order.status, paymentStatus: order.paymentStatus, totalCents: order.totalCents }, payment: serializePayment(order.payment), submissions: submissions.map(serializeSubmission) };
}

function event(tx, req, action, paymentId, metadata) {
  return tx.auditLog.create({ data: { actorId: req.auth.sub, action, entity: 'Payment', entityId: paymentId, metadata: JSON.stringify(metadata) } });
}

export async function submitManualPayment(orderId, userId, input, req) {
  const data = submissionSchema.parse(input);
  try {
    return await prisma.$transaction(async tx => {
      const order = await manualOrder(orderId, userId, tx);
      const payment = order.payment;
      if (order.status !== 'PENDING' || !['PENDING', 'REJECTED'].includes(payment.status)) throw new AppError(409, 'PAYMENT_NOT_SUBMITTABLE', 'This payment is already submitted, settled, or the order is closed');
      const destination = JSON.parse(payment.manualDestination);
      const referenceKey = crypto.createHash('sha256').update(JSON.stringify([destination.provider, destination.provider === 'BANK' ? destination.account.replace(/[^a-z0-9]/gi, '').toUpperCase() : '', data.reference.replace(/[^A-Z0-9]/g, '')])).digest('hex');
      const count = await tx.manualPaymentSubmission.count({ where: { paymentId: payment.id } });
      if (count >= 20) throw new AppError(409, 'SUBMISSION_LIMIT', 'Please contact the restaurant for further payment review');
      const submission = await tx.manualPaymentSubmission.create({ data: { ...data, referenceKey, paymentId: payment.id, amountCents: payment.amountCents, currency: payment.currency } });
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'REVIEW', attempts: { increment: 1 }, lastAttemptAt: new Date(), failureReason: null } });
      await tx.order.update({ where: { id: order.id }, data: { paymentStatus: 'REVIEW' } });
      await event(tx, req, 'MANUAL_PAYMENT_SUBMITTED', payment.id, { submissionId: submission.id });
      return serializeSubmission(submission);
    });
  } catch (error) {
    if (error.code === 'P2002') throw new AppError(409, 'DUPLICATE_PAYMENT_REFERENCE', 'This transaction reference has already been submitted. Check the reference or contact the restaurant; do not pay again just to resubmit.');
    throw error;
  }
}

export async function reviewManualPayment(paymentId, input, req) {
  const data = reviewSchema.parse(input);
  return prisma.$transaction(async tx => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId }, include: { order: true } });
    if (!payment || payment.provider !== 'MANUAL') throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Manual payment not found');
    const submission = await tx.manualPaymentSubmission.findFirst({ where: { id: data.submissionId, paymentId } });
    if (!submission) throw new AppError(404, 'SUBMISSION_NOT_FOUND', 'Payment submission not found');
    if (payment.order.status !== 'PENDING' || payment.status !== 'REVIEW' || submission.status !== 'SUBMITTED') throw new AppError(409, 'REVIEW_ALREADY_COMPLETED', 'Payment changed or has already been reviewed. Refresh before continuing.');
    const approved = data.decision === 'APPROVE';
    await tx.manualPaymentSubmission.update({ where: { id: submission.id }, data: { status: approved ? 'APPROVED' : 'REJECTED', reviewNote: data.note, reviewedBy: req.auth.sub, reviewedAt: new Date() } });
    const updated = await tx.payment.update({ where: { id: paymentId }, data: { status: approved ? 'PAID' : 'REJECTED', failureReason: approved ? null : data.note, ...(approved ? { paidAt: new Date(), gatewayTransactionId: submission.reference } : {}) } });
    await tx.order.update({ where: { id: payment.orderId }, data: { paymentStatus: updated.status, ...(approved ? { status: 'CONFIRMED', ...trackingTimestampData('CONFIRMED', payment.order), trackingEvents: { create: trackingEventData('CONFIRMED', { actorType: 'ADMIN', actorLabel: req.auth.email || 'Restaurant team', note: 'Manual payment verified and order confirmed.' }) } } : {}) } });
    await event(tx, req, approved ? 'MANUAL_PAYMENT_APPROVED' : 'MANUAL_PAYMENT_REJECTED', payment.id, { submissionId: submission.id, note: data.note });
    return serializePayment(updated);
  });
}

export async function refundManualPayment(paymentId, input, req) {
  const { note } = z.object({ note: z.string().trim().min(5).max(500), confirmedReceived: z.literal(true) }).parse(input);
  return prisma.$transaction(async tx => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.provider !== 'MANUAL' || payment.status !== 'PAID') throw new AppError(409, 'REFUND_NOT_ALLOWED', 'Only a paid manual payment can be recorded as refunded');
    const updated = await tx.payment.update({ where: { id: paymentId }, data: { status: 'REFUNDED', failureReason: note } });
    await tx.order.update({ where: { id: payment.orderId }, data: { paymentStatus: 'REFUNDED' } });
    await event(tx, req, 'MANUAL_PAYMENT_REFUNDED', paymentId, { note });
    return serializePayment(updated);
  });
}
