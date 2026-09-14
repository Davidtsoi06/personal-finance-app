/**
 * date-format — 日期显示统一格式（v1.10.20）：YYYY/MM/DD。
 * 存储仍为 ISO（YYYY-MM-DD，SQLite 排序/范围/strftime 依赖），仅在展示与导出层转换。
 */

/** ISO（可带时间）日期 → YYYY/MM/DD；无法识别时原样返回 */
export function formatDate(raw: string | number | Date | null | undefined): string {
  if (raw === null || raw === undefined || raw === '') return '';
  const s = raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '/' + m[2] + '/' + m[3];
  return s;
}

/** ISO 月份（YYYY-MM）→ YYYY/MM；无法识别时原样返回 */
export function formatMonth(raw: string | null | undefined): string {
  if (!raw) return '';
  const m = String(raw).match(/^(\d{4})-(\d{2})/);
  return m ? m[1] + '/' + m[2] : String(raw);
}