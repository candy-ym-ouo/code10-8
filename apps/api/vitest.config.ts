import { defineConfig } from 'vitest/config';

/**
 * 单元测试不连数据库，但 config.ts 在模块加载时会校验环境变量，
 * 所以这里先给出占位值，保证测试可以在任何机器上直接跑起来。
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      JWT_SECRET: 'test-only-secret-test-only-secret-1234',
      DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test?schema=public',
      STORAGE_ROOT: './data/test-uploads',
      EXPORT_ROOT: './data/test-exports',
      BACKUP_ROOT: './data/test-backups',
    },
  },
});
