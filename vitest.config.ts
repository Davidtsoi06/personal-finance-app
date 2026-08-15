import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    // 线程池模式：不启动子进程（受限/沙箱环境下也能运行）
    pool: 'threads',
  },
});
