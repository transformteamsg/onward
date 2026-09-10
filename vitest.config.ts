import process from 'node:process';

import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';

// `src/lib/server/db.ts` requires `POSTGRES_URL` when it loads, and some modules
// under test import it for the generated Prisma enums. No test opens a
// connection, so a placeholder without credentials is enough. This runs before
// the SvelteKit plugin reads the environment, which `test.env` does not.
process.env.POSTGRES_URL ||= 'postgresql://localhost:5432/onward-test';

export default {
  plugins: [svelteTesting(), sveltekit()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{js,ts}'],
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      enabled: true,
      include: ['src/**/*.{ts,js,svelte}'],
      exclude: [
        'src/**/*.{test,spec}.{ts,js}',
        'src/**/*.d.ts',
        'src/app.html',
        'src/generated/**/*',
      ],
    },
  },
};
