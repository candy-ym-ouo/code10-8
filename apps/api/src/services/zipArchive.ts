import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const zlib = require('node:zlib') as typeof import('node:zlib');

/**
 * 可断点续传的流式 ZIP 写出器。
 *
 * 为什么不用 archiver：导出任务要求「中断后复用已完成部分」，即进程崩溃后能从
 * 最后一个完整条目继续追加，而不是从头再压一遍。ZIP 格式本身允许这样做——
 * 每个条目自包含，中央目录在最后。这里手写一个刚好够用的写出器：
 *
 * - 媒体条目用 store（不压缩）：jpg/webp/mp3/pdf 本身就是压缩格式，再压只会
 *   浪费 CPU；store 也让「截断到指定偏移续写」变得简单可靠。
 * - 文本条目（Markdown/CSV/JSON）先在内存里 deflate 再写入，尺寸与 CRC 都是
 *   确定的，同样支持续写。
 * - 每个媒体条目在写入的同时计算 CRC32 与 sha256，写完回填本地头的 CRC 字段；
 *   调用方拿到 sha256 与档案记录比对，实现「按内容摘要校验」。
 * - 调用方在每个条目写完后记录 offset 作为检查点；崩溃恢复时把 .part 截断到
 *   检查点偏移，坏掉/多余的条目随之消失，最终包里不会出现重复条目。
 * - 支持 ZIP64（单文件 ≥4GB 或归档 ≥4GB 时自动启用）。
 */

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const ZIP64_EXTRA_ID = 0x0001;
const UTF8_FLAG = 0x0800;
/** 外部属性：普通文件 + 0644，解压后权限正常（>>> 0 保持为无符号） */
const EXTERNAL_ATTRS = (0o100644 << 16) >>> 0;

const U32_MAX = 0xffffffff;

// ---------------------------------------------------------------- CRC32

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32Js(buf: Buffer, previous: number): number {
  let c = (previous ^ 0xffffffff) >>> 0;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Node ≥ 20.15 自带原生 crc32，快一个数量级；旧版本回退到纯 JS 实现。 */
const nativeCrc32: ((data: Buffer, value?: number) => number) | undefined =
  typeof (zlib as { crc32?: unknown }).crc32 === 'function'
    ? (zlib as unknown as { crc32: (data: Buffer, value?: number) => number }).crc32
    : undefined;

/** 标准 CRC-32（与 ZIP/PNG 相同），支持增量计算。 */
export function crc32(buf: Buffer, previous = 0): number {
  return nativeCrc32 ? nativeCrc32(buf, previous) : crc32Js(buf, previous);
}

export class Crc32 {
  private value = 0;

  update(buf: Buffer): this {
    this.value = crc32(buf, this.value);
    return this;
  }

  digest(): number {
    return this.value >>> 0;
  }
}

// ---------------------------------------------------------------- 小工具

/** ZIP 时间戳用 DOS 格式（2 秒精度）。 */
export function dosDateTime(d: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    dosTime: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    dosDate: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** 用户文件名进入 ZIP 前的清洗：去掉路径分隔与控制字符，避免解压时目录穿越。 */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/^\.+/, '_')
    .replace(/[. ]+$/, '')
    .trim();
  return (cleaned || 'file').slice(0, 120);
}

/** 同一目录下重名时追加 -2、-3…，保证包内条目名唯一、不互相覆盖。 */
export function uniqueEntryName(desired: string, used: Set<string>): string {
  if (!used.has(desired)) {
    used.add(desired);
    return desired;
  }
  const dot = desired.lastIndexOf('.');
  const stem = dot > 0 ? desired.slice(0, dot) : desired;
  const ext = dot > 0 ? desired.slice(dot) : '';
  for (let i = 2; ; i += 1) {
    const candidate = `${stem}-${i}${ext}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

// ---------------------------------------------------------------- 写出器

export interface ZipEntryRecord {
  name: string;
  method: 0 | 8;
  crc32: number;
  compressedSize: number;
  size: number;
  localOffset: number;
  /** 条目尺寸达到 ZIP64 门槛（在追加时确定，续传后仍一致） */
  zip64: boolean;
}

export interface ZipWriterOptions {
  dosTime: number;
  dosDate: number;
  /** 测试可下调以走 ZIP64 分支；默认 0xFFFFFFFF */
  zip64Threshold?: number;
}

export class ZipWriter {
  private fd: number;

  private _offset: number;

  readonly records: ZipEntryRecord[];

  private readonly dosTime: number;

  private readonly dosDate: number;

  private readonly zip64Threshold: number;

  private closed = false;

  private constructor(fd: number, offset: number, records: ZipEntryRecord[], opts: ZipWriterOptions) {
    this.fd = fd;
    this._offset = offset;
    this.records = records;
    this.dosTime = opts.dosTime;
    this.dosDate = opts.dosDate;
    this.zip64Threshold = opts.zip64Threshold ?? U32_MAX;
  }

  /** 新建（截断已有文件）。 */
  static async create(partPath: string, opts: ZipWriterOptions): Promise<ZipWriter> {
    await fsp.mkdir(path.dirname(partPath), { recursive: true });
    const fd = fs.openSync(partPath, 'w');
    return new ZipWriter(fd, 0, [], opts);
  }

  /**
   * 从检查点恢复：打开已有 .part，截断到 offset（去掉上次中断时写了一半的
   * 条目），并继承已完成的中央目录记录。
   */
  static async resume(partPath: string, records: ZipEntryRecord[], offset: number, opts: ZipWriterOptions): Promise<ZipWriter> {
    const stat = await fsp.stat(partPath).catch(() => null);
    if (!stat || stat.size < offset) {
      throw new Error(`部分文件缺失或小于检查点（需要 ${offset} 字节），无法续传`);
    }
    const fd = fs.openSync(partPath, 'r+');
    fs.ftruncateSync(fd, offset);
    return new ZipWriter(fd, offset, [...records], opts);
  }

  get offset(): number {
    return this._offset;
  }

  private write(buf: Buffer): void {
    fs.writeSync(this.fd, buf, 0, buf.length, this._offset);
    this._offset += buf.length;
  }

  private localHeader(nameLen: number, extraLen: number, method: 0 | 8, zip64: boolean): Buffer {
    const header = Buffer.alloc(30);
    header.writeUInt32LE(LOCAL_SIG, 0);
    header.writeUInt16LE(zip64 ? 45 : 20, 4);
    header.writeUInt16LE(UTF8_FLAG, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(this.dosTime, 10);
    header.writeUInt16LE(this.dosDate, 12);
    // crc32（偏移 14）与尺寸（18/22）由调用方填写；store 条目先写 0，写完数据后回填
    header.writeUInt16LE(nameLen, 26);
    header.writeUInt16LE(extraLen, 28);
    return header;
  }

  private zip64SizesExtra(size: number, compressedSize: number): Buffer {
    const extra = Buffer.alloc(4 + 16);
    extra.writeUInt16LE(ZIP64_EXTRA_ID, 0);
    extra.writeUInt16LE(16, 2);
    extra.writeBigUInt64LE(BigInt(size), 4);
    extra.writeBigUInt64LE(BigInt(compressedSize), 12);
    return extra;
  }

  /**
   * 以 store 方式追加一个磁盘文件，同时计算 CRC32 与 sha256。
   * 返回条目记录与内容摘要，调用方据此做「按内容摘要校验」。
   */
  async appendStored(name: string, absPath: string): Promise<{ record: ZipEntryRecord; sha256: string }> {
    this.assertOpen();
    const stat = await fsp.stat(absPath);
    const size = stat.size;
    const nameBuf = Buffer.from(name, 'utf8');
    const zip64 = size >= this.zip64Threshold || this._offset >= this.zip64Threshold;
    const extra = zip64 ? this.zip64SizesExtra(size, size) : Buffer.alloc(0);

    const header = this.localHeader(nameBuf.length, extra.length, 0, zip64);
    header.writeUInt32LE(zip64 ? U32_MAX : size, 18);
    header.writeUInt32LE(zip64 ? U32_MAX : size, 22);

    const localOffset = this._offset;
    this.write(header);
    this.write(nameBuf);
    if (extra.length) this.write(extra);

    const crc = new Crc32();
    const sha = createHash('sha256');
    let read = 0;
    for await (const chunk of fs.createReadStream(absPath)) {
      const buf = chunk as Buffer;
      crc.update(buf);
      sha.update(buf);
      this.write(buf);
      read += buf.length;
    }
    if (read !== size) {
      throw new Error(`文件在打包过程中发生变化（${absPath}）：期望 ${size} 字节，读到 ${read} 字节`);
    }

    // 回填本地头的 CRC（尺寸在写头时已确定，无需回填）
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32LE(crc.digest(), 0);
    fs.writeSync(this.fd, crcBuf, 0, 4, localOffset + 14);

    const record: ZipEntryRecord = {
      name,
      method: 0,
      crc32: crc.digest(),
      compressedSize: size,
      size,
      localOffset,
      zip64,
    };
    this.records.push(record);
    return { record, sha256: sha.digest('hex') };
  }

  /** 以 deflate 方式追加一段内存数据（Markdown / CSV / JSON 等文本条目）。 */
  async appendDeflated(name: string, data: Buffer): Promise<ZipEntryRecord> {
    this.assertOpen();
    const compressed = deflateRawSync(data, { level: 6 });
    const checksum = crc32(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const zip64 =
      data.length >= this.zip64Threshold || compressed.length >= this.zip64Threshold || this._offset >= this.zip64Threshold;
    const extra = zip64 ? this.zip64SizesExtra(data.length, compressed.length) : Buffer.alloc(0);

    const header = this.localHeader(nameBuf.length, extra.length, 8, zip64);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(zip64 ? U32_MAX : compressed.length, 18);
    header.writeUInt32LE(zip64 ? U32_MAX : data.length, 22);

    const localOffset = this._offset;
    this.write(header);
    this.write(nameBuf);
    if (extra.length) this.write(extra);
    this.write(compressed);

    const record: ZipEntryRecord = {
      name,
      method: 8,
      crc32: checksum,
      compressedSize: compressed.length,
      size: data.length,
      localOffset,
      zip64,
    };
    this.records.push(record);
    return record;
  }

  private centralHeader(rec: ZipEntryRecord): Buffer {
    const nameBuf = Buffer.from(rec.name, 'utf8');
    const offset64 = rec.localOffset >= this.zip64Threshold;
    const needs64 = rec.zip64 || offset64;

    // ZIP64 扩展字段：按规范顺序放 原始尺寸 / 压缩尺寸 / 本地头偏移，只放超标的项
    let extraLen = 0;
    if (needs64) extraLen = 4 + (rec.zip64 ? 16 : 0) + (offset64 ? 8 : 0);
    const extra = Buffer.alloc(extraLen);
    if (needs64) {
      let p = 0;
      extra.writeUInt16LE(ZIP64_EXTRA_ID, p);
      extra.writeUInt16LE(extraLen - 4, p + 2);
      p += 4;
      if (rec.zip64) {
        extra.writeBigUInt64LE(BigInt(rec.size), p);
        extra.writeBigUInt64LE(BigInt(rec.compressedSize), p + 8);
        p += 16;
      }
      if (offset64) extra.writeBigUInt64LE(BigInt(rec.localOffset), p);
    }

    const header = Buffer.alloc(46);
    header.writeUInt32LE(CENTRAL_SIG, 0);
    header.writeUInt16LE(needs64 ? 0x032d : 0x031e, 4); // version made by：Unix + 4.5/3.0
    header.writeUInt16LE(needs64 ? 45 : 20, 6);
    header.writeUInt16LE(UTF8_FLAG, 8);
    header.writeUInt16LE(rec.method, 10);
    header.writeUInt16LE(this.dosTime, 12);
    header.writeUInt16LE(this.dosDate, 14);
    header.writeUInt32LE(rec.crc32, 16);
    header.writeUInt32LE(rec.zip64 ? U32_MAX : rec.compressedSize, 20);
    header.writeUInt32LE(rec.zip64 ? U32_MAX : rec.size, 24);
    header.writeUInt16LE(nameBuf.length, 28);
    header.writeUInt16LE(extraLen, 30);
    // comment 0、disk 0、internal attrs 0
    header.writeUInt32LE(EXTERNAL_ATTRS, 38);
    header.writeUInt32LE(offset64 ? U32_MAX : rec.localOffset, 42);
    return Buffer.concat([header, nameBuf, extra]);
  }

  /** 写中央目录与结束记录，fsync 后关闭。调用后不能再追加。 */
  async finalize(): Promise<void> {
    this.assertOpen();
    const cdStart = this._offset;
    for (const rec of this.records) this.write(this.centralHeader(rec));
    const cdSize = this._offset - cdStart;
    const count = this.records.length;

    const needZip64 =
      count >= 0xffff ||
      cdStart >= this.zip64Threshold ||
      cdSize >= this.zip64Threshold ||
      this.records.some((r) => r.zip64 || r.localOffset >= this.zip64Threshold);

    if (needZip64) {
      const zip64EocdOffset = this._offset;
      const eocd64 = Buffer.alloc(56);
      eocd64.writeUInt32LE(ZIP64_EOCD_SIG, 0);
      eocd64.writeBigUInt64LE(BigInt(44), 4); // 记录剩余长度
      eocd64.writeUInt16LE(45, 12);
      eocd64.writeUInt16LE(45, 14);
      // 磁盘号字段均为 0（单磁盘）
      eocd64.writeBigUInt64LE(BigInt(count), 24);
      eocd64.writeBigUInt64LE(BigInt(count), 32);
      eocd64.writeBigUInt64LE(BigInt(cdSize), 40);
      eocd64.writeBigUInt64LE(BigInt(cdStart), 48);
      this.write(eocd64);

      const locator = Buffer.alloc(20);
      locator.writeUInt32LE(ZIP64_LOCATOR_SIG, 0);
      locator.writeBigUInt64LE(BigInt(zip64EocdOffset), 8);
      locator.writeUInt32LE(1, 16); // 总磁盘数
      this.write(locator);
    }

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(EOCD_SIG, 0);
    eocd.writeUInt16LE(count >= 0xffff ? 0xffff : count, 8);
    eocd.writeUInt16LE(count >= 0xffff ? 0xffff : count, 10);
    eocd.writeUInt32LE(cdSize >= U32_MAX || (needZip64 && cdSize >= this.zip64Threshold) ? U32_MAX : cdSize, 12);
    eocd.writeUInt32LE(cdStart >= U32_MAX || (needZip64 && cdStart >= this.zip64Threshold) ? U32_MAX : cdStart, 16);
    this.write(eocd);

    fs.fsyncSync(this.fd);
    fs.closeSync(this.fd);
    this.closed = true;
  }

  /** 放弃时关闭（不补中央目录，.part 由调用方决定保留或删除）。 */
  close(): void {
    if (!this.closed) {
      try {
        fs.closeSync(this.fd);
      } catch {
        // 已关闭
      }
      this.closed = true;
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('ZIP 写出器已关闭');
  }
}
