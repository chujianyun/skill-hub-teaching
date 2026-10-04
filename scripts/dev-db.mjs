import { spawnSync } from 'node:child_process';
function run(args, capture = false) {
  const r = spawnSync('docker', ['compose', '-f', 'docker-compose.dev.yml', ...args], { stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8' });
  if (r.status !== 0) process.exit(r.status ?? 1);
  return r.stdout?.trim();
}
run(['up', '-d', '--wait']);
const exists = run(['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', "SELECT 1 FROM pg_database WHERE datname = 'skill_hub_demo_test'"], true);
if (exists !== '1') run(['exec', '-T', 'postgres', 'createdb', '-U', 'postgres', 'skill_hub_demo_test']);
