/**
 * Price fetcher — fetches stock, gold, and crypto prices from various public APIs.
 * Each fetcher returns a price number or null on failure.
 */
import { getDatabase } from '../database';
import { updateCurrentPrice } from '../database/services/asset-service';

/** Fetch A-share stock price from Sina Finance */
async function fetchAStock(code: string): Promise<number | null> {
  try {
    const prefix = code.startsWith('6') ? 'sh' : 'sz';
    const url = `https://hq.sinajs.cn/list=${prefix}${code}`;
    const response = await fetch(url, {
      headers: { Referer: 'https://finance.sina.com.cn' },
    });
    const text = await response.text();
    // Parse: var hq_str_sh600036="招商银行,38.50,..."
    const match = text.match(/"([^"]+)"/);
    if (!match) return null;
    const fields = match[1].split(',');
    // fields[3] is current price for stocks
    const price = parseFloat(fields[3]);
    return isNaN(price) ? null : price;
  } catch {
    return null;
  }
}

/** Fetch HK stock price from Sina Finance */
async function fetchHKStock(code: string): Promise<number | null> {
  try {
    const paddedCode = code.padStart(5, '0');
    const url = `https://hq.sinajs.cn/list=hk${paddedCode}`;
    const response = await fetch(url, {
      headers: { Referer: 'https://finance.sina.com.cn' },
    });
    const text = await response.text();
    const match = text.match(/"([^"]+)"/);
    if (!match) return null;
    const fields = match[1].split(',');
    // fields[6] is current price for HK stocks
    const price = parseFloat(fields[6]);
    return isNaN(price) ? null : price;
  } catch {
    return null;
  }
}

/** Fetch US stock price via Yahoo Finance (free, no API key) */
async function fetchUSStock(symbol: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json() as any;
    const result = data.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta;
    return meta.regularMarketPrice || null;
  } catch {
    return null;
  }
}

/** Fetch gold price from Sina Finance */
async function fetchGoldPrice(): Promise<number | null> {
  try {
    const url = 'https://hq.sinajs.cn/list=hf_XAU';
    const response = await fetch(url, {
      headers: { Referer: 'https://finance.sina.com.cn' },
    });
    const text = await response.text();
    const match = text.match(/"([^"]+)"/);
    if (!match) return null;
    const fields = match[1].split(',');
    // Gold price is in field[0] in USD per ounce, convert to CNY/gram
    const usdPerOunce = parseFloat(fields[0]);
    if (isNaN(usdPerOunce)) return null;
    // 1 troy ounce = 31.1035 grams. Get USD/CNY rate.
    const db = getDatabase();
    const usdRow = db.prepare("SELECT rate_to_base FROM currencies WHERE code = 'USD'").get() as any;
    const usdRate = usdRow?.rate_to_base || 7.25;
    return parseFloat(((usdPerOunce * usdRate) / 31.1035).toFixed(2));
  } catch {
    return null;
  }
}

/** Fetch crypto price from CoinGecko (free, rate-limited) */
async function fetchCryptoPrice(coingeckoId: string): Promise<number | null> {
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json() as any;
    const usdPrice = data[coingeckoId]?.usd;
    if (!usdPrice) return null;
    // Convert USD to CNY
    const db = getDatabase();
    const usdRow = db.prepare("SELECT rate_to_base FROM currencies WHERE code = 'USD'").get() as any;
    const usdRate = usdRow?.rate_to_base || 7.25;
    return parseFloat((usdPrice * usdRate).toFixed(2));
  } catch {
    return null;
  }
}

/** Update prices for all assets that have codes — batched concurrent requests. */
export async function fetchAllPrices(): Promise<{
  success: boolean;
  total: number;
  updated: number;
  errors: string[];
}> {
  const db = getDatabase();
  const assets = db.prepare("SELECT id, code, type, market FROM assets WHERE type != 'fixed_deposit'").all() as any[];

  // Pre-fetch shared data — gold price and USD rate are the same for all assets
  let goldPriceCache: number | null = null;
  const hasGold = assets.some(a => a.type === 'gold');
  if (hasGold) {
    goldPriceCache = await fetchGoldPrice();
  }

  // Fetch crypto prices in parallel for all crypto assets
  const cryptoAssets = assets.filter(a => a.type === 'crypto');
  const cgIdMap: Record<string, string> = {
    BTC: 'bitcoin', ETH: 'ethereum', USDT: 'tether', USDC: 'usd-coin',
  };
  const cryptoPrices = new Map<string, number | null>();
  if (cryptoAssets.length > 0) {
    const results = await Promise.all(
      cryptoAssets.map(async (a) => {
        const cgId = cgIdMap[a.code.toUpperCase()] || a.code.toLowerCase();
        const price = await fetchCryptoPrice(cgId);
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
  const stockAssets = assets.filter(a => a.type !== 'gold' && a.type !== 'crypto');

  let updated = 0;
  const errors: string[] = [];

  for (let i = 0; i < stockAssets.length; i += BATCH_SIZE) {
    const batch = stockAssets.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.all(
      batch.map(async (asset) => {
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
          }
          return { id: asset.id, price, error: null };
        } catch (err: any) {
          return { id: asset.id, price: null, error: `${asset.code}: ${err.message}` };
        }
      })
    );

    for (const r of batchResults) {
      if (r.error) {
        errors.push(r.error);
      } else if (r.price && r.price > 0) {
        updateCurrentPrice(r.id, r.price);
        updated++;
      }
    }

    // Rate-limit between batches
    if (i + BATCH_SIZE < stockAssets.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  // Update gold assets
  if (goldPriceCache && goldPriceCache > 0) {
    for (const a of assets.filter(a => a.type === 'gold')) {
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

  return { success: true, total: assets.length, updated, errors };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
