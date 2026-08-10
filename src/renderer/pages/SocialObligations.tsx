import { useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Badge } from '../components/ui/Badge';
import { invoke } from '../hooks/useIpc';
import './SocialObligations.css';

interface Obligation {
  id: number;
  type: 'owe' | 'owed';
  person: string;
  item: string;
  status: 'pending' | 'done';
  notes: string | null;
  created_at: string;
  updated_at: string;
}

type TabType = 'owe' | 'owed';

const TAB_OPTIONS: { key: TabType; label: string; icon: string }[] = [
  { key: 'owe', label: '我欠别人的', icon: '🙏' },
  { key: 'owed', label: '别人欠我的', icon: '🤝' },
];

export function SocialObligations() {
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('owe');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ person: '', item: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    invoke<Obligation[]>('socialObligation:list')
      .then((d) => { setObligations(d || []); setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = obligations.filter((o) => o.type === activeTab);

  const openAdd = () => {
    setEditingId(null);
    setForm({ person: '', item: '', notes: '' });
    setShowModal(true);
  };

  const openEdit = (o: Obligation) => {
    setEditingId(o.id);
    setForm({ person: o.person, item: o.item, notes: o.notes || '' });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.person.trim() || !form.item.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        await invoke('socialObligation:update', editingId, {
          person: form.person.trim(),
          item: form.item.trim(),
          notes: form.notes.trim() || null,
        });
      } else {
        await invoke('socialObligation:create', {
          type: activeTab,
          person: form.person.trim(),
          item: form.item.trim(),
          notes: form.notes.trim() || undefined,
        });
      }
      setShowModal(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (o: Obligation) => {
    await invoke('socialObligation:update', o.id, {
      status: o.status === 'pending' ? 'done' : 'pending',
    });
    load();
  };

  const handleDelete = async (id: number) => {
    await invoke('socialObligation:delete', id);
    load();
  };

  const formatDate = (dateStr: string) => dateStr.slice(0, 10);

  if (loading) return <div className="page-loading">加载中...</div>;

  const pendingList = filtered.filter((o) => o.status === 'pending');
  const doneList = filtered.filter((o) => o.status === 'done');
  const displayList = [...pendingList, ...doneList];

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">🤝 人情债</h2>
        <p className="page-subtitle">记录人情往来，不纳入资产统计</p>
        <Button variant="primary" onClick={openAdd}>+ 添加记录</Button>
      </div>

      {/* Tab bar */}
      <div className="obl-tabs">
        {TAB_OPTIONS.map((tab) => (
          <button
            key={tab.key}
            className={`obl-tab ${activeTab === tab.key ? 'obl-tab--active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            <span className="obl-tab-icon">{tab.icon}</span>
            <span className="obl-tab-label">{tab.label}</span>
            <span className="obl-tab-count">
              {obligations.filter((o) => o.type === tab.key && o.status === 'pending').length}
            </span>
          </button>
        ))}
      </div>

      {/* Card grid */}
      {displayList.length === 0 ? (
        <Card>
          <div className="card-placeholder">
            <p>{activeTab === 'owe' ? '没有我欠别人的记录' : '没有别人欠我的记录'}</p>
            <p className="text-secondary">点击「+ 添加记录」开始记录人情往来</p>
          </div>
        </Card>
      ) : (
        <div className="obl-grid">
          {displayList.map((o) => (
            <div key={o.id} className={`obl-card ${o.status === 'done' ? 'obl-card--done' : ''}`}>
              <div className="obl-card-header">
                <Badge
                  label={o.status === 'pending' ? '待完成' : '已完成'}
                  color={o.status === 'pending' ? 'warning' : 'success'}
                />
              </div>
              <div className="obl-card-body">
                <div className="obl-card-person">{o.person}</div>
                <div className="obl-card-item">{o.item}</div>
                {o.notes && <div className="obl-card-notes">{o.notes}</div>}
              </div>
              <div className="obl-card-footer">
                <span className="obl-card-date">📅 {formatDate(o.created_at)}</span>
                <div className="obl-card-actions">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => toggleStatus(o)}
                  >
                    {o.status === 'pending' ? '✅ 完成' : '🔄 重开'}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => openEdit(o)}>
                    ✏️ 编辑
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => handleDelete(o.id)}>
                    🗑 删除
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Modal */}
      <Modal
        open={showModal}
        title={editingId ? '编辑人情记录' : '添加人情记录'}
        onClose={() => setShowModal(false)}
      >
        <div className="obl-form">
          <div className="obl-form-group">
            <label className="obl-form-label">对象（必填）</label>
            <input
              className="obl-form-input"
              type="text"
              placeholder="例如：舅舅"
              value={form.person}
              onChange={(e) => setForm({ ...form, person: e.target.value })}
            />
          </div>
          <div className="obl-form-group">
            <label className="obl-form-label">事项（必填）</label>
            <input
              className="obl-form-input"
              type="text"
              placeholder="例如：帮忙买电视"
              value={form.item}
              onChange={(e) => setForm({ ...form, item: e.target.value })}
            />
          </div>
          <div className="obl-form-group">
            <label className="obl-form-label">备注（可选）</label>
            <input
              className="obl-form-input"
              type="text"
              placeholder="补充说明…"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
          {!editingId && (
            <p className="obl-form-hint">
              当前记录的类别为「{activeTab === 'owe' ? '我欠别人的' : '别人欠我的'}」（由上方 Tab 决定）
            </p>
          )}
          <div className="obl-form-actions">
            <Button variant="secondary" onClick={() => setShowModal(false)}>取消</Button>
            <Button variant="primary" disabled={saving} onClick={handleSave}>
              {saving ? '保存中...' : '💾 保存'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
