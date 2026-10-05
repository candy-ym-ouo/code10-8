import type { Request, Response } from 'express';
import { createReadStream } from 'node:fs';
import { absOf } from '../storage/local';

interface SendOptions {
  /** 存储 key（相对 STORAGE_ROOT）；与 absPath 二选一 */
  key?: string;
  /** 绝对路径（用于导出包等不在存储根下的文件）；与 key 二选一 */
  absPath?: string;
  size: number;
  mimeType: string;
  filename: string;
  download?: boolean;
  /** 内容摘要（sha256 hex）。提供时输出 ETag 并支持 If-Range，断点续传的客户端可校验文件未变 */
  etag?: string;
}

/**
 * 带 Range 支持的文件响应：音频拖动进度条、大图/PDF 分段加载、导出包断点续传都依赖它。
 * 只允许单段 range，多段（multipart/byteranges）回退为整文件，够用且实现简单。
 */
export function sendStoredFile(req: Request, res: Response, opts: SendOptions): void {
  const { size, mimeType, filename, download } = opts;
  const filePath = opts.absPath ?? absOf(opts.key!);
  const disposition = `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(filename)}`;
  const etagQuoted = opts.etag ? `"${opts.etag}"` : null;

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', disposition);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  if (etagQuoted) res.setHeader('ETag', etagQuoted);

  const range = req.header('range');
  if (range) {
    // If-Range 与当前 ETag 不符说明文件已变，忽略 Range 直接发完整文件
    const ifRange = req.header('if-range');
    const rangeUsable = !ifRange || (etagQuoted !== null && ifRange.trim() === etagQuoted);
    if (rangeUsable) {
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
          createReadStream(filePath, { start, end }).pipe(res);
          return;
        }
        res.status(416).setHeader('Content-Range', `bytes */${size}`);
        res.end();
        return;
      }
    }
  }

  res.setHeader('Content-Length', String(size));
  createReadStream(filePath).pipe(res);
}
