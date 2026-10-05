import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { Crc32, ZipWriter, crc32, dosDateTime, sanitizeFileName, uniqueEntryName, type ZipEntryRecord } from './zipArchive';

/**
 * 用一个最小的解析器把写出的 ZIP 读回来，验证结构；
 * 系统里有 unzip 时再跑一遍 `unzip -t` 做第三方交叉校验。
 */

interface ParsedEntry {
  name: string;
  method: number;
  crc32: number;
  compressedSize: number;
  size: number;
  localOffset: number;
  versionNeeded: number;
  extraZip64: boolean;
}

function parseCentralDirectory(buf: Buffer): { entries: ParsedEntry[]; zip64Eocd: boolean } {
  // EOCD 固定 22 字节且在文件末尾（本写出器不写注释）
  const eocdAt = buf.length - 22;
  expect(buf.readUInt32LE(eocdAt)).toBe(0x06054b50);
  let count = buf.readUInt16LE(eocdAt + 10);
  let cdOffset = buf.readUInt32LE(eocdAt + 16);
  let zip64Eocd = false;

  // 出现 ZIP64 定位符时，以 ZIP64 EOCD 为准
  const locatorAt = eocdAt - 20;
  if (locatorAt >= 0 && buf.readUInt32LE(locatorAt) === 0x07064b50) {
    zip64Eocd = true;
    const eocd64At = Number(buf.readBigUInt64LE(locatorAt + 8));
    expect(buf.readUInt32LE(eocd64At)).toBe(0x06064b50);
    count = Number(buf.readBigUInt64LE(eocd64At + 32));
    cdOffset = Number(buf.readBigUInt64LE(eocd64At + 48));
  }

  const entries: ParsedEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i += 1) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const versionNeeded = buf.readUInt16LE(p + 6);
    const method = buf.readUInt16LE(p + 10);
    const checksum = buf.readUInt32LE(p + 16);
    let compressedSize = buf.readUInt32LE(p + 20);
    let size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    let localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');

    let extraZip64 = false;
    const extraStart = p + 46 + nameLen;
    if (extraLen > 0 && buf.readUInt16LE(extraStart) === 0x0001) {
      extraZip64 = true;
      let q = extraStart + 4;
      if (size === 0xffffffff) {
        size = Number(buf.readBigUInt64LE(q));
        q += 8;
      }
      if (compressedSize === 0xffffffff) {
        compressedSize = Number(buf.readBigUInt64LE(q));
        q += 8;
      }
      if (localOffset === 0xffffffff) {
        localOffset = Number(buf.readBigUInt64LE(q));
      }
    }
    entries.push({ name, method, crc32: checksum, compressedSize, size, localOffset, versionNeeded, extraZip64 });
    p = extraStart + extraLen + commentLen;
  }
  return { entries, zip64Eocd };
}

/** 按本地头读出某个条目的原始内容（store 直接读，deflate 解压）。 */
function readEntryContent(buf: Buffer, entry: ParsedEntry): Buffer {
  const p = entry.localOffset;
  expect(buf.readUInt32LE(p)).toBe(0x04034b50);
  const nameLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);
  const dataStart = p + 30 + nameLen + extraLen;
  const raw = buf.subarray(dataStart, dataStart + entry.compressedSize);
  const content = entry.method === 8 ? inflateRawSync(raw) : raw;
  expect(content.length).toBe(entry.size);
  expect(crc32(content)).toBe(entry.crc32);
  return content;
}

function unzipAvailable(): boolean {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const HAS_UNZIP = unzipAvailable();
const FIXED = dosDateTime(new Date('2026-10-04T12:00:00'));
const OPTS = { dosTime: FIXED.dosTime, dosDate: FIXED.dosDate };

let dir: string;

beforeAll(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'zip-test-'));
});

afterAll(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
});

describe('CRC32', () => {
  it('标准测试向量', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });

  it('增量计算与一次性计算一致', () => {
    const data = Buffer.alloc(100000);
    for (let i = 0; i < data.length; i += 1) data[i] = i % 251;
    const oneShot = crc32(data);
    const inc = new Crc32();
    for (let off = 0; off < data.length; off += 7777) inc.update(data.subarray(off, off + 7777));
    expect(inc.digest()).toBe(oneShot);
  });
});

describe('小工具', () => {
  it('DOS 时间编码', () => {
    const { dosTime, dosDate } = dosDateTime(new Date(2026, 9, 4, 13, 30, 26));
    expect(dosDate).toBe(((2026 - 1980) << 9) | (10 << 5) | 4);
    expect(dosTime).toBe((13 << 11) | (30 << 5) | 13);
  });

  it('文件名清洗：去掉路径分隔与控制字符', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('.._.._etc_passwd'.replace(/^\.+/, '_'));
    expect(sanitizeFileName('正常 照片.jpg')).toBe('正常 照片.jpg');
    expect(sanitizeFileName('a/b\\c:d')).toBe('a_b_c_d');
    expect(sanitizeFileName('...')).toBe('_');
    expect(sanitizeFileName('')).toBe('file');
  });

  it('重名条目自动加序号', () => {
    const used = new Set<string>();
    expect(uniqueEntryName('001-a.jpg', used)).toBe('001-a.jpg');
    expect(uniqueEntryName('001-a.jpg', used)).toBe('001-a-2.jpg');
    expect(uniqueEntryName('001-a.jpg', used)).toBe('001-a-3.jpg');
    expect(uniqueEntryName('README', used)).toBe('README');
    expect(uniqueEntryName('README', used)).toBe('README-2');
  });
});

describe('ZipWriter', () => {
  it('写出的 ZIP 结构正确，且通过 unzip -t 交叉校验', async () => {
    const part = path.join(dir, 'basic.zip');
    const mediaPath = path.join(dir, 'photo.bin');
    const media = Buffer.alloc(200000);
    for (let i = 0; i < media.length; i += 1) media[i] = (i * 7) % 256;
    await fsp.writeFile(mediaPath, media);

    const writer = await ZipWriter.create(part, OPTS);
    await writer.appendDeflated('root/items/a.md', Buffer.from('# 樟木箱\n故事', 'utf8'));
    const { record, sha256 } = await writer.appendStored('root/media/a/001-photo.bin', mediaPath);
    expect(sha256).toBe(createHash('sha256').update(media).digest('hex'));
    expect(record.size).toBe(media.length);
    await writer.appendDeflated('root/manifest.json', Buffer.from('{"a":1}'));
    await writer.finalize();

    const buf = await fsp.readFile(part);
    const { entries, zip64Eocd } = parseCentralDirectory(buf);
    expect(zip64Eocd).toBe(false);
    expect(entries.map((e) => e.name)).toEqual(['root/items/a.md', 'root/media/a/001-photo.bin', 'root/manifest.json']);
    expect(entries[0]!.method).toBe(8);
    expect(entries[1]!.method).toBe(0);
    expect(readEntryContent(buf, entries[0]!).toString('utf8')).toBe('# 樟木箱\n故事');
    expect(readEntryContent(buf, entries[1]!)).toEqual(media);
    expect(readEntryContent(buf, entries[2]!).toString('utf8')).toBe('{"a":1}');

    if (HAS_UNZIP) {
      expect(() => execFileSync('unzip', ['-t', part], { stdio: 'pipe' })).not.toThrow();
      const listing = execFileSync('unzip', ['-Z1', part], { encoding: 'utf8' });
      expect(listing.trim().split('\n')).toContain('root/media/a/001-photo.bin');
    }
  });

  it('中断后从检查点续传：截断脏数据再继续，最终包无重复条目', async () => {
    const part = path.join(dir, 'resumed.zip');
    const fileA = path.join(dir, 'a.bin');
    const fileB = path.join(dir, 'b.bin');
    const dataA = Buffer.alloc(50000, 0x41);
    const dataB = Buffer.alloc(60000, 0x42);
    await fsp.writeFile(fileA, dataA);
    await fsp.writeFile(fileB, dataB);

    // 第一次尝试：写完 A 与半个 B 后「崩溃」
    const first = await ZipWriter.create(part, OPTS);
    const recA = (await first.appendStored('root/a.bin', fileA)).record;
    const checkpointOffset = first.offset;
    const checkpointRecords: ZipEntryRecord[] = [...first.records];
    // 模拟写了一半的 B：直接写原始字节后丢弃写出器（不 finalize）
    const partial = await ZipWriter.resume(part, checkpointRecords, checkpointOffset, OPTS);
    const recB = await partial.appendStored('root/b.bin', fileB);
    expect(recB.record.size).toBe(60000);
    // 崩溃点：只持久化了 A 的检查点，B 的字节留在文件里
    partial.close();

    // 恢复：检查点只认 A，B 的残留字节被截断后重写
    const second = await ZipWriter.resume(part, checkpointRecords, checkpointOffset, OPTS);
    expect(second.offset).toBe(checkpointOffset);
    await second.appendStored('root/b.bin', fileB);
    await second.appendDeflated('root/done.txt', Buffer.from('ok'));
    await second.finalize();

    const buf = await fsp.readFile(part);
    const { entries } = parseCentralDirectory(buf);
    expect(entries.map((e) => e.name)).toEqual(['root/a.bin', 'root/b.bin', 'root/done.txt']);
    expect(readEntryContent(buf, entries[0]!)).toEqual(dataA);
    expect(readEntryContent(buf, entries[1]!)).toEqual(dataB);
    // 文件里不存在两份 B：总尺寸 = A 条目 + B 条目 + done 条目 + 中央目录，无残留
    if (HAS_UNZIP) {
      expect(() => execFileSync('unzip', ['-t', part], { stdio: 'pipe' })).not.toThrow();
      const listing = execFileSync('unzip', ['-Z1', part], { encoding: 'utf8' });
      expect(listing.trim().split('\n').filter((n) => n === 'root/b.bin')).toHaveLength(1);
    }
  });

  it('崩溃发生在 finalize 之后：截断到检查点可安全重打中央目录', async () => {
    const part = path.join(dir, 'finalized-twice.zip');
    const writer = await ZipWriter.create(part, OPTS);
    await writer.appendDeflated('root/a.txt', Buffer.from('hello'));
    const records = [...writer.records];
    const offset = writer.offset;
    await writer.finalize(); // 完整写完，模拟「finalize 完成但状态未持久化」

    const resumed = await ZipWriter.resume(part, records, offset, OPTS);
    await resumed.finalize();

    const buf = await fsp.readFile(part);
    const { entries } = parseCentralDirectory(buf);
    expect(entries.map((e) => e.name)).toEqual(['root/a.txt']);
    expect(readEntryContent(buf, entries[0]!).toString('utf8')).toBe('hello');
    if (HAS_UNZIP) expect(() => execFileSync('unzip', ['-t', part], { stdio: 'pipe' })).not.toThrow();
  });

  it('ZIP64：超过门槛时写 ZIP64 扩展与 ZIP64 EOCD', async () => {
    const part = path.join(dir, 'zip64.zip');
    const filePath = path.join(dir, 'big.bin');
    const data = Buffer.alloc(1000, 0x5a);
    await fsp.writeFile(filePath, data);

    // 把门槛调到 10 字节，强制走 ZIP64 分支
    const writer = await ZipWriter.create(part, { ...OPTS, zip64Threshold: 10 });
    await writer.appendStored('root/big.bin', filePath);
    await writer.appendDeflated('root/small.txt', Buffer.from('tiny'));
    await writer.finalize();

    const buf = await fsp.readFile(part);
    const { entries, zip64Eocd } = parseCentralDirectory(buf);
    expect(zip64Eocd).toBe(true);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.extraZip64).toBe(true);
    expect(entries[0]!.versionNeeded).toBe(45);
    expect(entries[0]!.size).toBe(1000);
    expect(readEntryContent(buf, entries[0]!)).toEqual(data);
    expect(readEntryContent(buf, entries[1]!).toString('utf8')).toBe('tiny');
    if (HAS_UNZIP) {
      expect(() => execFileSync('unzip', ['-t', part], { stdio: 'pipe' })).not.toThrow();
      const info = execFileSync('zipinfo', ['-v', part], { encoding: 'utf8' });
      expect(info).toContain('big.bin');
    }
  });

  it('空文件与空文本条目也能正确打包', async () => {
    const part = path.join(dir, 'empty.zip');
    const emptyFile = path.join(dir, 'empty.bin');
    await fsp.writeFile(emptyFile, Buffer.alloc(0));

    const writer = await ZipWriter.create(part, OPTS);
    await writer.appendStored('root/empty.bin', emptyFile);
    await writer.appendDeflated('root/empty.txt', Buffer.alloc(0));
    await writer.finalize();

    const buf = await fsp.readFile(part);
    const { entries } = parseCentralDirectory(buf);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.size).toBe(0);
    expect(entries[0]!.crc32).toBe(0);
    expect(readEntryContent(buf, entries[1]!)).toEqual(Buffer.alloc(0));
    if (HAS_UNZIP) expect(() => execFileSync('unzip', ['-t', part], { stdio: 'pipe' })).not.toThrow();
  });

  it('文件在打包过程中被改动会报错而不是产出坏包', async () => {
    const part = path.join(dir, 'changed.zip');
    const target = path.join(dir, 'changing.bin');
    await fsp.writeFile(target, Buffer.alloc(100, 0x31));

    const writer = await ZipWriter.create(part, OPTS);
    // 在流式读取期间把文件改大：stat 与实读不一致必须被发现
    const origReadStream = fs.createReadStream;
    let calls = 0;
    // @ts-expect-error 测试内打补丁
    fs.createReadStream = (...args: unknown[]) => {
      calls += 1;
      const stream = origReadStream(...(args as [string]));
      if (calls === 1) {
        stream.once('open', () => {
          fs.writeFileSync(target, Buffer.alloc(5000, 0x32));
        });
      }
      return stream;
    };
    await expect(writer.appendStored('root/changing.bin', target)).rejects.toThrow('发生变化');
    // @ts-expect-error 还原
    fs.createReadStream = origReadStream;
    writer.close();
  });
});
