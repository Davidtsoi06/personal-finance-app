/**
 * money — 金额舍入工具。
 * 金额精度策略：全库金额以 REAL 存储，所有计算出口统一四舍五入到分（2 位小数），
 * 消除浮点运算（0.1 + 0.2 类问题）的累积误差。规则见 docs/tech-spec.md。
 */

/** 金额统一四舍五入到分（2 位小数，负数按远离零方向舍入）。非有限数返回 0。 */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round((Math.abs(value) + Number.EPSILON) * 100)) / 100;
}

/** 百分比保留 2 位小数。非有限数返回 0。 */
export function roundPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
