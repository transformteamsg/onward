import process from 'node:process';

import { PrismaPg } from '@prisma/adapter-pg';

import { building } from '$app/environment';
import { env } from '$env/dynamic/private';

import { Prisma, PrismaClient } from '../../generated/prisma/client.js';

export const { PrismaClientKnownRequestError } = Prisma;
export * from '../../generated/prisma/enums.js';
export * from '../../generated/prisma/models.js';

export const db = new PrismaClient({
  adapter: new PrismaPg({
    // The empty string keeps the adapter constructible during the build, which
    // opens no connection. The variable is required at runtime below.
    connectionString: env.POSTGRES_URL || '',
  }),
});

if (!building) {
  if (!env.POSTGRES_URL) {
    throw new Error('POSTGRES_URL is not set.');
  }

  const isReady = await db
    .$connect()
    .then(() => true)
    .catch(() => false);

  if (!isReady) {
    await db.$disconnect();
    throw new Error('Database is not ready.');
  }
}

// Disconnect from the database when the server shuts down.
process.on('sveltekit:shutdown', async () => {
  await db.$disconnect();
});
