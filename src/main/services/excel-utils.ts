/**
 * excel-utils — Excel 工作表 → 文本网格（v1.10.10）。
 * 等效「Excel 先转 CSV 再识别」：
 * - 日期格式单元格 → 输出序列号数字（如 46334），normalizeDate 精确转换（2026-08-11），无美/英歧义；
 * - 其他单元格 → 格式化显示文本（金额带符号 HK$25,000.00 / 日期文本 18/08/2026 / 纯数字 25000）。
 */
import { isDateCellFormat } from './ai-service';
import { stripFormulaWrapper } from '../../shared/utils/amount-parse';

function colToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function colIndexToLetter(i: number): string {
  let s = '';
  i++;
  while (i > 0) {
    const r = (i - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

/** 工作表 → 文本行网格（string[][]，行/列按 !ref 范围补齐）。 */
export function xlsxSheetToTextRows(sheet: any): string[][] {
  const ref = String(sheet?.['!ref'] || '');
  const m = ref.match(/^([A-Za-z]+)(\d+):([A-Za-z]+)(\d+)$/);
  if (!m) return [];
  const startCol = colToIndex(m[1]);
  const startRow = parseInt(m[2], 10) - 1;
  const endCol = colToIndex(m[3]);
  const endRow = parseInt(m[4], 10) - 1;
  const rows: string[][] = [];
  for (let r = startRow; r <= endRow; r++) {
    const row: string[] = [];
    for (let c = startCol; c <= endCol; c++) {
      const addr = sheet[colIndexToLetter(c) + (r + 1)];
      if (!addr || addr.v === undefined || addr.v === null) { row.push(''); continue; }
      if (addr.t === 'n' && isDateCellFormat(String(addr.z || ''))) {
        // 日期格式单元格：输出序列号，normalizeDate 精确转换，避免 m/d/yy 显示文本的美/英歧义
        row.push(String(addr.v));
      } else if (typeof addr.w === 'string' && addr.w.trim()) {
        // 其他单元格：格式化显示文本（金额 HK$25,000.00 / 日期文本 18/08/2026 / 纯数字）
        // v1.10.11：剥离公式包裹（Excel 文本公式 ='20260813'）
        row.push(stripFormulaWrapper(addr.w));
      } else {
        row.push(typeof addr.v === 'number' ? String(addr.v) : String(addr.v ?? ''));
      }
    }
    rows.push(row);
  }
  return rows;
}