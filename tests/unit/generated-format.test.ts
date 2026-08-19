import { describe, it, expect } from 'vitest';
import { parseGeneratedFormat } from '../../src/main/services/ai-service';

/** v1.10.0：AI 生成模板 JSON 解析与校验 */
describe('parseGeneratedFormat（v1.10.0）', () => {
  it('解析标准 JSON（含名称/关键词/表头/列映射）', () => {
    const f = parseGeneratedFormat(JSON.stringify({
      name: '招商银行-个人流水',
      keywords: ['交易日期', '招商银行'],
      hasHeader: true,
      columns: [
        { position: 0, field: 'date' },
        { position: 1, field: 'description' },
        { position: 2, field: 'type' },
        { position: 3, field: 'amount' },
        { position: 4, field: 'currency' },
      ],
    }));
    expect(f.name).toBe('招商银行-个人流水');
    expect(f.keywords).toEqual(['交易日期', '招商银行']);
    expect(f.hasHeader).toBe(true);
    expect(f.columns).toHaveLength(5);
    expect(f.columns[0]).toEqual({ position: 0, field: 'date' });
    expect(f.columns[3].field).toBe('amount');
  });

  it('容忍 Markdown 代码围栏（```json ... ```）', () => {
    const f = parseGeneratedFormat('```json\n{"name":"测试","keywords":["k"],"hasHeader":false,"columns":[{"position":0,"field":"date"},{"position":1,"field":"amount"}]}\n```');
    expect(f.name).toBe('测试');
    expect(f.hasHeader).toBe(false);
  });

  it('容忍围栏外多余解释文字（截取 JSON 片段）', () => {
    const f = parseGeneratedFormat('这是识别结果：\n{"name":"工行","keywords":["x"],"hasHeader":true,"columns":[{"position":0,"field":"amount"},{"position":1,"field":"date"}]}\n以上仅供参考');
    expect(f.name).toBe('工行');
    expect(f.columns[0].field).toBe('amount');
  });

  it('券商字段（code/quantity/price/net_amount/fee）合法', () => {
    const f = parseGeneratedFormat(JSON.stringify({
      name: '华泰证券',
      keywords: [],
      hasHeader: true,
      columns: [
        { position: 0, field: 'date' },
        { position: 1, field: 'code' },
        { position: 2, field: 'name' },
        { position: 3, field: 'type' },
        { position: 4, field: 'quantity' },
        { position: 5, field: 'price' },
        { position: 6, field: 'amount' },
        { position: 7, field: 'net_amount' },
        { position: 8, field: 'fee' },
      ],
    }));
    expect(f.columns).toHaveLength(9);
    expect(f.columns[8].field).toBe('fee');
  });

  it('列按 position 排序、未知字段剔除、position 缺失剔除', () => {
    const f = parseGeneratedFormat(JSON.stringify({
      name: 'X',
      keywords: ['a', '', '  b  '],
      hasHeader: true,
      columns: [
        { position: 2, field: 'amount' },
        { position: 0, field: 'date' },
        { position: 1, field: 'not_a_field' },
        { position: 3, field: 'balance' },
        { field: 'currency' }, // 无 position → 剔除
      ],
    }));
    expect(f.columns.map((c) => c.position)).toEqual([0, 2, 3]);
    expect(f.keywords).toEqual(['a', 'b']);
  });

  it('非 JSON → 抛错（可重试）', () => {
    expect(() => parseGeneratedFormat('抱歉，我无法识别')).toThrow(/JSON/);
  });

  it('缺日期列或金额列 → 抛错', () => {
    expect(() => parseGeneratedFormat(JSON.stringify({ name: 'X', keywords: [], hasHeader: true, columns: [{ position: 0, field: 'amount' }] }))).toThrow(/日期/);
    expect(() => parseGeneratedFormat(JSON.stringify({ name: 'X', keywords: [], hasHeader: true, columns: [{ position: 0, field: 'date' }] }))).toThrow(/金额/);
  });

  it('名称缺失 → 默认名', () => {
    const f = parseGeneratedFormat(JSON.stringify({ keywords: [], hasHeader: true, columns: [{ position: 0, field: 'date' }, { position: 1, field: 'amount' }] }));
    expect(f.name).toBe('AI 生成的模板');
  });
});
