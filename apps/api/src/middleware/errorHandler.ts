import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { AppError } from '../http/errors';
import { logger } from '../logger';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在' } });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
      requestId: req.requestId,
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'VALIDATION_FAILED', message: '请求参数不合法', details: err.flatten() },
      requestId: req.requestId,
    });
    return;
  }

  if (err instanceof multer.MulterError) {
    const isSize = err.code === 'LIMIT_FILE_SIZE';
    res.status(isSize ? 413 : 400).json({
      error: {
        code: isSize ? 'FILE_TOO_LARGE' : 'VALIDATION_FAILED',
        message: isSize ? '文件超出大小上限' : `上传失败：${err.message}`,
      },
      requestId: req.requestId,
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({
        error: { code: 'CONFLICT', message: '该记录已存在', details: { target: err.meta?.target } },
        requestId: req.requestId,
      });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '资源不存在' }, requestId: req.requestId });
      return;
    }
  }

  logger.error({ err, requestId: req.requestId, path: req.path, method: req.method }, '未预期的服务端错误');
  res.status(500).json({
    error: { code: 'INTERNAL', message: '服务器内部错误，请把请求编号提供给管理员' },
    requestId: req.requestId,
  });
}

