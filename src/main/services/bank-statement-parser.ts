/**
 * Bank statement parser — smart format matching for bank daily statements.
 * Auto-detects bank format and normalizes to standard deposit/withdraw records.
 * Supports built-in auto-detection and custom user-defined formats.
 */
import { getDatabase } from '../database';
import { normalizeDate, normalizeCurrency } from './data-normalizer';
import { parseAmount } from '../../shared/utils/amount-parse';

/** Safely convert a cell value (string/number from xlsx or CSV) to a trimmed string. */
function safeTrim(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/** Parsed bank record from a statement */
export interface ParsedBankRecord {
  date: string;
  amount: number;
  type: 'deposit' | 'withdraw';
  description: string;
  currency: string;
  balance?: number;
}

/** Parse result */
export interface BankParseResult {
  success: boolean;
  format: string;
  records: ParsedBankRecord[];
  errors: string[];
}

// ── Custom format definition (loaded from DB) ──

interface CustomBankFormat {
  name: string;
  keywords: string[];
  columnMap: Record<string, number>; // field -> column index
  hasHeader: boolean;
}

// ── Standard format columns ──
const STANDARD_COLUMNS = ['date', 'amount', 'type', 'description', 'currency'];

/**
 * Parse a bank statement text and return normalized records.
 */
export function parseBankStatement(csvText: string, forceFormat?: string): BankParseResult {
  const lines = csvText.split('\n').filter((l) => l.trim());
  if (lines.length < 2) {
    return { success: false, format: '未知', records: [], errors: ['内容为空或行数不足'] };
  }

  // Step 0: forced format
  if (forceFormat) {
    const customFormats = loadCustomBankFormats();
    const custom = customFormats.find((c) => c.name === forceFormat);
    if (custom) {
      const result = tryCustomFormat(lines, custom, true);
      if (result && result.length > 0) {
        return { success: true, format: custom.name, records: result, errors: [] };
      }
      return { success: false, format: forceFormat, records: [], errors: ['该格式未能解析出有效记录'] };
    }
    return { success: false, format: forceFormat, records: [], errors: [`未找到名为 "${forceFormat}" 的格式`] };
  }

  // Step 1: Try standard CSV format
  const standardResult = tryStandardFormat(lines);
  if (standardResult && standardResult.length > 0) {
    return { success: true, format: '标准 CSV 格式', records: standardResult, errors: [] };
  }

  // Step 2: Try each custom user-defined format
  const customFormats = loadCustomBankFormats();
  for (const fmt of customFormats) {
    const result = tryCustomFormat(lines, fmt);
    if (result && result.length > 0) {
      return { success: true, format: fmt.name, records: result, errors: [] };
    }
  }

  // Step 3: Generic auto-detect
  const genericResult = tryGenericDetection(lines);
  if (genericResult.records.length > 0) {
    return { ...genericResult, success: true };
  }

  return {
    success: false, format: '未知', records: [],
    errors: ['无法识别银行日结单格式，请检查格式后重试'],
  };
}

/**
 * Parse pre-parsed rows (2D string array from Excel).
 */
export function parseBankRows(rows: string[][], forceFormat?: string): BankParseResult {
  if (rows.length < 2) {
    return { success: false, format: '未知', records: [], errors: ['内容为空或行数不足'] };
  }

  if (forceFormat) {
    const customFormats = loadCustomBankFormats();
    const custom = customFormats.find((c) => c.name === forceFormat);
    if (custom) {
      const result = tryCustomFormatOnRows(rows, custom, true);
      if (result && result.length > 0) {
        return { success: true, format: custom.name, records: result, errors: [] };
      }
      return { success: false, format: forceFormat, records: [], errors: ['该格式未能解析出有效记录'] };
    }
    return { success: false, format: forceFormat, records: [], errors: [`未找到名为 "${forceFormat}" 的格式`] };
  }

  const standardResult = tryStandardFormatOnRows(rows);
  if (standardResult && standardResult.length > 0) {
    return { success: true, format: '标准 CSV 格式', records: standardResult, errors: [] };
  }

  const customFormats = loadCustomBankFormats();
  for (const fmt of customFormats) {
    const result = tryCustomFormatOnRows(rows, fmt);
    if (result && result.length > 0) {
      return { success: true, format: fmt.name, records: result, errors: [] };
    }
  }

  const genericResult = tryGenericDetectionOnRows(rows);
  if (genericResult.records.length > 0) {
    return { ...genericResult, success: true };
  }

  return {
    success: false, format: '未知', records: [],
    errors: ['无法识别银行日结单格式，请检查格式后重试'],
  };
}

/** Return all available custom bank format names. */
export function getBankFormats(): string[] {
  return loadCustomBankFormats().map((c) => c.name);
}

// ── Format detection helpers ──

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if ((ch === ',' || ch === '\t') && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

/** Determine deposit/withdraw from a type string */
function detectType(raw: string, amount: number): 'deposit' | 'withdraw' {
  const t = raw.trim().toLowerCase();
  // Chinese keywords
  if (t.includes('存') || t.includes('入') || t.includes('收') || t.includes('转入') || t.includes('汇入')) return 'deposit';
  if (t.includes('取') || t.includes('出') || t.includes('支') || t.includes('转出') || t.includes('汇出')) return 'withdraw';
  // English keywords
  if (t.includes('deposit') || t.includes('credit') || t === 'cr') return 'deposit';
  if (t.includes('withdraw') || t.includes('debit') || t === 'dr' || t.includes('payment')) return 'withdraw';
  // Fallback: use amount sign
  if (amount > 0) return 'deposit';
  if (amount < 0) return 'withdraw';
  return 'deposit';
}

function parseStandardLine(cols: string[]): ParsedBankRecord | null {
  const [date, amountStr, typeStr, description, currency] = cols;
  let amount = parseAmount(amountStr);
  if (amount === null) return null;
  // Amount may be absolute — direction comes from type field
  const absAmount = Math.abs(amount);
  const type = detectType(safeTrim(typeStr), amount);

  return {
    date: normalizeDate(safeTrim(date)) || new Date().toISOString().slice(0, 10),
    amount: absAmount,
    type,
    description: safeTrim(description),
    currency: normalizeCurrency(safeTrim(currency), 'CNY'),
  };
}

function tryStandardFormat(lines: string[]): ParsedBankRecord[] | null {
  const trades: ParsedBankRecord[] = [];
  const firstCols = parseCSVLine(lines[0]);
  const isHeader = STANDARD_COLUMNS.some((col) =>
    firstCols.some((c) => c.trim().toLowerCase() === col.toLowerCase())
  );
  const startIdx = isHeader ? 1 : 0;

  for (let i = startIdx; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 4) continue;
    const record = parseStandardLine(cols);
    if (record) trades.push(record);
  }
  return trades.length > 0 ? trades : null;
}

function tryStandardFormatOnRows(rows: string[][]): ParsedBankRecord[] | null {
  const trades: ParsedBankRecord[] = [];
  const firstRow = rows[0];
  const isHeader = firstRow && STANDARD_COLUMNS.some((col) =>
    firstRow.some((c) => c.trim().toLowerCase() === col.toLowerCase())
  );
  const startIdx = isHeader ? 1 : 0;

  for (let i = startIdx; i < rows.length; i++) {
    if (rows[i].length < 4) continue;
    const record = parseStandardLine(rows[i]);
    if (record) trades.push(record);
  }
  return trades.length > 0 ? trades : null;
}

// ── Custom format matching ──

function buildColMap(fmt: CustomBankFormat): Record<string, number> {
  // The columnMap is already {field -> index} — just filter out 'ignore'
  const map: Record<string, number> = {};
  for (const [field, idx] of Object.entries(fmt.columnMap)) {
    if (field !== 'ignore') map[field] = idx;
  }
  return map;
}

function mapRowToBankRecord(cols: string[], colMap: Record<string, number>): ParsedBankRecord | null {
  if (cols.length < 3) return null;

  const date = normalizeDate(colMap['date'] !== undefined ? safeTrim(cols[colMap['date']]) : '');
  const rawAmount = colMap['amount'] !== undefined ? parseAmount(cols[colMap['amount']]) : null;
  if (rawAmount === null || !date) return null;

  const absAmount = Math.abs(rawAmount);
  const typeRaw = colMap['type'] !== undefined ? safeTrim(cols[colMap['type']]) : '';
  const type = detectType(typeRaw, rawAmount);

  const description = colMap['description'] !== undefined ? safeTrim(cols[colMap['description']]) : '';
  const currency = normalizeCurrency(
    colMap['currency'] !== undefined ? safeTrim(cols[colMap['currency']]) : '',
    'CNY'
  );
  const balance = colMap['balance'] !== undefined ? parseAmount(cols[colMap['balance']]) : undefined;
  const validBalance = balance !== undefined && balance !== null ? balance : undefined;

  return { date, amount: absAmount, type, description, currency, balance: validBalance };
}

function keywordMatch(text: string, fmt: CustomBankFormat): boolean {
  if (!fmt.hasHeader) return true;
  const lower = text.toLowerCase();
  return fmt.keywords.filter((kw) => lower.includes(kw.toLowerCase())).length >= 1;
}

function tryCustomFormat(lines: string[], fmt: CustomBankFormat, skipKeywordCheck = false): ParsedBankRecord[] | null {
  if (!skipKeywordCheck && !keywordMatch(lines.join('\n'), fmt)) return null;

  const colMap = buildColMap(fmt);
  if (colMap['date'] === undefined || colMap['amount'] === undefined) return null;

  const dataStartIdx = fmt.hasHeader ? 1 : 0;
  const records: ParsedBankRecord[] = [];
  for (let i = dataStartIdx; i < lines.length; i++) {
    const record = mapRowToBankRecord(parseCSVLine(lines[i]), colMap);
    if (record) records.push(record);
  }
  return records.length > 0 ? records : null;
}

function tryCustomFormatOnRows(rows: string[][], fmt: CustomBankFormat, skipKeywordCheck = false): ParsedBankRecord[] | null {
  if (!skipKeywordCheck && !keywordMatch(rows.map((r) => r.join(',')).join('\n'), fmt)) return null;

  const colMap = buildColMap(fmt);
  if (colMap['date'] === undefined || colMap['amount'] === undefined) return null;

  const dataStartIdx = fmt.hasHeader ? 1 : 0;
  const records: ParsedBankRecord[] = [];
  for (let i = dataStartIdx; i < rows.length; i++) {
    const record = mapRowToBankRecord(rows[i], colMap);
    if (record) records.push(record);
  }
  return records.length > 0 ? records : null;
}

// ── Generic auto-detection ──

function findColumn(headers: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const idx = headers.findIndex((h) => h === alias.toLowerCase());
    if (idx !== -1) return idx;
  }
  for (const alias of aliases) {
    const idx = headers.findIndex((h) => h.includes(alias.toLowerCase()));
    if (idx !== -1) return idx;
  }
  return -1;
}

function tryGenericDetection(lines: string[]): BankParseResult {
  const headerCols = parseCSVLine(lines[0]).map((c) => c.trim().toLowerCase());

  const dateIdx = findColumn(headerCols, ['date', '日期', '交易日期', '记账日期', 'trade date', '交易时间']);
  const amountIdx = findColumn(headerCols, ['amount', '金额', '交易金额', '发生额', '发生金额', '收入金额', '支出金额']);
  const typeIdx = findColumn(headerCols, ['type', '收支', '方向', '收支方向', '借贷', '交易类型', '业务类型', '摘要类别']);
  const descIdx = findColumn(headerCols, ['description', '摘要', '备注', '交易说明', '对方户名', '用途', '交易摘要', '说明']);
  const currIdx = findColumn(headerCols, ['currency', '币种', '货币', 'ccy']);
  const balIdx = findColumn(headerCols, ['balance', '余额', '账户余额']);

  // Also try to find amount as income/expense split columns
  const incomeIdx = findColumn(headerCols, ['收入', '贷方金额', 'credit', '存入']);
  const expenseIdx = findColumn(headerCols, ['支出', '借方金额', 'debit', '取出']);
  const combinedAmountIdx = incomeIdx !== -1 || expenseIdx !== -1 ? Math.max(incomeIdx, expenseIdx) : amountIdx;

  if (dateIdx === -1 || (amountIdx === -1 && incomeIdx === -1 && expenseIdx === -1)) {
    return { success: false, format: '未知', records: [], errors: ['无法自动检测日期/金额列'] };
  }

  const colMap: Record<string, number> = {};
  if (dateIdx !== -1) colMap['date'] = dateIdx;
  colMap['amount'] = combinedAmountIdx;
  if (typeIdx !== -1) colMap['type'] = typeIdx;
  if (descIdx !== -1) colMap['description'] = descIdx;
  if (currIdx !== -1) colMap['currency'] = currIdx;
  if (balIdx !== -1) colMap['balance'] = balIdx;
  // For split income/expense columns, store both for later use
  if (incomeIdx !== -1) (colMap as any)['incomeIdx'] = incomeIdx;
  if (expenseIdx !== -1) (colMap as any)['expenseIdx'] = expenseIdx;

  const records: ParsedBankRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < Math.max(dateIdx, combinedAmountIdx) + 1) continue;

    // Handle split income/expense columns
    let amount: number;
    let type: 'deposit' | 'withdraw';
    if (incomeIdx !== -1 && expenseIdx !== -1) {
      const inc = parseAmount(cols[incomeIdx]) || 0;
      const exp = parseAmount(cols[expenseIdx]) || 0;
      if (inc > 0) { amount = inc; type = 'deposit'; }
      else if (exp > 0) { amount = exp; type = 'withdraw'; }
      else continue;
    } else if (incomeIdx !== -1) {
      amount = parseAmount(cols[incomeIdx]) || 0;
      type = 'deposit';
      if (amount === 0) continue;
    } else if (expenseIdx !== -1) {
      amount = parseAmount(cols[expenseIdx]) || 0;
      type = 'withdraw';
      if (amount === 0) continue;
    } else {
      amount = parseAmount(cols[combinedAmountIdx]) ?? NaN;
      if (isNaN(amount) || amount === 0) continue;
      const typeRaw = typeIdx !== -1 ? cols[typeIdx]?.trim() : '';
      type = detectType(typeRaw, amount);
    }

    const date = normalizeDate(cols[dateIdx]?.trim());
    if (!date) continue;

    const description = descIdx !== -1 ? cols[descIdx]?.trim() : '';
    const currency = normalizeCurrency(currIdx !== -1 ? cols[currIdx]?.trim() : '', 'CNY');
    const balance = balIdx !== -1 ? parseFloat(cols[balIdx]) : undefined;

    records.push({
      date,
      amount: Math.abs(amount),
      type,
      description,
      currency,
      balance: balance !== undefined && !isNaN(balance) ? balance : undefined,
    });
  }

  return {
    success: records.length > 0,
    format: records.length > 0 ? '自动检测格式' : '未知',
    records,
    errors: records.length === 0 ? ['未能从数据行中解析出有效记录'] : [],
  };
}

function tryGenericDetectionOnRows(rows: string[][]): BankParseResult {
  const errors: string[] = [];
  const headerCols = rows[0].map((c) => c.trim().toLowerCase());

  const dateIdx = findColumn(headerCols, ['date', '日期', '交易日期', '记账日期', 'trade date', '交易时间']);
  const amountIdx = findColumn(headerCols, ['amount', '金额', '交易金额', '发生额', '发生金额', '收入金额', '支出金额']);
  const typeIdx = findColumn(headerCols, ['type', '收支', '方向', '收支方向', '借贷', '交易类型', '业务类型', '摘要类别']);
  const descIdx = findColumn(headerCols, ['description', '摘要', '备注', '交易说明', '对方户名', '用途', '交易摘要', '说明']);
  const currIdx = findColumn(headerCols, ['currency', '币种', '货币', 'ccy']);
  const balIdx = findColumn(headerCols, ['balance', '余额', '账户余额']);
  const incomeIdx = findColumn(headerCols, ['收入', '贷方金额', 'credit', '存入']);
  const expenseIdx = findColumn(headerCols, ['支出', '借方金额', 'debit', '取出']);
  const combinedAmountIdx = incomeIdx !== -1 || expenseIdx !== -1 ? Math.max(incomeIdx, expenseIdx) : amountIdx;

  if (dateIdx === -1 || (amountIdx === -1 && incomeIdx === -1 && expenseIdx === -1)) {
    return { success: false, format: '未知', records: [], errors: ['无法自动检测日期/金额列'] };
  }

  const records: ParsedBankRecord[] = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].length < Math.max(dateIdx, combinedAmountIdx) + 1) continue;

    let amount: number;
    let type: 'deposit' | 'withdraw';
    if (incomeIdx !== -1 && expenseIdx !== -1) {
      const inc = parseFloat(rows[i][incomeIdx]) || 0;
      const exp = parseFloat(rows[i][expenseIdx]) || 0;
      if (inc > 0) { amount = inc; type = 'deposit'; }
      else if (exp > 0) { amount = exp; type = 'withdraw'; }
      else continue;
    } else if (incomeIdx !== -1) {
      amount = parseFloat(rows[i][incomeIdx]) || 0;
      type = 'deposit';
      if (amount === 0) continue;
    } else if (expenseIdx !== -1) {
      amount = parseFloat(rows[i][expenseIdx]) || 0;
      type = 'withdraw';
      if (amount === 0) continue;
    } else {
      amount = parseFloat(rows[i][combinedAmountIdx]);
      if (isNaN(amount) || amount === 0) continue;
      const typeRaw = typeIdx !== -1 ? safeTrim(rows[i][typeIdx]) : '';
      type = detectType(typeRaw, amount);
    }

    const date = normalizeDate(safeTrim(rows[i][dateIdx]));
    if (!date) continue;

    const description = descIdx !== -1 ? safeTrim(rows[i][descIdx]) : '';
    const currency = normalizeCurrency(currIdx !== -1 ? safeTrim(rows[i][currIdx]) : '', 'CNY');
    const balance = balIdx !== -1 ? parseFloat(rows[i][balIdx]) : undefined;

    records.push({
      date,
      amount: Math.abs(amount),
      type,
      description,
      currency,
      balance: balance !== undefined && !isNaN(balance) ? balance : undefined,
    });
  }

  return {
    success: records.length > 0,
    format: records.length > 0 ? '自动检测格式' : '未知',
    records,
    errors: records.length === 0 ? ['未能从数据行中解析出有效记录'] : errors,
  };
}

// ── Database loading ──

function loadCustomBankFormats(): CustomBankFormat[] {
  try {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM custom_bank_formats').all() as any[];
    return rows.map((row: any) => {
      const mapping: Record<string, string> = {};
      const columns: { position: number; field: string }[] = JSON.parse(row.column_mapping);
      for (const col of columns) {
        if (col.field !== 'ignore') {
          mapping[col.field] = String(col.position);
        }
      }
      // Convert to columnMap: {field -> index}
      const columnMap: Record<string, number> = {};
      for (const [pos, field] of Object.entries(mapping)) {
        const idx = parseInt(pos);
        if (!isNaN(idx)) columnMap[field] = idx;
      }
      return {
        name: row.name,
        keywords: row.keywords.split(',').map((k: string) => k.trim()),
        columnMap,
        hasHeader: row.has_header === 1,
      };
    });
  } catch {
    return [];
  }
}
