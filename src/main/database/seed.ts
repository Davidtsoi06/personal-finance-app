/**
 * Seed test data for development and demo purposes.
 * Comprehensive test data covering all features.
 */
import { getDatabase } from './index';

export function seedTestData(): void {
  const db = getDatabase();

  console.log('Seeding test data...');

  // ═══════════════════════════════════════════
  // 1. Bank/Cash Accounts (7 accounts, 3 currencies)
  // ═══════════════════════════════════════════
  const accStmt = db.prepare(`
    INSERT INTO accounts (name, type, currency, balance, bank_name, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  accStmt.run('现金钱包', 'cash', 'CNY', 8500, null, 1);
  accStmt.run('招商银行储蓄卡', 'bank_card', 'CNY', 156000, '招商银行', 2);
  accStmt.run('招商银行信用卡', 'credit_card', 'CNY', -4200, '招商银行', 3);
  accStmt.run('汇丰银行(香港)', 'bank_card', 'HKD', 320000, '汇丰银行', 4);
  accStmt.run('中国银行储蓄卡', 'bank_card', 'CNY', 88000, '中国银行', 5);
  accStmt.run('微信支付', 'online_pay', 'CNY', 3200, null, 6);
  accStmt.run('美元现金', 'cash', 'USD', 5000, null, 7);

  // ═══════════════════════════════════════════
  // 2. Account Transactions (deposits/withdrawals for banks)
  // ═══════════════════════════════════════════
  const atStmt = db.prepare(`
    INSERT INTO account_transactions (account_id, type, amount, currency, date, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const t = new Date();
  const td = (daysBack: number) => {
    const d = new Date(t);
    d.setDate(d.getDate() - daysBack);
    return d.toISOString().slice(0, 10);
  };

  atStmt.run(2, 'deposit', 25000, 'CNY', td(1), '工资入账');
  atStmt.run(2, 'withdraw', 5000, 'CNY', td(3), '取现');
  atStmt.run(2, 'deposit', 3000, 'CNY', td(7), '奖金');
  atStmt.run(4, 'deposit', 50000, 'HKD', td(2), '换汇转入');
  atStmt.run(4, 'withdraw', 10000, 'HKD', td(5), '转至投资账户');
  atStmt.run(1, 'deposit', 2000, 'CNY', td(4), '零钱存入');
  atStmt.run(1, 'withdraw', 500, 'CNY', td(6), '日常取用');
  atStmt.run(6, 'deposit', 1500, 'CNY', td(1), '转账充值');

  // ═══════════════════════════════════════════
  // 3. Investment Accounts (4 accounts)
  // ═══════════════════════════════════════════
  const ivAccStmt = db.prepare(`
    INSERT INTO investment_accounts (name, broker, currency, account_number, notes)
    VALUES (?, ?, ?, ?, ?)
  `);
  ivAccStmt.run('富途牛牛', '富途证券', 'HKD', 'FT-123456', '港股+美股账户');
  ivAccStmt.run('中国银行(香港)', '中国银行', 'HKD', 'BOC-789012', '港股账户');
  ivAccStmt.run('盈透证券', 'Interactive Brokers', 'USD', 'IB-345678', '美股主要账户');
  ivAccStmt.run('长桥证券', 'Long Bridge', 'HKD', 'LB-567890', '港股账户');

  // ═══════════════════════════════════════════
  // 4. Investment Assets (15+ holdings across 4 accounts)
  // ═══════════════════════════════════════════
  const assetStmt = db.prepare(`
    INSERT INTO assets (name, code, type, market, currency, quantity, cost_price, current_price, market_value, total_cost, profit_loss, profit_loss_pct, investment_account_id, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // 富途牛牛 (HKD) - id=1
  assetStmt.run('腾讯控股', '00700', 'stock', 'hk_stock', 'HKD', 500, 320.0, 345.0, 172500, 160000, 12500, 7.81, 1, '科技龙头');
  assetStmt.run('阿里巴巴', '09988', 'stock', 'hk_stock', 'HKD', 1000, 75.0, 80.5, 80500, 75000, 5500, 7.33, 1, '电商');
  assetStmt.run('Apple Inc', 'AAPL', 'stock', 'us_stock', 'USD', 200, 175.0, 190.0, 38000, 35000, 3000, 8.57, 1, '美股科技');
  assetStmt.run('美团-W', '03690', 'stock', 'hk_stock', 'HKD', 300, 110.0, 118.0, 35400, 33000, 2400, 7.27, 1, '本地生活');

  // 中国银行(香港) (HKD) - id=2
  assetStmt.run('汇丰控股', '00005', 'stock', 'hk_stock', 'HKD', 400, 58.0, 60.5, 24200, 23200, 1000, 4.31, 2, '银行股');
  assetStmt.run('港交所', '00388', 'stock', 'hk_stock', 'HKD', 300, 280.0, 295.0, 88500, 84000, 4500, 5.36, 2, '交易所');
  assetStmt.run('盈富基金', '02800', 'etf', 'hk_stock', 'HKD', 2000, 18.5, 19.2, 38400, 37000, 1400, 3.78, 2, '恒指ETF');

  // 盈透证券 (USD) - id=3
  assetStmt.run('Apple Inc', 'AAPL', 'stock', 'us_stock', 'USD', 100, 170.0, 190.0, 19000, 17000, 2000, 11.76, 3, 'Apple');
  assetStmt.run('Tesla Inc', 'TSLA', 'stock', 'us_stock', 'USD', 50, 240.0, 255.0, 12750, 12000, 750, 6.25, 3, 'Tesla');
  assetStmt.run('比特币', 'BTC', 'crypto', 'other', 'USD', 0.5, 42000.0, 65000.0, 32500, 21000, 11500, 54.76, 3, '加密货币');
  assetStmt.run('SPY ETF', 'SPY', 'etf', 'us_stock', 'USD', 80, 450.0, 475.0, 38000, 36000, 2000, 5.56, 3, '标普500ETF');

  // 长桥证券 (HKD) - id=4
  assetStmt.run('小米集团-W', '01810', 'stock', 'hk_stock', 'HKD', 2000, 16.5, 18.2, 36400, 33000, 3400, 10.3, 4, '手机+汽车');
  assetStmt.run('快手-W', '01024', 'stock', 'hk_stock', 'HKD', 500, 52.0, 55.5, 27750, 26000, 1750, 6.73, 4, '短视频');

  // Unlinked assets (no investment account)
  assetStmt.run('黄金ETF', 'AU9999', 'gold', 'other', 'CNY', 100, 450.0, 480.0, 48000, 45000, 3000, 6.67, null, '实物黄金');
  assetStmt.run('一年期定期', 'FD001', 'fixed_deposit', 'other', 'CNY', 50000, 1.0, 1.02, 51000, 50000, 1000, 2.0, null, '年利率2%');
  assetStmt.run('贵州茅台', '600519', 'stock', 'a_stock', 'CNY', 100, 1680.0, 1720.0, 172000, 168000, 4000, 2.38, null, '白酒龙头');

  // ═══════════════════════════════════════════
  // 5. Transactions (25+ records across multiple dates)
  // ═══════════════════════════════════════════
  const txStmt = db.prepare(`
    INSERT INTO transactions (asset_id, type, quantity, price, fee, total_amount, currency, date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // 腾讯控股 — multiple buys over time
  txStmt.run(1, 'buy', 200, 310.0, 10, 62010, 'HKD', td(30), '建仓腾讯');
  txStmt.run(1, 'buy', 150, 318.0, 8, 47708, 'HKD', td(20), '加仓腾讯');
  txStmt.run(1, 'buy', 150, 330.0, 8, 49508, 'HKD', td(10), '加仓腾讯');

  // 阿里巴巴 — buy + sell
  txStmt.run(2, 'buy', 600, 72.0, 12, 43212, 'HKD', td(25), '建仓阿里');
  txStmt.run(2, 'buy', 400, 78.0, 10, 31210, 'HKD', td(15), '加仓阿里');
  txStmt.run(2, 'sell', 200, 85.0, 8, 16992, 'HKD', td(3), '减仓止盈');

  // Apple (富途)
  txStmt.run(3, 'buy', 100, 170.0, 2, 17002, 'USD', td(28), '建仓Apple');
  txStmt.run(3, 'buy', 100, 180.0, 2, 18002, 'USD', td(14), '加仓Apple');

  // 美团
  txStmt.run(4, 'buy', 300, 110.0, 8, 33008, 'HKD', td(12), '建仓美团');

  // 汇丰控股
  txStmt.run(5, 'buy', 400, 58.0, 10, 23210, 'HKD', td(20), '买入汇丰');

  // 港交所
  txStmt.run(6, 'buy', 200, 275.0, 10, 55010, 'HKD', td(18), '建仓港交所');
  txStmt.run(6, 'buy', 100, 288.0, 6, 28806, 'HKD', td(8), '加仓港交所');

  // 盈富基金
  txStmt.run(7, 'buy', 1000, 18.0, 5, 18005, 'HKD', td(22), '定投盈富');
  txStmt.run(7, 'buy', 1000, 19.0, 5, 19005, 'HKD', td(4), '定投盈富');

  // Apple (盈透)
  txStmt.run(8, 'buy', 60, 165.0, 1, 9901, 'USD', td(26), '买入Apple');
  txStmt.run(8, 'buy', 40, 175.0, 1, 7001, 'USD', td(11), '加仓Apple');

  // Tesla
  txStmt.run(9, 'buy', 30, 235.0, 1, 7051, 'USD', td(19), '建仓Tesla');
  txStmt.run(9, 'buy', 20, 248.0, 1, 4961, 'USD', td(6), '加仓Tesla');

  // 比特币
  txStmt.run(10, 'buy', 0.3, 40000.0, 5, 12005, 'USD', td(35), '买入BTC');
  txStmt.run(10, 'buy', 0.2, 45000.0, 3, 9003, 'USD', td(15), '加仓BTC');

  // SPY
  txStmt.run(11, 'buy', 80, 450.0, 1, 36001, 'USD', td(10), '买入SPY');

  // 小米
  txStmt.run(12, 'buy', 1000, 16.0, 8, 16008, 'HKD', td(16), '建仓小米');
  txStmt.run(12, 'buy', 1000, 17.0, 8, 17008, 'HKD', td(5), '加仓小米');

  // 快手
  txStmt.run(13, 'buy', 500, 52.0, 5, 26005, 'HKD', td(14), '建仓快手');

  // 贵州茅台
  txStmt.run(16, 'buy', 100, 1680.0, 5, 168005, 'CNY', td(40), '买入茅台');

  // ═══════════════════════════════════════════
  // 6. Ledger entries (daily bookkeeping records)
  // ═══════════════════════════════════════════
  const ledgerStmt = db.prepare(`
    INSERT INTO ledgers (type, amount, currency, category_id, account_id, date, description, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  ledgerStmt.run('income', 25000, 'CNY', 11, 2, td(1), '8月工资', '["工资"]');
  ledgerStmt.run('income', 5000, 'CNY', 12, 2, td(7), '项目奖金', '["奖金"]');
  ledgerStmt.run('income', 800, 'CNY', 15, 6, td(10), '朋友还钱', '["还款"]');
  ledgerStmt.run('expense', 120, 'CNY', 1, 6, td(1), '午餐外卖', '["餐饮"]');
  ledgerStmt.run('expense', 68, 'CNY', 1, 6, td(2), '晚餐', '["餐饮"]');
  ledgerStmt.run('expense', 35, 'CNY', 2, 6, td(1), '地铁通勤', '["交通"]');
  ledgerStmt.run('expense', 200, 'CNY', 2, 6, td(5), '加油', '["交通"]');
  ledgerStmt.run('expense', 3000, 'CNY', 5, 2, td(1), '房租', '["居住"]');
  ledgerStmt.run('expense', 450, 'CNY', 3, 6, td(3), '超市购物', '["购物"]');
  ledgerStmt.run('expense', 299, 'CNY', 4, 6, td(4), '电影票', '["娱乐"]');
  ledgerStmt.run('expense', 180, 'CNY', 6, 6, td(6), '买药', '["医疗"]');
  ledgerStmt.run('expense', 88, 'CNY', 7, 6, td(8), '购买书籍', '["教育"]');

  // ═══════════════════════════════════════════
  // 7. Net worth history (30 days snapshot)
  // ═══════════════════════════════════════════
  const nwStmt = db.prepare(
    'INSERT OR REPLACE INTO net_worth_history (date, total_cash, total_investments, net_worth) VALUES (?, ?, ?, ?)'
  );
  for (let i = 30; i >= 0; i--) {
    const d = td(i);
    const cashBase = 576500; // approximate CNY cash total
    const invBase = 876000;  // approximate investment total
    // Add some variance to make the chart interesting
    const variance = Math.sin(i * 0.15) * 20000 + (Math.random() - 0.5) * 15000;
    const cash = Math.round(cashBase + variance * 0.3);
    const inv = Math.round(invBase + variance * 0.7 + i * 500);
    nwStmt.run(d, cash, inv, cash + inv);
  }

  console.log('Test data seeded successfully!');
}
