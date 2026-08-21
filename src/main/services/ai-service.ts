/**
 * AI service — Chat with DeepSeek/OpenAI-compatible API.
 * All network calls and API key handling stay in the main process.
 */
import { getAiConfig } from '../database/services/settings-service';
import { gatherPortfolioContext, generateDailySummaryContext } from './portfolio-context';
import { normalizeDate } from './data-normalizer';

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

// ── AI 生成日结单模板（v1.10.0） ──

export interface GeneratedFormat {
  name: string;
  keywords: string[];
  hasHeader: boolean;
  columns: { position: number; field: string }[];
}

// 银行与券商日结单字段的并集（校验 AI 输出用）
const FORMAT_FIELDS = [
  'date', 'amount', 'type', 'description', 'currency', 'balance', 'ignore',
  'income', 'expense',
  'code', 'name', 'quantity', 'price', 'net_amount', 'fee',
];
// v1.10.1：银行字段含「收入/支出分列」（常见港银格式：支出一列、收入一列、结余一列，无方向列）
const BANK_FIELDS_TEXT = 'date(日期) income(收入金额) expense(支出金额) amount(金额) type(收支方向) description(摘要/备注) currency(币种) balance(余额) ignore(忽略此列)';
const BROKER_FIELDS_TEXT = 'date(日期) code(证券代码) name(证券名称) type(业务名称) quantity(成交数量) price(成交价格) amount(成交金额) net_amount(发生金额) fee(手续费) currency(币种) ignore(忽略此列)';

function formatSystemPrompt(kind: 'bank' | 'broker'): string {
  const fieldsText = kind === 'bank' ? BANK_FIELDS_TEXT : BROKER_FIELDS_TEXT;
  const kindName = kind === 'bank' ? '银行' : '券商';
  return `你是${kindName}日结单格式分析专家。用户会给你一段${kindName}日结单样例文本，请识别它的列格式。
只输出一个 JSON 对象，不要输出任何解释或 Markdown 围栏：
{
  "name": "模板名称（必须包含${kindName === '银行' ? '银行' : '券商'}名称，如：${kindName === '银行' ? '招商银行' : '华泰证券'}-个人流水）",
  "keywords": ["该${kindName}格式的特征关键词（表头或固定字样，2~5 个）"],
  "hasHeader": true,
  "columns": [{"position": 0, "field": "date"}]
}
字段 field 只能取：${fieldsText}。
position 从 0 开始，按样例中的列顺序排列。
${kind === 'bank'
    ? '银行日结单常见两种结构：① 只有一个金额列（带正负号或借/贷方向列）→ 用 amount 映射金额列，若有方向列再用 type；② 收入/支出分列（支出一列、收入一列，另有结余列）→ 用 income 映射收入列、expense 映射支出列、balance 映射结余列，此时不要生成 type 列（方向由收入/支出列自动判断）。币种列用 currency；结余币种列或重复列用 ignore。'
    : ''}`;
}

/** 解析 AI 返回内容为格式定义（容错：去代码围栏/截取 JSON 片段），校验日期与金额列必须存在。 */
export function parseGeneratedFormat(raw: string): GeneratedFormat {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  let obj: any;
  try {
    obj = JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('AI 返回内容不是有效的 JSON');
    try {
      obj = JSON.parse(text.slice(start, end + 1));
    } catch {
      throw new Error('AI 返回内容不是有效的 JSON');
    }
  }
  const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim().slice(0, 50) : 'AI 生成的模板';
  const keywords = Array.isArray(obj.keywords)
    ? obj.keywords.map((k: any) => String(k).trim()).filter(Boolean).slice(0, 20)
    : [];
  const hasHeader = obj.hasHeader === undefined ? true : !!obj.hasHeader;
  const colsRaw = Array.isArray(obj.columns) ? obj.columns : (Array.isArray(obj.column_mapping) ? obj.column_mapping : []);
  const columns = colsRaw
    .map((c: any) => ({
      position: typeof c.position === 'number' ? c.position : parseInt(String(c.position ?? c.index ?? ''), 10),
      field: typeof c.field === 'string' ? c.field.trim() : '',
    }))
    .filter((c: any) => Number.isInteger(c.position) && c.position >= 0 && FORMAT_FIELDS.includes(c.field))
    .sort((a: any, b: any) => a.position - b.position);
  if (columns.length === 0) throw new Error('AI 生成结果没有有效列映射，请重试');
  if (!columns.some((c: any) => c.field === 'date')) throw new Error('AI 生成结果缺少日期列，请重试');
  // v1.10.1：金额可以是单列 amount，也可以是 income/expense 分列
  const hasAmount = columns.some((c: any) => c.field === 'amount' || c.field === 'income' || c.field === 'expense');
  if (!hasAmount) throw new Error('AI 生成结果缺少金额列（amount 或收入/支出分列），请重试');
  return { name, keywords, hasHeader, columns };
}

/**
 * v1.10.1：把解析出的表格行转成样例文本（制表符分隔、单元格去空白），最多 maxLines 行。
 * v1.10.3：Excel「日期格式」单元格（cellDates 读取后为 Date 对象）→ 真实日期文本。
 * v1.10.4 修复：不再按数值区间猜日期——普通数字（货币金额如 30,000）会被误转成日期序列号；
 *   只有读取时被 xlsx 识别为日期格式的单元格（Date 对象）才转日期，金额等数字保持原样。
 */
export function rowsToSampleText(rows: unknown[][], maxLines = 30): string {
  return rows
    .slice(0, maxLines)
    .map((row) => row.map(cellToSampleText).join('\t'))
    .join('\n');
}

function cellToSampleText(c: unknown): string {
  if (c === null || c === undefined) return '';
  // 仅 Date 对象视为日期；普通数字（金额）保持原样
  if (c instanceof Date) return normalizeDate(c);
  return String(c).trim();
}

/**
 * v1.10.4：白名单判断 Excel 数字格式是否为日期格式。
 * 不用 SheetJS 的 cellDates（会把 HK$#,##0.00 里的 h 误判为小时）；
 * 规则：去掉引号/[..]片段/数字占位符后，含 年份(yy/yyyy)、星期文本(ddd)、月份文本(mmmm) 或 时间(h:mm) 令牌 → 日期。
 */
export function isDateCellFormat(z: string): boolean {
  if (!z) return false;
  const cleaned = z.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
  const lowerRaw = cleaned.toLowerCase();
  // 时间检测在剥离冒号前进行（h:mm 的冒号不能被剥掉）
  const hasTime = /h+\s*[:.]/.test(lowerRaw);
  const code = cleaned.replace(/[0#?.,:;@\\\-_* ]/g, '').toLowerCase();
  if (!code) return false;
  const hasYear = /y{2,}/.test(code);
  const hasTextDay = /ddd/.test(code);
  const hasMonthName = /mmmm/.test(code);
  return hasYear || hasTextDay || hasMonthName || hasTime;
}

/**
 * v1.10.4：把 Excel sheet 转成样例行——日期格式单元格（序列号）→ 真实日期文本，
 * 金额/币种等普通数字保持原样（前 30 行）。'!ref' 形如 'A1:F30'。
 */
export function xlsxSheetToSampleRows(sheet: any, maxLines = 30): unknown[][] {
  const ref = String(sheet?.['!ref'] || 'A1');
  const m = ref.match(/^(\w+)(\d+):(\w+)(\d+)$/);
  let eRow = 0;
  let eCol = 0;
  if (m) {
    eCol = colToIndex(m[3]);
    eRow = parseInt(m[4], 10) - 1;
  }
  const rows: unknown[][] = [];
  for (let r = 0; r <= eRow && rows.length < maxLines; r++) {
    const row: unknown[] = [];
    for (let c = 0; c <= eCol; c++) {
      const addr = (sheet as any)[colIndexToLetter(c) + (r + 1)];
      if (!addr || addr.v === undefined || addr.v === null) { row.push(''); continue; }
      if (addr.t === 'n' && typeof addr.w === 'string' && addr.w.trim()) {
        // 优先用格式化显示文本：日期→'17/8/2026'，货币→'HK$25,000.00'（真实显示，AI 可识别）
        row.push(addr.w.trim());
      } else if (addr.t === 'n' && isDateCellFormat(String(addr.z || ''))) {
        row.push(normalizeDate(addr.v)); // 日期序列号 → 日期文本（无 w 时的兜底）
      } else if (addr.t === 'd') {
        row.push(normalizeDate(addr.v));
      } else {
        row.push(addr.v);
      }
    }
    rows.push(row);
  }
  return rows;
}

function colToIndex(letter: string): number {
  let n = 0;
  for (const ch of letter.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function colIndexToLetter(i: number): string {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * AI 生成日结单模板：取样例前 30 行 → 调用 AI → 解析校验（JSON 解析失败自动重试一次）。
 * 样例内容会发送给配置的 AI 服务商（弹窗已明示）。
 */
export async function generateStatementFormat(sample: string, kind: 'bank' | 'broker'): Promise<GeneratedFormat> {
  const config = getAiConfig();
  if (!config.apiKey) {
    throw new Error('请先在设置中配置 AI API Key（设置 → AI 助手）');
  }
  const sampleLines = sample.split('\n').filter((l) => l.trim()).slice(0, 30).join('\n');
  if (!sampleLines) throw new Error('样例内容为空');

  const callOnce = async (): Promise<string> => {
    const messages: ChatMessage[] = [
      { role: 'system', content: formatSystemPrompt(kind) },
      { role: 'user', content: `这是${kind === 'bank' ? '银行' : '券商'}日结单样例（可能带表头）：\n\`\`\`\n${sampleLines}\n\`\`\`` },
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
        body: JSON.stringify({ model: config.model, messages, temperature: 0.2, max_tokens: 1500 }),
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
      if (!content) throw new Error('AI 返回了空内容，请重试');
      return content;
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') throw new Error('请求超时（60秒），请检查网络连接');
      throw err;
    }
  };

  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const content = await callOnce();
      return parseGeneratedFormat(content);
    } catch (err: any) {
      // 仅解析类错误（JSON/列缺失）自动重试一次；网络/鉴权错误直接抛出
      if (!(err instanceof Error) || !/JSON|列/.test(err.message)) throw err;
      lastErr = err;
    }
  }
  throw lastErr || new Error('AI 生成模板失败，请重试');
}

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

  // If history already starts with a system message (e.g. daily summary),
  // merge portfolio context into it instead of creating a second system message.
  let messages: ChatMessage[];
  if (history.length > 0 && history[0].role === 'system') {
    messages = [
      { role: 'system', content: history[0].content + '\n\n' + portfolioCtx },
      ...history.slice(1),
      { role: 'user', content: userMessage },
    ];
  } else {
    messages = [
      { role: 'system', content: SYSTEM_PROMPT + '\n\n' + portfolioCtx },
      ...history.slice(-20),
      { role: 'user', content: userMessage },
    ];
  }

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

  // If history already starts with a system message, merge portfolio context into it.
  let messages: ChatMessage[];
  if (history.length > 0 && history[0].role === 'system') {
    messages = [
      { role: 'system', content: history[0].content + '\n\n' + portfolioCtx },
      ...history.slice(1),
      { role: 'user', content: userMessage },
    ];
  } else {
    messages = [
      { role: 'system', content: SYSTEM_PROMPT + '\n\n' + portfolioCtx },
      ...history.slice(-20),
      { role: 'user', content: userMessage },
    ];
  }

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

// ── Daily Investment Summary ──

const DAILY_SUMMARY_SYSTEM_PROMPT = `你是一位专业的投资分析师。请根据用户当日的交易数据和投资组合变化，生成一份简洁的投资日报。格式要求：

### 📊 今日交易概况
（如有交易，列出买卖情况和金额；如无交易，说明今日无操作）

### 📈 持仓表现
（分析主要持仓的涨跌情况、整体组合表现）

### 💡 分析与建议
（基于当日数据，给出简短的分析和后续关注要点）

注意：
- 回答使用中文，总字数约 300-500 字
- 不要编造数据，只基于提供的真实数据进行分析
- 投资建议需包含风险提示`;

export async function generateInvestmentSummary(date?: string): Promise<{
  content: string;
  generatedAt: string;
}> {
  const targetDate = date || new Date().toISOString().slice(0, 10);
  const context = generateDailySummaryContext(targetDate);

  try {
    const result = await chat(
      `请根据以下 ${targetDate} 的数据生成当日投资日报。`,
      [{ role: 'system', content: DAILY_SUMMARY_SYSTEM_PROMPT + '\n\n' + context }]
    );
    return { content: result.content, generatedAt: new Date().toISOString() };
  } catch (err: any) {
    throw new Error(`生成投资日报失败：${err.message}`);
  }
}
