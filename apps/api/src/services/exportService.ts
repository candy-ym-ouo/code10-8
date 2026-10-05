import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CATEGORY_LABELS, ITEM_STATUS_LABELS, VISIBILITY_LABELS, formatAcquired, htmlToText } from '@heirloom/shared';
import type { Job } from '@prisma/client';
import { prisma } from '../db';
import { config } from '../config';
import { logger } from '../logger';
import { notFound } from '../http/errors';
import { absOf, extensionFor } from '../storage/local';
import { sha256File, slugify } from '../utils/crypto';
import { ZipWriter, dosDateTime, sanitizeFileName, uniqueEntryName, type ZipEntryRecord } from './zipArchive';
import * as audit from './auditService';
import type { FamilyContext } from './permissionService';

/**
 * 全量导出：增量打包 + 断点续传 + 内容摘要校验。
 *
 * 磁盘布局（EXPORT_ROOT/<familyId>/）：
 *   staging/objects/<sha前两位>/<sha256>.<ext>   内容寻址的媒体暂存区。
 *     同一家庭的所有导出任务共享：已暂存的媒体直接复用（增量打包），
 *     同一内容只存一份（硬链接到内容寻址存储，天然不产生重复文件）。
 *   staging/.lastuse                            暂存区最近使用时间，GC 依据。
 *   <jobId>.plan.json                           打包计划：任务首次执行时冻结的
 *     条目快照（文本内容、媒体清单、顺序），重试时继续用，保证多次尝试产出
 *     的是同一份包。
 *   <jobId>.state.json                          断点检查点：已写到第几个条目、
 *     每个条目结束时的偏移、中央目录记录、缺失媒体列表。原子写（tmp+rename）。
 *   <jobId>.zip.part                            组装中的 ZIP。中断后按检查点截断
 *     续写；写完后原子改名成 <jobId>.zip，下载端永远看不到半成品。
 *
 * 媒体校验：暂存时若是复制则边复制边算 sha256 与档案记录比对；写入 ZIP 时
 * 再算一次（同一趟读取，不额外花钱），不一致就删掉暂存副本并让任务失败重试。
 */

export interface ActorMeta {
  ip?: string | null;
  userAgent?: string | null;
}

// ---------------------------------------------------------------- 计划与检查点

interface PlanTextEntry {
  kind: 'text';
  name: string;
  text: string;
}

interface PlanMediaEntry {
  kind: 'media';
  /** ZIP 内路径（含根目录） */
  name: string;
  mediaId: string;
  itemId: string;
  storageKey: string;
  sha256: string;
  size: number;
  /** 相对 staging/objects/ 的内容寻址路径 */
  stagedRel: string;
  /** media/index.csv 里的一行 */
  indexRow: string;
  /** SHA256SUMS 里的一行（相对导出根目录，可直接 sha256sum -c） */
  sumsLine: string;
}

type TailKind = 'itemsCsv' | 'mediaIndex' | 'sums' | 'readme' | 'manifest';

interface PlanTailEntry {
  kind: 'tail';
  tail: TailKind;
  name: string;
}

type PlanEntry = PlanTextEntry | PlanMediaEntry | PlanTailEntry;

interface ExportPlan {
  version: 1;
  jobId: string;
  familyId: string;
  createdAt: string;
  root: string;
  dosTime: number;
  dosDate: number;
  familyName: string;
  itemCount: number;
  /** items.csv 的全部行（含表头），计划时冻结 */
  csvRows: string[];
  entries: PlanEntry[];
}

interface ExportState {
  version: 1;
  /** 已处理到计划里的第几个条目 */
  written: number;
  /** 每个已写 ZIP 条目结束时的文件偏移（与 records 对齐） */
  offsets: number[];
  /** 已写条目的中央目录记录（续传时交给 ZipWriter） */
  records: ZipEntryRecord[];
  /** 源文件已丢失、被跳过的媒体 id */
  missing: string[];
  stagedMedia: number;
  reusedMedia: number;
}

export interface ExportBuildResult {
  file: string;
  items: number;
  media: number;
  bytes: number;
  sha256: string;
  stagedMedia: number;
  reusedMedia: number;
  missingMedia: number;
}

// ---------------------------------------------------------------- 路径约定

export function exportZipPath(familyId: string, jobId: string): string {
  return path.join(config.EXPORT_ROOT, familyId, `${jobId}.zip`);
}

function exportPartPath(familyId: string, jobId: string): string {
  return path.join(config.EXPORT_ROOT, familyId, `${jobId}.zip.part`);
}

function planPath(familyId: string, jobId: string): string {
  return path.join(config.EXPORT_ROOT, familyId, `${jobId}.plan.json`);
}

function statePath(familyId: string, jobId: string): string {
  return path.join(config.EXPORT_ROOT, familyId, `${jobId}.state.json`);
}

function stagingObjectsDir(familyId: string): string {
  return path.join(config.EXPORT_ROOT, familyId, 'staging', 'objects');
}

function stagingDir(familyId: string): string {
  return path.join(config.EXPORT_ROOT, familyId, 'staging');
}

// ---------------------------------------------------------------- 任务创建 / 查询

export async function createExportJob(userId: string, ctx: FamilyContext, meta: ActorMeta) {
  // 同一家庭已有排队/进行中的导出时直接复用，避免重复打包占两份磁盘
  const existing = await prisma.job.findFirst({
    where: { familyId: ctx.familyId, type: 'export_build', status: { in: ['queued', 'running'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) return { jobId: existing.id, status: existing.status };

  const job = await prisma.$transaction(async (tx) => {
    const created = await tx.job.create({
      data: {
        familyId: ctx.familyId,
        type: 'export_build',
        payload: { requestedBy: userId } as never,
      },
    });
    await audit.record(
      {
        familyId: ctx.familyId,
        actorId: userId,
        action: 'export.create',
        targetType: 'job',
        targetId: created.id,
        ...meta,
      },
      tx,
    );
    return created;
  });
  return { jobId: job.id, status: job.status };
}

export async function getExportJob(familyId: string, jobId: string) {
  const job = await prisma.job.findFirst({ where: { id: jobId, familyId, type: 'export_build' } });
  if (!job) throw notFound('导出任务不存在');
  // result 里的 file 是服务器绝对路径，不下发给前端
  const raw = (job.result ?? null) as Record<string, unknown> | null;
  const result = raw ? Object.fromEntries(Object.entries(raw).filter(([k]) => k !== 'file')) : null;
  return {
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    lastError: job.lastError,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
    downloadUrl: job.status === 'done' ? `/api/v1/families/${familyId}/exports/${job.id}/download` : null,
    result,
  };
}

// ---------------------------------------------------------------- 计划生成

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return `"${s.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
}

type ItemWithRelations = NonNullable<Awaited<ReturnType<typeof loadItems>>>[number];

async function loadItems(familyId: string) {
  return prisma.item.findMany({
    where: { familyId, status: { not: 'trashed' } },
    include: {
      media: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
      people: { include: { person: true } },
      creator: { select: { displayName: true } },
    },
    orderBy: { sortAt: 'asc' },
  });
}

function buildItemMarkdown(item: ItemWithRelations, mediaFileNames: string[]): string {
  const peopleNames = item.people.map((p) => p.person.name).join('、');
  const acquired = formatAcquired({
    acquiredAt: item.acquiredAt,
    acquiredPrecision: item.acquiredPrecision,
    acquiredLabel: item.acquiredLabel,
  });
  return [
    `# ${item.title}`,
    '',
    `- 分类：${CATEGORY_LABELS[item.category]}`,
    `- 获得时间：${acquired}${item.acquiredNote ? `（${item.acquiredNote}）` : ''}`,
    `- 来源人物：${peopleNames || '未记录'}`,
    `- 地点：${[item.placeProvince, item.placeCity, item.placeText].filter(Boolean).join(' ') || '未记录'}`,
    `- 存放位置：${item.storageLocation ?? '未记录'}`,
    `- 保存状况：${item.condition ?? '未记录'}`,
    `- 可见范围：${VISIBILITY_LABELS[item.visibility]}`,
    '',
    '## 故事',
    '',
    item.storyHtml ? htmlToText(item.storyHtml) : '（暂无）',
    '',
    '## 图片 / 音频 / 文件',
    '',
    ...(item.media.length
      ? item.media.map(
          (m, idx) =>
            `${idx + 1}. \`media/${item.id}/${mediaFileNames[idx]!}\` — ${m.caption ?? m.kind}${m.transcript ? `\n   听写稿：${m.transcript}` : ''}`,
        )
      : ['（暂无）']),
    '',
  ].join('\n');
}

/** 首次执行时冻结一份打包计划；重试/续传都按这份快照走。 */
async function createPlan(job: Job, familyId: string): Promise<ExportPlan> {
  const family = await prisma.family.findUniqueOrThrow({ where: { id: familyId } });
  const items = await loadItems(familyId);

  const createdAt = new Date();
  const root = `family-${slugify(family.name)}-${createdAt.toISOString().slice(0, 10)}`;
  const { dosTime, dosDate } = dosDateTime(createdAt);

  const entries: PlanEntry[] = [];
  const csvRows: string[] = ['标题,分类,获得时间,时间精度,来源人物,地点,状态,可见性,创建者,媒体数'];

  for (const item of items) {
    const peopleNames = item.people.map((p) => p.person.name).join('、');
    const acquired = formatAcquired({
      acquiredAt: item.acquiredAt,
      acquiredPrecision: item.acquiredPrecision,
      acquiredLabel: item.acquiredLabel,
    });

    csvRows.push(
      [
        csvCell(item.title),
        csvCell(CATEGORY_LABELS[item.category]),
        csvCell(acquired),
        csvCell(item.acquiredPrecision),
        csvCell(peopleNames),
        csvCell([item.placeProvince, item.placeCity, item.placeText].filter(Boolean).join(' ')),
        csvCell(ITEM_STATUS_LABELS[item.status]),
        csvCell(VISIBILITY_LABELS[item.visibility]),
        csvCell(item.creator.displayName),
        csvCell(item.media.length),
      ].join(','),
    );

    // 媒体条目：文件名清洗 + 同目录重名去重，保证包内路径唯一
    const usedNames = new Set<string>();
    const mediaFileNames: string[] = [];
    const mediaEntries: PlanMediaEntry[] = [];
    for (const m of item.media) {
      const fileName = uniqueEntryName(
        `${String(m.sortOrder).padStart(3, '0')}-${sanitizeFileName(m.originalName)}`,
        usedNames,
      );
      mediaFileNames.push(fileName);
      mediaEntries.push({
        kind: 'media',
        name: `${root}/media/${item.id}/${fileName}`,
        mediaId: m.id,
        itemId: item.id,
        storageKey: m.storageKey,
        sha256: m.sha256,
        size: Number(m.byteSize),
        stagedRel: path.posix.join(m.sha256.slice(0, 2), `${m.sha256}.${extensionFor(m.mimeType)}`),
        indexRow: [item.id, csvCell(item.title), m.sortOrder, m.kind, csvCell(m.originalName), m.sha256, Number(m.byteSize), m.mimeType].join(','),
        sumsLine: `${m.sha256} *media/${item.id}/${fileName}`,
      });
    }

    entries.push({ kind: 'text', name: `${root}/items/${item.id}.md`, text: buildItemMarkdown(item, mediaFileNames) });
    entries.push(...mediaEntries);
  }

  // 汇总类条目放最后：内容在写入时根据「实际打包结果」生成（缺失媒体会被剔除）
  entries.push({ kind: 'tail', tail: 'itemsCsv', name: `${root}/items.csv` });
  entries.push({ kind: 'tail', tail: 'mediaIndex', name: `${root}/media/index.csv` });
  entries.push({ kind: 'tail', tail: 'sums', name: `${root}/SHA256SUMS` });
  entries.push({ kind: 'tail', tail: 'readme', name: `${root}/README.txt` });
  entries.push({ kind: 'tail', tail: 'manifest', name: `${root}/manifest.json` });

  return {
    version: 1,
    jobId: job.id,
    familyId,
    createdAt: createdAt.toISOString(),
    root,
    dosTime,
    dosDate,
    familyName: family.name,
    itemCount: items.length,
    csvRows,
    entries,
  };
}

// ---------------------------------------------------------------- 计划/状态读写

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}`;
  await fsp.writeFile(tmp, JSON.stringify(value));
  await fsp.rename(tmp, file);
}

async function loadPlan(file: string, jobId: string, familyId: string): Promise<ExportPlan | null> {
  try {
    const plan = JSON.parse(await fsp.readFile(file, 'utf8')) as ExportPlan;
    if (plan.version !== 1 || plan.jobId !== jobId || plan.familyId !== familyId || !Array.isArray(plan.entries)) return null;
    return plan;
  } catch {
    return null;
  }
}

function freshState(): ExportState {
  return { version: 1, written: 0, offsets: [], records: [], missing: [], stagedMedia: 0, reusedMedia: 0 };
}

async function loadState(file: string): Promise<ExportState | null> {
  try {
    const state = JSON.parse(await fsp.readFile(file, 'utf8')) as ExportState;
    if (state.version !== 1 || !Array.isArray(state.offsets) || !Array.isArray(state.records)) return null;
    return state;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- 媒体暂存

class MediaMissingError extends Error {
  constructor(readonly mediaId: string) {
    super(`媒体源文件不存在：${mediaId}`);
    this.name = 'MediaMissingError';
  }
}

/** 复制的同时校验 sha256；校验不过不留残件。 */
async function copyVerified(source: string, target: string, expectedSha256: string): Promise<void> {
  const tmp = `${target}.part-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const hash = createHash('sha256');
  const input = fs.createReadStream(source);
  input.on('data', (chunk) => hash.update(chunk as Buffer));
  try {
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(tmp);
      input.on('error', reject);
      out.on('error', reject);
      out.on('finish', () => resolve());
      input.pipe(out);
    });
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    throw err;
  }
  const digest = hash.digest('hex');
  if (digest !== expectedSha256) {
    await fsp.rm(tmp, { force: true });
    throw new Error(`媒体内容摘要校验失败：期望 ${expectedSha256.slice(0, 12)}…，实际 ${digest.slice(0, 12)}…`);
  }
  await fsp.rename(tmp, target);
}

/**
 * 把媒体放进内容寻址暂存区。已在里面的（同内容同尺寸）直接复用——
 * 这是「增量打包」与「中断后复用已完成部分」的基础。
 */
async function stageMedia(familyId: string, entry: PlanMediaEntry): Promise<'staged' | 'reused'> {
  const target = path.join(stagingObjectsDir(familyId), entry.stagedRel);
  const existing = await fsp.stat(target).catch(() => null);
  if (existing && existing.size === entry.size) return 'reused';

  const source = absOf(entry.storageKey);
  if (!fs.existsSync(source)) throw new MediaMissingError(entry.mediaId);

  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.rm(target, { force: true }); // 尺寸不符的残留（上次复制到一半）清掉重放
  try {
    // 优先硬链接：与内容寻址存储同一 inode，零拷贝，内容天然一致
    await fsp.link(source, target);
    return 'staged';
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return 'reused'; // 并发导出先一步放好了
    // 跨设备或文件系统不支持硬链接时，退化为复制并校验摘要
  }
  await copyVerified(source, target, entry.sha256);
  return 'staged';
}

// ---------------------------------------------------------------- 汇总条目

function packedMediaEntries(plan: ExportPlan, state: ExportState): PlanMediaEntry[] {
  const missing = new Set(state.missing);
  return plan.entries.filter((e): e is PlanMediaEntry => e.kind === 'media' && !missing.has(e.mediaId));
}

function buildTailEntry(plan: ExportPlan, state: ExportState, tail: TailKind): string {
  const packed = packedMediaEntries(plan, state);
  const mediaBytes = packed.reduce((sum, e) => sum + e.size, 0);

  switch (tail) {
    case 'itemsCsv':
      return plan.csvRows.join('\n');
    case 'mediaIndex':
      return ['itemId,itemTitle,sortOrder,kind,originalName,sha256,bytes,mimeType', ...packed.map((e) => e.indexRow)].join('\n');
    case 'sums':
      return `${packed.map((e) => e.sumsLine).join('\n')}\n`;
    case 'readme':
      return [
        '家中物品来历册 · 导出包',
        '',
        `家庭：${plan.familyName}`,
        `导出时间：${plan.createdAt}`,
        `条目数：${plan.itemCount}`,
        `媒体文件数：${packed.length}${state.missing.length ? `（另有 ${state.missing.length} 个源文件缺失，已跳过）` : ''}`,
        '',
        '如何阅读：',
        '1. items.csv 可用 Excel/WPS 打开，是全部条目的总表。',
        '2. items/<条目ID>.md 是每条物品的完整档案（含故事与媒体清单）。',
        '3. media/<条目ID>/ 下是原始文件，文件名前缀是排序号。',
        '4. 每个媒体文件都按 sha256 校验过。解压后可在本目录复核：',
        '   sha256sum -c SHA256SUMS        # Linux',
        '   shasum -a 256 -c SHA256SUMS    # macOS',
        '   Windows：certutil -hashfile <文件> SHA256 后与 SHA256SUMS 比对',
        '',
        '这个导出包不依赖本系统，任何电脑都能离线打开。',
      ].join('\n');
    case 'manifest':
      return JSON.stringify(
        {
          app: '家中物品来历册',
          version: 2,
          exportedAt: plan.createdAt,
          family: { id: plan.familyId, name: plan.familyName },
          counts: { items: plan.itemCount, media: packed.length, missingMedia: state.missing.length },
          mediaBytes,
          mediaIntegrity: '每个媒体文件写入本包时已按 sha256 校验，清单见 SHA256SUMS',
          incremental: { stagedMedia: state.stagedMedia, reusedMedia: state.reusedMedia },
          jobId: plan.jobId,
        },
        null,
        2,
      );
  }
}

// ---------------------------------------------------------------- 主流程

const CHECKPOINT_EVERY_ENTRIES = 16;
const CHECKPOINT_EVERY_BYTES = 32 * 1024 * 1024;

/**
 * 生成全量导出包。可重入：任务失败/进程中断后再进来，会沿着检查点继续，
 * 已暂存的媒体与已写入的条目都不会重做。
 */
export async function buildExportZip(job: Job): Promise<ExportBuildResult> {
  const familyId = job.familyId;
  if (!familyId) throw new Error('导出任务缺少 familyId');

  const zipPath = exportZipPath(familyId, job.id);
  const partPath = exportPartPath(familyId, job.id);
  const planP = planPath(familyId, job.id);
  const stateP = statePath(familyId, job.id);
  await fsp.mkdir(path.dirname(zipPath), { recursive: true });
  await fsp.mkdir(stagingObjectsDir(familyId), { recursive: true });
  // 暂存区使用标记，供 GC 判断「还在用的暂存区不能收」
  await fsp.writeFile(path.join(stagingDir(familyId), '.lastuse'), new Date().toISOString()).catch(() => undefined);

  // 1. 计划：有就复用（同一份快照），没有就冻结一份新的
  let plan = await loadPlan(planP, job.id, familyId);
  if (!plan) {
    plan = await createPlan(job, familyId);
    await writeJsonAtomic(planP, plan);
    await writeJsonAtomic(stateP, freshState());
    await fsp.rm(partPath, { force: true }); // 旧 .part 属于旧计划，作废
  }
  let state = (await loadState(stateP)) ?? freshState();

  // 2. 已完成打包、只是收尾前中断的情况：直接复用产物
  const total = plan.entries.length;
  if (state.written === total && fs.existsSync(zipPath)) {
    const stat = await fsp.stat(zipPath);
    const sha256 = await sha256File(zipPath);
    await fsp.rm(planP, { force: true });
    await fsp.rm(stateP, { force: true });
    logger.info({ jobId: job.id }, '导出包此前已生成，直接复用');
    return resultOf(plan, state, zipPath, stat.size, sha256);
  }

  // 3. 打开/恢复 .part：检查点之后的字节（写了一半的条目）截掉
  const expectedOffset = state.offsets.length ? state.offsets[state.offsets.length - 1]! : 0;
  const partStat = await fsp.stat(partPath).catch(() => null);
  const canResume = partStat !== null && partStat.size >= expectedOffset;
  if (expectedOffset > 0 && !canResume) {
    // 检查点与数据对不上（如掉电丢了未落盘的页）：保留计划与暂存区，重打 ZIP
    logger.warn({ jobId: job.id, expectedOffset, partSize: partStat?.size ?? null }, '导出检查点与部分文件不一致，重新组装（暂存媒体仍然复用）');
    state = freshState();
    await writeJsonAtomic(stateP, state);
  }
  const writerOpts = { dosTime: plan.dosTime, dosDate: plan.dosDate };
  const writer =
    expectedOffset > 0 && canResume
      ? await ZipWriter.resume(partPath, state.records, expectedOffset, writerOpts)
      : await ZipWriter.create(partPath, writerOpts);
  if (partStat && partStat.size > expectedOffset) {
    logger.info({ jobId: job.id, truncated: partStat.size - expectedOffset }, '截断上次中断时写了一半的条目，从检查点继续');
  }

  // 4. 逐条目写入，按批落检查点
  let entriesSinceCheckpoint = 0;
  let bytesSinceCheckpoint = 0;
  const checkpoint = async (force: boolean) => {
    if (!force && entriesSinceCheckpoint < CHECKPOINT_EVERY_ENTRIES && bytesSinceCheckpoint < CHECKPOINT_EVERY_BYTES) return;
    entriesSinceCheckpoint = 0;
    bytesSinceCheckpoint = 0;
    await writeJsonAtomic(stateP, state);
    const progress = Math.min(95, Math.round((state.written / Math.max(1, total)) * 95));
    await prisma.job.update({ where: { id: job.id }, data: { progress } }).catch(() => undefined);
  };

  try {
    for (let i = state.written; i < total; i += 1) {
      const entry = plan.entries[i]!;
      if (entry.kind === 'text') {
        const record = await writer.appendDeflated(entry.name, Buffer.from(entry.text, 'utf8'));
        state.records.push(record);
        state.offsets.push(writer.offset);
      } else if (entry.kind === 'media') {
        let stagedAbs: string | null = null;
        try {
          const how = await stageMedia(familyId, entry);
          if (how === 'staged') state.stagedMedia += 1;
          else state.reusedMedia += 1;
          stagedAbs = path.join(stagingObjectsDir(familyId), entry.stagedRel);
        } catch (err) {
          if (!(err instanceof MediaMissingError)) throw err;
          state.missing.push(entry.mediaId);
          logger.warn({ jobId: job.id, mediaId: entry.mediaId }, '媒体源文件缺失，导出时跳过');
        }
        if (stagedAbs) {
          const { record, sha256 } = await writer.appendStored(entry.name, stagedAbs);
          if (sha256 !== entry.sha256) {
            // 内容摘要与档案记录不符：删掉暂存副本，重试时会从源头重新校验
            await fsp.rm(stagedAbs, { force: true });
            throw new Error(
              `媒体内容摘要校验失败：${entry.name}（期望 ${entry.sha256.slice(0, 12)}…，实际 ${sha256.slice(0, 12)}…）`,
            );
          }
          state.records.push(record);
          state.offsets.push(writer.offset);
        }
      } else {
        const record = await writer.appendDeflated(entry.name, Buffer.from(buildTailEntry(plan, state, entry.tail), 'utf8'));
        state.records.push(record);
        state.offsets.push(writer.offset);
      }
      state.written = i + 1;
      entriesSinceCheckpoint += 1;
      if (entry.kind === 'media') bytesSinceCheckpoint += entry.size;
      await checkpoint(false);
    }
    await checkpoint(true);

    // 5. 补中央目录并落盘，原子改名成正式产物
    await writer.finalize();
  } catch (err) {
    writer.close();
    // 检查点已落盘的部分下次继续用；失败原因交给 worker 记录与重试
    await writeJsonAtomic(stateP, state).catch(() => undefined);
    throw err;
  }

  const sha256 = await sha256File(partPath);
  await fsp.rename(partPath, zipPath);
  await fsp.rm(planP, { force: true });
  await fsp.rm(stateP, { force: true });

  const stat = await fsp.stat(zipPath);
  logger.info(
    { jobId: job.id, items: plan.itemCount, media: state.stagedMedia + state.reusedMedia, reused: state.reusedMedia, bytes: stat.size },
    '导出包生成完成',
  );
  return resultOf(plan, state, zipPath, stat.size, sha256);
}

function resultOf(plan: ExportPlan, state: ExportState, file: string, bytes: number, sha256: string): ExportBuildResult {
  return {
    file,
    items: plan.itemCount,
    media: packedMediaEntries(plan, state).length,
    bytes,
    sha256,
    stagedMedia: state.stagedMedia,
    reusedMedia: state.reusedMedia,
    missingMedia: state.missing.length,
  };
}
