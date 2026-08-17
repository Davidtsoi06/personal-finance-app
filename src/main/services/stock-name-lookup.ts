/**
 * stock-name-lookup — 股票名称自动匹配（v1.8.1）。
 * 数据源：东方财富行情接口（UTF-8 JSON，字段 f58=名称）；失败返回 null 由调用方静默降级。
 */
import { detectMarket } from '../../shared/utils/market';

/** 由代码与市场推断东方财富 secid（纯函数，可测试） */
export function buildEastmoneySecid(code: string, market?: string): string | null {
  const m = market || detectMarket(code);
  const c = code.trim().toUpperCase();
  if (m === 'a_stock') {
    // 沪市：5/6/9 开头 → 1.；深市：0/1/2/3 开头 → 0.
    return (/^[569]/.test(c) ? '1.' : '0.') + c;
  }
  if (m === 'hk_stock') {
    return '116.' + c.padStart(5, '0');
  }
  if (m === 'us_stock') {
    return '105.' + c;
  }
  return null;
}

/** 解析东方财富返回 JSON 中的名称（f58）；失败返回 null */
export function parseNameFromEastmoney(json: unknown): string | null {
  const data = (json as any)?.data as any;
    
  if (data && typeof data.f58 === 'string' && data.f58.trim() && data.f58 !== '-') {
    return data.f58.trim();
  }
  return null;
}

/** 查股票名称（5 秒超时，失败返回 null） */
export async function lookupStockName(code: string, market?: string): Promise<string | null> {
  const secid = buildEastmoneySecid(code, market);
  if (!secid) return null;
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f58`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const json = await resp.json();
    return parseNameFromEastmoney(json);
  } catch {
    return null;
  }
}