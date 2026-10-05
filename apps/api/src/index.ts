import { createApp } from './app';
import { config } from './config';
import { logger } from './logger';
import { prisma, disconnectDb } from './db';
import { ensureDirs } from './storage/local';
import { startWorker } from './queue/worker';
import { hasFfmpeg } from './media/audio';

async function main(): Promise<void> {
  await ensureDirs();

  const pending = await prisma.family.count({ where: { deletedAt: null } });
  logger.info({ families: pending }, '数据库连接正常');

  const app = createApp();
  const stopWorker = startWorker();
  const server = app.listen(config.API_PORT, () => {
    logger.info(
      { port: config.API_PORT, env: config.NODE_ENV, worker: config.WORKER_ENABLED, storage: config.STORAGE_ROOT },
      'API 已启动',
    );
    void hasFfmpeg().then((ok) =>
      logger.info(
        { ffmpeg: ok ? 'available' : 'missing' },
        ok ? '音频转码与波形生成已启用' : '未检测到 ffmpeg：音频会保留原始文件，但不生成波形与 mp3 转码',
      ),
    );
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, '收到退出信号，开始优雅关闭');
    stopWorker();
    server.close(() => {
      void disconnectDb().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, '服务启动失败');
  process.exit(1);
});

