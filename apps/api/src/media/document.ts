import fsp from 'node:fs/promises';

export interface DocumentInfo {
  /** 预编译的 sharp 不含 PDF 渲染能力，这里不做首页缩略图，前端用文档图标表示。 */
  thumbKey: null;
  pageCount: number | null;
}

/** 轻量校验：确认真的是可解析的 PDF（以 %%EOF 结尾），并粗算页数用于展示。 */
export async function inspectDocument(srcPath: string): Promise<DocumentInfo> {
  const buf = await fsp.readFile(srcPath);
  const tail = buf.subarray(Math.max(0, buf.length - 2048)).toString('latin1');
  if (!tail.includes('%%EOF')) {
    throw new Error('PDF 文件不完整或已损坏');
  }
  const matches = buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g);
  return { thumbKey: null, pageCount: matches ? matches.length : null };
}

