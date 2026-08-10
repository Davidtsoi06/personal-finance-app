/**
 * AI Assistant page — chat with AI about your investment portfolio.
 * Uses DeepSeek API (free tier available — $5 signup credit + daily free quota).
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '../hooks/useIpc';
import { Button } from '../components/ui/Button';
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

/** Simple markdown-to-HTML for AI responses (bold, italic, headings, lists, code, tables). */
function renderMarkdown(text: string): string {
  // code blocks first
  let out = text.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  // inline code
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  // bold
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // italic
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // headings
  out = out.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  out = out.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  out = out.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // tables — simple pipe table handling
  out = out.replace(/\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)*)/g, (_, header, body) => {
    const hCells = header.split('|').filter((c: string) => c.trim()).map((c: string) => `<th>${c.trim()}</th>`).join('');
    const rows = body.trim().split('\n').map((row: string) => {
      const cells = row.split('|').filter((c: string) => c.trim()).map((c: string) => `<td>${c.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<table><thead><tr>${hCells}</tr></thead><tbody>${rows}</tbody></table>`;
  });
  // unordered lists
  out = out.replace(/^- (.+)$/gm, '<li>$1</li>');
  out = out.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  // numbered lists
  out = out.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  // line breaks
  out = out.replace(/\n\n/g, '<br/><br/>');
  out = out.replace(/\n/g, '<br/>');
  return out;
}

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
    }
  }, [input, loading, messages]);

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
  );
}
