import sanitizeHtml from 'sanitize-html';
import { htmlToText } from '@heirloom/shared';

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'blockquote', 'ul', 'ol', 'li', 'a', 'h3', 'h4'],
  allowedAttributes: { a: ['href', 'title'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
    b: 'strong',
    i: 'em',
  },
};

/** 富文本白名单净化：只保留叙述性排版，杜绝脚本与样式注入。 */
export function cleanStory(html: string | null | undefined): { html: string | null; text: string } {
  if (!html || !html.trim()) return { html: null, text: '' };
  const clean = sanitizeHtml(html, OPTIONS).trim();
  if (!clean) return { html: null, text: '' };
  return { html: clean, text: htmlToText(clean).slice(0, 50_000) };
}

export function cleanInline(input: string | null | undefined): string | null {
  if (!input) return null;
  const clean = sanitizeHtml(input, { allowedTags: [], allowedAttributes: {} }).trim();
  return clean || null;
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
