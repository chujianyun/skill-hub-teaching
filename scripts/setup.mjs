import { copyFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
if (!existsSync('apps/server/.env')) copyFileSync('apps/server/.env.example', 'apps/server/.env');
for (const args of [['dev:db'], ['build'], ['--filter', '@skill-hub/server', 'db:deploy'], ['--filter', '@skill-hub/server', 'db:seed']]) {
  const result = spawnSync('pnpm', args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
