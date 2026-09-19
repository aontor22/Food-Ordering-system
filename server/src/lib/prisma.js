import { PrismaClient } from '@prisma/client';
export const prisma = globalThis.__foodPrisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalThis.__foodPrisma = prisma;
