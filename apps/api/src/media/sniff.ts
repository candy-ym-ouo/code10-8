import { createReadStream } from 'node:fs';
import { AppError } from '../http/errors';

export interface DetectedType {
  mime: string;
  kind: 'image' | 'audio' | 'document';
}

const ALLOWED: Record<string, DetectedType> = {
  'image/jpeg': { mime: 'image/jpeg', kind: 'image' },
  'image/png': { mime: 'image/png', kind: 'image' },
  'image/webp': { mime: 'image/webp', kind: 'image' },
  'image/heic': { mime: 'image/heic', kind: 'image' },
  'image/heif': { mime: 'image/heif', kind: 'image' },
  'audio/mpeg': { mime: 'audio/mpeg', kind: 'audio' },
  'audio/mp4': { mime: 'audio/mp4', kind: 'audio' },
  'audio/wav': { mime: 'audio/wav', kind: 'audio' },
  'audio/webm': { mime: 'audio/webm', kind: 'audio' },
  'audio/ogg': { mime: 'audio/ogg', kind: 'audio' },
  'application/pdf': { mime: 'application/pdf', kind: 'document' },
};

function ascii(buf: Buffer, start: number, len: number): string {
  return buf.subarray(start, start + len).toString('latin1');
}

/**
 * 魔数嗅探：只信任文件内容，不信任客户端给的 Content-Type。
 * 覆盖项目允许的全部格式（图片 / 音频 / PDF）。
 */
export function detectFromBuffer(buf: Buffer): DetectedType | null {
  if (buf.length < 12) return null;

  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ALLOWED['image/jpeg']!;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return ALLOWED['image/png']!;
  }
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WEBP') return ALLOWED['image/webp']!;
  if (ascii(buf, 4, 4) === 'ftyp') {
    const brand = ascii(buf, 8, 4);
    if (brand.startsWith('heic') || brand.startsWith('heix') || brand.startsWith('mif1')) {
      return ALLOWED['image/heic']!;
    }
    if (brand.startsWith('M4A') || brand.startsWith('mp42') || brand.startsWith('isom')) {
      return ALLOWED['audio/mp4']!;
    }
  }
  if (ascii(buf, 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0)) {
    return ALLOWED['audio/mpeg']!;
  }
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WAVE') return ALLOWED['audio/wav']!;
  if (buf.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    // EBML：webm 与 matroska 同族，浏览器录音常见的是 webm/opus
    return ALLOWED['audio/webm']!;
  }
  if (ascii(buf, 0, 4) === 'OggS') return ALLOWED['audio/ogg']!;
  if (ascii(buf, 0, 5) === '%PDF-') return ALLOWED['application/pdf']!;

  return null;
}

export async function detectFileType(filePath: string): Promise<DetectedType> {
  const header = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = createReadStream(filePath, { start: 0, end: 4095 });
    stream.on('data', (c) => chunks.push(c as Buffer));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
  const detected = detectFromBuffer(header);
  if (!detected) {
    throw new AppError('UNSUPPORTED_MEDIA_TYPE', '无法识别的文件格式，仅支持 JPG/PNG/WebP/HEIC、MP3/M4A/WAV/WebM/OGG 与 PDF');
  }
  return detected;
}

export function limitForKind(kind: DetectedType['kind'], limits: { image: number; audio: number; document: number }): number {
  if (kind === 'image') return limits.image;
  if (kind === 'audio') return limits.audio;
  return limits.document;
}
