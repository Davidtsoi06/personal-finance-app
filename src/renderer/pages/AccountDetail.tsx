import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Table, Column } from '../components/ui/Table';
import { Amount } from '../components/ui/Amount';
import { Badge } from '../components/ui/Badge';
import { invoke } from '../hooks/useIpc';
import { ACCOUNT_TYPE_LABELS } from '@shared/constants/labels';

interface AccountBalance {
  id: number; account_id: number; currency: string; balance: number;
}

interface Account {
  id: number; name: string; type: string; currency: string;
  balance: number; bank_name: string | null; card_number: string | null;
  balances: AccountBalance[];
}

interface AccountTransaction {
  id: number; account_id: number; type: 'deposit' | 'withdraw';
  amount: number; currency: string; date: string; notes: string | null;
}

interface ParsedBankRecord {
  date: string; amount: number; type: 'deposit' | 'withdraw';
  description: string; currency: string; balance?: number;
}

export function AccountDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [account, setAccount] = useState<Account | null>(null);
  const [transactions, setTransactions] = useState<AccountTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [txType, setTxType] = useState<'deposit' | 'withdraw'>('deposit');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // ── Bank statement import state ──
  const [showBankImport, setShowBankImport] = useState(false);
  const [bankCsvText, setBankCsvText] = useState('');
  const [parsedBankRecords, setParsedBankRecords] = useState<ParsedBankRecord[] | null>(null);
  const [bankParseFormat, setBankParseFormat] = useState('');
  const [bankImportStatus, setBankImportStatus] = useState('');
  const [bankImporting, setBankImporting] = useState(false);
  const [bankFormats, setBankFormats] = useState<string[]>([]);
  const [selectedBankFormat, setSelectedBankFormat] = useState('');

  const accountId = parseInt(id || '0');

  const load = useCallback(async () => {
    try {
      const [acc, txs] = await Promise.all([
        invoke<Account>('account:get', accountId),
        invoke<AccountTransaction[]>('accountTransaction:list', accountId),
      ]);
      setAccount(acc);
      setTransactions(txs || []);
      setLoading(false);
    } catch (err) { console.error(err); setLoading(false); }
  }, [accountId]);

  useEffect(() => { load(); }, [load]);

  // Load bank formats when import modal opens
  useEffect(() => {
    if (showBankImport) {
      invoke<string[]>('bank:listFormats').then((f) => setBankFormats(f || []));
    }
  }, [showBankImport]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    const form = e.target as HTMLFormElement;
    const data: Record<string, unknown> = { account_id: accountId, type: txType };
    new FormData(form).forEach((v, k) => { data[k] = v; });
    const amount = parseFloat((data.amount ?? '') as string) || 0;
    data.amount = amount;

    if (amount <= 0 || isNaN(amount)) {
      setError('金额必须大于 0');
      setSaving(false);
      return;
    }

    try {
      await invoke('accountTransaction:create', data);
      setShowForm(false);
      load();
    } catch (err: any) {
      setError(err.message || '操作失败');
    }
    setSaving(false);
  };

  // ── Bank statement import handlers ──
  const doBankParse = async (text: string, format: string) => {
    if (!text.trim()) return;
    setBankImportStatus(format ? `正在使用「${format}」格式解析...` : '正在识别银行日结单格式...');
    setParsedBankRecords(null);
    try {
      const formatParam = format || undefined;
      const result = await invoke<{
        success: boolean; format: string; records: ParsedBankRecord[]; errors: string[];
      }>('bank:parseStatement', text, formatParam);
      if (result.success && result.records.length > 0) {
        setBankParseFormat(result.format);
        setParsedBankRecords(result.records);
        setBankImportStatus(`✅ 识别为「${result.format}」，共 ${result.records.length} 条记录，请预览确认后导入`);
      } else {
        setBankImportStatus(`❌ 无法识别格式：${(result.errors || ['未知格式']).join('，')}`);
      }
    } catch (err: any) {
      setBankImportStatus(`❌ 解析失败：${err.message}`);
    }
  };

  const handleBankParse = async () => {
    await doBankParse(bankCsvText, selectedBankFormat);
  };

  const handleBankFormatChange = async (format: string) => {
    setSelectedBankFormat(format);
    if (bankCsvText.trim()) {
      await doBankParse(bankCsvText, format);
    }
  };

  const handleBankExcelUpload = async () => {
    setBankImportStatus('正在打开文件选择器...');
    setParsedBankRecords(null);
    try {
      const formatParam = selectedBankFormat || undefined;
      const result = await invoke<{
        canceled: boolean;
        fileName?: string;
        success?: boolean;
        format?: string;
        records?: ParsedBankRecord[];
        errors?: string[];
      }>('bank:importExcel', formatParam);

      if (result.canceled) { setBankImportStatus(''); return; }

      if (result.success && result.records && result.records.length > 0) {
        setBankParseFormat(`${result.format} · ${result.fileName}`);
        setParsedBankRecords(result.records);
        setBankImportStatus(`✅ 识别为「${result.format}」，共 ${result.records.length} 条记录，请预览确认后导入`);
      } else {
        setBankImportStatus(`❌ 无法识别格式：${(result.errors || ['未知格式']).join('，')}`);
      }
    } catch (err: any) {
      setBankImportStatus(`❌ 读取文件失败：${err.message}`);
    }
  };

  const handleBankImport = async () => {
    if (!parsedBankRecords || parsedBankRecords.length === 0) return;
    setBankImporting(true);
    setBankImportStatus('正在导入...');
    try {
      const result = await invoke<{ imported: number; errors: string[] }>(
        'bank:importParsed', parsedBankRecords, accountId
      );
      let msg = `✅ 成功导入 ${result.imported} 条存取记录`;
      if (result.errors.length > 0) {
        msg += `（${result.errors.length} 条失败：${result.errors.slice(0, 3).join('；')}）`;
      }
      setBankImportStatus(msg);
      setBankCsvText('');
      setParsedBankRecords(null);
      load();
    } catch (err: any) {
      setBankImportStatus(`❌ 导入失败：${err.message}`);
    }
    setBankImporting(false);
  };

  const columns: Column<AccountTransaction>[] = [
    {
      key: 'date', title: '日期',
      render: (r) => r.date,
    },
    {
      key: 'type', title: '类型', align: 'center',
      render: (r) => (
        <Badge
          label={r.type === 'deposit' ? '📥 存入' : '📤 取出'}
          color={r.type === 'deposit' ? 'success' : 'danger'}
        />
      ),
    },
    {
      key: 'amount', title: '金额', align: 'right',
      render: (r) => (
        <span style={{
          fontWeight: 600,
          color: r.type === 'deposit' ? 'var(--color-success)' : 'var(--color-danger)',
        }}>
          {r.type === 'deposit' ? '+' : '-'}
          <Amount value={r.amount} currency={r.currency} showSign={false} />
        </span>
      ),
    },
    {
      key: 'notes', title: '备注',
      render: (r) => r.notes || <span style={{ color: 'var(--color-text-muted)' }}>—</span>,
    },
  ];

  if (loading) return <div className="page-loading">加载中...</div>;
  if (!account) return <div className="page-loading">账户不存在</div>;

  return (
    <div className="page">
      <div className="page-header">
        <button
          onClick={() => navigate('/accounts')}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 'var(--font-size-sm)', color: 'var(--color-primary-500)',
            padding: 0, marginBottom: 'var(--spacing-xs)',
          }}
        >
          ← 返回账户列表
        </button>
        <h2 className="page-title">{account.name}</h2>
        <p className="page-subtitle">
          {ACCOUNT_TYPE_LABELS[account.type] || account.type}
          {account.bank_name && ` · ${account.bank_name}`}
          {account.card_number && ` · ${account.card_number}`}
          {' · '}当前余额 <Amount value={account.balance} currency={account.currency} colored size="md" />
        </p>
        <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
          <Button variant="primary" onClick={() => { setTxType('deposit'); setShowForm(true); }}>
            📥 存入
          </Button>
          <Button variant="secondary" onClick={() => { setTxType('withdraw'); setShowForm(true); }}>
            📤 取出
          </Button>
          <Button variant="secondary" onClick={() => {
            setParsedBankRecords(null); setBankCsvText(''); setBankImportStatus(''); setShowBankImport(true);
          }}>
            📥 导入银行日结单
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-card-label">当前余额</div>
          <div className="stat-card-value number">
            <Amount value={account.balance} currency={account.currency} colored />
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">交易次数</div>
          <div className="stat-card-value number">{transactions.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">最近交易</div>
          <div className="stat-card-value" style={{ fontSize: 'var(--font-size-sm)' }}>
            {transactions.length > 0 ? transactions[0].date : '暂无'}
          </div>
        </div>
      </div>

      {/* Multi-currency balances */}
      {account.balances && account.balances.length > 0 && (
        <Card title="💱 多币种余额">
          <div style={{ display: 'flex', gap: 'var(--spacing-md)', flexWrap: 'wrap' }}>
            {account.balances.map(b => (
              <div key={b.currency} style={{
                flex: '1 1 180px',
                background: 'var(--color-bg, #fafbfc)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--spacing-md)',
                border: '1px solid var(--color-border-light, #f0f0f0)',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 4 }}>
                  {b.currency}
                </div>
                <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 700 }}>
                  {b.currency === 'CNY' ? '¥' : b.currency === 'HKD' ? 'HK$' : '$'}
                  {b.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Transaction History */}
      <Card title="📋 存取记录">
        <Table
          columns={columns}
          data={transactions}
          rowKey={(r) => r.id}
          emptyText="暂无存取记录，点击上方按钮添加"
        />
      </Card>

      {/* Deposit/Withdraw Modal */}
      <Modal
        open={showForm}
        title={txType === 'deposit' ? '📥 存入资金' : '📤 取出资金'}
        onClose={() => setShowForm(false)}
      >
        <form onSubmit={handleSubmit}>
          {/* Type toggle */}
          <div style={{ display: 'flex', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-md)' }}>
            <button
              type="button"
              onClick={() => setTxType('deposit')}
              style={{
                flex: 1, padding: '10px', borderRadius: 'var(--radius-sm)', border: '2px solid',
                borderColor: txType === 'deposit' ? 'var(--color-success)' : 'var(--color-border)',
                background: txType === 'deposit' ? '#F6FFED' : 'var(--color-surface)',
                color: txType === 'deposit' ? 'var(--color-success)' : 'var(--color-text-muted)',
                fontWeight: txType === 'deposit' ? 600 : 400,
                cursor: 'pointer', fontSize: 'var(--font-size-md)',
              }}
            >
              📥 存入
            </button>
            <button
              type="button"
              onClick={() => setTxType('withdraw')}
              style={{
                flex: 1, padding: '10px', borderRadius: 'var(--radius-sm)', border: '2px solid',
                borderColor: txType === 'withdraw' ? 'var(--color-danger)' : 'var(--color-border)',
                background: txType === 'withdraw' ? '#FFF2F0' : 'var(--color-surface)',
                color: txType === 'withdraw' ? 'var(--color-danger)' : 'var(--color-text-muted)',
                fontWeight: txType === 'withdraw' ? 600 : 400,
                cursor: 'pointer', fontSize: 'var(--font-size-md)',
              }}
            >
              📤 取出
            </button>
          </div>

          <div className="form-group">
            <label className="form-label">金额 *</label>
            <input
              className="form-input" name="amount" type="number" step="any"
              required placeholder="0.00" autoFocus
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">币种</label>
              <select className="form-select" name="currency" defaultValue={account.currency}>
                <option value="CNY">¥ 人民币</option>
                <option value="HKD">HK$ 港币</option>
                <option value="USD">$ 美元</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">日期</label>
              <input
                className="form-input" name="date" type="date"
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">备注</label>
            <input className="form-input" name="notes" placeholder="如：工资入账 / 取现" />
          </div>

          {error && (
            <div style={{
              padding: 'var(--spacing-sm) var(--spacing-md)',
              background: '#FFF2F0', borderRadius: 'var(--radius-sm)',
              color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)',
              marginBottom: 'var(--spacing-md)',
            }}>
              {error}
            </div>
          )}

          <div className="form-actions">
            <Button variant="secondary" onClick={() => setShowForm(false)} type="button">取消</Button>
            <Button variant={txType === 'deposit' ? 'primary' : 'danger'} type="submit" disabled={saving}>
              {saving ? '处理中...' : txType === 'deposit' ? '确认存入' : '确认取出'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Bank Statement Import Modal */}
      <Modal open={showBankImport} title="📥 导入银行日结单" onClose={() => setShowBankImport(false)} width="700px">
        <div>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-md)' }}>
            粘贴 CSV 日结单，或直接上传银行 Excel 文件。自动检测格式或手动选择银行格式。
          </p>

          {/* Bank format selector */}
          <div style={{ marginBottom: 'var(--spacing-md)', display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'center' }}>
            <label style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, whiteSpace: 'nowrap' }}>银行格式：</label>
            <select
              value={selectedBankFormat}
              onChange={(e) => handleBankFormatChange(e.target.value)}
              style={{
                flex: 1, padding: '6px 12px', borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border)', fontSize: 'var(--font-size-sm)',
                background: 'var(--color-bg-primary)', cursor: 'pointer',
              }}
            >
              <option value="">🔍 自动检测</option>
              {bankFormats.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>

          {/* Step 1: Paste raw text */}
          {!parsedBankRecords && (
            <>
              <textarea
                className="form-input"
                value={bankCsvText}
                onChange={(e) => setBankCsvText(e.target.value)}
                placeholder={`粘贴银行日结单，支持多种格式：

标准 CSV 格式：
2026-08-05, 5000.00, 存入, 工资, CNY
2026-08-06, 200.00, 取出, 餐饮, CNY

常见银行格式（自动检测）：
交易日期, 摘要, 收支方向, 金额, 币种
2026-08-05, 工资入账, 收入, 5000.00, CNY

或收支分开格式：
日期, 摘要, 收入金额, 支出金额, 余额, 币种
2026-08-05, 工资, 5000.00, 0.00, 5000.00, CNY`}
                rows={10}
                style={{ height: 'auto', fontFamily: 'var(--font-family-number)', fontSize: 'var(--font-size-xs)' }}
              />
              {bankImportStatus && (
                <div style={{
                  marginTop: 'var(--spacing-sm)', padding: 'var(--spacing-sm) var(--spacing-md)',
                  background: bankImportStatus.startsWith('✅') ? '#F6FFED' : bankImportStatus.startsWith('❌') ? '#FFF2F0' : bankImportStatus.startsWith('正在') ? '#E6F7FF' : '#FFFBE6',
                  borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)',
                }}>
                  {bankImportStatus}
                </div>
              )}
              <div className="form-actions" style={{ justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                  <Button variant="secondary" onClick={() => setShowBankImport(false)}>取消</Button>
                  <Button variant="secondary" onClick={handleBankExcelUpload}>
                    📂 上传 Excel
                  </Button>
                </div>
                <Button variant="primary" onClick={handleBankParse} disabled={!bankCsvText.trim()}>
                  🔍 识别并解析
                </Button>
              </div>
            </>
          )}

          {/* Step 2: Preview parsed records */}
          {parsedBankRecords && (
            <>
              <div style={{
                padding: 'var(--spacing-sm) var(--spacing-md)',
                background: '#F6FFED', borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--font-size-sm)', marginBottom: 'var(--spacing-md)',
              }}>
                已识别格式：<b>{bankParseFormat}</b>，共 <b>{parsedBankRecords.length}</b> 条记录
              </div>

              <div style={{ maxHeight: '300px', overflow: 'auto', marginBottom: 'var(--spacing-md)' }}>
                <table style={{ width: '100%', fontSize: 'var(--font-size-xs)', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--color-bg-secondary)', position: 'sticky', top: 0 }}>
                      <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>日期</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>摘要</th>
                      <th style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid var(--color-border)' }}>方向</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid var(--color-border)' }}>金额</th>
                      <th style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid var(--color-border)' }}>币种</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedBankRecords.map((r, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td style={{ padding: '6px 8px' }}>{r.date}</td>
                        <td style={{ padding: '6px 8px' }}>{r.description || '—'}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                          <span style={{
                            color: r.type === 'deposit' ? 'var(--color-success)' : 'var(--color-danger)',
                            fontWeight: 500,
                          }}>
                            {r.type === 'deposit' ? '📥 存入' : '📤 取出'}
                          </span>
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--font-family-number)' }}>
                          {r.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'center' }}>{r.currency}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {bankImportStatus && (
                <div style={{
                  marginTop: 'var(--spacing-sm)', marginBottom: 'var(--spacing-sm)',
                  padding: 'var(--spacing-sm) var(--spacing-md)',
                  background: bankImportStatus.startsWith('✅') ? '#F6FFED' : bankImportStatus.startsWith('❌') ? '#FFF2F0' : '#E6F7FF',
                  borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)',
                }}>
                  {bankImportStatus}
                </div>
              )}

              <div className="form-actions">
                <Button variant="secondary" onClick={() => { setParsedBankRecords(null); setBankImportStatus(''); }}>
                  ← 返回修改
                </Button>
                <Button variant="primary" onClick={handleBankImport} disabled={bankImporting}>
                  {bankImporting ? '导入中...' : `✅ 确认导入 ${parsedBankRecords.length} 条记录`}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
