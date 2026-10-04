import { spawn } from 'node:child_process';
const children = ['server', 'web'].map((name) => spawn('pnpm', ['--filter', `@skill-hub/${name}`, 'dev'], { stdio: 'inherit', detached: true }));
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  process.exitCode = code;
}
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
for (const child of children) { child.on('error', () => stop(1)); child.on('exit', (code) => stop(code ?? 0)); }
