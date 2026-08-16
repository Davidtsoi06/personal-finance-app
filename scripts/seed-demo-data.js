/**
 * seed-demo-data.js — 生成各类资产、多种币种的演示数据（用于总资产口径验证）。
 * 用法：node scripts/seed-demo-data.js <数据库路径>
 * 说明：若目标库不存在/未初始化，会先按迁移建表（跳过 v13 的 electron 依赖迁移）。
 *      脚本会清空业务数据后写入演示数据（可重复执行）。
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.argv[2];
if (!dbPath) {
  console.error('用法: node scripts/seed-demo-data.js <数据库路径>');
  process.exit(1);
}

fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

// ── 建表（若未初始化）──
const hasTables = db.prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE name = '_migrations'").get().c > 0;
if (!hasTables) {
  const { MIGRATIONS } = require('../dist/main/main/database/migrations.js');
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');
  for (const m of MIGRATIONS) {
    db.exec('BEGIN');
    db.exec(m.sql);
    if (m.migrate && m.version !== 13) m.migrate(db);
    db.prepare('INSERT INTO _migrations (version) VALUES (?)').run(m.version);
    db.exec('COMMIT');
  }
  console.log('✓ 已初始化数据库（迁移 v1~v16）');
}

// ── 清空业务数据（可重复执行）──
const wipe = db.transaction(() => {
  for (const t of ['investment_cash_flows','premium_payments','insurance_policies','transactions','asset_prices',
    'account_transactions','ledgers','fixed_deposits','assets','net_worth_history','budgets',
    'social_obligations','account_balances','investment_accounts','accounts','currencies','categories']) {
    db.prepare('DELETE FROM ' + t).run();
  }
});
wipe();

// ── 汇率（CNY 本位）──
const insCur = db.prepare('INSERT INTO currencies (code, name, symbol, rate_to_base, is_base) VALUES (?, ?, ?, ?, ?)');
insCur.run('CNY', '人民币', '¥', 1.0, 1);
insCur.run('HKD', '港币', 'HK$', 0.92, 0);
insCur.run('USD', '美元', '$', 7.25, 0);
insCur.run('EUR', '欧元', '€', 7.85, 0);
insCur.run('JPY', '日元', '¥', 0.048, 0);
insCur.run('GBP', '英镑', '£', 9.2, 0);

// ── 账户 ──
const insAcc = db.prepare("INSERT INTO accounts (name, type, asset_type, currency, balance, bank_name, card_number, display_alias, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)");
const insBal = db.prepare('INSERT INTO account_balances (account_id, currency, balance) VALUES (?, ?, ?)');
function addAccount(name, type, assetType, currency, balance, bankName, card, alias, sort) {
  const r = insAcc.run(name, type, assetType, currency, balance, bankName || null, card || null, alias || null, sort);
  const id = Number(r.lastInsertRowid);
  if (balance !== 0) insBal.run(id, currency, balance);
  return id;
}

const bocHkd = addAccount('中国银行港股卡', 'bank_card', 'bank', 'HKD', 100000, '中国银行', '8888', '港股卡', 1);
const bocCny = addAccount('中国银行工资卡', 'bank_card', 'bank', 'CNY', 50000, '中国银行', '6666', '工资卡', 2);
const icbc = addAccount('工商银行储蓄卡', 'bank_card', 'bank', 'CNY', 20000, '工商银行', '1234', null, 3);
addAccount('微信', 'online_pay', 'e_wallet', 'CNY', 5000, null, null, null, 10);
addAccount('支付宝', 'online_pay', 'e_wallet', 'CNY', 3000, null, null, null, 11);
addAccount('现金', 'cash', 'cash', 'CNY', 2000, null, null, null, 12);

// ── 定期存款（扣款型 + 纯记录型）──
const insFd = db.prepare("INSERT INTO fixed_deposits (account_id, amount, currency, interest_rate, start_date, maturity_date, notes, deduct_mode, deduct_account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
insFd.run(bocHkd, 50000, 'HKD', 3.5, '2026-01-01', '2027-01-01', '演示：扣款型定存', 'deduct', bocHkd);
insFd.run(icbc, 30000, 'CNY', 2.5, '2026-02-01', '2027-02-01', '演示：纯记录定存', 'record_only', null);
// 扣款型生效：HKD 卡余额 100000 - 50000 = 50000
db.prepare("UPDATE account_balances SET balance = 50000 WHERE account_id = ? AND currency = 'HKD'").run(bocHkd);
db.prepare('UPDATE accounts SET balance = ? WHERE id = ?').run(50000 * 0.92, bocHkd);

// ── 保单（CNY / HKD / USD 三种币种现金价值）──
const insPol = db.prepare("INSERT INTO insurance_policies (name, company, type, annual_premium, premium_currency, cash_value, cash_value_currency, insured_person, start_date, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)");
insPol.run('重大疾病险', '平安保险', 'critical', 5000, 'CNY', 20000, 'CNY', '张三', '2020-01-01');
insPol.run('储蓄型年金', '友邦保险', 'annuity', 20000, 'HKD', 30000, 'HKD', '张三', '2021-01-01');
insPol.run('美元分红险', '保诚', 'life', 3000, 'USD', 5000, 'USD', '张三', '2022-01-01');

// ── 券商账户 ──
const insIa = db.prepare("INSERT INTO investment_accounts (name, broker, currency, account_number, funding_account_id, cash_balance, notes) VALUES (?, ?, ?, ?, ?, ?, ?)");
const futu = Number(insIa.run('富途证券', '富途', 'HKD', 'FT888', bocHkd, 10000, '演示：关联中国银行港股卡').lastInsertRowid);
const ibkr = Number(insIa.run('盈透证券', 'Interactive Brokers', 'USD', 'IB666', null, 2000, '演示：未关联银行').lastInsertRowid);

// ── 持仓（券商）──
const insAsset = db.prepare("INSERT INTO assets (name, code, type, market, currency, quantity, cost_price, current_price, market_value, total_cost, profit_loss, profit_loss_pct, investment_account_id) VALUES (?, ?, 'stock', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
insAsset.run('腾讯控股', '00700', 'hk_stock', 'HKD', 500, 300, 340, 170000, 150000, 20000, 13.33, futu);
insAsset.run('阿里巴巴', '09988', 'hk_stock', 'HKD', 1000, 80, 75, 75000, 80000, -5000, -6.25, futu);
insAsset.run('苹果', 'AAPL', 'us_stock', 'USD', 100, 180, 200, 20000, 18000, 2000, 11.11, ibkr);

// ── 银行理财（挂在银行账户下，计入投资市值）──
const insWealth = db.prepare("INSERT INTO assets (name, code, type, market, currency, quantity, cost_price, current_price, market_value, total_cost, profit_loss, profit_loss_pct, account_id) VALUES (?, ?, 'fund', 'other', ?, ?, ?, ?, ?, ?, ?, ?, ?)");
insWealth.run('华夏成长基金', '000001', 'CNY', 10000, 1.2, 1.5, 15000, 12000, 3000, 25, bocCny);
insWealth.run('中银理财稳富', 'ZY888', 'HKD', 20000, 0.9, 1.0, 20000, 18000, 2000, 11.11, bocHkd);

// ── 交易记录 ──
const insTx = db.prepare("INSERT INTO transactions (asset_id, type, quantity, price, fee, total_amount, currency, date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
const tencent = db.prepare("SELECT id FROM assets WHERE code = '00700'").get().id;
const ali = db.prepare("SELECT id FROM assets WHERE code = '09988'").get().id;
const aapl = db.prepare("SELECT id FROM assets WHERE code = 'AAPL'").get().id;
insTx.run(tencent, 'buy', 500, 300, 500, 150500, 'HKD', '2026-03-01', '演示买入');
insTx.run(ali, 'buy', 1000, 80, 300, 80300, 'HKD', '2026-03-02', '演示买入');
insTx.run(aapl, 'buy', 100, 180, 50, 18050, 'USD', '2026-03-03', '演示买入');

// ── 券商现金流（余额 = Σ流水）──
const insFlow = db.prepare("INSERT INTO investment_cash_flows (investment_account_id, type, amount, asset_id, transaction_id, currency, date, notes, balance_after) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
const t1 = db.prepare("SELECT id FROM transactions WHERE asset_id = ?").get(tencent).id;
const t2 = db.prepare("SELECT id FROM transactions WHERE asset_id = ?").get(ali).id;
const t3 = db.prepare("SELECT id FROM transactions WHERE asset_id = ?").get(aapl).id;
// 富途：160000 - 150500 - 80300 + 80800 = 10000 ✓
insFlow.run(futu, 'deposit', 160000, null, null, 'HKD', '2026-02-28', '演示存入', 160000);
insFlow.run(futu, 'buy', -150500, tencent, t1, 'HKD', '2026-03-01', '买入 腾讯控股', 9500);
insFlow.run(futu, 'buy', -80300, ali, t2, 'HKD', '2026-03-02', '买入 阿里巴巴', -70800);
insFlow.run(futu, 'sell', 80800, tencent, null, 'HKD', '2026-03-10', '卖出 腾讯控股', 10000);
// 盈透：20000 - 18050 = 1950…调整：存入 20050 - 18050 = 2000 ✓
insFlow.run(ibkr, 'deposit', 20050, null, null, 'USD', '2026-02-28', '演示存入', 20050);
insFlow.run(ibkr, 'buy', -18050, aapl, t3, 'USD', '2026-03-03', '买入 苹果', 2000);

// ── 记账流水（本月收支卡）──
db.prepare("INSERT INTO categories (name, type, sort_order, is_default) VALUES ('工资', 'income', 1, 1), ('餐饮', 'expense', 1, 1)").run();
const catWage = db.prepare("SELECT id FROM categories WHERE name = '工资'").get().id;
const catFood = db.prepare("SELECT id FROM categories WHERE name = '餐饮'").get().id;
const insLed = db.prepare("INSERT INTO ledgers (type, amount, currency, category_id, account_id, date, description) VALUES (?, ?, ?, ?, ?, date('now', 'start of month'), ?)");
insLed.run('income', 30000, 'CNY', catWage, bocCny, '演示工资');
insLed.run('expense', 1200, 'CNY', catFood, icbc, '演示餐饮');
insLed.run('expense', 800, 'CNY', catFood, icbc, '演示购物');

console.log('');
console.log('✓ 演示数据已写入: ' + dbPath);
console.log('');
console.log('===== 预期金额（供总资产口径验证） =====');
console.log('现金及存款（钱包8000 + 现金2000 + 银行余额192000 + 保险83850）: ¥285,850');
console.log('券商流动金（富途 10,000×0.92 + 盈透 2,000×7.25）: ¥23,700');
console.log('投资市值（券商持仓370,400 + 银行理财33,400）: ¥403,800');
console.log('总资产 = 285,850 + 23,700 + 403,800 = ¥713,350');
console.log('========================================');
console.log('');
console.log('启动方式：$env:PF_USER_DATA_DIR = \'<演示目录>\'; npm start');

db.close();
