/**
 * TradeHistoryModal — 单只持仓的交易历史弹窗（自 HoldingsDetail 拆分）。
 */
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Table } from '../ui/Table';
import { Amount } from '../ui/Amount';
import { Badge } from '../ui/Badge';
import type { Holding } from './HoldingsTableCard';
import type { TradeRecord } from './TradesTableCard';

interface Props {
  holding: Holding | null;
  trades: TradeRecord[];
  onClose: () => void;
  onPriceEdit: (h: Holding) => void;
}

export function TradeHistoryModal({ holding, trades, onClose, onPriceEdit }: Props) {
  const history = holding ? trades.filter((t) => t.asset_id === holding.id) : [];

  return (
    <Modal
      open={holding !== null}
      title={'📜 ' + (holding?.name || '') + ' (' + (holding?.code || '') + ') 交易记录'}
      onClose={onClose}
      width="700px"
    >
      {holding && (
        <>
          <div style={{
            display: 'flex', gap: 'var(--spacing-lg)', marginBottom: 'var(--spacing-md)',
            padding: 'var(--spacing-md)', background: 'var(--color-bg-secondary)',
            borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)',
          }}>
            <div>当前持仓：<b>{holding.quantity.toLocaleString()} 股</b></div>
            <div>成本价：<b>{holding.currency} {holding.cost_price.toFixed(3)}</b></div>
            <div>最新价：<b>{holding.currency} {holding.current_price.toFixed(3)}</b></div>
            <Button variant="secondary" size="sm" onClick={() => onPriceEdit(holding)}>✏️ 改价</Button>
          </div>
          <Table
            columns={[
              { key: 'date', title: '日期', render: (r: TradeRecord) => r.date },
              {
                key: 'type', title: '方向', align: 'center',
                render: (r: TradeRecord) => (
                  <Badge
                    label={r.type === 'buy' ? '🟢 买入' : '🔴 卖出'}
                    color={r.type === 'buy' ? 'success' : 'danger'}
                  />
                ),
              },
              { key: 'quantity', title: '数量', align: 'right', render: (r: TradeRecord) => r.quantity.toLocaleString() },
              { key: 'price', title: '价格', align: 'right', render: (r: TradeRecord) => <Amount value={r.price} currency={r.currency} showSign={false} size="sm" /> },
              {
                key: 'total_amount', title: '金额', align: 'right',
                render: (r: TradeRecord) => (
                  <span style={{ color: r.type === 'buy' ? 'var(--color-danger)' : 'var(--color-success)', fontWeight: 500 }}>
                    {r.type === 'buy' ? '-' : '+'}
                    <Amount value={r.total_amount} currency={r.currency} showSign={false} />
                  </span>
                ),
              },
              {
                key: 'notes', title: '备注',
                render: (r: TradeRecord) => r.notes || <span style={{ color: 'var(--color-text-muted)' }}>—</span>,
              },
            ]}
            data={history}
            rowKey={(r) => r.id}
            emptyText="暂无该股票的交易记录"
          />
        </>
      )}
    </Modal>
  );
}
