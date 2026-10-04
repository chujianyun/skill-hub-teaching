import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const database = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5434/skill_hub_demo_test';
process.env.NO_PROXY = ['localhost', '127.0.0.1', process.env.NO_PROXY].filter(Boolean).join(',');
export default defineConfig({
  testDir: './e2e', workers: 1, fullyParallel: false, forbidOnly: !!process.env.CI,
  timeout: 60000, expect: { timeout: 10000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { actionTimeout: 10000, baseURL: 'http://localhost:5176', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }],
  webServer: [
    {
      command: 'pnpm --filter @skill-hub/server db:deploy && pnpm --filter @skill-hub/server test:reset-db && pnpm --filter @skill-hub/server start',
      url: 'http://localhost:3101/api/health', reuseExistingServer: false,
      env: { DATABASE_URL: database, TEST_DATABASE_URL: database, PORT: '3101', PRIVATE_UPLOAD_DIR: join(tmpdir(), 'skill-hub-pw-private-uploads') },
    },
    { command: 'pnpm dev --port 5176 --strictPort', url: 'http://localhost:5176', reuseExistingServer: false, env: { API_TARGET: 'http://localhost:3101' } },
  ],
});
