/**
 * statement-classifier — 银行日结单行分类（v1.9.0 定期全自动体系）。
 * 纯函数：方向 + 摘要关键词 → fd_out（转出转定期）/ fd_in（定期回款）/ normal（普通收支）。
 * 分类只决定默认动作，用户在预览中可改。
 */

export type StatementRowClass = 'fd_out' | 'fd_in' | 'normal';

/** 取出方向 + 这些关键词 → 疑似转定期（扣活期、建定期）；不含裸「定期」防误伤「定期到期支取」 */
export const FD_OUT_KEYWORDS = [
  '转定期', '定期存款', '定期存单', '定存', '存单', '大额存单', '结构性存款', '理财申购', '理财认购', '整存整取', '转存',
  // v1.10.1：英文/港银表述
  'NEW TERM DEP', 'NEW TERM DEPOSIT', 'TERM DEP PURCHASE', 'FD PURCHASE', 'TIME DEPOSIT NEW',
];

/** 存入方向 + 这些关键词 → 疑似定期回款（结清定期） */
export const FD_IN_KEYWORDS = [
  '定期到期', '定存到期', '到期', '赎回', '回款', '本息', '结清', '支取',
  // v1.10.1：英文/港银表述（TERM DEP W\D = 定期支取回款）
  'TERM DEP W', 'TERM DEP WITHDRAWAL', 'TERM DEP MATURITY', 'MATURITY', 'TIME DEPOSIT W',
];

export function classifyBankRecord(rec: { type: 'deposit' | 'withdraw'; description: string }): StatementRowClass {
  const desc = (rec.description || '').trim();
  if (!desc) return 'normal';
  if (rec.type === 'withdraw' && FD_OUT_KEYWORDS.some((k) => desc.includes(k))) return 'fd_out';
  if (rec.type === 'deposit' && FD_IN_KEYWORDS.some((k) => desc.includes(k))) return 'fd_in';
  return 'normal';
}
