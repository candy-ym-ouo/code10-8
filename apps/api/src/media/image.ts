import sharp from 'sharp';
import { derivedKey } from '../storage/local';

export interface ImageVariants {
  largeKey: string;
  thumbKey: string;
  width: number;
  height: number;
}

const LARGE_MAX = 2400;
const THUMB_WIDTH = 480;

/**
 * 生成在线展示用的大图与缩略图。
 * sharp 默认不写回 EXIF，因此 GPS/拍摄设备信息在转码这一步被剥离，只保留像素。
 */
export async function processImage(
  srcPath: string,
  familyId: string,
  sha256: string,
  put: (key: string, data: Buffer) => Promise<void>,
): Promise<ImageVariants> {
  const base = sharp(srcPath, { failOn: 'none' }).rotate(); // rotate(): 按 EXIF 方向纠正后丢弃方向标记
  const meta = await base.metadata();

  const largeBuf = await base
    .clone()
    .resize({ width: LARGE_MAX, height: LARGE_MAX, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });

  const thumbBuf = await base
    .clone()
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .webp({ quality: 72 })
    .toBuffer({ resolveWithObject: true });

  const largeKey = derivedKey(familyId, sha256, '-lg.webp');
  const thumbKey = derivedKey(familyId, sha256, '-thumb.webp');
  await put(largeKey, largeBuf.data);
  await put(thumbKey, thumbBuf.data);

  return {
    largeKey,
    thumbKey,
    width: largeBuf.info.width ?? meta.width ?? 0,
    height: largeBuf.info.height ?? meta.height ?? 0,
  };
}

