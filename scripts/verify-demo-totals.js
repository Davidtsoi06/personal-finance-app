/**
 * verify-demo-totals.js — 总资产口径端到端验证脚本（可重复执行）。
 * 用法：node scripts/verify-demo-totals.js <数据库路径>
 * 过程：
 *   1) 用演示数据脚本灌库（建表 + 清空 + 写入多币种演示数据）；
 *   2) stub electron，加载真实编译产物（dist）中的数据库服务；
 *   3) 调用 getAllAssetsSummary() / recordNetWorth() / getNetWorthHistory()，
 *      打印每个顶级分类的 CNY 金额，并与手算预期值逐项对比（PASS/FAIL）。
 * 说明：验证的是编译产物行为，与 GUI 展示同源；不触碰真实用户数据（请指向临时目录）。
 */
const path = require('path');
const fs = require('fs');

const dbPath = process.argv[2];
if (!dbPath) {
  console.error('用法: node scripts/verify-demo-totals.js <数据库路径>');
  process.exit(1);
}
const dbDir = path.dirname(dbPath);

// ── 1. 灌演示数据（该脚本会先建表、再清空业务数据后写入）──
process.argv[2] = dbPath;
require('./seed-demo-data.js');

// ── 2. stub electron，加载真实编译产物 ──
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
const { recordNetWorth, getNetWorthHistory } = require('../dist/main/main/database/services/net-worth-service.js');

const summary = getAllAssetsSummary();

// ── 3. 用真实编译产物中的单一口径函数计算（与 Dashboard 同源） ──
const { computeAssetTotals } = require('../dist/main/shared/utils/asset-totals.js');
const computed = computeAssetTotals(summary);
const totalBank = computed.totalCash;
const totalBrokerCash = computed.totalBrokerCash;
const totalInvestment = computed.totalInvestments;

// 资产管理页口径：所有顶级项 market_value_cny 直接相加
const accountsPageTotal = summary.reduce((s, i) => s + (i.market_value_cny || 0), 0);

console.log('────────────────────────────────────────────────');
console.log('顶级分类明细（getAllAssetsSummary）：');
for (const item of summary) {
  console.log(`  [${item.asset_type}] ${item.name}  is_investment=${item.is_investment ? 1 : 0}  CNY=${(item.market_value_cny || 0).toFixed(2)}`);
  for (const c of item.children || []) {
    console.log(`      └ ${c.name}  is_inv=${c.is_investment ? 1 : 0}  CNY=${(c.market_value_cny || 0).toFixed(2)}`);
  }
}
console.log('────────────────────────────────────────────────');

const totals = {
  totalBank,
  totalBrokerCash,
  totalInvestment,
  totalAssets: computed.totalAssets, // v1.7.3：含债务债权净值
  accountsPageTotal,
};

const expected = {
  totalBank: 285850,
  totalBrokerCash: 23700,
  totalInvestment: 403800,
  totalAssets: 714975,
  accountsPageTotal: 714975,
  creditItem: 3625,
  debtItem: -2000,
  insuranceItem: 83850,
  bankWealthItem: 33400,
  brokerCashItem: 23700,
  bocGroup: 367400,
  bocBankPart: 142000,
  icbcGroup: 50000,
  wallets: 10000,
};

console.log('口径汇总（Dashboard 逻辑）：');
let allPass = true;
for (const [k, v] of Object.entries(totals)) {
  const exp = expected[k];
  const ok = exp === undefined || Math.abs(v - exp) < 0.005;
  if (!ok) allPass = false;
  console.log(`  ${ok ? '✅' : '❌'} ${k} = ${v.toFixed(2)}${exp !== undefined ? `（预期 ${exp.toFixed(2)}）` : ''}`);
}

// 逐项分类核对
const byName = new Map();
for (const item of summary) {
  byName.set(`${item.asset_type}|${item.name}`, item.market_value_cny || 0);
  for (const c of item.children || []) {
    byName.set(`child|${c.name}`, c.market_value_cny || 0);
  }
}
const itemChecks = [
  ['insurance|保险', expected.insuranceItem],
  ['bank_wealth|银行理财', expected.bankWealthItem],
  ['broker_cash|券商流动金', expected.brokerCashItem],
  ['bank|中国银行', expected.bocGroup],
  ['bank|工商银行', expected.icbcGroup],
  ['credit|债权（别人欠我）', expected.creditItem],
  ['debt|债务（我欠别人）', expected.debtItem],
];
for (const [key, exp] of itemChecks) {
  const v = byName.get(key);
  const ok = v !== undefined && Math.abs(v - exp) < 0.005;
  if (!ok) allPass = false;
  console.log(`  ${ok ? '✅' : '❌'} ${key} = ${v === undefined ? '未找到' : v.toFixed(2)}（预期 ${exp.toFixed(2)}）`);
}
// 中国银行的银行部分（扣内嵌券商后）
const sumInv = (item) =>
  (item.is_investment ? item.market_value_cny || 0 : 0) +
  (item.children || []).reduce((s, c) => s + sumInv(c), 0);
const boc = summary.find((i) => i.name === '中国银行');
if (boc) {
  const bankPart = (boc.market_value_cny || 0) - (boc.children || []).reduce((s, c) => s + sumInv(c), 0);
  const ok = Math.abs(bankPart - expected.bocBankPart) < 0.005;
  if (!ok) allPass = false;
  console.log(`  ${ok ? '✅' : '❌'} 中国银行(银行部分) = ${bankPart.toFixed(2)}（预期 ${expected.bocBankPart.toFixed(2)}）`);
}

// ── 4. 净资产快照与历史 ──
// 预插 40 天旧历史，验证「最近 N 天」窗口（v1.6.1 修复：旧代码升序取最早 N 天）
const insHist = db.prepare('INSERT OR REPLACE INTO net_worth_history (date, total_cash, total_investments, net_worth) VALUES (?, 100000, 200000, 300000)');
for (let i = 40; i >= 1; i--) {
  insHist.run(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
}
recordNetWorth();
const latest = db.prepare('SELECT * FROM net_worth_history ORDER BY date DESC LIMIT 1').get();
const latestOk = latest && Math.abs(latest.net_worth - expected.totalAssets) < 0.005;
if (!latestOk) allPass = false;
console.log(`\n${latestOk ? '✅' : '❌'} 净资产最新快照 net_worth = ${latest ? latest.net_worth.toFixed(2) : '无记录'}（预期 ${expected.totalAssets.toFixed(2)}）`);

const hist = getNetWorthHistory(30);
const histFirst = hist[0];
const histTail = hist[hist.length - 1];
const histWinOk = hist.length === 30 && histTail && Math.abs(histTail.net_worth - expected.totalAssets) < 0.005
  && histFirst && histFirst.date === new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
if (!histWinOk) allPass = false;
console.log(`${histWinOk ? '✅' : '❌'} 净值历史(30天)窗口 = 共 ${hist.length} 条，首条 ${histFirst ? histFirst.date : '无'}（预期 29 天前），末条 net_worth ${histTail ? histTail.net_worth.toFixed(2) : '无'}（预期 ${expected.totalAssets.toFixed(2)}）`);

console.log('\n════════════════════════════════════════');
console.log(allPass ? '全部通过 ✅' : '存在失败项 ❌（见上方标注）');
process.exit(allPass ? 0 : 1);