import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // Electron 应用为单实例运行，测试必须串行
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
});
