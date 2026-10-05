import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';

export function sha256Hex(input: Buffer | string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** 流式计算文件的 sha256，用于上传落库与导出包整包校验。 */
export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (c) => hash.update(c));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/** 邀请码 / 分享 token：URL 安全、可粘贴给家人。 */
export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

export function randomHex(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

export function slugify(input: string, fallback = 'family'): string {
  const ascii = input
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
  return ascii || fallback;
}

