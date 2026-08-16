import { describe, it, expect } from 'vitest';
import { isSafeApiUrl } from '../../src/shared/utils/url-safety';

describe('isSafeApiUrl（v1.7.1 防 SSRF）', () => {
  it('允许公网 HTTPS', () => {
    expect(isSafeApiUrl('https://api.deepseek.com/v1/chat/completions')).toBe(true);
    expect(isSafeApiUrl('https://api.openai.com/v1')).toBe(true);
    expect(isSafeApiUrl('https://api.moonshot.cn')).toBe(true);
  });

  it('拒绝 http 与内网/localhost/链路本地', () => {
    expect(isSafeApiUrl('http://api.deepseek.com/v1')).toBe(false);
    expect(isSafeApiUrl('https://localhost:8080')).toBe(false);
    expect(isSafeApiUrl('https://127.0.0.1:8080')).toBe(false);
    expect(isSafeApiUrl('https://10.0.0.5')).toBe(false);
    expect(isSafeApiUrl('https://192.168.1.10')).toBe(false);
    expect(isSafeApiUrl('https://172.16.0.1')).toBe(false);
    expect(isSafeApiUrl('https://169.254.169.254')).toBe(false);
    expect(isSafeApiUrl('https://[::1]')).toBe(false);
    expect(isSafeApiUrl('https://myhost.local')).toBe(false);
  });

  it('拒绝非法 URL', () => {
    expect(isSafeApiUrl('not-a-url')).toBe(false);
    expect(isSafeApiUrl('')).toBe(false);
  });
});