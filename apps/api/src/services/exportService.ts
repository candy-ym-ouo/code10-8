import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import archiver from 'archiver';
import { CATEGORY_LABELS, ITEM_STATUS_LABELS, VISIBILITY_LABELS, formatAcquired, htmlToText } from '@heirloom/shared';
import type { Job } from '@prisma/client';
import { prisma } from '../db';
import { config } from '../config';
import { logger } from '../logger';
import { notFound } from '../http/errors';
import { absOf } from '../storage/local';
import { sha256File, slugify } from '../utils/crypto';
import * as audit from './auditService';
import {
  planStaging,
  pruneObject,
  readStagingState,
  stageObject,
  stagedObjectPath,
  stagingDirOf,
  statSignature,
  writeStagingState,
  type PlanInput,
} from './exportStaging';
import type { FamilyContext } from './permissionService';

export interface ActorMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export interface ExportBuildResult {
  file: string;
  items: number;
  media: number;
  bytes: number;
  /** 整包 sha256，下载响应用它做 ETag，客户端可据此校验续传 */
  sha256: string;
  /** 本次直接复用的媒体对象数（此前导出已打包并校验过） */
  reused: number;
  /** 本次新打包并通过摘要校验的媒体对象数 */
  staged: number;
  /** 从暂存区清理掉的失效对象数 */
  pruned: number;
  /** 数据库有记录但磁盘缺失的媒体数 */
  missing: number;
}

export async function createExportJob(userId: string, ctx: FamilyContext, meta: ActorMeta) {
  // 同一家庭同时只允许一个进行中的导出任务：避免并发写同一暂存区，重复点击直接复用现有任务
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
  return {
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    lastError: job.lastError,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
    downloadUrl: job.status === 'done' ? `/api/v1/families/${familyId}/exports/${job.id}/download` : null,
    result: job.result,
  };
}

export function exportZipPath(familyId: string, jobId: string): string {
  return path.join(config.EXPORT_ROOT, familyId, `${jobId}.zip`);
}

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return `"${s.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
}

async function reportProgress(jobId: string, progress: number): Promise<void> {
  await prisma.job.update({ where: { id: jobId }, data: { progress } }).catch(() => undefined);
}

/**
 * 生成全量导出包。产物结构与项目文档 6.9 一致：
 * manifest.json + items.csv + items/*.md + media/原始文件 + media/index.csv，
 * 每份 media 都带 sha256，离线也能校验完整性。
 *
 * 增量与断点设计：
 * - 媒体先进入按 sha256 寻址的暂存区（硬链接，不产生重复数据块），入区时按内容摘要校验；
 * - 暂存状态落盘（state.json），任务中断重跑或再次导出时，签名未变的对象直接复用；
 * - ZIP 先写到 <jobId>.zip.part，算完整包 sha256 后原子改名，下载端永远看不到半成品。
 */
export async function buildExportZip(job: Job): Promise<ExportBuildResult> {
  const familyId = job.familyId;
  if (!familyId) throw new Error('导出任务缺少 familyId');

  const family = await prisma.family.findUniqueOrThrow({ where: { id: familyId } });
  const items = await prisma.item.findMany({
    where: { familyId, status: { not: 'trashed' } },
    include: {
      media: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
      people: { include: { person: true } },
      creator: { select: { displayName: true } },
    },
    orderBy: { sortAt: 'asc' },
  });

  const stagingDir = stagingDirOf(config.EXPORT_ROOT, familyId);
  const state = await readStagingState(stagingDir);

  // ---------- 1. 计算目标媒体集合（按内容摘要去重） ----------
  const desired = new Map<string, { sha256: string; bytes: number; sourceAbs: string }>();
  let missing = 0;
  for (const item of items) {
    for (const m of item.media) {
      const sourceAbs = absOf(m.storageKey);
      if (!fs.existsSync(sourceAbs)) {
        missing += 1;
        logger.warn({ mediaId: m.id, storageKey: m.storageKey }, '导出跳过：媒体文件在磁盘上缺失');
        continue;
      }
      if (!desired.has(m.sha256)) {
        desired.set(m.sha256, { sha256: m.sha256, bytes: Number(m.byteSize), sourceAbs });
      }
    }
  }

  // ---------- 2. 增量计划：复用 / 重打包 / 清理 ----------
  const planInput: PlanInput[] = [];
  for (const d of desired.values()) {
    const sourceStat = await fsp.stat(d.sourceAbs).catch(() => null);
    const stagedStat = await fsp.stat(stagedObjectPath(stagingDir, d.sha256)).catch(() => null);
    planInput.push({
      sha256: d.sha256,
      bytes: d.bytes,
      sourceSig: sourceStat ? statSignature(sourceStat) : null,
      stagedSig: stagedStat ? statSignature(stagedStat) : null,
    });
  }
  const plan = planStaging(planInput, state);

  for (const sha of plan.prune) {
    await pruneObject(stagingDir, sha);
    delete state.objects[sha];
  }

  // ---------- 3. 暂存新增/变化的对象（按内容摘要校验，失败即终止导出） ----------
  const stageTotal = plan.stage.length || 1;
  for (let i = 0; i < plan.stage.length; i += 1) {
    const sha = plan.stage[i]!;
    const d = desired.get(sha)!;
    state.objects[sha] = await stageObject(d.sourceAbs, stagingDir, sha, d.bytes);
    if (i % 10 === 0 || i === plan.stage.length - 1) {
      await reportProgress(job.id, Math.min(70, 5 + Math.round(((i + 1) / stageTotal) * 65)));
    }
  }
  // 状态先落盘再打包：即使打包阶段进程被杀，已校验的暂存成果下次仍可复用
  await writeStagingState(stagingDir, state);

  // ---------- 4. 生成文本内容并打包（媒体一律从暂存区读取） ----------
  const outPath = exportZipPath(familyId, job.id);
  const partPath = `${outPath}.part`;
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  await fsp.rm(partPath, { force: true }); // 清理上次中断可能留下的半成品

  const output = fs.createWriteStream(partPath);
  const archive = archiver('zip', { zlib: { level: 6 } });
  const done = new Promise<void>((resolve, reject) => {
    output.on('close', () => resolve());
    archive.on('error', reject);
    output.on('error', reject);
  });
  archive.pipe(output);

  const root = `family-${slugify(family.name)}-${new Date().toISOString().slice(0, 10)}`;
  let mediaTotal = 0;
  let mediaBytes = 0;
  const mediaIndex: string[] = ['itemId,itemTitle,sortOrder,kind,originalName,sha256,bytes,mimeType'];

  const csv: string[] = ['标题,分类,获得时间,时间精度,来源人物,地点,状态,可见性,创建者,媒体数'];
  const total = items.length;

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    const peopleNames = item.people.map((p) => p.person.name).join('、');
    const acquired = formatAcquired({
      acquiredAt: item.acquiredAt,
      acquiredPrecision: item.acquiredPrecision,
      acquiredLabel: item.acquiredLabel,
    });

    csv.push(
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

    const md: string[] = [
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
              `${idx + 1}. \`media/${item.id}/${String(m.sortOrder).padStart(3, '0')}-${m.originalName}\` — ${m.caption ?? m.kind}${m.transcript ? `\n   听写稿：${m.transcript}` : ''}`,
          )
        : ['（暂无）']),
      '',
    ];
    archive.append(md.join('\n'), { name: `${root}/items/${item.id}.md` });

    for (const m of item.media) {
      if (!desired.has(m.sha256)) continue; // 磁盘缺失的媒体已在上面跳过并计数
      mediaTotal += 1;
      mediaBytes += Number(m.byteSize);
      const name = `${String(m.sortOrder).padStart(3, '0')}-${m.originalName}`;
      archive.file(stagedObjectPath(stagingDir, m.sha256), { name: `${root}/media/${item.id}/${name}` });
      mediaIndex.push(
        [item.id, csvCell(item.title), m.sortOrder, m.kind, csvCell(m.originalName), m.sha256, Number(m.byteSize), m.mimeType].join(','),
      );
    }

    if (i % 25 === 0 || i === total - 1) {
      await reportProgress(job.id, total === 0 ? 85 : Math.min(85, 70 + Math.round(((i + 1) / total) * 15)));
    }
  }

  archive.append(csv.join('\n'), { name: `${root}/items.csv` });
  archive.append(mediaIndex.join('\n'), { name: `${root}/media/index.csv` });
  archive.append(
    [
      '家中物品来历册 · 导出包',
      '',
      `家庭：${family.name}`,
      `导出时间：${new Date().toISOString()}`,
      `条目数：${items.length}`,
      `媒体文件数：${mediaTotal}`,
      '',
      '如何阅读：',
      '1. items.csv 可用 Excel/WPS 打开，是全部条目的总表。',
      '2. items/<条目ID>.md 是每条物品的完整档案（含故事与媒体清单）。',
      '3. media/<条目ID>/ 下是原始文件，文件名前缀是排序号。',
      '4. media/index.csv 记录了每个文件的 sha256，可用以下命令校验：',
      '   shasum -a 256 <文件>      # macOS / Linux',
      '   certutil -hashfile <文件> SHA256   # Windows',
      '',
      '这个导出包不依赖本系统，任何电脑都能离线打开。',
    ].join('\n'),
    { name: `${root}/README.txt` },
  );
  archive.append(
    JSON.stringify(
      {
        app: '家中物品来历册',
        version: 1,
        exportedAt: new Date().toISOString(),
        family: { id: family.id, name: family.name },
        counts: { items: items.length, media: mediaTotal },
        mediaBytes,
        jobId: job.id,
      },
      null,
      2,
    ),
    { name: `${root}/manifest.json` },
  );

  await archive.finalize();
  await done;

  // ---------- 5. 整包摘要 + 原子就位：下载端永远只能看到完整产物 ----------
  const zipSha256 = await sha256File(partPath);
  await fsp.rename(partPath, outPath);
  await reportProgress(job.id, 95);

  const stat = await fsp.stat(outPath);
  const result: ExportBuildResult = {
    file: outPath,
    items: items.length,
    media: mediaTotal,
    bytes: stat.size,
    sha256: zipSha256,
    reused: plan.reuse.length,
    staged: plan.stage.length,
    pruned: plan.prune.length,
    missing,
  };
  logger.info(
    { jobId: job.id, items: result.items, media: result.media, bytes: result.bytes, reused: result.reused, staged: result.staged },
    '导出包生成完成',
  );
  return result;
}
