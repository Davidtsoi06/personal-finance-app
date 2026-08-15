import { describe, it, expect } from 'vitest';
import { escapeHtml, renderMarkdown } from '../../src/shared/utils/markdown';

describe('escapeHtml', () => {
  it('转义全部 HTML 特殊字符', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
    expect(escapeHtml('a&b"c' + String.fromCharCode(39) + 'd')).toBe('a&amp;b&quot;c&#39;d');
  });
});

describe('renderMarkdown（安全渲染）', () => {
  it('原始 HTML 不会进入输出（防 XSS）', () => {
    const out = renderMarkdown('<script>alert(1)</script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('事件处理器所在标签被整体转义为文本', () => {
    const out = renderMarkdown('<img src=x onerror=alert(1)>');
    expect(out).not.toMatch(/<img/i);
    expect(out).toContain('&lt;img');
  });

  it('Markdown 语法正常渲染', () => {
    expect(renderMarkdown('**加粗**')).toContain('<strong>加粗</strong>');
    expect(renderMarkdown('# 标题')).toContain('<h1>标题</h1>');
    expect(renderMarkdown('- 项目')).toContain('<li>项目</li>');
    expect(renderMarkdown(String.fromCharCode(96) + 'code' + String.fromCharCode(96))).toContain('<code>code</code>');
  });

  it('表格渲染', () => {
    const out = renderMarkdown('| 名称 | 值 |' + String.fromCharCode(10) + '| --- | --- |' + String.fromCharCode(10) + '| A | 1 |');
    expect(out).toContain('<table>');
    expect(out).toContain('<th>名称</th>');
    expect(out).toContain('<td>1</td>');
  });

  it('加粗内容中的 HTML 同样被转义', () => {
    const out = renderMarkdown('**<b>粗</b>**');
    expect(out).not.toContain('<b>');
    expect(out).toContain('<strong>&lt;b&gt;粗&lt;/b&gt;</strong>');
  });
});
