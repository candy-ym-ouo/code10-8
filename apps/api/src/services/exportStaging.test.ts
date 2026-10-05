import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DigestMismatchError,
  emptyStagingState,
  planStaging,
  readStagingState,
  stageObject,
  stagedObjectPath,
  statSignature,
  writeStagingState,
  type PlanInput,
  type StagingState,
} from './exportStaging';

const shaOf = (content: string) => createHash('sha256').update(content).digest('hex');

function stateWith(objects: Record<string, { bytes: number; sig: string }>): StagingState {
  const state = emptyStagingState();
  for (const [sha, o] of Object.entries(objects)) {
    state.objects[sha] = { ...o, verifiedAt: new Date().toISOString() };
  }
  return state;
}

describe('导出暂存区 · 增量计划（planStaging）', () => {
  it('签名一致且已校验过的对象直接复用', () => {
    const sha = shaOf('a');
    const state = stateWith({ [sha]: { bytes: 1, sig: '1:2:3:1' } });
    const desired: PlanInput[] = [{ sha256: sha, bytes: 1, sourceSig: '1:2:3:1', stagedSig: '1:2:3:1' }];
    const plan = planStaging(desired, state);
    expect(plan).toEqual({ reuse: [sha], stage: [], prune: [] });
  });

  it('源文件签名变化（恢复备份/被替换）后重新暂存校验', () => {
    const sha = shaOf('a');
    const state = stateWith({ [sha]: { bytes: 1, sig: '1:2:3:1' } });
    const desired: PlanInput[] = [{ sha256: sha, bytes: 1, sourceSig: '9:9:9:1', stagedSig: '1:2:3:1' }];
    expect(planStaging(desired, state).stage).toEqual([sha]);
  });

  it('暂存文件丢失或状态缺失时重新暂存', () => {
    const sha = shaOf('a');
    const state = stateWith({ [sha]: { bytes: 1, sig: '1:2:3:1' } });
    expect(planStaging([{ sha256: sha, bytes: 1, sourceSig: '1:2:3:1', stagedSig: null }], state).stage).toEqual([sha]);
    expect(planStaging([{ sha256: sha, bytes: 1, sourceSig: '1:2:3:1', stagedSig: '1:2:3:1' }], emptyStagingState()).stage).toEqual([sha]);
  });

  it('不再被引用的对象进入清理清单，不产生残留文件', () => {
    const keep = shaOf('keep');
    const drop = shaOf('drop');
    const state = stateWith({
      [keep]: { bytes: 4, sig: '1:1:1:4' },
      [drop]: { bytes: 4, sig: '2:2:2:4' },
    });
    const plan = planStaging([{ sha256: keep, bytes: 4, sourceSig: '1:1:1:4', stagedSig: '1:1:1:4' }], state);
    expect(plan.reuse).toEqual([keep]);
    expect(plan.prune).toEqual([drop]);
  });

  it('大小与库记录不符时不复用', () => {
    const sha = shaOf('a');
    const state = stateWith({ [sha]: { bytes: 100, sig: '1:2:3:1' } });
    const plan = planStaging([{ sha256: sha, bytes: 1, sourceSig: '1:2:3:1', stagedSig: '1:2:3:1' }], state);
    expect(plan.stage).toEqual([sha]);
  });
});

describe('导出暂存区 · 状态文件', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'staging-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('写入后可读回；损坏或版本不符时回退为空状态', async () => {
    const state = stateWith({ abc: { bytes: 1, sig: 's' } });
    await writeStagingState(dir, state);
    expect(await readStagingState(dir)).toEqual(state);

    writeFileSync(path.join(dir, 'state.json'), '{broken', 'utf8');
    expect(await readStagingState(dir)).toEqual(emptyStagingState());

    writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ version: 999, objects: {} }), 'utf8');
    expect(await readStagingState(dir)).toEqual(emptyStagingState());
  });

  it('不存在的目录返回空状态', async () => {
    expect(await readStagingState(path.join(dir, 'nope'))).toEqual(emptyStagingState());
  });
});

describe('导出暂存区 · 对象暂存（按内容摘要校验）', () => {
  let dir: string;
  let srcDir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'staging-'));
    srcDir = mkdtempSync(path.join(os.tmpdir(), 'src-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(srcDir, { recursive: true, force: true });
  });

  it('摘要一致时暂存成功，暂存件与源文件同内容同签名', async () => {
    const content = '外婆的录音';
    const src = path.join(srcDir, 'a.wav');
    writeFileSync(src, content);
    const sha = shaOf(content);

    const rec = await stageObject(src, dir, sha, Buffer.byteLength(content));
    const staged = stagedObjectPath(dir, sha);

    expect(await fsp.readFile(staged, 'utf8')).toBe(content);
    const srcStat = await fsp.stat(src);
    expect(rec.sig).toBe(statSignature(srcStat));
    // 同文件系统下是硬链接：同一 inode，不产生重复数据块
    expect((await fsp.stat(staged)).ino).toBe(srcStat.ino);
  });

  it('摘要与库记录不符时抛 DigestMismatchError，且不留下暂存文件', async () => {
    const src = path.join(srcDir, 'corrupt.jpg');
    writeFileSync(src, '被损坏的内容');
    const wrongSha = shaOf('原始内容');

    await expect(stageObject(src, dir, wrongSha, 10)).rejects.toBeInstanceOf(DigestMismatchError);
    await expect(fsp.stat(stagedObjectPath(dir, wrongSha))).rejects.toThrow();
  });

  it('重复暂存同一对象是幂等的（中断重跑不产生重复文件）', async () => {
    const src = path.join(srcDir, 'm.jpg');
    writeFileSync(src, 'photo-bytes');
    const sha = shaOf('photo-bytes');

    const first = await stageObject(src, dir, sha, 11);
    const second = await stageObject(src, dir, sha, 11);
    expect(second.sig).toBe(first.sig);
    const entries = await fsp.readdir(path.dirname(stagedObjectPath(dir, sha)));
    expect(entries).toEqual([sha]);
  });
});
