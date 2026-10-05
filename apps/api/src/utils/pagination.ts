import { badRequest } from '../http/errors';

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export function encodeCursor(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): string {
  try {
    return Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw badRequest('分页游标无效');
  }
}

/** 多取一条来判断是否还有下一页，避免额外 count 查询。 */
export function toPage<T extends { id: string }>(rows: T[], limit: number): CursorPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(last.id) : null,
  };
}

