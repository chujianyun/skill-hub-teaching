import { expect, test, type Page } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const evidence = resolve('../../docs/test-reports/feedback');
mkdirSync(evidence, { recursive: true });

async function login(page: Page, role: '超管' | '租户管理员' | '普通用户') {
  await page.goto('/login');
  await page.getByRole('button', { name: new RegExp(`^${role}`) }).click();
  await page.getByRole('button', { name: /^登\s*录$/ }).click();
  await expect(page).toHaveURL(role === '超管' ? /\/admin\/skills$/ : role === '租户管理员' ? /\/tenant\/skills$/ : /\/workspace\/skills$/);
}

function zip(name: string, content = '测试内容') {
  return Buffer.from(zipSync({ [`${name}/SKILL.md`]: strToU8(`---\nname: ${name}\ndescription: 反馈测试技能\n---\n# 测试技能\n${content}\n`), [`${name}/references/example.md`]: strToU8(content) }));
}

async function uploadSkill(page: Page, name: string) {
  await page.getByTestId('skill-zip-input').setInputFiles({ name: `${name}.zip`, mimeType: 'application/zip', buffer: zip(name) });
  await expect(page.getByTestId('picked-skill')).toContainText(name);
  const response = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/skills(?:\/[^/]+\/versions)?$/.test(new URL(r.url()).pathname));
  await page.getByRole('button', { name: '直接发布', exact: true }).click();
  const r = await response;
  expect(r.status()).toBe(201);
  return r.json();
}

test.describe('Skill 反馈功能', () => {
  test('普通用户可以提交反馈', async ({ page }) => {
    // 管理员登录并上传 Skill
    await login(page, '租户管理员');
    await page.getByRole('button', { name: /上传 Skill$/ }).click();
    await uploadSkill(page, 'feedback-test');
    
    // 等待跳转到详情页
    await expect(page).toHaveURL(/\/skills\/[a-z0-9-]+/);
    await page.screenshot({ path: `${evidence}/01-skill-detail.png`, fullPage: true });
    
    // 切换到反馈标签
    await page.getByRole('tab', { name: '使用反馈' }).click();
    await page.screenshot({ path: `${evidence}/02-feedback-tab.png`, fullPage: true });
    
    // 提交反馈
    await page.getByPlaceholder('简要描述问题').fill('测试问题标题');
    await page.getByPlaceholder('详细描述问题现象').fill('这是一个测试问题的详细描述，用于验证反馈功能是否正常工作。');
    await page.screenshot({ path: `${evidence}/03-feedback-form-filled.png`, fullPage: true });
    
    // 点击提交按钮并等待响应
    const submitResponse = page.waitForResponse((r) => r.url().includes('/feedbacks') && r.request().method() === 'POST');
    await page.getByRole('button', { name: '提交反馈' }).click();
    await submitResponse;
    
    // 验证反馈已提交
    await expect(page.getByText('测试问题标题')).toBeVisible();
    await page.screenshot({ path: `${evidence}/04-feedback-submitted.png`, fullPage: true });
  });

  test('作者可以管理反馈状态', async ({ page }) => {
    // 管理员登录并上传 Skill
    await login(page, '租户管理员');
    await page.getByRole('button', { name: /上传 Skill$/ }).click();
    await uploadSkill(page, 'feedback-manage');
    await expect(page).toHaveURL(/\/skills\/[a-z0-9-]+/);
    
    // 切换到反馈标签
    await page.getByRole('tab', { name: '使用反馈' }).click();
    
    // 提交反馈
    const submitResponse1 = page.waitForResponse((r) => r.url().includes('/feedbacks') && r.request().method() === 'POST');
    await page.getByPlaceholder('简要描述问题').fill('需要处理的问题');
    await page.getByPlaceholder('详细描述问题现象').fill('问题描述内容');
    await page.getByRole('button', { name: '提交反馈' }).click();
    await submitResponse1;
    
    // 验证操作按钮可见（管理员是作者）
    await expect(page.getByRole('button', { name: '标记处理中' })).toBeVisible();
    await expect(page.getByRole('button', { name: '标记已解决' })).toBeVisible();
    await page.screenshot({ path: `${evidence}/05-feedback-actions-visible.png`, fullPage: true });
    
    // 标记为处理中
    const statusResponse1 = page.waitForResponse((r) => r.url().includes('/feedbacks') && r.request().method() === 'PATCH');
    await page.getByRole('button', { name: '标记处理中' }).click();
    await statusResponse1;
    await expect(page.getByText('状态已更新')).toBeVisible();
    await page.screenshot({ path: `${evidence}/06-feedback-in-progress.png`, fullPage: true });
    
    // 标记为已解决
    await page.getByRole('button', { name: '标记已解决' }).click();
    await page.waitForSelector('#resolution-input');
    await page.fill('#resolution-input', '已修复这个问题');
    await page.screenshot({ path: `${evidence}/07-feedback-resolve-modal.png`, fullPage: true });
    const statusResponse2 = page.waitForResponse((r) => r.url().includes('/feedbacks') && r.request().method() === 'PATCH');
    await page.locator('.ant-modal-confirm .ant-btn-primary').click();
    await statusResponse2;
    
    await expect(page.getByText('已标记为已解决')).toBeVisible();
    await page.screenshot({ path: `${evidence}/08-feedback-resolved.png`, fullPage: true });
  });

  test('状态筛选功能正常', async ({ page }) => {
    // 管理员登录并上传 Skill
    await login(page, '租户管理员');
    await page.getByRole('button', { name: /上传 Skill$/ }).click();
    await uploadSkill(page, 'feedback-filter');
    await expect(page).toHaveURL(/\/skills\/[a-z0-9-]+/);
    
    // 切换到反馈标签
    await page.getByRole('tab', { name: '使用反馈' }).click();
    
    // 提交两个反馈
    const submitResponse1 = page.waitForResponse((r) => r.url().includes('/feedbacks') && r.request().method() === 'POST');
    await page.getByPlaceholder('简要描述问题').fill('问题1-待处理');
    await page.getByPlaceholder('详细描述问题现象').fill('描述1');
    await page.getByRole('button', { name: '提交反馈' }).click();
    await submitResponse1;
    
    const submitResponse2 = page.waitForResponse((r) => r.url().includes('/feedbacks') && r.request().method() === 'POST');
    await page.getByPlaceholder('简要描述问题').fill('问题2-将解决');
    await page.getByPlaceholder('详细描述问题现象').fill('描述2');
    await page.getByRole('button', { name: '提交反馈' }).click();
    await submitResponse2;
    
    // 验证两个反馈都显示
    await expect(page.getByText('问题1-待处理')).toBeVisible();
    await expect(page.getByText('问题2-将解决')).toBeVisible();
    await page.screenshot({ path: `${evidence}/09-feedback-list-all.png`, fullPage: true });
    
    // 解决第二个问题
    const secondRow = page.locator('tr', { has: page.getByText('问题2-将解决') });
    await secondRow.getByRole('button', { name: '标记已解决' }).click();
    await page.waitForSelector('#resolution-input');
    await page.fill('#resolution-input', '已修复');
    const resolveResponse = page.waitForResponse((r) => r.url().includes('/feedbacks') && r.request().method() === 'PATCH');
    // 点击模态框中的确认按钮
    await page.locator('.ant-modal-confirm .ant-btn-primary').click();
    await resolveResponse;
    
    // 筛选待处理
    await page.locator('.ant-radio-button-wrapper', { hasText: '待处理' }).click();
    await expect(page.getByText('问题1-待处理')).toBeVisible();
    await expect(page.getByText('问题2-将解决')).not.toBeVisible();
    await page.screenshot({ path: `${evidence}/10-feedback-filter-pending.png`, fullPage: true });
    
    // 筛选已解决
    await page.locator('.ant-radio-button-wrapper', { hasText: '已解决' }).click();
    await expect(page.getByText('问题2-将解决')).toBeVisible();
    await expect(page.getByText('问题1-待处理')).not.toBeVisible();
    await page.screenshot({ path: `${evidence}/11-feedback-filter-resolved.png`, fullPage: true });
    
    // 筛选全部
    await page.locator('.ant-radio-button-wrapper', { hasText: '全部' }).click();
    await expect(page.getByText('问题1-待处理')).toBeVisible();
    await expect(page.getByText('问题2-将解决')).toBeVisible();
  });

  test('URL 参数 tab=feedback 可以切换到反馈标签', async ({ page }) => {
    // 管理员登录并上传 Skill
    await login(page, '租户管理员');
    await page.getByRole('button', { name: /上传 Skill$/ }).click();
    await uploadSkill(page, 'feedback-url');
    await expect(page).toHaveURL(/\/skills\/[a-z0-9-]+/);
    
    // 获取当前 URL
    const url = page.url();
    
    // 直接访问带 tab=feedback 参数的 URL
    await page.goto(`${url}?tab=feedback`);
    
    // 验证反馈标签被激活
    await expect(page.locator('.ant-tabs-tab-active').getByText('使用反馈')).toBeVisible();
    await expect(page.getByText('提交反馈').first()).toBeVisible();
    await page.screenshot({ path: `${evidence}/12-feedback-url-param.png`, fullPage: true });
  });
});
