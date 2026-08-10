/**
 * Price fetcher — fetches stock, gold, and crypto prices from various public APIs.
 * Each fetcher returns a price number or null on failure.
 *
 * Data source architecture (primary → fallback):
 *   A-stock:    Sina → Tencent
 *   HK stock:   Sina → Tencent
 *   US stock:   Yahoo → Sina
 *   Gold:       Sina → Gold-API
 *   Crypto:     CoinGecko → Binance
 *
 * All errors are logged with structured [PriceFetcher] prefix for debugging.
 */
import { getDatabase } from '../database';
import { updateCurrentPrice } from '../database/services/asset-service';

const TAG = '[PriceFetcher]';

// ─── Market Detection ───────────────────────────────────────────

/**
 * Smart market detection from stock code pattern.
 * Falls back to the explicit market field when code pattern is ambiguous.
 */
function detectMarket(code: string, explicitMarket?: string): string {
  // If market is already explicitly set and non-ambiguous, use it
  if (explicitMarket && explicitMarket !== 'other') return explicitMarket;

  const cleaned = code.trim().replace(/[^A-Za-z0-9]/g, '');

  // 6-digit numeric → A-stock
  if (/^\d{6}$/.test(cleaned)) {
    return cleaned.startsWith('6') ? 'a_stock' : 'a_stock';
  }

  // 1-5 digit numeric → HK stock
  if (/^\d{1,5}$/.test(cleaned)) {
    return 'hk_stock';
  }

  // 1-5 letters → US stock
  if (/^[A-Za-z]{1,5}$/.test(cleaned)) {
    return 'us_stock';
  }

  return explicitMarket || 'other';
}

// ─── Generic Fallback Wrapper ───────────────────────────────────

/**
 * Try primary fetcher first; on failure, log and try fallback.
 * Returns the price or null if both sources fail.
 */
async function fetchWithFallback(
  code: string,
  label: string,
  primaryName: string,
  primary: () => Promise<number | null>,
  fallbackName: string,
  fallback: () => Promise<number | null>,
): Promise<number | null> {
  const t0 = Date.now();

  // ── Primary ──
  try {
    console.log(`${TAG} ${label} ${code}: ${primaryName} 开始获取...`);
    const price = await primary();
    if (price && price > 0) {
      const elapsed = Date.now() - t0;
      console.log(`${TAG} ${label} ${code}: ${primaryName} ✓ 价格=${price} 耗时=${elapsed}ms`);
      return price;
    }
    console.warn(`${TAG} ${label} ${code}: ${primaryName} 返回无效价格 → 尝试备用源 ${fallbackName}`);
  } catch (err: any) {
    console.warn(`${TAG} ${label} ${code}: ${primaryName} 异常 — ${err.message || err} → 尝试备用源 ${fallbackName}`);
  }

  // ── Fallback ──
  try {
    console.log(`${TAG} ${label} ${code}: ${fallbackName} 备用源开始获取...`);
    const price = await fallback();
    if (price && price > 0) {
      const elapsed = Date.now() - t0;
      console.log(`${TAG} ${label} ${code}: ${fallbackName}(备用) ✓ 价格=${price} 总耗时=${elapsed}ms`);
      return price;
    }
    console.error(`${TAG} ${label} ${code}: ${fallbackName}(备用) 也返回无效价格`);
  } catch (err: any) {
    console.error(`${TAG} ${label} ${code}: ${fallbackName}(备用) 也失败 — ${err.message || err}`);
  }

  console.error(`${TAG} ${label} ${code}: 所有数据源均失败 (${primaryName} → ${fallbackName})`);
  return null;
}

// ─── A-Share Stock ──────────────────────────────────────────────

/** Primary: Sina Finance A-stock */
async function fetchAStockSina(code: string): Promise<number | null> {
  const prefix = (code.startsWith('5') || code.startsWith('6')) ? 'sh' : 'sz';
  const url = `https://hq.sinajs.cn/list=${prefix}${code}`;
  const response = await fetch(url, {
    headers: { Referer: 'https://finance.sina.com.cn' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  const match = text.match(/"([^"]+)"/);
  if (!match) throw new Error('返回格式异常');
  const fields = match[1].split(',');
  const price = parseFloat(fields[3]);
  if (isNaN(price)) throw new Error(`价格解析失败, field[3]=${fields[3]}`);
  return price;
}

/** Fallback: Tencent Finance A-stock */
async function fetchAStockTencent(code: string): Promise<number | null> {
  const prefix = (code.startsWith('5') || code.startsWith('6')) ? 'sh' : 'sz';
  const url = `https://qt.gtimg.cn/q=${prefix}${code}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  const match = text.match(/~([\d.]+)/);
  if (!match) throw new Error('返回格式异常');
  // Tencent format: v_...="1~name~code~price~...
  const parts = text.split('~');
  const price = parseFloat(parts[3]);
  if (isNaN(price)) throw new Error(`价格解析失败, parts[3]=${parts[3]}`);
  return price;
}

async function fetchAStock(code: string): Promise<number | null> {
  return fetchWithFallback(code, 'A股', '新浪', () => fetchAStockSina(code), '腾讯', () => fetchAStockTencent(code));
}

// ─── HK Stock ───────────────────────────────────────────────────

/** Primary: Sina Finance HK stock */
async function fetchHKStockSina(code: string): Promise<number | null> {
  const paddedCode = code.padStart(5, '0');
  const url = `https://hq.sinajs.cn/list=hk${paddedCode}`;
  const response = await fetch(url, {
    headers: { Referer: 'https://finance.sina.com.cn' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  const match = text.match(/"([^"]+)"/);
  if (!match) throw new Error('返回格式异常');
  const fields = match[1].split(',');
  const price = parseFloat(fields[6]);
  if (isNaN(price)) throw new Error(`价格解析失败, field[6]=${fields[6]}`);
  return price;
}

/** Fallback: Tencent Finance HK stock */
async function fetchHKStockTencent(code: string): Promise<number | null> {
  const paddedCode = code.padStart(5, '0');
  const url = `https://qt.gtimg.cn/q=hk${paddedCode}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  const parts = text.split('~');
  const price = parseFloat(parts[3]);
  if (isNaN(price)) throw new Error(`价格解析失败, parts[3]=${parts[3]}`);
  return price;
}

async function fetchHKStock(code: string): Promise<number | null> {
  return fetchWithFallback(code, '港股', '新浪', () => fetchHKStockSina(code), '腾讯', () => fetchHKStockTencent(code));
}

// ─── US Stock ───────────────────────────────────────────────────

/** Fetch US stock price via Yahoo Finance, with Sina Finance fallback */
async function fetchUSStock(symbol: string): Promise<number | null> {
  // ── Primary: Yahoo Finance ──
  try {
    const t0 = Date.now();
    console.log(`${TAG} 美股 ${symbol}: Yahoo 开始获取...`);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json() as any;
      const result = data.chart?.result?.[0];
      if (result) {
        const price = result.meta?.regularMarketPrice;
        if (price && !isNaN(price)) {
          console.log(`${TAG} 美股 ${symbol}: Yahoo ✓ 价格=${price} 耗时=${Date.now() - t0}ms`);
          return price;
        }
      }
      console.warn(`${TAG} 美股 ${symbol}: Yahoo 返回数据无价格字段 → 尝试备用源 新浪`);
    } else {
      console.warn(`${TAG} 美股 ${symbol}: Yahoo HTTP ${response.status} → 尝试备用源 新浪`);
    }
  } catch (err: any) {
    console.warn(`${TAG} 美股 ${symbol}: Yahoo 异常 — ${err.message || err} → 尝试备用源 新浪`);
  }

  // ── Fallback: Sina Finance US stock ──
  try {
    console.log(`${TAG} 美股 ${symbol}: 新浪(备用) 开始获取...`);
    const sinaUrl = `https://hq.sinajs.cn/list=gb_${symbol.toLowerCase()}`;
    const response = await fetch(sinaUrl, {
      headers: { Referer: 'https://finance.sina.com.cn' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const match = text.match(/"([^"]+)"/);
    if (!match) throw new Error('返回格式异常');
    const fields = match[1].split(',');
    const price = parseFloat(fields[1]);
    if (isNaN(price)) throw new Error(`价格解析失败, field[1]=${fields[1]}`);
    console.log(`${TAG} 美股 ${symbol}: 新浪(备用) ✓ 价格=${price}`);
    return price;
  } catch (err: any) {
    console.error(`${TAG} 美股 ${symbol}: 新浪(备用) 也失败 — ${err.message || err}`);
    return null;
  }
}

// ─── Gold ───────────────────────────────────────────────────────

/** Primary: Sina Finance gold futures */
async function fetchGoldPriceSina(): Promise<number | null> {
  const url = 'https://hq.sinajs.cn/list=hf_XAU';
  const response = await fetch(url, {
    headers: { Referer: 'https://finance.sina.com.cn' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  const match = text.match(/"([^"]+)"/);
  if (!match) throw new Error('返回格式异常');
  const fields = match[1].split(',');
  const usdPerOunce = parseFloat(fields[0]);
  if (isNaN(usdPerOunce)) throw new Error(`价格解析失败, field[0]=${fields[0]}`);
  const db = getDatabase();
  const usdRow = db.prepare("SELECT rate_to_base FROM currencies WHERE code = 'USD'").get() as any;
  const usdRate = usdRow?.rate_to_base || 7.25;
  return parseFloat(((usdPerOunce * usdRate) / 31.1035).toFixed(2));
}

/** Fallback: Gold-API (free, no key required) */
async function fetchGoldPriceApi(): Promise<number | null> {
  const url = 'https://api.gold-api.com/price/XAU';
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json() as any;
  const usdPerOunce = data.price;
  if (!usdPerOunce || isNaN(usdPerOunce)) throw new Error('返回数据无价格');
  const db = getDatabase();
  const usdRow = db.prepare("SELECT rate_to_base FROM currencies WHERE code = 'USD'").get() as any;
  const usdRate = usdRow?.rate_to_base || 7.25;
  return parseFloat(((usdPerOunce * usdRate) / 31.1035).toFixed(2));
}

async function fetchGoldPrice(): Promise<number | null> {
  return fetchWithFallback('XAU', '黄金', '新浪', fetchGoldPriceSina, 'Gold-API', fetchGoldPriceApi);
}

// ─── Crypto ─────────────────────────────────────────────────────

/** Primary: CoinGecko (free, rate-limited) */
async function fetchCryptoPriceCoinGecko(coingeckoId: string): Promise<number | null> {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json() as any;
  const usdPrice = data[coingeckoId]?.usd;
  if (!usdPrice) throw new Error(`返回数据无价格, keys=${Object.keys(data).join(',')}`);
  const db = getDatabase();
  const usdRow = db.prepare("SELECT rate_to_base FROM currencies WHERE code = 'USD'").get() as any;
  const usdRate = usdRow?.rate_to_base || 7.25;
  return parseFloat((usdPrice * usdRate).toFixed(2));
}

/** Fallback: Binance public API */
async function fetchCryptoPriceBinance(symbol: string): Promise<number | null> {
  const binanceSymbol = `${symbol.toUpperCase()}USDT`;
  const url = `https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbol}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json() as any;
  const usdPrice = parseFloat(data.price);
  if (!usdPrice || isNaN(usdPrice)) throw new Error('返回数据无价格');
  const db = getDatabase();
  const usdRow = db.prepare("SELECT rate_to_base FROM currencies WHERE code = 'USD'").get() as any;
  const usdRate = usdRow?.rate_to_base || 7.25;
  return parseFloat((usdPrice * usdRate).toFixed(2));
}

async function fetchCryptoPrice(coingeckoId: string, code?: string): Promise<number | null> {
  const binanceSymbol = code || coingeckoId;
  return fetchWithFallback(
    coingeckoId, '加密货币', 'CoinGecko',
    () => fetchCryptoPriceCoinGecko(coingeckoId),
    'Binance',
    () => fetchCryptoPriceBinance(binanceSymbol),
  );
}

// ─── Main Export ────────────────────────────────────────────────

/** Get USD-to-base conversion rate (cached per call for efficiency). */
function getUsdRate(): number {
  const db = getDatabase();
  const usdRow = db.prepare("SELECT rate_to_base FROM currencies WHERE code = 'USD'").get() as any;
  return usdRow?.rate_to_base || 7.25;
}

/** Update prices for all assets that have codes — batched concurrent requests. */
export async function fetchAllPrices(): Promise<{
  success: boolean;
  total: number;
  updated: number;
  errors: string[];
}> {
  const db = getDatabase();
  const rawAssets = db.prepare("SELECT id, code, type, market FROM assets WHERE type != 'fixed_deposit'").all() as any[];

  // Apply smart market detection to assets with ambiguous market
  const assets = rawAssets.map((a: any) => ({
    ...a,
    market: detectMarket(a.code, a.market),
  }));

  console.log(`${TAG} 开始更新 ${assets.length} 个资产价格...`);

  // Pre-fetch shared data — gold price (with fallback)
  let goldPriceCache: number | null = null;
  const hasGold = assets.some((a: any) => a.type === 'gold');
  if (hasGold) {
    goldPriceCache = await fetchGoldPrice();
    if (goldPriceCache) {
      console.log(`${TAG} 黄金价格: ¥${goldPriceCache}/克`);
    }
  }

  // Fetch crypto prices in parallel
  const cryptoAssets = assets.filter((a: any) => a.type === 'crypto');
  const cgIdMap: Record<string, string> = {
    BTC: 'bitcoin', ETH: 'ethereum', USDT: 'tether', USDC: 'usd-coin',
  };
  const cryptoPrices = new Map<string, number | null>();
  if (cryptoAssets.length > 0) {
    const results = await Promise.all(
      cryptoAssets.map(async (a: any) => {
        const cgId = cgIdMap[a.code.toUpperCase()] || a.code.toLowerCase();
        const price = await fetchCryptoPrice(cgId, a.code);
        return { id: a.id, price };
      })
    );
    for (const r of results) {
      cryptoPrices.set(r.id, r.price);
    }
  }

  // Fetch stock prices in concurrent batches (5 per batch, 200ms between batches)
  const BATCH_SIZE = 5;
  const BATCH_DELAY_MS = 200;
  const stockAssets = assets.filter((a: any) => a.type !== 'gold' && a.type !== 'crypto');

  let updated = 0;
  const errors: string[] = [];

  for (let i = 0; i < stockAssets.length; i += BATCH_SIZE) {
    const batch = stockAssets.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.all(
      batch.map(async (asset: any) => {
        try {
          let price: number | null = null;
          switch (asset.market) {
            case 'a_stock':
              price = await fetchAStock(asset.code);
              break;
            case 'hk_stock':
              price = await fetchHKStock(asset.code);
              break;
            case 'us_stock':
              price = await fetchUSStock(asset.code);
              break;
            default:
              // Auto-detect market for unknown types
              const detected = detectMarket(asset.code);
              if (detected === 'a_stock') {
                price = await fetchAStock(asset.code);
              } else if (detected === 'hk_stock') {
                price = await fetchHKStock(asset.code);
              } else if (detected === 'us_stock') {
                price = await fetchUSStock(asset.code);
              } else {
                console.error(`${TAG} ${asset.code}: 无法检测市场类型 (market=${asset.market})`);
              }
          }
          return { id: asset.id, code: asset.code, price, error: null };
        } catch (err: any) {
          return { id: asset.id, code: asset.code, price: null, error: `${asset.code}: ${err.message}` };
        }
      })
    );

    for (const r of batchResults) {
      if (r.error) {
        errors.push(r.error);
      } else if (r.price && r.price > 0) {
        updateCurrentPrice(r.id, r.price);
        updated++;
      } else if (r.price === null || r.price <= 0) {
        const asset = stockAssets.find((a: any) => a.id === r.id);
        if (asset) {
          console.error(`${TAG} ${asset.code} (${asset.market}): 获取价格失败`);
        }
      }
    }

    // Rate-limit between batches
    if (i + BATCH_SIZE < stockAssets.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  // Update gold assets
  if (goldPriceCache && goldPriceCache > 0) {
    for (const a of assets.filter((a: any) => a.type === 'gold')) {
      updateCurrentPrice(a.id, goldPriceCache);
      updated++;
    }
  }

  // Update crypto assets
  for (const a of cryptoAssets) {
    const price = cryptoPrices.get(a.id);
    if (price && price > 0) {
      updateCurrentPrice(a.id, price);
      updated++;
    }
  }

  if (errors.length > 0) {
    console.error(`${TAG} 完成: ${updated}/${assets.length} 更新成功, ${errors.length} 失败`);
    for (const e of errors.slice(0, 10)) {
      console.error(`  - ${e}`);
    }
    if (errors.length > 10) {
      console.error(`  ... 另有 ${errors.length - 10} 个错误`);
    }
  } else {
    console.log(`${TAG} 完成: ${updated}/${assets.length} 全部更新成功`);
  }

  return { success: true, total: assets.length, updated, errors };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
