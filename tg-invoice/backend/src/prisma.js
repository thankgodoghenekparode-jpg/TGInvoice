import dotenv from 'dotenv';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

dotenv.config();

/**
 * Single shared Prisma client.
 * Prisma parameterises every query — never interpolate user input into $queryRaw.
 */
const globalForPrisma = globalThis;
const pool = globalForPrisma.__pgPool ?? new Pool({ connectionString: process.env.DATABASE_URL });

export const prisma =
  globalForPrisma.__prisma ??
  new PrismaClient({
    adapter: new PrismaPg(pool),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__pgPool = pool;
  globalForPrisma.__prisma = prisma;
}

export default prisma;
