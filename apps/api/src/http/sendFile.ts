import type { Request, Response } from 'express';
import { createReadStream } from 'node:fs';
import { absOf } from '../storage/local';

interface SendOptions {
  key: string;
  size: number;
  mimeType: string;
  filename: string;
  download?: boolean;
}

interface SendPathOptions {
  absPath: string;
  size: number;
  mimeType: string;
  filename: string;
  download?: boolean;
  /** 提供时会处理 If-Range：实体已变化则忽略 Range 重发完整文件 */
  etag?: string;
}

/**
 * 带 Range 支持的文件响应：音频拖动进度条、大图/PDF 分段加载、导出包
 * 断点续传都依赖它。只允许单段 range，多段（multipart/byteranges）回退为
 * 整文件，够用且实现简单。
 */
export function sendFilePath(req: Request, res: Response, opts: SendPathOptions): void {
  const { absPath, size, mimeType, filename, download, etag } = opts;
  const disposition = `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(filename)}`;

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', disposition);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  if (etag) res.setHeader('ETag', etag);

  const range = req.header('range');
  const ifRange = req.header('if-range');
  // If-Range 不匹配说明文件已变，续传没有意义，直接重发完整文件
  const rangeAllowed = Boolean(range) && (!ifRange || !etag || ifRange.trim() === etag);
  if (range && rangeAllowed) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (match) {
      const startRaw = match[1];
      const endRaw = match[2];
      let start = startRaw ? Number(startRaw) : 0;
      let end = endRaw ? Number(endRaw) : size - 1;
      if (!startRaw && endRaw) {
        start = Math.max(0, size - Number(endRaw));
        end = size - 1;
      }
      if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start < size) {
        end = Math.min(end, size - 1);
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
        res.setHeader('Content-Length', String(end - start + 1));
        createReadStream(absPath, { start, end }).pipe(res);
        return;
      }
      res.status(416).setHeader('Content-Range', `bytes */${size}`);
      res.end();
      return;
    }
  }

  res.setHeader('Content-Length', String(size));
  createReadStream(absPath).pipe(res);
}

export function sendStoredFile(req: Request, res: Response, opts: SendOptions): void {
  const { key, ...rest } = opts;
  sendFilePath(req, res, { ...rest, absPath: absOf(key) });
}
