/**
 * wallet-bill-parser — 微信/支付宝账单解析（v1.10.6）。
 * 微信 Excel/CSV：跳过前 17 行无效数据（容错：扫描 10~20 行内表头），
 *   第 18 行表头、第 19 行起数据，尾部统计行自动截断；金额支持 ¥ 符号/千分位/正负号。
 * 支付宝 CSV：完整字段映射，容错尾部逗号/空值/引号包裹；方向取「收/支」列。
 */
import { normalizeDate } from './data-normalizer';
import { parseAmount } from '../../shared/utils/amount-parse';

export interface ParsedWalletBill {
  date: string;
  type: 'income' | 'expense';
  amount: number;
  currency: string;
  description: string;
  category?: string;
}

export interface WalletParseResult {
  format: 'wechat' | 'alipay' | 'unknown';
  records: ParsedWalletBill[];
  errors: string[];
}

/** 引号感知分隔（容错：空值/尾部逗号/引号包裹），返回前自动修剪尾部空元素 */
function splitCsv(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === sep && !inQ) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out;
}

function cell(row: unknown[], i: number): string {
  return i >= 0 && i < row.length ? String(row[i] ?? '').trim() : '';
}

/** 扫描前 20 行找表头（含全部关键列名） */
function findHeaderIndex(rows: (unknown[] | string[])[], keys: string[]): number {
  const maxScan = Math.min(rows.length, 20);
  for (let i = 10; i < maxScan; i++) {
    const row = rows[i] || [];
    const joined = row.map((c) => String(c ?? '')).join('\t');
    if (keys.every((k) => joined.includes(k))) return i;
  }
  return -1;
}

/** 微信账单数据行（二维数组：Excel sheet 行 或 CSV 行）→ 记录。headIdx=表头行号，数据从 headIdx+1 开始。 */
function parseWechatRows(rows: unknown[][], currency: string): WalletParseResult {
  const errors: string[] = [];
  const records: ParsedWalletBill[] = [];
  const headIdx = findHeaderIndex(rows, ['交易时间', '收/支']);
  if (headIdx < 0) return { format: 'wechat', records, errors: ['未找到微信账单表头（需含 交易时间 与 收/支 列）'] };

  const raw = rows.slice(headIdx + 1);
  for (const row of raw) {
    const c0 = cell(row, 0);
    // 尾部统计区：总笔数/收入(元)/支出(元)/零钱明细/微信支付账单明细 等
    if (!c0 || /^(总|收入|支出|零钱|微信支付|已|本月|生成时间|微信昵称)/.test(c0)) break;
    const date = normalizeDate(c0);
    const direction = cell(row, 4);
    const amount = parseAmount(cell(row, 5));
    if (!date || amount === null || amount <= 0) continue;
    if (direction !== '收入' && direction !== '支出') continue;
    const tradeType = cell(row, 1);
    const counterparty = cell(row, 2);
    const product = cell(row, 3);
    records.push({
      date,
      type: direction === '收入' ? 'income' : 'expense',
      amount,
      currency,
      description: [tradeType, counterparty, product].filter(Boolean).join(' '),
      category: tradeType || undefined,
    });
  }
  return { format: 'wechat', records, errors };
}

/** 微信 Excel（sheet 行） */
export function parseWechatExcel(rows: unknown[][], currency = 'CNY'): WalletParseResult {
  return parseWechatRows(rows, currency);
}

/** 微信 CSV 文本（行结构与 Excel 一致） */
export function parseWechatCsv(text: string, currency = 'CNY'): WalletParseResult {
  const rows: unknown[][] = text.split(/\r?\n/).map((l) => splitCsv(l, ','));
  return parseWechatRows(rows, currency);
}

/** 支付宝 CSV 文本 */
export function parseAlipayCsv(text: string, currency = 'CNY'): WalletParseResult {
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // 表头行：含 交易时间 与 收/支 与 金额
  let headIdx = -1;
  let sep = ',';
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const joined = lines[i];
    if (joined.includes('交易时间') && joined.includes('收/支') && joined.includes('金额')) {
      headIdx = i;
      sep = joined.includes(';') ? ';' : ',';
      break;
    }
  }
  if (headIdx < 0) return { format: 'alipay', records: [], errors: ['未找到支付宝表头（需含 交易时间 / 收/支 / 金额 列）'] };

  const header = splitCsv(lines[headIdx], sep);
  const col = (name: string) => header.findIndex((h) => h.includes(name));
  const iDate = col('交易时间');
  const iType = col('交易分类');
  const iCounterparty = col('交易对方');
  const iAccount = col('对方账号');
  const iProduct = col('商品说明');
  const iDirection = col('收/支');
  const iAmount = col('金额');
  if (iDate < 0 || iDirection < 0 || iAmount < 0) {
    return { format: 'alipay', records: [], errors: ['缺少 交易时间 / 收/支 / 金额 列'] };
  }

  const records: ParsedWalletBill[] = [];
  for (let i = headIdx + 1; i < lines.length; i++) {
    const c = splitCsv(lines[i], sep);
    const date = normalizeDate(cell(c, iDate));
    const direction = cell(c, iDirection);
    const amount = parseAmount(cell(c, iAmount));
    if (!date || amount === null || amount <= 0) continue;
    if (direction !== '收入' && direction !== '支出') continue;
    const type = cell(c, iType);
    const counterparty = cell(c, iCounterparty);
    const account = cell(c, iAccount);
    const product = cell(c, iProduct);
    records.push({
      date,
      type: direction === '收入' ? 'income' : 'expense',
      amount,
      currency,
      description: [type, counterparty, account, product].filter(Boolean).join(' '),
      category: type || undefined,
    });
  }
  return { format: 'alipay', records, errors };
}

/** 文本自动识别：微信 CSV / 支付宝 CSV */
export function parseCsvAuto(text: string, currency = 'CNY'): WalletParseResult {
  const first = text.slice(0, 3000);
  if (first.includes('微信支付账单明细') || first.includes('微信昵称')) {
    return parseWechatCsv(text, currency);
  }
  return parseAlipayCsv(text, currency);
}
