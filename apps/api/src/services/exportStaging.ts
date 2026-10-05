import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

/**
 * 导出暂存区：让每个家庭的导出可以增量打包、中断后续跑。
 *
 * 目录结构（位于 EXPORT_ROOT/<familyId>/.staging/）：
 *   objects/<sha 前两位>/<sha256>   媒体对象，按内容摘要寻址，硬链接自上传存储（同 inode，不占额外磁盘）
 *   state.json                      每个对象的 stat 签名与校验时间，用于判断「上次校验后源文件没被动过」
 *
 * 复用判定：state.json 里记录的签名 == 源文件当前签名 == 暂存文件当前签名。
 * 硬链接与源文件是同一 inode，签名天然一致；恢复备份、文件被替换等场景签名会变，自动重新校验。
 */

export const STAGING_DIR_NAME = '.staging';
export const STAGING_STATE_VERSION = 1;

export interface StagedObject {
  bytes: number;
  /** 通过摘要校验时源文件的 stat 签名（dev:ino:mtimeMs:size） */
  sig: string;
  verifiedAt: string;
}

export interface StagingState {
  version: number;
  objects: Record<string, StagedObject>;
}

export interface PlanInput {
  sha256: string;
  bytes: number;
  /** 源文件当前签名；源文件缺失时为 null */
  sourceSig: string | null;
  /** 暂存文件当前签名；暂存文件缺失时为 null */
  stagedSig: string | null;
}

export interface StagingPlan {
  /** 可直接复用：暂存件与源文件签名一致且此前已通过摘要校验 */
  reuse: string[];
  /** 需要（重新）暂存并校验摘要：新增 / 签名变化 / 暂存件丢失 */
  stage: string[];
  /** 暂存区里不再被任何条目引用的对象，应清理 */
  prune: string[];
}

export function emptyStagingState(): StagingState {
  return { version: STAGING_STATE_VERSION, objects: {} };
}

export function stagingDirOf(exportRoot: string, familyId: string): string {
  return path.join(exportRoot, familyId, STAGING_DIR_NAME);
}

export function stagedObjectPath(stagingDir: string, sha256: string): string {
  return path.join(stagingDir, 'objects', sha256.slice(0, 2), sha256);
}

/** stat 签名：任一字段变化都视为「文件被换过」，需要重新校验内容摘要。 */
export function statSignature(st: fs.Stats): string {
  return `${st.dev}:${st.ino}:${Math.round(st.mtimeMs)}:${st.size}`;
}

export async function readStagingState(stagingDir: string): Promise<StagingState> {
  try {
    const parsed = JSON.parse(await fsp.readFile(path.join(stagingDir, 'state.json'), 'utf8')) as StagingState;
    if (parsed?.version !== STAGING_STATE_VERSION || typeof parsed.objects !== 'object' || parsed.objects === null) {
      return emptyStagingState();
    }
    return parsed;
  } catch {
    return emptyStagingState();
  }
}

/** 原子写状态文件：先写临时文件再改名，崩溃不会留下半个 JSON。 */
export async function writeStagingState(stagingDir: string, state: StagingState): Promise<void> {
  await fsp.mkdir(stagingDir, { recursive: true });
  const target = path.join(stagingDir, 'state.json');
  const tmp = `${target}.part-${process.pid}`;
  await fsp.writeFile(tmp, JSON.stringify(state), 'utf8');
  await fsp.rename(tmp, target);
}

/**
 * 纯函数：根据「目标对象集合」与「暂存区现状」算出复用 / 重打包 / 清理清单。
 * 签名由调用方通过 stat 得到，方便测试。
 */
export function planStaging(desired: PlanInput[], state: StagingState): StagingPlan {
  const reuse: string[] = [];
  const stage: string[] = [];
  for (const d of desired) {
    const rec = state.objects[d.sha256];
    const fresh =
      rec !== undefined &&
      rec.bytes === d.bytes &&
      d.sourceSig !== null &&
      d.stagedSig !== null &&
      rec.sig === d.sourceSig &&
      d.stagedSig === d.sourceSig;
    if (fresh) reuse.push(d.sha256);
    else stage.push(d.sha256);
  }
  const wanted = new Set(desired.map((d) => d.sha256));
  const prune = Object.keys(state.objects).filter((sha) => !wanted.has(sha));
  return { reuse, stage, prune };
}

export class DigestMismatchError extends Error {
  constructor(
    public readonly sha256: string,
    public readonly actual: string,
  ) {
    super(`媒体内容摘要校验失败：期望 sha256=${sha256}，实际=${actual}（存储文件可能已损坏）`);
    this.name = 'DigestMismatchError';
  }
}

async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

/**
 * 把一个媒体对象纳入暂存区：
 * 1. 流式读取源文件并计算 sha256，与数据库记录比对（媒体按内容摘要校验，不符即失败）；
 * 2. 硬链接进暂存区（跨设备时退化为复制），先落临时名再原子改名；
 * 3. 返回写入状态文件所需的记录。
 */
export async function stageObject(
  sourceAbs: string,
  stagingDir: string,
  sha256: string,
  bytes: number,
): Promise<StagedObject> {
  const actual = await hashFile(sourceAbs);
  if (actual !== sha256) throw new DigestMismatchError(sha256, actual);

  const target = stagedObjectPath(stagingDir, sha256);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.part-${process.pid}`;
  await fsp.rm(tmp, { force: true });
  try {
    await fsp.link(sourceAbs, tmp);
  } catch {
    // 跨文件系统不能硬链接时退化为复制（内容刚校验过，rename 保证原子性）
    await fsp.copyFile(sourceAbs, tmp);
  }
  await fsp.rename(tmp, target);
  // rename 对「指向同一 inode 的硬链接」是 no-op（暂存件与源本就是同一对象时会残留 tmp），兜底清掉
  await fsp.rm(tmp, { force: true });

  const st = await fsp.stat(sourceAbs);
  if (st.size !== bytes) {
    // 摘要对了但大小与库记录不符：以摘要为准，但仍按实际大小记录，保证下次复用判定一致
    return { bytes: st.size, sig: statSignature(st), verifiedAt: new Date().toISOString() };
  }
  return { bytes, sig: statSignature(st), verifiedAt: new Date().toISOString() };
}

/** 清理暂存区里不再需要的对象。 */
export async function pruneObject(stagingDir: string, sha256: string): Promise<void> {
  await fsp.rm(stagedObjectPath(stagingDir, sha256), { force: true });
  // 目录可能因此变空，顺手清掉（忽略不存在的错误）
  await fsp.rmdir(path.join(stagingDir, 'objects', sha256.slice(0, 2))).catch(() => undefined);
}
