/**
 * 恢复校验：确认恢复出来的库与磁盘媒体一致。
 * 由 scripts/restore.sh 调用；也可以手动执行：
 *   node apps/api/dist/scripts/verify-restore.js --backup data/backups/2026-10-05-023000
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { config, REPO_ROOT } from '../config';
import { prisma, disconnectDb } from '../db';

interface Args {
  backup?: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--backup' && argv[i + 1]) out.backup = argv[i + 1];
  }
  return out;
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(file);
    stream.on('data', (c) => hash.update(c));
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const problems: string[] = [];

  const [users, families, items, media, jobs] = await Promise.all([
    prisma.user.count(),
    prisma.family.count({ where: { deletedAt: null } }),
    prisma.item.count(),
    prisma.itemMedia.count(),
    prisma.job.count(),
  ]);

  console.log(`数据库：用户 ${users} / 家庭 ${families} / 条目 ${items} / 媒体 ${media} / 任务 ${jobs}`);

  if (args.backup) {
    const base = path.isAbsolute(args.backup) ? args.backup : path.join(REPO_ROOT, args.backup);
    const manifestPath = path.join(base, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      problems.push(`找不到备份清单：${manifestPath}`);
    } else {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
        counts?: { items?: number; media?: number };
      };
      const expectedItems = manifest.counts?.items ?? null;
      if (expectedItems !== null && expectedItems !== items) {
        problems.push(`条目数与备份清单不一致：清单 ${expectedItems}，当前 ${items}`);
      }
      console.log(`备份清单：条目 ${manifest.counts?.items ?? '?'} / 媒体 ${manifest.counts?.media ?? '?'}`);
    }
  }

  // 抽样 20 个媒体，核对库里的 sha256 与磁盘文件是否一致
  const sample = await prisma.itemMedia.findMany({
    select: { id: true, sha256: true, storageKey: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  let checked = 0;
  for (const m of sample) {
    const file = path.join(config.STORAGE_ROOT, m.storageKey);
    if (!fs.existsSync(file)) {
      problems.push(`媒体文件缺失：${m.storageKey}`);
      continue;
    }
    const actual = await sha256File(file);
    checked += 1;
    if (actual !== m.sha256) {
      problems.push(`媒体校验不一致：${m.storageKey}`);
    }
  }
  console.log(`媒体抽样：校验 ${checked}/${sample.length} 个`);

  if (problems.length > 0) {
    console.error('\n校验未通过：');
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
  } else {
    console.log('\n恢复校验通过：数据库与媒体文件一致。');
  }
  await disconnectDb();
}

main().catch(async (err) => {
  console.error('校验脚本执行失败：', err);
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
