import multer from 'multer';
import path from 'node:path';
import { config } from '../config';
import { tmpDir } from '../storage/local';

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, tmpDir()),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 10).replace(/[^.\w]/g, '');
    cb(null, `up-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`);
  },
});

/**
 * 上传走流式落盘，不进内存（音频可到 200MB）。
 * 这里先按最大的音频上限拦一道，真实类型识别后再按类别精确校验。
 */
export const uploadSingle = multer({
  storage,
  limits: { fileSize: config.limits.audio, files: 1 },
}).single('file');

