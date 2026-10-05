import { describe, expect, it } from 'vitest';
import { detectFromBuffer, limitForKind } from './sniff';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(32)]);
const WAV = (() => {
  const b = Buffer.alloc(64);
  b.write('RIFF', 0);
  b.write('WAVE', 8);
  return b;
})();
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(32)]);
const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(32)]);

describe('文件类型嗅探（只信内容，不信客户端声明的 Content-Type）', () => {
  it('识别图片', () => {
    expect(detectFromBuffer(PNG)).toEqual({ mime: 'image/png', kind: 'image' });
    expect(detectFromBuffer(JPEG)?.mime).toBe('image/jpeg');
  });

  it('识别音频', () => {
    expect(detectFromBuffer(WAV)?.mime).toBe('audio/wav');
    expect(detectFromBuffer(WEBM)?.mime).toBe('audio/webm');
    expect(detectFromBuffer(OGG)?.mime).toBe('audio/ogg');
  });

  it('识别 PDF', () => {
    expect(detectFromBuffer(PDF)).toEqual({ mime: 'application/pdf', kind: 'document' });
  });

  it('伪装成图片的脚本会被拒绝', () => {
    expect(detectFromBuffer(Buffer.from('<?php system($_GET[0]); ?>'))).toBeNull();
    expect(detectFromBuffer(Buffer.from('<svg onload=alert(1)></svg>'))).toBeNull();
    expect(detectFromBuffer(Buffer.alloc(4))).toBeNull();
  });
});

describe('分类大小上限', () => {
  it('按类型取不同的上限', () => {
    const limits = { image: 25, audio: 200, document: 50 };
    expect(limitForKind('image', limits)).toBe(25);
    expect(limitForKind('audio', limits)).toBe(200);
    expect(limitForKind('document', limits)).toBe(50);
  });
});

