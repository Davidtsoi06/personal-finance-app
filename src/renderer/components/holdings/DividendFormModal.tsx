/**
 * DividendFormModal — 股息/分红登记弹窗（v1.10.21）。
 * 支持两种口径：每股派息 × 股数 自动算税前，或直接填税前总额；再填预扣税得到实收。
 * 落库：transactions(type=dividend) + 现金（券商流动金 / 直达关联银行）+ 可选记账「股息收入」。
 */
import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { invoke } from '../../hooks/useIpc';
import { computeDividendAmounts } from '../../../shared/utils/dividend';

export interface DividendHoldingOption {
  assetId: number | null;
  code: string;
  name: string;
  currency: string;
  quantity: number;
}

interface Props {
  open: boolean;
  accountId: number;
  /** 券商已关联的银行账户名（有值 → 现金直达银行余额） */
  bankName?: string | null;
  currency: string;
  holdings: DividendHoldingOption[];
  /** 编辑模式：传入已有股息记录 */
  editing?: {
    id: number; assetId: number; code: string; name: string; currency: string;
    date: string; gross: number; tax: number; notes?: string | null; writeLedger?: boolean;
  } | null;
  /** 预选持仓（从持仓行打开时） */
  presetAssetId?: number | null;
  onClose: () => void;
  onSaved: () => void;
}

const todayStr = () => new Date().toISOString().slice(0, 10);

export function DividendFormModal({
  open, accountId, bankName, currency, holdings, editing, presetAssetId, onClose, onSaved,
}: Props) {
  const [assetId, setAssetId] = useState<number | null>(null);
  const [date, setDate] = useState(todayStr());
  const [mode, setMode] = useState<'perShare' | 'total'>('perShare');
  const [perShare, setPerShare] = useState('');
  const [quantity, setQuantity] = useState('');
  const [grossAmount, setGrossAmount] = useState('');
  const [taxAmount, setTaxAmount] = useState('');
  const [writeLedger, setWriteLedger] = useState(true);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    if (editing) {
      setAssetId(editing.assetId);
      setDate(editing.date);
      setMode('total');
      setGrossAmount(String(editing.gross));
      setTaxAmount(String(editing.tax));
      setPerShare('');
      setQuantity('');
      setNotes(editing.notes || '');
      setWriteLedger(editing.writeLedger !== false);
      return;
    }
    const preset = presetAssetId ? holdings.find((h) => h.assetId === presetAssetId) : holdings[0];
    setAssetId(preset?.assetId ?? null);
    setDate(todayStr());
    setMode('perShare');
    setPerShare('');
    setQuantity(preset && preset.quantity > 0 ? String(preset.quantity) : '');
    setGrossAmount('');
    setTaxAmount('');
    setNotes('');
    setWriteLedger(true);
  }, [open, editing, presetAssetId, holdings]);

  const selected = holdings.find((h) => h.assetId === assetId) || null;
  const amounts = computeDividendAmounts({
    perShare: mode === 'perShare' ? Number(perShare) || 0 : null,
    quantity: mode === 'perShare' ? Number(quantity) || 0 : null,
    grossAmount: mode === 'total' ? Number(grossAmount) || 0 : null,
    taxAmount: Number(taxAmount) || 0,
  });

  const handleSave = async () => {
    setError('');
    if (!(amounts.net > 0)) { setError('实收金额必须大于 0（请填写每股派息×股数或税前总额）'); return; }
    setSaving(true);
    try {
      const payload = {
        investmentAccountId: accountId,
        assetId: selected?.assetId ?? editing?.assetId ?? null,
        code: selected?.code || editing?.code,
        name: selected?.name || editing?.name,
        currency: selected?.currency || currency,
        date,
        grossAmount: amounts.gross,
        taxAmount: amounts.tax,
        perShare: Number(perShare) || 0,
        quantity: Number(quantity) || 0,
        writeLedger,
        notes: notes || null,
      };
      if (editing) await invoke('investmentAccount:updateDividend', editing.id, payload);
      else await invoke('investmentAccount:recordDividend', payload);
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || '保存失败');
    }
    setSaving(false);
  };

  return (
    <Modal open={open} title={editing ? '✏️ 修改股息记录' : '💰 登记分红（股息）'} onClose={onClose} width="560px">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
        <div>
          <label className="form-label">股票</label>
          <select
            className="form-input"
            value={assetId ?? ''}
            disabled={!!editing}
            onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : null;
              setAssetId(id);
              const h = holdings.find((x) => x.assetId === id);
              if (h && h.quantity > 0 && !quantity) setQuantity(String(h.quantity));
            }}
          >
            <option value="">（不指定股票，仅登记分红现金）</option>
            {holdings.map((h) => (
              <option key={String(h.assetId)} value={h.assetId ?? ''}>
                {h.name}（{h.code}）· 持仓 {h.quantity.toLocaleString()}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', gap: 'var(--spacing-md)' }}>
          <div style={{ flex: 1 }}>
            <label className="form-label">到账日期</label>
            <input className="form-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label className="form-label">计算方式</label>
            <select className="form-input" value={mode} onChange={(e) => setMode(e.target.value as 'perShare' | 'total')}>
              <option value="perShare">每股派息 × 股数</option>
              <option value="total">直接填税前总额</option>
            </select>
          </div>
        </div>

        {mode === 'perShare' ? (
          <div style={{ display: 'flex', gap: 'var(--spacing-md)' }}>
            <div style={{ flex: 1 }}>
              <label className="form-label">每股派息</label>
              <input className="form-input" inputMode="decimal" value={perShare} placeholder="0.00" onChange={(e) => setPerShare(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="form-label">股数</label>
              <input className="form-input" inputMode="decimal" value={quantity} placeholder="0" onChange={(e) => setQuantity(e.target.value)} />
            </div>
          </div>
        ) : (
          <div>
            <label className="form-label">税前总额</label>
            <input className="form-input" inputMode="decimal" value={grossAmount} placeholder="0.00" onChange={(e) => setGrossAmount(e.target.value)} />
          </div>
        )}

        <div>
          <label className="form-label">预扣税（港股/美股常见，默认 0）</label>
          <input className="form-input" inputMode="decimal" value={taxAmount} placeholder="0.00" onChange={(e) => setTaxAmount(e.target.value)} />
        </div>

        <div style={{ background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-sm)', padding: 'var(--spacing-sm)' }}>
          <div style={{ fontSize: 'var(--font-size-sm)' }}>
            税前 <b>{amounts.gross.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>
            {' − '}预扣税 <b>{amounts.tax.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>
            {' = '}实收{' '}
            <b style={{ color: 'var(--color-success)' }}>
              {amounts.net.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </b>
            {' '}{selected?.currency || currency}
          </div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: 4 }}>
            {bankName
              ? '到账方式：直达关联银行「' + bankName + '」余额'
              : '到账方式：记入该券商流动金（未关联银行）'}
            {' · '}分红不改动持仓数量与成本价
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-size-sm)' }}>
          <input type="checkbox" checked={writeLedger} onChange={(e) => setWriteLedger(e.target.checked)} />
          同时在日常记账里生成一笔「股息收入」（投资收入分类）
        </label>

        <div>
          <label className="form-label">备注（可选）</label>
          <input className="form-input" value={notes} maxLength={200} onChange={(e) => setNotes(e.target.value)} placeholder="如：中期息 / 末期息" />
        </div>

        {error && <div style={{ color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)' }}>❌ {error}</div>}

        <div className="form-actions">
          <Button variant="secondary" onClick={onClose} disabled={saving}>取消</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>{saving ? '保存中...' : (editing ? '保存修改' : '确认登记')}</Button>
        </div>
      </div>
    </Modal>
  );
}
