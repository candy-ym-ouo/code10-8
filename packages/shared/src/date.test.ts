import { describe, expect, it } from 'vitest';
import { formatAcquired, isTimeUncertain, sortAt, timelineGroupKey } from './date';

describe('formatAcquired', () => {
  it('按精度裁剪展示层级', () => {
    const at = '1978-03-12T00:00:00.000Z';
    expect(formatAcquired({ acquiredAt: at, acquiredPrecision: 'day' })).toBe('1978 年 3 月 12 日');
    expect(formatAcquired({ acquiredAt: at, acquiredPrecision: 'month' })).toBe('1978 年 3 月');
    expect(formatAcquired({ acquiredAt: at, acquiredPrecision: 'year' })).toBe('1978 年');
    expect(formatAcquired({ acquiredAt: at, acquiredPrecision: 'decade' })).toBe('1970 年代');
  });

  it('说不清时回落到用户原文，而不是显示假日期', () => {
    expect(
      formatAcquired({ acquiredAt: null, acquiredPrecision: 'unknown', acquiredLabel: '我上小学那年' }),
    ).toBe('我上小学那年');
    expect(formatAcquired({ acquiredAt: null, acquiredPrecision: 'unknown' })).toBe('时间不详');
  });
});

describe('sortAt / timelineGroupKey', () => {
  it('只知道年份时落在年中，避免堆在 1 月 1 日', () => {
    const d = sortAt({ acquiredAt: '1978-01-01T00:00:00.000Z', acquiredPrecision: 'year' }, new Date());
    expect(d.getUTCMonth()).toBe(6);
  });

  it('十年精度落到年代中点', () => {
    const d = sortAt({ acquiredAt: '1978-01-01T00:00:00.000Z', acquiredPrecision: 'decade' }, new Date());
    expect(d.getUTCFullYear()).toBe(1975);
    expect(timelineGroupKey({ acquiredAt: '1978-01-01T00:00:00.000Z', acquiredPrecision: 'decade' }, new Date())).toBe('1970s');
  });
});

describe('isTimeUncertain', () => {
  it('精度粗于月即视为存疑', () => {
    expect(isTimeUncertain({ acquiredPrecision: 'day' })).toBe(false);
    expect(isTimeUncertain({ acquiredPrecision: 'month' })).toBe(false);
    expect(isTimeUncertain({ acquiredPrecision: 'year' })).toBe(true);
    expect(isTimeUncertain({ acquiredPrecision: 'unknown' })).toBe(true);
  });
});

