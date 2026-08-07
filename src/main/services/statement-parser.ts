/**
 * Statement parser — smart format matching for brokerage day statements.
 * Auto-detects broker format and normalizes to standard CSV.
 * Supports built-in formats, custom user-defined formats, and generic auto-detection.
 */
import { getDatabase } from '../database';
import { normalizeDate, normalizeCurrency, normalizeCode, normalizeTradeType } from './data-normalizer';

/** Parsed trade record from a statement */
export interface ParsedTrade {
  date: string;
  code: string;
  name: string;
  type: 'buy' | 'sell' | 'split' | 'other';
  quantity: number;
  price: number;
  fee: number;
  currency: string;
  /** Net amount (发生金额) = trade amount (成交金额) - fee (手续费) */
  net_amount?: number;
}

/** Parse result */
export interface ParseResult {
  success: boolean;
  format: string;
  trades: ParsedTrade[];
  errors: string[];
}

// ── Custom format definition (loaded from DB) ──

interface CustomBrokerFormat {
  name: string;
  keywords: string[];
  /** Positional column mapping: key = column index (0,1,2...), value = field name */
  columnMap: Record<string, string>;
  hasHeader: boolean;
}

// ── Standard format (our own CSV) ──
const STANDARD_COLUMNS = ['date', 'code', 'name', 'type', 'quantity', 'price', 'fee', 'currency'];

/**
 * Parse a statement text and return normalized trades.
 * @param csvText Raw CSV/Excel content
 * @param forceFormat If specified, skip auto-detection and use this exact format name
 */
export function parseStatement(csvText: string, forceFormat?: string): ParseResult {
  const lines = csvText.split('\n').filter((l) => l.trim());
  if (lines.length < 2) {
    return { success: false, format: '未知', trades: [], errors: ['内容为空或行数不足'] };
  }

  // Step 0: If a specific format is forced, try it first
  if (forceFormat) {
    const customFormats = loadCustomFormats();
    const custom = customFormats.find((c) => c.name === forceFormat);
    if (custom) {
      // skipKeywordCheck=true: user manually selected this format, trust it
      const result = tryCustomFormat(lines, custom, true);
      if (result && result.length > 0) {
        return { success: true, format: custom.name, trades: result, errors: [] };
      }
      return { success: false, format: forceFormat, trades: [], errors: ['该格式未能解析出有效交易记录'] };
    }
    return { success: false, format: forceFormat, trades: [], errors: [`未找到名为 "${forceFormat}" 的格式`] };
  }

  // Step 1: Try standard CSV format first
  const standardResult = tryStandardFormat(lines);
  if (standardResult && standardResult.length > 0) {
    return {
      success: true,
      format: '标准 CSV 格式',
      trades: standardResult,
      errors: [],
    };
  }

  // Step 2: Try each custom user-defined format
  const customFormats = loadCustomFormats();
  for (const broker of customFormats) {
    const result = tryCustomFormat(lines, broker);
    if (result && result.length > 0) {
      return {
        success: true,
        format: broker.name,
        trades: result,
        errors: [],
      };
    }
  }

  // Step 3: Generic auto-detect — try to identify columns by position and keywords
  const genericResult = tryGenericDetection(lines);
  if (genericResult.trades.length > 0) {
    return { ...genericResult, success: true };
  }

  return {
    success: false,
    format: '未知',
    trades: [],
    errors: ['无法识别日结单格式，请检查格式后重试'],
  };
}

/**
 * Parse pre-parsed rows (2D string array from Excel) directly — no CSV text conversion.
 * Avoids encoding issues that occur in the text round-trip.
 * @param rows 2D string array from xlsx sheet_to_json({ header: 1 })
 * @param forceFormat If specified, skip auto-detection and use this exact format name
 */
export function parseRows(rows: string[][], forceFormat?: string): ParseResult {
  if (rows.length < 2) {
    return { success: false, format: '未知', trades: [], errors: ['内容为空或行数不足'] };
  }

  // Step 0: If a specific format is forced, try it first
  if (forceFormat) {
    const customFormats = loadCustomFormats();
    const custom = customFormats.find((c) => c.name === forceFormat);
    if (custom) {
      const result = tryCustomFormatOnRows(rows, custom, true);
      if (result && result.length > 0) {
        return { success: true, format: custom.name, trades: result, errors: [] };
      }
      return { success: false, format: forceFormat, trades: [], errors: ['该格式未能解析出有效交易记录'] };
    }
    return { success: false, format: forceFormat, trades: [], errors: [`未找到名为 "${forceFormat}" 的格式`] };
  }

  // Step 1: Try standard CSV format on rows
  const standardResult = tryStandardFormatOnRows(rows);
  if (standardResult && standardResult.length > 0) {
    return { success: true, format: '标准 CSV 格式', trades: standardResult, errors: [] };
  }

  // Step 2: Try each custom user-defined format
  const customFormats = loadCustomFormats();
  for (const broker of customFormats) {
    const result = tryCustomFormatOnRows(rows, broker);
    if (result && result.length > 0) {
      return { success: true, format: broker.name, trades: result, errors: [] };
    }
  }

  // Step 3: Generic auto-detect on rows
  const genericResult = tryGenericDetectionOnRows(rows);
  if (genericResult.trades.length > 0) {
    return { ...genericResult, success: true };
  }

  return {
    success: false,
    format: '未知',
    trades: [],
    errors: ['无法识别日结单格式，请检查格式后重试'],
  };
}

// ── Format detect helpers ──

function parseCSVLine(line: string): string[] {
  // Handle quoted fields with commas inside
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

/** Try the standard format: date, code, name, type, quantity, price, fee, currency */
function tryStandardFormat(lines: string[]): ParsedTrade[] | null {
  const trades: ParsedTrade[] = [];
  // Skip header if first line looks like a header
  const firstCols = parseCSVLine(lines[0]);
  const isHeader = STANDARD_COLUMNS.some((col) =>
    firstCols.some((c) => c.trim().toLowerCase() === col.toLowerCase())
  );
  const startIdx = isHeader ? 1 : 0;

  for (let i = startIdx; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 6) continue;

    const trade = parseStandardLine(cols);
    if (trade) trades.push(trade);
  }
  return trades.length > 0 ? trades : null;
}

function parseStandardLine(cols: string[]): ParsedTrade | null {
  const [date, code, name, typeStr, qtyStr, priceStr, feeStr, currency] = cols;
  const quantity = parseFloat(qtyStr);
  const price = parseFloat(priceStr);
  const fee = parseFloat(feeStr) || 0;
  if (isNaN(quantity) || isNaN(price)) return null;

  const type = typeStr?.trim().toLowerCase();
  if (type === 'buy' || type?.includes('买')) {
    return {
      date: date?.trim() || new Date().toISOString().slice(0, 10),
      code: code?.trim() || '',
      name: name?.trim() || code?.trim() || '',
      type: 'buy' as const,
      quantity, price, fee,
      currency: (currency?.trim() || 'HKD').toUpperCase(),
    };
  }
  if (type === 'sell' || type?.includes('卖')) {
    return {
      date: date?.trim() || new Date().toISOString().slice(0, 10),
      code: code?.trim() || '',
      name: name?.trim() || code?.trim() || '',
      type: 'sell' as const,
      quantity, price, fee,
      currency: (currency?.trim() || 'HKD').toUpperCase(),
    };
  }
  if (type?.includes('分拆') || type?.includes('拆分') || type === 'split') {
    return {
      date: date?.trim() || new Date().toISOString().slice(0, 10),
      code: code?.trim() || '',
      name: name?.trim() || code?.trim() || '',
      type: 'split' as const,
      quantity, price, fee,
      currency: (currency?.trim() || 'HKD').toUpperCase(),
    };
  }
  // 'other' type
  return {
    date: date?.trim() || new Date().toISOString().slice(0, 10),
    code: code?.trim() || '',
    name: name?.trim() || code?.trim() || '',
    type: 'other' as const,
    quantity, price, fee,
    currency: (currency?.trim() || 'HKD').toUpperCase(),
  };
}

/** Build column position → field mapping from a custom format definition */
function buildColMap(broker: CustomBrokerFormat): Record<string, number> {
  const colMap: Record<string, number> = {};
  for (const [pos, field] of Object.entries(broker.columnMap)) {
    const idx = parseInt(pos);
    if (!isNaN(idx) && field !== 'ignore') {
      colMap[field] = idx;
    }
  }
  return colMap;
}

/** Map a single parsed row (string columns) to a ParsedTrade using positional colMap */
function mapRowToTrade(cols: string[], colMap: Record<string, number>): ParsedTrade | null {
  if (cols.length < 4) return null;

  const date = normalizeDate(colMap['date'] !== undefined ? cols[colMap['date']]?.trim() : '');
  const code = normalizeCode(colMap['code'] !== undefined ? cols[colMap['code']]?.trim() : '');
  const name = colMap['name'] !== undefined ? cols[colMap['name']]?.trim() : code;
  const typeRaw = colMap['type'] !== undefined ? cols[colMap['type']]?.trim() : '';
  const qty = parseFloat(cols[colMap['quantity']]);
  const price = parseFloat(cols[colMap['price']]);
  const rawAmount = colMap['amount'] !== undefined ? parseFloat(cols[colMap['amount']]) : NaN;
  const rawNetAmount = colMap['net_amount'] !== undefined ? parseFloat(cols[colMap['net_amount']]) : NaN;
  let fee = colMap['fee'] !== undefined ? parseFloat(cols[colMap['fee']]) || 0 : 0;
  if (!isNaN(rawAmount) && !isNaN(rawNetAmount)) {
    fee = Math.abs(Math.abs(rawNetAmount) - Math.abs(rawAmount));
  }
  const currency = normalizeCurrency(
    colMap['currency'] !== undefined ? cols[colMap['currency']]?.trim() : '',
    'HKD'
  );

  if (isNaN(qty) || isNaN(price)) return null;
  if (!date) return null;

  let type = normalizeTradeType(typeRaw);
  // Fallback: use net_amount sign when text-based type detection fails
  if (type === 'other' && !isNaN(rawNetAmount)) {
    if (rawNetAmount < 0) type = 'buy';
    else if (rawNetAmount > 0) type = 'sell';
  }

  const trade: ParsedTrade = { date, code, name, type, quantity: qty, price, fee, currency };
  if (!isNaN(rawNetAmount)) trade.net_amount = rawNetAmount;
  return trade;
}

/** Check keyword match for auto-detection (on full text) */
function keywordMatch(text: string, broker: CustomBrokerFormat): boolean {
  if (!broker.hasHeader) return true;
  const lower = text.toLowerCase();
  const matches = broker.keywords.filter((kw) => lower.includes(kw.toLowerCase())).length;
  return matches >= 1;
}

/** Try matching against a custom user-defined broker format (CSV text input) */
function tryCustomFormat(lines: string[], broker: CustomBrokerFormat, skipKeywordCheck = false): ParsedTrade[] | null {
  if (!skipKeywordCheck && !keywordMatch(lines.join('\n'), broker)) return null;

  const colMap = buildColMap(broker);
  if (colMap['date'] === undefined || colMap['quantity'] === undefined || colMap['price'] === undefined) {
    return null;
  }

  const dataStartIdx = broker.hasHeader ? 1 : 0;
  const trades: ParsedTrade[] = [];
  for (let i = dataStartIdx; i < lines.length; i++) {
    const trade = mapRowToTrade(parseCSVLine(lines[i]), colMap);
    if (trade) trades.push(trade);
  }
  return trades.length > 0 ? trades : null;
}

/** Try matching against a custom format (pre-parsed 2D rows from Excel) */
function tryCustomFormatOnRows(rows: string[][], broker: CustomBrokerFormat, skipKeywordCheck = false): ParsedTrade[] | null {
  if (!skipKeywordCheck && !keywordMatch(rows.map((r) => r.join(',')).join('\n'), broker)) return null;

  const colMap = buildColMap(broker);
  if (colMap['date'] === undefined || colMap['quantity'] === undefined || colMap['price'] === undefined) {
    return null;
  }

  const dataStartIdx = broker.hasHeader ? 1 : 0;
  const trades: ParsedTrade[] = [];
  for (let i = dataStartIdx; i < rows.length; i++) {
    const trade = mapRowToTrade(rows[i], colMap);
    if (trade) trades.push(trade);
  }
  return trades.length > 0 ? trades : null;
}

/** Generic detection — try to auto-identify columns without knowing the broker */
function tryGenericDetection(lines: string[]): ParseResult {
  const errors: string[] = [];
  const headerCols = parseCSVLine(lines[0]).map((c) => c.trim().toLowerCase());

  // Try to guess each column from common Chinese/English names
  const dateIdx = findColumn(headerCols, ['date', '日期', '成交日期', '交易日期', '成交日', 'trade date']);
  const codeIdx = findColumn(headerCols, ['code', '代码', '证券代码', '股票代码', 'symbol', 'ticker', '代号', '股票代号']);
  const nameIdx = findColumn(headerCols, ['name', '名称', '证券名称', '股票名称', 'description', 'security']);
  const typeIdx = findColumn(headerCols, ['type', '业务名称', '方向', '买卖方向', '买/卖', '买卖', 'buy/sell', 'side', '操作']);
  const qtyIdx = findColumn(headerCols, ['quantity', '数量', '成交数量', '股数', 'qty', 'shares', '成交量']);
  const priceIdx = findColumn(headerCols, ['price', '价格', '成交价格', '成交价', '单价', 'trade price']);
  const netAmountIdx = findColumn(headerCols, ['net_amount', '发生金额', '净收付金额']);
  const feeIdx = findColumn(headerCols, ['fee', '手续费', '佣金', '费用', 'commission', 'comm']);
  const currIdx = findColumn(headerCols, ['currency', '币种', '货币', '结算币种', 'ccy']);
  const amountIdx = findColumn(headerCols, ['amount', '金额', '成交金额', '交易金额']);

  if (dateIdx === -1 || qtyIdx === -1 || priceIdx === -1) {
    return { success: false, format: '未知', trades: [], errors: ['无法自动检测日期/数量/价格列'] };
  }

  const trades: ParsedTrade[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols.length < Math.max(dateIdx, qtyIdx, priceIdx) + 1) continue;

    const date = normalizeDate(cols[dateIdx]?.trim());
    const qty = parseFloat(cols[qtyIdx]);
    const price = parseFloat(cols[priceIdx]);
    if (isNaN(qty) || isNaN(price) || !date) continue;

    const rawAmount = amountIdx !== -1 ? parseFloat(cols[amountIdx]) : NaN;
    const rawNetAmount = netAmountIdx !== -1 ? parseFloat(cols[netAmountIdx]) : NaN;
    let fee = feeIdx !== -1 ? parseFloat(cols[feeIdx]) || 0 : 0;
    if (!isNaN(rawAmount) && !isNaN(rawNetAmount)) {
      fee = Math.abs(Math.abs(rawNetAmount) - Math.abs(rawAmount));
    }

    const typeRaw = typeIdx !== -1 ? cols[typeIdx]?.trim() : '';
    let type = normalizeTradeType(typeRaw);
    if (type === 'other' && !isNaN(rawNetAmount)) {
      if (rawNetAmount < 0) type = 'buy';
      else if (rawNetAmount > 0) type = 'sell';
    }

    const currency = normalizeCurrency(
      currIdx !== -1 ? cols[currIdx]?.trim() : '',
      'HKD'
    );

    const trade: ParsedTrade = {
      date,
      code: codeIdx !== -1 ? cols[codeIdx]?.trim() || '' : '',
      name: nameIdx !== -1 ? cols[nameIdx]?.trim() || '' : '',
      type,
      quantity: qty,
      price,
      fee,
      currency,
    };
    if (!isNaN(rawNetAmount)) trade.net_amount = rawNetAmount;
    trades.push(trade);
  }

  return {
    success: trades.length > 0,
    format: trades.length > 0 ? '自动检测格式' : '未知',
    trades,
    errors: trades.length === 0 ? ['未能从数据行中解析出有效交易'] : errors,
  };
}

/** Standard format detection on pre-parsed rows (from Excel) */
function tryStandardFormatOnRows(rows: string[][]): ParsedTrade[] | null {
  const trades: ParsedTrade[] = [];
  const firstRow = rows[0];
  const isHeader = firstRow && STANDARD_COLUMNS.some((col) =>
    firstRow.some((c) => c.trim().toLowerCase() === col.toLowerCase())
  );
  const startIdx = isHeader ? 1 : 0;

  for (let i = startIdx; i < rows.length; i++) {
    if (rows[i].length < 6) continue;
    const trade = parseStandardLine(rows[i]);
    if (trade) trades.push(trade);
  }
  return trades.length > 0 ? trades : null;
}

/** Generic detection on pre-parsed rows (from Excel) */
function tryGenericDetectionOnRows(rows: string[][]): ParseResult {
  const errors: string[] = [];
  const headerCols = rows[0].map((c) => c.trim().toLowerCase());

  const dateIdx = findColumn(headerCols, ['date', '日期', '成交日期', '交易日期', '成交日', 'trade date']);
  const codeIdx = findColumn(headerCols, ['code', '代码', '证券代码', '股票代码', 'symbol', 'ticker', '代号', '股票代号']);
  const nameIdx = findColumn(headerCols, ['name', '名称', '证券名称', '股票名称', 'description', 'security']);
  const typeIdx = findColumn(headerCols, ['type', '业务名称', '方向', '买卖方向', '买/卖', '买卖', 'buy/sell', 'side', '操作']);
  const qtyIdx = findColumn(headerCols, ['quantity', '数量', '成交数量', '股数', 'qty', 'shares', '成交量']);
  const priceIdx = findColumn(headerCols, ['price', '价格', '成交价格', '成交价', '单价', 'trade price']);
  const netAmountIdx = findColumn(headerCols, ['net_amount', '发生金额', '净收付金额']);
  const feeIdx = findColumn(headerCols, ['fee', '手续费', '佣金', '费用', 'commission', 'comm']);
  const currIdx = findColumn(headerCols, ['currency', '币种', '货币', '结算币种', 'ccy']);
  const amountIdx = findColumn(headerCols, ['amount', '金额', '成交金额', '交易金额']);

  if (dateIdx === -1 || qtyIdx === -1 || priceIdx === -1) {
    return { success: false, format: '未知', trades: [], errors: ['无法自动检测日期/数量/价格列'] };
  }

  const colMap: Record<string, number> = {};
  if (dateIdx !== -1) colMap['date'] = dateIdx;
  if (codeIdx !== -1) colMap['code'] = codeIdx;
  if (nameIdx !== -1) colMap['name'] = nameIdx;
  if (typeIdx !== -1) colMap['type'] = typeIdx;
  colMap['quantity'] = qtyIdx;
  colMap['price'] = priceIdx;
  if (amountIdx !== -1) colMap['amount'] = amountIdx;
  if (netAmountIdx !== -1) colMap['net_amount'] = netAmountIdx;
  if (feeIdx !== -1) colMap['fee'] = feeIdx;
  if (currIdx !== -1) colMap['currency'] = currIdx;

  const trades: ParsedTrade[] = [];
  for (let i = 1; i < rows.length; i++) {
    const trade = mapRowToTrade(rows[i], colMap);
    if (trade) trades.push(trade);
  }

  return {
    success: trades.length > 0,
    format: trades.length > 0 ? '自动检测格式' : '未知',
    trades,
    errors: trades.length === 0 ? ['未能从数据行中解析出有效交易'] : errors,
  };
}

function findColumn(headers: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const idx = headers.findIndex((h) => h === alias.toLowerCase());
    if (idx !== -1) return idx;
  }
  // Fuzzy match
  for (const alias of aliases) {
    const idx = headers.findIndex((h) => h.includes(alias.toLowerCase()));
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Return all available custom broker format names.
 * Used by the UI to populate the format selector dropdown.
 */
export function getBrokerFormats(): string[] {
  return loadCustomFormats().map((c) => c.name);
}

/** Load user-defined custom formats from the database */
function loadCustomFormats(): CustomBrokerFormat[] {
  try {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM custom_statement_formats').all() as any[];
    return rows.map((row: any) => {
      const mapping: Record<string, string> = {};
      const columns: { position: number; field: string }[] = JSON.parse(row.column_mapping);
      for (const col of columns) {
        if (col.field !== 'ignore') {
          mapping[String(col.position)] = col.field;
        }
      }
      return {
        name: row.name,
        keywords: row.keywords.split(',').map((k: string) => k.trim()),
        columnMap: mapping,
        hasHeader: row.has_header === 1,
      };
    });
  } catch {
    return [];
  }
}
