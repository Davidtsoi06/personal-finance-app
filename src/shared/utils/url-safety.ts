/**
 * url-safety — AI 端点安全校验（v1.7.1）。
 * 本地软件防 SSRF：只允许公网 HTTPS，禁止 localhost/内网/链路本地地址。
 */
export function isSafeApiUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
  if (host === '0.0.0.0' || host === '::1' || host === '[::1]' || host === '::') return false;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  if (/^169\.254\./.test(host)) return false;
  // IPv6 各种本地/链路地址
  if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return false;
  return true;
}