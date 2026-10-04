import { expect, test, type Page } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const evidence = resolve('../../.spec-to-ship/skill-hub-demo/screenshots');
mkdirSync(evidence, { recursive: true });

async function login(page: Page, role: '超管' | '租户管理员' | '普通用户') {
  await page.goto('/login');
  await page.getByRole('button', { name: new RegExp(`^${role}`) }).click();
  await page.getByRole('button', { name: /^登\s*录$/ }).click();
  await expect(page).toHaveURL(role === '超管' ? /\/admin\/skills$/ : role === '租户管理员' ? /\/tenant\/skills$/ : /\/workspace\/skills$/);
}
async function logout(page: Page) {
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/);
}
function zip(name: string, content = '第一版') {
  return Buffer.from(zipSync({ [`${name}/SKILL.md`]: strToU8(`---\nname: ${name}\ndescription: 浏览器演示验证\n---\n# 测试技能\n${content}\n`), [`${name}/references/example.md`]: strToU8(content) }));
}
async function upload(page: Page, name: string, action: string, content?: string) {
  await page.getByTestId('skill-zip-input').setInputFiles({ name: `${name}.zip`, mimeType: 'application/zip', buffer: zip(name, content) });
  await expect(page.getByTestId('picked-skill')).toContainText(name);
  const response = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/skills(?:\/[^/]+\/versions)?$/.test(new URL(r.url()).pathname));
  await page.getByRole('button', { name: action, exact: true }).click();
  const r = await response;
  expect(r.status()).toBe(201);
  const skill = await r.json();
  if (action === '提交审核') await page.getByRole('button', { name: '知道了' }).click();
  return skill;
}
async function confirm(page: Page) { await page.getByRole('button', { name: /^确\s*定$/ }).click(); await expect(page.locator('.ant-popconfirm:visible')).toHaveCount(0); }

test('three fixed identities, login error, refresh and role boundaries', async ({ page }) => {
  await page.goto('/login');
  await page.screenshot({ path: `${evidence}/login-desktop.png`, fullPage: true });
  await page.getByLabel('用户名').fill('root'); await page.getByLabel('密码', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: /^登\s*录$/ }).click();
  await expect(page.getByText('账号或密码错误')).toBeVisible();
  for (const role of ['超管', '租户管理员', '普通用户'] as const) {
    await login(page, role); await page.reload();
    await expect(page.getByTestId('current-user')).toBeVisible();
    await expect(page.getByRole('menu')).not.toContainText(/员工管理|部门管理|租户管理|二方系统|个人中心/);
    if (role === '普通用户') {
      expect((await page.request.get('/api/admin/tenants')).status()).toBe(403);
      await page.goto('/tenant/reviews'); await expect(page).toHaveURL(/\/workspace\/skills$/);
    }
    await logout(page);
  }
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/login');
  await expect(page.getByRole('button', { name: /^登\s*录$/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${evidence}/login-mobile.png`, fullPage: true });
});

test('employee upload → reject → reupload → approve → version diff → download → superadmin governance', async ({ page }) => {
  const name = 'browser-workflow';
  await login(page, '普通用户');
  await page.getByRole('button', { name: /上传 Skill$/ }).click();
  let skill = await upload(page, name, '提交审核');
  const skillId = skill.id;
  const versionId = skill.workingVersion.id;
  const reviewLink = `/skills/review/${versionId}`;
  await expect(page.getByText('审核中', { exact: true }).first()).toBeVisible();
  await logout(page);
  await page.goto(reviewLink); await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByRole('button', { name: /^租户管理员/ }).click();
  await page.getByRole('button', { name: /^登\s*录$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/tenant/reviews/${versionId}$`));
  await page.screenshot({ path: `${evidence}/review-pending.png`, fullPage: true });
  await page.getByRole('button', { name: /驳\s*回$/ }).click();
  await page.getByLabel('驳回意见').fill('请补充使用示例');
  await page.getByRole('dialog').getByRole('button', { name: /驳\s*回$/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('请补充使用示例').first()).toBeVisible();
  await logout(page);
  await login(page, '普通用户'); await page.goto(`/workspace/skills/${skillId}`);
  await expect(page.getByText('请补充使用示例').first()).toBeVisible();
  await page.getByRole('button', { name: /重新上传/ }).click();
  await page.getByTestId('skill-zip-input').setInputFiles({ name: `${name}.zip`, mimeType: 'application/zip', buffer: zip(name, '已补充使用示例') });
  await page.getByRole('button', { name: '保存并提交审核', exact: true }).click();
  await page.getByRole('button', { name: '知道了' }).click();
  await logout(page); await login(page, '租户管理员'); await page.goto(`/tenant/reviews/${versionId}`);
  await page.getByRole('button', { name: /通\s*过$/ }).click(); await confirm(page);
  await expect(page.getByRole('button', { name: /通\s*过$/ })).toHaveCount(0);
  await logout(page); await login(page, '普通用户');
  await page.getByRole('link', { name, exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('link', { name: /下载 1\.0\.0$/ }).click();
  expect((await downloaded).suggestedFilename()).toContain(name);
  await page.getByRole('button', { name: /上传新版本$/ }).click();
  skill = await upload(page, name, '提交审核', '第二版内容');
  await expect(page.getByText('1.0.0', { exact: true }).first()).toBeVisible();
  await logout(page); await login(page, '租户管理员'); await page.goto(`/tenant/reviews/${skill.workingVersion.id}`);
  await page.getByRole('tab', { name: /差异/ }).click();
  await expect(page.getByText('references/example.md').first()).toBeVisible();
  await page.screenshot({ path: `${evidence}/version-diff.png`, fullPage: true });
  await page.getByRole('button', { name: /通\s*过$/ }).click(); await confirm(page);
  await logout(page); await login(page, '超管');
  await page.getByTestId('admin-tenant-select').click(); await page.getByText('Skill Hub 演示团队', { exact: true }).click();
  await page.getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('button', { name: /通\s*过$/ })).toHaveCount(0);
  await page.getByRole('button', { name: /下\s*架$/ }).click(); await confirm(page);
  await expect(page.getByTestId('unlisted-alert')).toBeVisible();
  await page.screenshot({ path: `${evidence}/superadmin-detail.png`, fullPage: true });
  await page.getByRole('button', { name: /上\s*架$/ }).click(); await confirm(page);
  await expect(page.getByTestId('unlisted-alert')).toHaveCount(0);
});

test('folder input and draft withdraw/resubmit', async ({ page }) => {
  await login(page, '普通用户');
  await page.getByRole('button', { name: /上传 Skill$/ }).click();
  await page.getByTestId('skill-folder-input').setInputFiles(resolve('../../examples/hello-skill'));
  await expect(page.getByTestId('picked-skill')).toContainText('hello-skill');
  await page.getByRole('button', { name: '存草稿', exact: true }).click();
  await expect(page.getByText('草稿', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: '提交审核', exact: true }).click();
  await page.getByRole('button', { name: '知道了' }).click();
  await page.getByRole('button', { name: /^撤\s*回$/ }).click(); await confirm(page);
  await expect(page.getByText('草稿', { exact: true }).first()).toBeVisible();
});

test('admin category lifecycle, visibility selection, search and direct publishing', async ({ page }) => {
  await login(page, '租户管理员');
  await page.getByRole('tab', { name: '分类', exact: true }).click();
  await page.getByRole('button', { name: /新增分类$/ }).click();
  await page.getByLabel('分类名称').fill('浏览器分类');
  await page.getByRole('dialog').getByRole('button', { name: /保\s*存$/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('tab', { name: '目录', exact: true }).click();
  await page.getByRole('button', { name: /上传 Skill$/ }).click();
  await page.getByTestId('upload-category-select').click();
  await page.getByTitle('浏览器分类', { exact: true }).click();
  await page.getByRole('dialog').getByText('特定部门可见', { exact: true }).click();
  await page.getByTestId('visibility-departments').click();
  await page.getByText('研发部', { exact: true }).click();
  await page.getByLabel('版本号').click();
  const skill = await upload(page, 'admin-browser-demo', '直接发布');
  await expect(page.getByTestId('skill-category')).toContainText('浏览器分类');
  await expect(page.getByTestId('skill-visibility')).toContainText('研发部');
  await page.getByRole('button', { name: '修改可见性' }).click();
  await page.getByRole('dialog').getByText('特定员工可见', { exact: true }).click();
  await page.getByTestId('visibility-employees').click();
  await page.getByTitle('演示用户（研发部）', { exact: true }).click();
  await page.screenshot({ path: `${evidence}/visibility-after.png`, fullPage: true });
  const popupBox = (await page.locator('.ant-select-dropdown:visible').boundingBox())!;
  const saveBox = (await page.getByRole('dialog').getByRole('button', { name: /保\s*存$/ }).boundingBox())!;
  expect(popupBox.y + popupBox.height).toBeLessThanOrEqual(saveBox.y);
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').getByRole('button', { name: /保\s*存$/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('skill-visibility')).toContainText('演示用户');
  await logout(page); await login(page, '普通用户');
  await page.getByTestId('category-filter').getByText('浏览器分类', { exact: true }).click();
  await page.getByPlaceholder('搜索名称或描述').fill('admin-browser');
  await page.getByPlaceholder('搜索名称或描述').press('Enter');
  await expect(page.getByRole('link', { name: 'admin-browser-demo', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'admin-browser-demo', exact: true }).click();
  await expect(page.getByRole('button', { name: '修改可见性' })).toHaveCount(0);
  await logout(page); await login(page, '租户管理员'); await page.goto(`/tenant/skills/${skill.id}`);
  await page.getByRole('button', { name: '修改可见性' }).click();
  await page.getByRole('dialog').getByText('仅自己可见', { exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /保\s*存$/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/tenant/skills'); await page.getByRole('tab', { name: '分类', exact: true }).click();
  const row = page.getByTestId('category-table').getByRole('row').filter({ hasText: '浏览器分类' });
  await row.getByText('改名', { exact: true }).click();
  await page.getByLabel('分类名称').fill('已改名分类');
  await page.getByRole('dialog').getByRole('button', { name: /保\s*存$/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByTestId('category-table').getByRole('row').filter({ hasText: '已改名分类' }).getByText('删除', { exact: true }).click();
  await page.locator('.ant-popconfirm').getByRole('button', { name: /删\s*除$/ }).click();
  await expect(page.getByTestId('category-table')).not.toContainText('已改名分类');
  await page.goto(`/tenant/skills/${skill.id}`); await expect(page.getByTestId('skill-category')).toContainText('未分类');
  await logout(page); await login(page, '普通用户');
  await expect(page.getByRole('link', { name: 'admin-browser-demo', exact: true })).toHaveCount(0);
  expect((await page.request.get(`/api/skills/${skill.id}`)).status()).toBe(404);
});

test('invalid upload recovers and native zip drag/drop works', async ({ page }, testInfo) => {
  await login(page, '普通用户'); await page.getByRole('button', { name: /上传 Skill$/ }).click();
  await page.getByTestId('skill-zip-input').setInputFiles({ name: 'bad.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync({ 'bad.txt': strToU8('no manifest') })) });
  await expect(page.getByRole('button', { name: '提交审核', exact: true })).toBeDisabled();
  await expect(page.getByRole('alert').last()).toContainText('SKILL.md');
  const zipPath = testInfo.outputPath('dragged-skill.zip'); writeFileSync(zipPath, zip('dragged-skill'));
  const zone = await page.getByTestId('skill-drop-zone').boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const data = { items: [], files: [zipPath], dragOperationsMask: 1 };
  await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', x: zone!.x + 20, y: zone!.y + 20, data });
  await cdp.send('Input.dispatchDragEvent', { type: 'drop', x: zone!.x + 20, y: zone!.y + 20, data });
  await expect(page.getByTestId('picked-skill')).toContainText('dragged-skill');
  await page.getByRole('button', { name: '存草稿', exact: true }).click();
  await expect(page.getByText('草稿', { exact: true }).first()).toBeVisible();
});

test('responsive typography, toolbar popup and fixed column remain aligned while scrolling', async ({ page }) => {
  await login(page, '租户管理员');
  expect((await page.request.post('/api/skills', { multipart: { file: { name: 'geometry.zip', mimeType: 'application/zip', buffer: zip('geometry-demo-long-name') }, version: '1.0.0' } })).status()).toBe(201);
  await page.getByRole('tab', { name: '管理', exact: true }).click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 992) await expect(page.locator('aside')).toHaveCSS('width', '0px');
    const select = page.getByTestId('filter-status');
    await select.click();
    const popup = page.locator('.ant-select-dropdown:visible');
    await expect(popup).toBeVisible();
    const box = (await popup.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(-1); expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    const trigger = (await select.boundingBox())!;
    expect(Math.abs(box.x - trigger.x)).toBeLessThan(5);
    const fonts = await page.locator('.ant-card-body').first().evaluate((el) => ({ font: parseFloat(getComputedStyle(el).fontSize), line: parseFloat(getComputedStyle(el).lineHeight) }));
    expect(fonts.font).toBeGreaterThanOrEqual(14); expect(fonts.line).toBeGreaterThan(fonts.font);
    await page.screenshot({ path: `${evidence}/toolbar-${width}.png`, fullPage: true });
    await page.keyboard.press('Escape');
    await expect(popup).toHaveCount(0);
  }
  await page.goto('/tenant/my-skills');
  await expect(page.locator('aside')).toHaveCSS('width', '0px');
  const container = page.locator('.ant-table-content').first();
  await expect(page.getByRole('link', { name: 'geometry-demo-long-name', exact: true })).toBeVisible();
  const action = page.locator('thead .ant-table-cell-fix-end').first();
  for (const fraction of [0, 0.5, 1]) {
    await container.evaluate((el, f) => { el.scrollLeft = (el.scrollWidth - el.clientWidth) * f; }, fraction);
    await expect(async () => {
      const a = (await action.boundingBox())!; const c = (await container.boundingBox())!;
      expect(Math.abs(a.x + a.width - (c.x + c.width))).toBeLessThan(3);
    }).toPass({ timeout: 5000 });
    await page.screenshot({ path: `${evidence}/table-mobile-${fraction}.png`, fullPage: true });
  }
});
