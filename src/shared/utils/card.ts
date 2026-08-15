/**
 * card — 卡号安全处理：仅保留后 4 位，完整卡号不落库（安全要求）。
 */
export function normalizeCardNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[\s-]/g, '');
  if (!cleaned) return null;
  return cleaned.slice(-4);
}
