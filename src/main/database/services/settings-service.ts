/**
 * App settings — simple key-value store backed by the app_settings table.
 * Used for AI configuration and other user preferences.
 */
import { getDatabase } from '../index';
import { isSafeApiUrl } from '../../../shared/utils/url-safety';
import { decryptText, encryptText } from '../../services/crypto-util';

// ── Types ──

export interface AiConfig {
  provider: string;
  apiUrl: string;
  apiKey: string;
  model: string;
  /** 是否允许 AI 读取组合数据（持仓/账户/交易）；默认 true */
  includePortfolio?: boolean;
}

export interface AiConfigPublic {
  provider: string;
  apiUrl: string;
  model: string;
  hasApiKey: boolean; // true if a key is stored (key itself never returned)
  includePortfolio: boolean; // 是否允许 AI 读取组合数据
}

// ── Provider presets ──

const PROVIDER_PRESETS: Record<string, { apiUrl: string; model: string }> = {
  deepseek: {
    apiUrl: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
  },
};

const DEFAULT_PROVIDER = 'deepseek';

// ── Low-level KV helpers ──

export function getSetting(key: string): string | null {
  const db = getDatabase();
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  const db = getDatabase();
  db.prepare(
    'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime(\'now\')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime(\'now\')'
  ).run(key, value);
}

export function getAllSettings(): Record<string, string> {
  const db = getDatabase();
  const rows = db.prepare('SELECT key, value FROM app_settings').all() as { key: string; value: string }[];
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

// ── AI config helpers ──

/**
 * 读取 AI Key：密文解密返回明文；旧版明文值就地升级为密文；解密失败视为未配置。
 */
function getAiKey(): string {
  const raw = getSetting('ai.apiKey') || '';
  if (!raw) return '';
  const decrypted = decryptText(raw);
  if (decrypted !== null) return decrypted;
  // 兼容旧版明文存储（迁移 v13 之前的数据库）
  if (!raw.startsWith('v1:')) {
    setSetting('ai.apiKey', encryptText(raw));
    return raw;
  }
  return ''; // 密钥文件丢失/损坏 → 视为未配置，用户重新填写
}

/** 是否允许 AI 读取组合数据（默认开启）。 */
export function isPortfolioSharingEnabled(): boolean {
  return getSetting('ai.includePortfolio') !== '0';
}

/** Get full AI config including API key (main-process only, never exposed to renderer). */
export function getAiConfig(): AiConfig {
  const provider = getSetting('ai.provider') || DEFAULT_PROVIDER;
  const preset = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS[DEFAULT_PROVIDER];
  return {
    provider,
    apiUrl: getSetting('ai.apiUrl') || preset.apiUrl,
    apiKey: getAiKey(),
    model: getSetting('ai.model') || preset.model,
    includePortfolio: isPortfolioSharingEnabled(),
  };
}

/** Get AI config safe for renderer (API key masked). */
export function getAiConfigPublic(): AiConfigPublic {
  const full = getAiConfig();
  const preset = PROVIDER_PRESETS[full.provider] || PROVIDER_PRESETS[DEFAULT_PROVIDER];
  return {
    provider: full.provider,
    apiUrl: full.apiUrl || preset.apiUrl,
    model: full.model || preset.model,
    hasApiKey: (full.apiKey || '').length > 0,
    includePortfolio: full.includePortfolio !== false,
  };
}

/** Save AI config from renderer. API Key 加密后落库（明文不进数据库）。 */
export function saveAiConfig(config: AiConfig): void {
  // v1.7.1：AI 端点安全校验（公网 HTTPS，禁止内网/localhost，防 SSRF）
  if (config.apiUrl && !isSafeApiUrl(config.apiUrl)) {
    throw new Error('AI 接口地址无效：仅支持公网 HTTPS 地址');
  }
  setSetting('ai.provider', config.provider || DEFAULT_PROVIDER);
  setSetting('ai.apiUrl', config.apiUrl || '');
  // 仅当传入非空 Key 时更新（空值表示"保持现有 Key"，修复掩码保存误清空 Key 的 bug）
  if (config.apiKey) {
    setSetting('ai.apiKey', encryptText(config.apiKey));
  }
  setSetting('ai.model', config.model || '');
  if (config.includePortfolio !== undefined) {
    setSetting('ai.includePortfolio', config.includePortfolio ? '1' : '0');
  }
}

// ── Daily Investment Summary ──

export function getDailySummary(date: string): string | null {
  return getSetting(`daily_summary.${date}`);
}

export function saveDailySummary(date: string, content: string): void {
  setSetting(`daily_summary.${date}`, content);
}

// ── App Name ──

const DEFAULT_APP_NAME = '个人理财投资软件';

export function getAppName(): string {
  return getSetting('app_name') || DEFAULT_APP_NAME;
}

export function setAppName(name: string): void {
  setSetting('app_name', name.trim() || DEFAULT_APP_NAME);
}

/** Test the AI API connection with the given config. */
export async function testAiConnection(config?: AiConfig): Promise<{ ok: boolean; error?: string }> {
  const c = config || getAiConfig();
  if (!c.apiKey) return { ok: false, error: '请先填写 API Key' };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(c.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${c.apiKey}`,
      },
      body: JSON.stringify({
        model: c.model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 10,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.ok) return { ok: true };
    if (response.status === 401) return { ok: false, error: 'API Key 无效（401 认证失败）' };
    if (response.status === 429) return { ok: false, error: '请求过于频繁，请稍后再试' };
    const text = await response.text();
    return { ok: false, error: `API 返回错误 (${response.status}): ${text.slice(0, 200)}` };
  } catch (err: any) {
    if (err.name === 'AbortError') return { ok: false, error: '连接超时，请检查网络或 API 地址' };
    return { ok: false, error: `网络错误: ${err.message}` };
  }
}
