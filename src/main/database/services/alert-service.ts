/**
 * Alert service — price change and budget alert configuration & checks.
 */
import { getDatabase } from '../index';

export interface AlertConfigRow {
  id: number;
  type: 'price_drop' | 'price_surge' | 'budget_warning';
  enabled: number;
  threshold: number;
  created_at: string;
  updated_at: string;
}

// ── CRUD ──

export function listAlertConfigs(): AlertConfigRow[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM alert_config ORDER BY id').all() as AlertConfigRow[];
}

export function updateAlertConfig(id: number, data: { enabled?: number; threshold?: number }): AlertConfigRow | undefined {
  const db = getDatabase();
  const existing = db.prepare('SELECT * FROM alert_config WHERE id = ?').get(id) as AlertConfigRow | undefined;
  if (!existing) return undefined;

  const enabled = data.enabled !== undefined ? data.enabled : existing.enabled;
  const threshold = data.threshold !== undefined ? data.threshold : existing.threshold;

  db.prepare(
    'UPDATE alert_config SET enabled = ?, threshold = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).run(enabled, threshold, id);

  return db.prepare('SELECT * FROM alert_config WHERE id = ?').get(id) as AlertConfigRow;
}

// ── Price change check ──

export interface PriceAlert {
  assetId: number;
  assetName: string;
  assetCode: string;
  currency: string;
  oldPrice: number;
  newPrice: number;
  changePct: number;
  direction: 'drop' | 'surge';
  quantity: number;
  marketValue: number;
}

/**
 * Compare old and new prices for all assets, return alerts that triggered.
 * Called after fetchAllPrices() completes in the scheduler.
 */
export function checkPriceAlerts(
  oldPrices: Map<number, number>,
  newPrices: Map<number, number>
): PriceAlert[] {
  const db = getDatabase();
  const configs = listAlertConfigs();

  const dropCfg = configs.find(c => c.type === 'price_drop' && c.enabled);
  const surgeCfg = configs.find(c => c.type === 'price_surge' && c.enabled);
  if (!dropCfg && !surgeCfg) return [];

  const alerts: PriceAlert[] = [];

  for (const [assetId, newPrice] of newPrices) {
    const oldPrice = oldPrices.get(assetId);
    if (!oldPrice || oldPrice <= 0 || newPrice <= 0) continue;

    const changePct = ((newPrice - oldPrice) / oldPrice) * 100;

    if (changePct <= -(dropCfg?.threshold || 999) && dropCfg) {
      const asset = db.prepare(
        'SELECT name, code, currency, quantity, market_value FROM assets WHERE id = ?'
      ).get(assetId) as any;
      if (asset) {
        alerts.push({
          assetId, assetName: asset.name, assetCode: asset.code,
          currency: asset.currency, oldPrice, newPrice,
          changePct: Math.round(changePct * 100) / 100,
          direction: 'drop',
          quantity: asset.quantity,
          marketValue: asset.market_value,
        });
      }
    }

    if (changePct >= (surgeCfg?.threshold || 999) && surgeCfg) {
      const asset = db.prepare(
        'SELECT name, code, currency, quantity, market_value FROM assets WHERE id = ?'
      ).get(assetId) as any;
      if (asset) {
        alerts.push({
          assetId, assetName: asset.name, assetCode: asset.code,
          currency: asset.currency, oldPrice, newPrice,
          changePct: Math.round(changePct * 100) / 100,
          direction: 'surge',
          quantity: asset.quantity,
          marketValue: asset.market_value,
        });
      }
    }
  }

  return alerts;
}
