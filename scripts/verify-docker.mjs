import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { zipSync, strToU8 } = require('fflate');
const base = process.env.DEMO_URL ?? 'http://localhost:8081';
assert.equal((await fetch(`${base}/login`)).status, 200);
let adminCookie;
for (const [phone, password, expectedRole] of [['root','admin',true], ['15168466666','test',false], ['15168488888','test',false]]) {
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone, password }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const me = await (await fetch(`${base}/api/auth/me`, { headers: { cookie } })).json();
  assert.equal(me.user.phone, phone); assert.equal(me.user.isSuperAdmin, expectedRole);
  if (phone === '15168466666') adminCookie = cookie;
  console.log(`Docker login verified: ${phone}`);
}
const name = `docker-check-${Date.now()}`;
const zip = zipSync({ [`${name}/SKILL.md`]: strToU8(`---\nname: ${name}\ndescription: Docker proxy and persistence test\n---\nDemo\n`), [`${name}/sample.bin`]: randomBytes(11 * 1024 * 1024) });
const form = new FormData(); form.append('file', new Blob([zip]), `${name}.zip`); form.append('version', '1.0.0');
const upload = await fetch(`${base}/api/skills`, { method: 'POST', headers: { cookie: adminCookie }, body: form });
assert.equal(upload.status, 201, await upload.clone().text());
const skill = await upload.json();
const url = `${base}/api/skills/${skill.id}/versions/${skill.currentVersion.id}/download`;
async function downloadHash() {
  const response = await fetch(url, { headers: { cookie: adminCookie } }); assert.equal(response.status, 200);
  return createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
}
try {
  const before = await downloadHash();
  console.log('11 MiB ZIP upload/download through Caddy passed (exceeds the old 10 MB proxy cap).');
  if (process.argv.includes('--restart')) {
    const restarted = spawnSync('docker', ['compose', 'restart', 'server'], { stdio: 'inherit' }); assert.equal(restarted.status, 0);
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try { ready = (await fetch(`${base}/api/health`)).ok; } catch {}
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert(ready, 'Server did not become healthy after restart');
  }
  assert.equal(await downloadHash(), before);
  console.log(process.argv.includes('--restart') ? 'Session and package content persisted across restart and repeated seed.' : 'Repeated download returned identical package content.');
} finally {
  // Only delete the unique test skill created above; existing demo content is untouched.
  assert.equal((await fetch(`${base}/api/skills/${skill.id}`, { method: 'DELETE', headers: { cookie: adminCookie } })).status, 204);
}
console.log('Docker smoke verification passed.');
