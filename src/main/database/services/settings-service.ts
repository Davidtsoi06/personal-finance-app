/**
 * App settings — simple key-value store backed by the app_settings table.
 * Used for AI configuration and other user preferences.
 */
import { getDatabase } from '../index';

// ── Types ──

export interface AiConfig {
  provider: string;
  apiUrl: string;
  apiKey: string;
  model: string;
}

export interface AiConfigPublic {
  provider: string;
  apiUrl: string;
  model: string;
  hasApiKey: boolean; // true if a key is stored (key itself never returned)
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

/** Get full AI config including API key (main-process only, never exposed to renderer). */
export function getAiConfig(): AiConfig {
  const provider = getSetting('ai.provider') || DEFAULT_PROVIDER;
  const preset = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS[DEFAULT_PROVIDER];
  return {
    provider,
    apiUrl: getSetting('ai.apiUrl') || preset.apiUrl,
    apiKey: getSetting('ai.apiKey') || '',
    model: getSetting('ai.model') || preset.model,
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
  };
}

/** Save AI config from renderer. */
export function saveAiConfig(config: AiConfig): void {
  setSetting('ai.provider', config.provider || DEFAULT_PROVIDER);
  setSetting('ai.apiUrl', config.apiUrl || '');
  setSetting('ai.apiKey', config.apiKey || '');
  setSetting('ai.model', config.model || '');
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
