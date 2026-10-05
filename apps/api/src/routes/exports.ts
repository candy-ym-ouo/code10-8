import { Router } from 'express';
import fsp from 'node:fs/promises';
import { asyncHandler } from '../http/asyncHandler';
import { clientMeta, currentUser } from '../middleware/auth';
import { familyCtx, requireFamily } from '../middleware/family';
import { writeLimiter } from '../middleware/rateLimit';
import * as exportService from '../services/exportService';
import * as audit from '../services/auditService';
import { notFound } from '../http/errors';
import { sendStoredFile } from '../http/sendFile';

export const exportsRouter = Router({ mergeParams: true });

exportsRouter.post(
  '/',
  requireFamily('family:export'),
  writeLimiter,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const ctx = familyCtx(req);
    const job = await exportService.createExportJob(user.id, ctx, clientMeta(req));
    res.status(202).json(job);
  }),
);

exportsRouter.get(
  '/:jobId',
  requireFamily('family:export'),
  asyncHandler(async (req, res) => {
    const ctx = familyCtx(req);
    res.json({ job: await exportService.getExportJob(ctx.familyId, req.params.jobId!) });
  }),
);

exportsRouter.get(
  '/:jobId/download',
  requireFamily('family:export'),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const ctx = familyCtx(req);
    const job = await exportService.getExportJob(ctx.familyId, req.params.jobId!);
    if (job.status !== 'done') throw notFound('导出包尚未生成完成');
    const file = exportService.exportZipPath(ctx.familyId, job.jobId);
    const stat = await fsp.stat(file).catch(() => null);
    if (!stat) throw notFound('导出包已被清理，请重新导出');
    await audit.record({
      familyId: ctx.familyId,
      actorId: user.id,
      action: 'export.download',
      targetType: 'job',
      targetId: job.jobId,
      ...clientMeta(req),
    });
    // Range + ETag（整包 sha256）：浏览器/下载器中断后可从断点续传，且能校验文件未变
    const sha256 = (job.result as { sha256?: unknown } | null)?.sha256;
    sendStoredFile(req, res, {
      absPath: file,
      size: stat.size,
      mimeType: 'application/zip',
      filename: `heirloom-export-${job.jobId}.zip`,
      download: true,
      etag: typeof sha256 === 'string' ? sha256 : undefined,
    });
  }),
);
