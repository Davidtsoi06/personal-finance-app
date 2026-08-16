/**
 * inspect-summary.js — 只读诊断：对指定数据库直接调用真实 dist 服务，
 * 打印 getAllAssetsSummary 的每个顶级项/子项 CNY 金额与各口径合计。
 * 用法：node scripts/inspect-summary.js <数据库路径>
 * 注意：只读展示，不做任何写入（不灌数据、不记快照）。
 */
const path = require('path');
const dbPath = process.argv[2];
if (!dbPath) {
  console.error('用法: node scripts/inspect-summary.js <数据库路径>');
  process.exit(1);
}
const dbDir = path.dirname(dbPath);

// stub electron，加载真实编译产物
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') {
    return { app: { getPath: (name) => (name === 'userData' ? dbDir : '') } };
  }
  return origLoad.apply(this, arguments);
};

const { initDatabase, getDatabase } = require('../dist/main/main/database/index.js');
initDatabase();
const db = getDatabase();
const { getAllAssetsSummary } = require('../dist/main/main/database/services/account-service.js');
const { computeAssetTotals } = require('../dist/main/shared/utils/asset-totals.js');

const summary = getAllAssetsSummary();
const totals = computeAssetTotals(summary);
const topSum = summary.reduce((s, i) => s + (i.market_value_cny || 0), 0);

console.log('────────────────────────────────────────────────');
console.log('顶级分类明细：');
for (const item of summary) {
  console.log(`  [${item.asset_type}] ${item.name}  is_inv=${item.is_investment ? 1 : 0}  CNY=${(item.market_value_cny || 0).toFixed(2)}`);
  for (const c of item.children || []) {
    console.log(`      └ ${c.name}  is_inv=${c.is_investment ? 1 : 0}  CNY=${(c.market_value_cny || 0).toFixed(2)}`);
  }
}
console.log('────────────────────────────────────────────────');
console.log('口径汇总：');
console.log(`  现金及存款（totalCash）= ${totals.totalCash.toFixed(2)}`);
console.log(`  券商流动金 = ${totals.totalBrokerCash.toFixed(2)}`);
console.log(`  投资市值 = ${totals.totalInvestments.toFixed(2)}`);
console.log(`  总资产（computeAssetTotals）= ${totals.totalAssets.toFixed(2)}`);
console.log(`  顶级项直接相加（资产管理页统计卡口径）= ${topSum.toFixed(2)}`);

// 各账户余额快照（辅助定位差异来源）
const balances = db.prepare('SELECT a.id, a.name, a.currency, a.balance, ab.currency as bcur, ab.balance as bbal FROM accounts a LEFT JOIN account_balances ab ON ab.account_id = a.id WHERE a.is_active = 1 ORDER BY a.id, ab.currency').all();
console.log('\n账户余额（accounts.balance vs account_balances）：');
for (const b of balances) {
  console.log(`  #${b.id} ${b.name} ${b.currency} accounts.balance=${b.balance}${b.bcur ? ` | balances[${b.bcur}]=${b.bbal}` : ' | 无 balances 行'}`);
}

// 定期存款
const fds = db.prepare("SELECT f.id, f.name, f.currency, f.amount, f.deduct_mode, f.deduct_account_id, a.name as acc_name FROM fixed_deposits f LEFT JOIN accounts a ON a.id = f.account_id").all();
console.log('\n定期存款：');
for (const f of fds) {
  console.log(`  #${f.id} ${f.name} ${f.currency} ${f.amount} deduct_mode=${f.deduct_mode} account=${f.acc_name}`);
}