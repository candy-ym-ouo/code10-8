import { api, getAccessToken } from '../api/client';
import type { Media } from '../api/types';

/**
 * 把服务端返回的媒体地址转成 <img>/<audio> 能直接用的地址。
 * 令牌以查询参数附上（服务端只对 GET 媒体路径放行），这样音频能走原生 Range 流式播放。
 */
export function mediaSrc(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const token = getAccessToken();
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}t=${encodeURIComponent(token)}`;
}

export interface WaveformData {
  peaks: number[];
  sampleRate: number;
  durationMs: number | null;
}

export async function fetchWaveform(media: Media): Promise<WaveformData | null> {
  if (!media.waveformUrl) return null;
  try {
    return await api.absolute<WaveformData>(media.waveformUrl);
  } catch {
    return null;
  }
}

export function isPlayableInBrowser(mimeType: string): boolean {
  return /audio\/(mpeg|mp4|wav|webm|ogg)/.test(mimeType);
}

