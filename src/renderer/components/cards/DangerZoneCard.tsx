/**
 * DangerZoneCard — 危险操作卡片（清空所有数据 + 确认弹窗，自 Settings.tsx 拆分）。
 */
import { useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { invoke } from '../../hooks/useIpc';

interface Props {
  /** 清空成功后回调：父组件刷新受影响的列表 */
  onDataCleared: () => void;
}

export function DangerZoneCard({ onDataCleared }: Props) {
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearConfirmText, setClearConfirmText] = useState('');
  const [clearLoading, setClearLoading] = useState(false);
  const [clearResult, setClearResult] = useState<string | null>(null);

  return (
    <div style={{ marginTop: 'var(--spacing-xl)' }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-md)' }}>
          <span style={{ fontSize: '1.25rem' }}>⚠️</span>
          <div>
            <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)', color: 'var(--color-danger)' }}>危险操作</h3>
            <p style={{ margin: '4px 0 0', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
              清空所有数据将删除你的全部账户、持仓、交易记录、记账流水、预算、人情债等数据。
              AI 配置和系统分类不会被清除。此操作不可撤销！
            </p>
          </div>
        </div>
        <Button variant="danger" onClick={() => { setShowClearModal(true); setClearConfirmText(''); setClearResult(null); }}>
          🗑 清空所有数据
        </Button>
      </Card>

      {/* ── Clear Data Confirmation Modal ── */}
      <Modal open={showClearModal} title="⚠️ 确认清空所有数据" onClose={() => setShowClearModal(false)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
          <div style={{
            padding: 'var(--spacing-md)',
            background: '#FFF2F0',
            border: '1px solid #FFCCC7',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-danger)',
          }}>
            <strong>此操作不可撤销！</strong><br/>
            所有账户、多币种余额、定期存款、持仓、交易记录、存取与记账流水、保单、预算、人情债、自定义日结单格式将被永久删除。<br/>
            AI 配置、系统分类和货币定义不会被清除。
          </div>
          <div>
            <label className="form-label">请输入「确认清空」以继续：</label>
            <input
              className="form-input"
              value={clearConfirmText}
              onChange={(e) => setClearConfirmText(e.target.value)}
              placeholder="确认清空"
              autoFocus
            />
          </div>
          {clearResult && (
            <div style={{
              padding: 'var(--spacing-sm)',
              background: clearResult.startsWith('✅') ? '#F6FFED' : '#FFF2F0',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--font-size-sm)',
            }}>
              {clearResult}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-sm)' }}>
            <Button variant="secondary" onClick={() => setShowClearModal(false)}>取消</Button>
            <Button
              variant="danger"
              disabled={clearConfirmText !== '确认清空' || clearLoading}
              onClick={async () => {
                setClearLoading(true);
                setClearResult(null);
                try {
                  const r = await invoke<{ success: boolean; deletedCount: number }>('data:clearAll');
                  setClearResult('✅ 已清空 ' + r.deletedCount + ' 条数据，应用已恢复为全新状态');
                  setClearConfirmText('');
                  onDataCleared();
                  setTimeout(() => setShowClearModal(false), 2000);
                } catch (err: any) {
                  setClearResult('❌ 清空失败：' + err.message);
                }
                setClearLoading(false);
              }}
            >
              {clearLoading ? '⏳ 清空中...' : '确认清空'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
