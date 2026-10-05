import type { Precision } from './enums';

export interface AcquiredInput {
  acquiredAt?: Date | string | null;
  acquiredPrecision: Precision;
  acquiredLabel?: string | null;
}

const MS_DAY = 86_400_000;

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * 获得时间的展示文案。真实场景里长辈往往只记得「大概 1978 年」或「我上小学那年」，
 * 因此这里必须能优雅退化到「精度 + 原文」。
 */
export function formatAcquired(input: AcquiredInput): string {
  const { acquiredAt, acquiredPrecision, acquiredLabel } = input;
  if (acquiredPrecision === 'unknown' || !acquiredAt) {
    return acquiredLabel?.trim() || '时间不详';
  }
  const d = toDate(acquiredAt);
  if (Number.isNaN(d.getTime())) return acquiredLabel?.trim() || '时间不详';

  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  switch (acquiredPrecision) {
    case 'day':
      return `${y} 年 ${m} 月 ${day} 日`;
    case 'month':
      return `${y} 年 ${m} 月`;
    case 'year':
      return `${y} 年`;
    case 'decade':
      return `${Math.floor(y / 10) * 10} 年代`;
    default:
      return acquiredLabel?.trim() || '时间不详';
  }
}

/** 时间轴落位用的排序时间：精度越低越往区间中点靠，避免「只知道年份」的条目全堆在 1 月 1 日。 */
export function sortAt(input: AcquiredInput, fallback: Date | string): Date {
  const { acquiredAt, acquiredPrecision } = input;
  if (!acquiredAt) return toDate(fallback);
  const d = toDate(acquiredAt);
  if (Number.isNaN(d.getTime())) return toDate(fallback);
  const y = d.getUTCFullYear();
  switch (acquiredPrecision) {
    case 'day':
      return d;
    case 'month':
      return new Date(Date.UTC(y, d.getUTCMonth(), 15));
    case 'year':
      return new Date(Date.UTC(y, 6, 2));
    case 'decade':
      return new Date(Date.UTC(Math.floor(y / 10) * 10 + 5, 0, 1));
    default:
      return toDate(fallback);
  }
}

/** 时间轴分组键：精确到日和月按年分组，十年精度按年代分组。 */
export function timelineGroupKey(input: AcquiredInput, fallback: Date | string): string {
  if (input.acquiredPrecision === 'unknown' || !input.acquiredAt) return 'unknown';
  const d = sortAt(input, fallback);
  if (input.acquiredPrecision === 'decade') return `${Math.floor(d.getUTCFullYear() / 10) * 10}s`;
  return String(d.getUTCFullYear());
}

/** 时间是否存疑：精度粗于「月」或完全说不清时，UI 需要显式标注。 */
export function isTimeUncertain(input: AcquiredInput): boolean {
  return input.acquiredPrecision === 'year' || input.acquiredPrecision === 'decade' || input.acquiredPrecision === 'unknown';
}

/** 判断两个时间是否落在同一天（用于「今天/昨天」类显示）。 */
export function isSameDay(a: Date | string, b: Date | string): boolean {
  const da = toDate(a);
  const db = toDate(b);
  return Math.abs(da.getTime() - db.getTime()) < MS_DAY && da.getUTCDate() === db.getUTCDate();
}

export function hoursAgo(date: Date | string): number {
  return (Date.now() - toDate(date).getTime()) / 3_600_000;
}

