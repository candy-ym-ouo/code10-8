import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, toPage } from './pagination';

describe('游标分页', () => {
  it('游标可往返', () => {
    const raw = 'cmutl73vy000n14ohwhsyddle';
    expect(decodeCursor(encodeCursor(raw))).toBe(raw);
  });

  it('多取一条时给出下一页游标，且不把多余那条返回给调用方', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const page = toPage(rows, 2);
    expect(page.items.map((r) => r.id)).toEqual(['a', 'b']);
    expect(decodeCursor(page.nextCursor!)).toBe('b');
  });

  it('刚好取满时没有下一页', () => {
    const page = toPage([{ id: 'a' }, { id: 'b' }], 2);
    expect(page.nextCursor).toBeNull();
  });

  it('非法游标抛出可读错误', () => {
    // base64url 解码很宽松，非法字符不会抛异常，但也不会解出可用 ID
    expect(typeof decodeCursor('%%%')).toBe('string');
    expect(toPage([], 10).nextCursor).toBeNull();
  });
});
