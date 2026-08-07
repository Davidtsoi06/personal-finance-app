/**
 * AI service — Chat with DeepSeek/OpenAI-compatible API.
 * All network calls and API key handling stay in the main process.
 */
import { getAiConfig } from '../database/services/settings-service';
import { gatherPortfolioContext } from './portfolio-context';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  content: string;
  model?: string;
}

const SYSTEM_PROMPT = `你是一个专业的个人理财投资助手。你可以访问用户的真实投资组合数据（在下方提供）。
请基于这些数据给出专业、客观的分析和建议。

重要规则：
- 回答使用中文
- 不要编造数据，只基于提供的真实数据进行分析
- 如果用户问的问题超出数据范围，礼貌地说明你缺乏相关信息
- 投资建议应包含风险提示（"投资有风险，以上建议仅供参考"）
- 使用友好的语气，像一位专业的理财顾问
- 金额使用人民币元为单位
- 适当使用 Markdown 格式（标题、列表、表格）来组织信息，让回答更易读`;

/**
 * Non-streaming chat — sends full message and waits for complete response.
 */
export async function chat(
  userMessage: string,
  history: ChatMessage[] = []
): Promise<ChatResponse> {
  const config = getAiConfig();
  if (!config.apiKey) {
    throw new Error('请先在设置中配置 DeepSeek API Key（免费注册即送 $5 额度）');
  }

  const portfolioCtx = gatherPortfolioContext();

  // Build messages: system + context + history + user
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT + '\n\n' + portfolioCtx },
    ...history.slice(-20), // keep last 20 messages (10 conversation turns)
    { role: 'user', content: userMessage },
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(config.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.7,
        max_tokens: 4096,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      if (response.status === 401) throw new Error('API Key 无效（401），请在设置中更新');
      if (response.status === 429) throw new Error('请求过于频繁，请稍后再试');
      const text = await response.text().catch(() => '');
      throw new Error(`AI 服务返回错误 (${response.status}): ${text.slice(0, 200)}`);
    }

    const data = await response.json() as any;
    const content = data?.choices?.[0]?.message?.content || '';

    return {
      content: content || 'AI 返回了空内容，请稍后重试',
      model: data.model || config.model,
    };
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('请求超时（60秒），请检查网络连接');
    throw err;
  }
}

/**
 * Streaming chat — calls onChunk for each text delta.
 * Returns full content at the end.
 */
export async function chatStreaming(
  userMessage: string,
  history: ChatMessage[],
  onChunk: (text: string) => void
): Promise<ChatResponse> {
  const config = getAiConfig();
  if (!config.apiKey) {
    throw new Error('请先在设置中配置 DeepSeek API Key（免费注册即送 $5 额度）');
  }

  const portfolioCtx = gatherPortfolioContext();

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT + '\n\n' + portfolioCtx },
    ...history.slice(-20),
    { role: 'user', content: userMessage },
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(config.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.7,
        max_tokens: 4096,
        stream: true,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      if (response.status === 401) throw new Error('API Key 无效（401），请在设置中更新');
      if (response.status === 429) throw new Error('请求过于频繁，请稍后再试');
      throw new Error(`AI 服务返回错误 ${response.status}`);
    }

    // Parse SSE stream
    const reader = response.body?.getReader();
    if (!reader) throw new Error('无法读取响应流');

    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed?.choices?.[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            onChunk(delta);
          }
        } catch {
          // skip unparseable chunks
        }
      }
    }

    return { content: fullContent || 'AI 返回了空内容，请稍后重试', model: config.model };
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('请求超时（60秒），请检查网络连接');
    throw err;
  }
}
