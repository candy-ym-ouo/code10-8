import { describe, expect, it } from 'vitest';
import { isAllowedOrigin } from './csrf';

describe('CSRF Origin 白名单', () => {
  it('同源请求放行', () => {
    expect(isAllowedOrigin('http://localhost:4000', 'localhost:4000')).toBe(true);
    expect(isAllowedOrigin('https://heirloom.example.com', 'heirloom.example.com')).toBe(true);
  });

  it('第三方站点被拒绝', () => {
    expect(isAllowedOrigin('https://evil.example.com', 'heirloom.example.com')).toBe(false);
    expect(isAllowedOrigin('http://heirloom.example.com.evil.com', 'heirloom.example.com')).toBe(false);
  });

  it('开发环境允许回环地址（Vite dev server 反代场景）', () => {
    // 测试环境 NODE_ENV=test，同样属于非生产
    expect(isAllowedOrigin('http://localhost:5173', '127.0.0.1:4000')).toBe(true);
  });

  it('非法 Origin 字符串不会抛异常', () => {
    expect(isAllowedOrigin('not-a-url', 'localhost:4000')).toBe(false);
  });
});
