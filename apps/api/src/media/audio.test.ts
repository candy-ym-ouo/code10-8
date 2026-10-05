import { describe, expect, it } from 'vitest';
import { computePeaks } from './audio';

function pcmFromSamples(samples: number[]): Buffer {
  const buf = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => buf.writeInt16LE(s, i * 2));
  return buf;
}

describe('波形降采样', () => {
  it('每个桶取绝对值最大值并归一化到 0..1', () => {
    const pcm = pcmFromSamples([0, 16384, -32768, 8192, 0, 0, 0, 0]);
    const peaks = computePeaks(pcm, 4);
    expect(peaks).toHaveLength(4);
    expect(peaks[0]).toBeCloseTo(0.5, 2);
    expect(peaks[1]).toBeCloseTo(1, 2);
    expect(peaks[2]).toBeCloseTo(0, 2);
    expect(peaks[3]).toBeCloseTo(0, 2);
  });

  it('空数据与非法桶数不会崩', () => {
    expect(computePeaks(Buffer.alloc(0), 10)).toEqual([]);
    expect(computePeaks(pcmFromSamples([1, 2, 3]), 0)).toEqual([]);
  });

  it('桶数多于采样点时按实际采样点返回', () => {
    const peaks = computePeaks(pcmFromSamples([100, 200, 300]), 100);
    expect(peaks.length).toBeLessThanOrEqual(100);
    expect(peaks.length).toBeGreaterThan(0);
  });
});

