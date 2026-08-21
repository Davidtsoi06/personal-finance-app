/**
 * AI Assistant page — chat with AI about your investment portfolio.
 * Uses DeepSeek API (free tier available — $5 signup credit + daily free quota).
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '../hooks/useIpc';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { renderMarkdown } from '@shared/utils/markdown';
import './AIAssistant.css';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  streaming?: boolean;
}

interface AiConfigPublic {
  provider: string;
  apiUrl: string;
  model: string;
  hasApiKey: boolean;
}

const QUICK_PROMPTS = [
  { icon: '📊', label: '分析我的投资组合', prompt: '请全面分析我目前的投资组合，包括资产配置、行业分布、风险评估，并给出优化建议。' },
  { icon: '⚠️', label: '评估持仓风险', prompt: '请评估我当前持仓的风险水平，识别潜在的风险点，并给出风险分散化的建议。' },
  { icon: '💡', label: '给出优化建议', prompt: '基于我目前的持仓和资产配置，请给出具体的投资组合优化建议。' },
  { icon: '📝', label: '生成本月投资报告', prompt: '请生成本月的投资报告，包括收益表现、盈亏分析、主要变动和市场回顾。' },
  { icon: '🔍', label: '分析消费习惯', prompt: '请分析我本月的收支情况，找出消费模式，并给出预算优化建议。' },
  { icon: '📋', label: '今日投资日报', prompt: '__DAILY_SUMMARY__' },
];

let msgCounter = 0;
function nextId() { return `msg_${++msgCounter}_${Date.now()}`; }

export function AIAssistant() {
  const [config, setConfig] = useState<AiConfigPublic | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();

  // v1.10.6：会话持久化与报告归档
  const [sessions, setSessions] = useState<{ id: number; title: string; message_count?: number; updated_at: string }[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [tab, setTab] = useState<'chat' | 'reports'>('chat');
  const [reports, setReports] = useState<{ id: number; session_id: number | null; title: string; content: string; created_at: string }[]>([]);
  const [viewingReport, setViewingReport] = useState<{ id: number; title: string; content: string; created_at: string } | null>(null);
  const [reportMsg, setReportMsg] = useState('');
  const streamedRef = useRef('');
  const bootstrappedRef = useRef(false);

  // Load AI config
  useEffect(() => {
    invoke<AiConfigPublic>('settings:getAiConfig')
      .then(c => { setConfig(c); setConfigLoading(false); })
      .catch(() => setConfigLoading(false));
  }, []);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── v1.10.6：会话持久化 ──
  const loadSessions = useCallback(async () => {
    const list = await invoke<{ id: number; title: string; message_count?: number; updated_at: string }[]>('ai:sessionList').catch(() => []);
    setSessions(list || []);
    return list || [];
  }, []);

  const loadMessages = useCallback(async (sessionId: number) => {
    const list = await invoke<{ id: number; role: string; content: string }[]>('ai:sessionMessages', sessionId).catch(() => []);
    setMessages((list || []).map((m) => ({ id: String(m.id), role: m.role as 'user' | 'assistant', content: renderMarkdown(m.content) })));
  }, []);

  const loadReports = useCallback(async () => {
    const list = await invoke<{ id: number; session_id: number | null; title: string; content: string; created_at: string }[]>('ai:reportList').catch(() => []);
    setReports(list || []);
  }, []);

  // 首次进入（已配置 Key）：恢复会话
  useEffect(() => {
    if (!config || !config.hasApiKey || bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    (async () => {
      const list = await loadSessions();
      if (list.length > 0) {
        setActiveSessionId(list[0].id);
        await loadMessages(list[0].id);
      } else {
        const sid = await invoke<number>('ai:sessionCreate', '新对话').catch(() => 0);
        setActiveSessionId(sid || null);
        await loadSessions();
      }
      loadReports();
    })();
  }, [config, loadSessions, loadMessages, loadReports]);

  /** 把一轮问答持久化到当前会话 */
  const persistExchange = useCallback(async (userText: string, assistantText: string) => {
    const sid = activeSessionId;
    if (sid == null) return;
    try {
      await invoke('ai:messageAppend', sid, 'user', userText);
      if (assistantText) await invoke('ai:messageAppend', sid, 'assistant', assistantText);
      await loadSessions();
    } catch { /* 持久化失败不阻塞对话 */ }
  }, [activeSessionId, loadSessions]);

  const handleNewSession = async () => {
    const sid = await invoke<number>('ai:sessionCreate', '新对话').catch(() => 0);
    if (!sid) return;
    await loadSessions();
    setActiveSessionId(sid);
    setMessages([]);
    setError('');
  };

  const handleSwitchSession = async (sid: number) => {
    setActiveSessionId(sid);
    setError('');
    await loadMessages(sid);
  };

  const handleDeleteSession = async (sid: number) => {
    await invoke('ai:sessionDelete', sid).catch(() => {});
    const list = await loadSessions();
    if (sid === activeSessionId) {
      if (list.length > 0) {
        setActiveSessionId(list[0].id);
        await loadMessages(list[0].id);
      } else {
        const nsid = await invoke<number>('ai:sessionCreate', '新对话').catch(() => 0);
        setActiveSessionId(nsid || null);
        setMessages([]);
        await loadSessions();
      }
    }
  };

  /** ⭐ 保存当前会话为报告 */
  const handleSaveReport = async () => {
    if (activeSessionId == null) return;
    const firstUser = messages.find((m) => m.role === 'user');
    const plain = firstUser ? firstUser.content.replace(/<[^>]+>/g, '').slice(0, 30) : '';
    const title = plain || `AI 对话报告 ${new Date().toISOString().slice(0, 10)}`;
    const rid = await invoke<number>('ai:reportSave', { sessionId: activeSessionId, title }).catch(() => 0);
    if (rid) {
      setReportMsg('✅ 报告已保存到「AI 报告归档」');
      loadReports();
      setTimeout(() => setReportMsg(''), 4000);
    }
  };

  const handleExportSession = async (format: 'md' | 'pdf') => {
    if (activeSessionId == null) return;
    await invoke('ai:sessionExport', activeSessionId, format).catch(() => {});
  };

  const handleExportReport = async (rid: number, format: 'md' | 'pdf') => {
    await invoke('ai:reportExport', rid, format).catch(() => {});
  };

  const handleDeleteReport = async (rid: number) => {
    await invoke('ai:reportDelete', rid).catch(() => {});
    loadReports();
    if (viewingReport && viewingReport.id === rid) setViewingReport(null);
  };

  const handleSend = useCallback(async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || loading) return;

    setInput('');
    setError('');

    // Handle daily summary special prompt
    if (msg === '__DAILY_SUMMARY__') {
      setLoading(true);
      const today = new Date().toISOString().slice(0, 10);
      const userMsg: Message = { id: nextId(), role: 'user', content: '📋 生成今日投资日报' };
      const aiMsg: Message = { id: nextId(), role: 'assistant', content: '', streaming: true };
      setMessages(prev => [...prev, userMsg, aiMsg]);

      try {
        const result = await invoke<{ success: boolean; content?: string; error?: string; cached?: boolean }>(
          'ai:dailySummary'
        );
        if (result.success && result.content) {
          const prefix = result.cached ? '📋 *以下为已缓存的今日投资日报*\n\n' : '📋 *以下为最新生成的今日投资日报*\n\n';
          setMessages(prev => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && last.role === 'assistant') {
              last.content = renderMarkdown(prefix + result.content!);
              last.streaming = false;
            }
            return updated;
          });
          await persistExchange('📋 生成今日投资日报', result.content); // v1.10.6
        } else {
          setError(result.error || '生成日报失败');
          setMessages(prev => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && last.role === 'assistant') {
              last.content = `❌ ${result.error || '生成失败，请稍后重试'}`;
              last.streaming = false;
            }
            return updated;
          });
          await persistExchange('📋 生成今日投资日报', `❌ ${result.error || '生成失败'}`);
        }
      } catch (err: any) {
        setError(err.message || '未知错误');
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === 'assistant') {
            last.content = `❌ ${err.message || '请求失败'}`;
            last.streaming = false;
          }
          return updated;
        });
        await persistExchange('📋 生成今日投资日报', `❌ ${err.message || '请求失败'}`);
      }
      setLoading(false);
      return;
    }

    const userMsg: Message = { id: nextId(), role: 'user', content: msg };
    const aiMsg: Message = { id: nextId(), role: 'assistant', content: '', streaming: true };
    setMessages(prev => [...prev, userMsg, aiMsg]);
    setLoading(true);

    // Build history (previous messages, excluding the new ones just added)
    const history = messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    try {
      // Register streaming listeners
      let streamedContent = '';
      const cleanup: (() => void)[] = [];

      if (window.electronAPI?.onAiStreamChunk) {
        window.electronAPI.onAiStreamChunk((chunk: string) => {
          streamedContent += chunk;
          streamedRef.current = streamedContent; // v1.10.6：持久化用原文
          setMessages(prev => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && last.role === 'assistant') {
              last.content = renderMarkdown(streamedContent);
              last.streaming = true;
            }
            return updated;
          });
        });
        cleanup.push(() => window.electronAPI?.removeAiStreamListeners?.());
      }

      if (window.electronAPI?.onAiStreamDone) {
        window.electronAPI.onAiStreamDone((data: any) => {
          if (!data.success) {
            setError(data.error || 'AI 请求失败');
            setMessages(prev => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last && last.role === 'assistant') {
                last.content = `❌ ${data.error || '请求失败，请稍后重试'}`;
                last.streaming = false;
              }
              return updated;
            });
          } else {
            setMessages(prev => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last && last.role === 'assistant') {
                last.streaming = false;
              }
              return updated;
            });
          }
          setLoading(false);
          cleanup.forEach(fn => fn());
        });
      }

      // If streaming is available, use it; otherwise fallback to non-streaming
      if (window.electronAPI) {
        await invoke('ai:chatStream', { message: msg, history });
        // v1.10.6：流式完成后持久化（原文）
        const finalContent = streamedRef.current || '';
        streamedRef.current = '';
        await persistExchange(msg, finalContent || undefined as any);
      } else {
        const result = await invoke<{ success: boolean; content?: string; error?: string }>('ai:chat', { message: msg, history });
        if (result.success && result.content) {
          setMessages(prev => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && last.role === 'assistant') {
              last.content = renderMarkdown(result.content!);
              last.streaming = false;
            }
            return updated;
          });
          await persistExchange(msg, result.content); // v1.10.6
        } else {
          setError(result.error || 'AI 请求失败');
          setMessages(prev => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && last.role === 'assistant') {
              last.content = `❌ ${result.error || '请求失败'}`;
              last.streaming = false;
            }
            return updated;
          });
          await persistExchange(msg, `❌ ${result.error || '请求失败'}`);
        }
        setLoading(false);
        cleanup.forEach(fn => fn());
      }
    } catch (err: any) {
      setError(err.message || '未知错误');
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last && last.role === 'assistant') {
          last.content = `❌ ${err.message || '请求失败'}`;
          last.streaming = false;
        }
        return updated;
      });
      setLoading(false);
      await persistExchange(msg, `❌ ${err.message || '请求失败'}`);
    }
  }, [input, loading, messages, persistExchange]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Config loading state
  if (configLoading) return <div className="page-loading">加载中...</div>;

  // No API key configured — show onboarding
  if (config && !config.hasApiKey) {
    return (
      <div className="page">
        <div className="page-header">
          <h2 className="page-title">🤖 AI 投资助手</h2>
          <p className="page-subtitle">基于你的真实持仓数据，AI 提供投资分析和建议</p>
        </div>

        <div className="ai-onboarding">
          <div className="ai-onboarding__hero">
            <span className="ai-onboarding__icon">🤖</span>
            <h3>免费使用，只需 2 步</h3>
            <p>DeepSeek 是国内领先的 AI 大模型，中文理解能力优秀。<br/>
            新用户注册即送 <strong>$5 免费额度</strong>，每天还有 50 次免费调用。</p>
          </div>

          <div className="ai-onboarding__steps">
            <div className="ai-onboarding__step">
              <div className="ai-onboarding__step-num">①</div>
              <div className="ai-onboarding__step-content">
                <h4>注册 DeepSeek 获取免费 API Key</h4>
                <p>手机号注册，1 分钟完成，免费送 $5 额度</p>
                <Button variant="primary" onClick={() => {
                  // Open in default browser via a simple approach
                  invoke('app:ping').then(() => {
                    // Use shell.openExternal via a simple approach
                    const link = 'https://platform.deepseek.com/api_keys';
                    // Try opening via window.open as fallback
                    window.open(link, '_blank');
                  });
                }}>
                  🔗 前往注册 DeepSeek
                </Button>
              </div>
            </div>

            <div className="ai-onboarding__step">
              <div className="ai-onboarding__step-num">②</div>
              <div className="ai-onboarding__step-content">
                <h4>粘贴 API Key 到设置中</h4>
                <p>注册后在设置页面填入 Key 即可开始使用</p>
                <Button variant="secondary" onClick={() => navigate('/settings')}>
                  ⚙️ 打开设置
                </Button>
              </div>
            </div>
          </div>

          <div className="ai-onboarding__tips">
            <p>💡 DeepSeek 是国内公司，无需 VPN，中文回答质量优秀</p>
            <p>💰 $5 额度个人使用可用数月，即使用完也只需 ¥10 充值（≈1000 万 tokens）</p>
            <p>🔒 你的财务数据仅用于本次 AI 对话上下文，不会用于模型训练</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2 className="page-title">🤖 AI 投资助手</h2>
        <p className="page-subtitle">基于你的真实持仓数据，AI 提供投资分析和建议</p>
      </div>

      <div className="ai-chat">
        {/* v1.10.6：工具栏——标签切换 + 会话操作 */}
        <div style={{ display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'center', marginBottom: 'var(--spacing-md)', flexWrap: 'wrap' }}>
          <button
            onClick={() => setTab('chat')}
            style={{
              padding: '6px 16px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 'var(--font-size-sm)',
              border: tab === 'chat' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
              background: tab === 'chat' ? 'rgba(91,155,213,0.1)' : 'var(--color-bg-primary)',
              color: tab === 'chat' ? 'var(--color-primary)' : 'var(--color-text-primary)', fontWeight: tab === 'chat' ? 600 : 400,
            }}
          >💬 对话</button>
          <button
            onClick={() => { setTab('reports'); loadReports(); }}
            style={{
              padding: '6px 16px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 'var(--font-size-sm)',
              border: tab === 'reports' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
              background: tab === 'reports' ? 'rgba(91,155,213,0.1)' : 'var(--color-bg-primary)',
              color: tab === 'reports' ? 'var(--color-primary)' : 'var(--color-text-primary)', fontWeight: tab === 'reports' ? 600 : 400,
            }}
          >📁 AI 报告归档{reports.length > 0 ? `（${reports.length}）` : ''}</button>
          <span style={{ flex: 1 }} />
          {tab === 'chat' && activeSessionId != null && (
            <>
              <Button variant="secondary" size="sm" onClick={handleNewSession}>＋ 新对话</Button>
              <Button variant="secondary" size="sm" onClick={handleSaveReport}>⭐ 保存为报告</Button>
              <Button variant="secondary" size="sm" onClick={() => handleExportSession('md')}>📄 导出 .md</Button>
              <Button variant="secondary" size="sm" onClick={() => handleExportSession('pdf')}>📄 导出 .pdf</Button>
            </>
          )}
        </div>
        {reportMsg && (
          <div style={{ padding: '6px 12px', background: '#F6FFED', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-sm)', marginBottom: 'var(--spacing-md)' }}>
            {reportMsg}
          </div>
        )}

        {/* v1.10.6：报告归档列表 */}
        {tab === 'reports' && (
          <div>
            {reports.length === 0 ? (
              <div className="card-placeholder">暂无归档报告——在对话中点「⭐ 保存为报告」即可归档</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
                {reports.map((r) => (
                  <div key={r.id} style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)',
                    padding: 'var(--spacing-sm) var(--spacing-md)',
                    background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-sm)',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{r.created_at?.replace('T', ' ').slice(0, 16)}</div>
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => setViewingReport(r)}>👁 查看</Button>
                    <Button variant="secondary" size="sm" onClick={() => handleExportReport(r.id, 'md')}>📄 .md</Button>
                    <Button variant="secondary" size="sm" onClick={() => handleExportReport(r.id, 'pdf')}>📄 .pdf</Button>
                    <Button variant="secondary" size="sm" onClick={() => handleDeleteReport(r.id)}>🗑</Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'chat' && (
        <div style={{ display: 'flex', gap: 'var(--spacing-md)', alignItems: 'flex-start' }}>
          {/* 会话侧栏（v1.10.6） */}
          <div style={{ width: 200, flexShrink: 0, borderRight: '1px solid var(--color-border)', paddingRight: 'var(--spacing-md)', maxHeight: '60vh', overflow: 'auto' }}>
            {sessions.map((s) => (
              <div key={s.id} onClick={() => handleSwitchSession(s.id)} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', marginBottom: 4,
                borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                background: s.id === activeSessionId ? 'rgba(91,155,213,0.15)' : 'transparent',
                border: s.id === activeSessionId ? '1px solid var(--color-primary)' : '1px solid transparent',
              }}>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--font-size-xs)' }}>
                  💬 {s.title || '新对话'}
                </span>
                <button
                  onClick={(ev) => { ev.stopPropagation(); handleDeleteSession(s.id); }}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)' }}
                >🗑</button>
              </div>
            ))}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
        {/* Quick prompts */}
        <div className="ai-chat__quick-prompts">
          {QUICK_PROMPTS.map((qp) => (
            <button
              key={qp.label}
              className="ai-chat__quick-prompt"
              onClick={() => handleSend(qp.prompt)}
              disabled={loading}
              title={qp.prompt}
            >
              {qp.icon} {qp.label}
            </button>
          ))}
        </div>

        {/* Messages */}
        <div className="ai-chat__messages">
          {messages.length === 0 && (
            <div className="ai-chat__welcome">
              <span className="ai-chat__welcome-icon">👋</span>
              <h3>你好！我是你的 AI 投资助手</h3>
              <p>我可以基于你的真实持仓数据帮你：</p>
              <ul>
                <li>📊 分析投资组合表现</li>
                <li>⚠️ 评估持仓风险</li>
                <li>💡 提供优化建议</li>
                <li>📝 生成投资报告</li>
                <li>🔍 分析消费习惯</li>
              </ul>
              <p className="ai-chat__welcome-hint">点击上方快捷提示开始，或直接输入你的问题</p>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`ai-chat__message ai-chat__message--${msg.role}`}>
              <div className={`ai-chat__bubble ai-chat__bubble--${msg.role}`}>
                {msg.role === 'assistant' ? (
                  <div
                    className="ai-chat__markdown"
                    dangerouslySetInnerHTML={{ __html: msg.content || (msg.streaming ? '<span class="ai-chat__cursor">▌</span>' : '') }}
                  />
                ) : (
                  <span>{msg.content}</span>
                )}
              </div>
            </div>
          ))}
          {loading && messages[messages.length - 1]?.content === '' && (
            <div className="ai-chat__message ai-chat__message--assistant">
              <div className="ai-chat__bubble ai-chat__bubble--assistant">
                <span className="ai-chat__thinking">🤔 AI 正在分析你的数据...</span>
              </div>
            </div>
          )}

          {error && (
            <div className="ai-chat__error">
              ❌ {error}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="ai-chat__input-area">
          <textarea
            ref={inputRef}
            className="ai-chat__input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入你的问题，按 Enter 发送，Shift+Enter 换行..."
            rows={2}
            disabled={loading}
          />
          <Button variant="primary" onClick={() => handleSend()} disabled={loading || !input.trim()}>
            {loading ? '⏳' : '📤'}
          </Button>
        </div>

        <div className="ai-chat__footer">
          <span>🔒 数据仅本地处理 · AI 由 DeepSeek 提供</span>
          <span>💡 快捷提问前 5 个模板点击即发送</span>
        </div>
          </div>
        </div>
        )}
      </div>

      {/* v1.10.6：报告查看弹窗 */}
      <Modal open={!!viewingReport} title="📄 AI 报告" onClose={() => setViewingReport(null)} width="720px">
        {viewingReport && (
          <div>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{viewingReport.title}</div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-md)' }}>
              {viewingReport.created_at?.replace('T', ' ').slice(0, 16)}
            </div>
            <div
              className="ai-chat__markdown"
              style={{ maxHeight: 420, overflow: 'auto' }}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(viewingReport.content) }}
            />
            <div className="form-actions" style={{ marginTop: 'var(--spacing-md)' }}>
              <Button variant="secondary" onClick={() => handleExportReport(viewingReport.id, 'md')}>📄 下载 .md</Button>
              <Button variant="secondary" onClick={() => handleExportReport(viewingReport.id, 'pdf')}>📄 下载 .pdf</Button>
              <Button variant="secondary" onClick={() => handleDeleteReport(viewingReport.id)}>🗑 删除</Button>
              <Button variant="primary" onClick={() => setViewingReport(null)}>关闭</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
