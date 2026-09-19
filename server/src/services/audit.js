import { prisma } from '../lib/prisma.js';
export function audit(req, action, entity, entityId, metadata) {
  return prisma.auditLog.create({ data: { action, entity, entityId, actorId: req.auth?.sub, ipAddress: req.ip, metadata: metadata ? JSON.stringify(metadata) : undefined } });
}
