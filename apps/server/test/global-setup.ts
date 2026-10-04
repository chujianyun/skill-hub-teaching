import { execSync } from 'node:child_process';
import { TEST_DATABASE_URL } from './test-database';

export default function globalSetup() {
  execSync('pnpm exec prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
