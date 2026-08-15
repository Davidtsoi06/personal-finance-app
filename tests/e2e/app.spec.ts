import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

test('应用启动：显示仪表盘并可导航', async () => {
  // 每次测试使用独立的用户数据目录（PF_USER_DATA_DIR 由主进程读取）
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-'));
  const app = await electron.launch({
    args: ['.'],
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, PF_USER_DATA_DIR: userData },
  });

  const win = await app.firstWindow();

  // 侧边栏与导航加载完成
  await win.waitForSelector('.sidebar');
  await expect(win.locator('.sidebar-title')).toContainText('个人理财投资软件');
  await expect(win.locator('.nav-item')).toHaveCount(8);

  // 仪表盘统计卡片渲染
  await win.waitForSelector('.stat-card', { timeout: 20000 });

  // 导航到报表分析页
  await win.click('text=报表分析');
  await win.waitForSelector('.page-title', { timeout: 15000 });

  // 导航到设置页
  await win.click('text=设置');
  await win.waitForSelector('.page-title', { timeout: 15000 });

  await app.close();
});

test('报表页显示年度已实现盈亏卡片（v1.5.5）', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-'));
  const app = await electron.launch({
    args: ['.'],
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, PF_USER_DATA_DIR: userData },
  });

  const win = await app.firstWindow();
  await win.waitForSelector('.sidebar');
  await win.click('text=报表分析');
  await win.waitForSelector('.page-title', { timeout: 15000 });

  // 年度已实现盈亏卡片与年份选择
  await expect(win.getByText('年度已实现盈亏')).toBeVisible({ timeout: 15000 });

  await app.close();
});

test('设置页显示 AI 隐私开关（v1.5.5）', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-'));
  const app = await electron.launch({
    args: ['.'],
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, PF_USER_DATA_DIR: userData },
  });

  const win = await app.firstWindow();
  await win.waitForSelector('.sidebar');
  await win.click('text=设置');
  await win.waitForSelector('.page-title', { timeout: 15000 });

  // AI 隐私开关文案（默认勾选）
  const privacyLabel = win.getByText('允许 AI 读取我的持仓、账户与交易数据', { exact: false });
  await expect(privacyLabel).toBeVisible({ timeout: 15000 });

  await app.close();
});
