/**
 * markdown — AI 回复渲染工具（从 AIAssistant 提取，供复用与测试）。
 * 安全策略：先整体 HTML 转义，再做 Markdown 转换 —— 原始 HTML 不会进入 DOM（防 XSS）。
 */

/** HTML 转义：外部内容中的任意 HTML 一律按纯文本处理。 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 简易 Markdown 转 HTML（加粗/斜体/标题/列表/代码/表格），输入已整体转义。 */
export function renderMarkdown(text: string): string {
  const escaped = escapeHtml(text);
  // code blocks first
  let out = escaped.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
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
  out = out.replace(/\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)*)/g, (_: string, header: string, body: string) => {
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
