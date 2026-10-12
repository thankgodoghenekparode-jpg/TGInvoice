import { PrismaClient } from '@prisma/client';

/**
 * Single shared Prisma client.
 * Prisma parameterises every query — never interpolate user input into $queryRaw.
 */
const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__prisma = prisma;
}

export default prisma;
