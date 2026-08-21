import { describe, it, expect } from 'vitest';
import { parseWechatExcel, parseAlipayCsv, parseCsvAuto } from '../../src/main/services/wallet-bill-parser';

/** v1.10.6：微信账单 Excel（前 17 行无效 + 表头 + 数据 + 尾部统计） */
function wechatRows(): unknown[][] {
  const rows: unknown[][] = [];
  for (let i = 0; i < 17; i++) rows.push([`微信支付账单明细-无效行${i}`, '']);
  rows.push(['微信支付账单明细', '', '']);
  rows.push(['交易时间', '交易类型', '交易对方', '商品', '收/支', '金额(元)', '支付方式', '当前状态']);
  rows.push(['2026-08-16 12:30:45', '商户消费', '星巴克', '拿铁', '支出', '¥35.00', '零钱', '支付成功']);
  rows.push(['2026-08-15 09:00:00', '转账', '张三', '', '收入', '500.00', '零钱', '已存入零钱']);
  rows.push(['2026-08-14 20:00:00', '商户消费', '美团', '外卖', '支出', '1,234.56', '零钱', '支付成功']);
  rows.push(['总笔数(2)', '', '', '', '', '1,269.56', '', '']);
  rows.push(['收入(0)', '', '', '', '', '500.00', '', '']);
  rows.push(['支出(2)', '', '', '', '', '1,269.56', '', '']);
  rows.push(['零钱明细', '', '', '', '', '', '', '']);
  return rows;
}

describe('微信账单解析（v1.10.6）', () => {
  it('跳过前 17 行无效数据、第 18 行表头、第 19 行起数据，尾部统计行截断', () => {
    const { records, errors } = parseWechatExcel(wechatRows());
    expect(errors).toEqual([]);
    expect(records).toHaveLength(3);
    expect(records[0].date).toBe('2026-08-16'); // 带时间只取日期
    expect(records[0].type).toBe('expense');
    expect(records[0].amount).toBeCloseTo(35, 2); // ¥ 符号
    expect(records[0].description).toContain('星巴克');
    expect(records[1].type).toBe('income');
    expect(records[1].amount).toBeCloseTo(500, 2);
    expect(records[2].amount).toBeCloseTo(1234.56, 2); // 千分位
  });

  it('无表头时返回错误', () => {
    const { records, errors } = parseWechatExcel([['a'], ['b']]);
    expect(records).toHaveLength(0);
    expect(errors.length).toBeGreaterThan(0);
  });
});

const ALIPAY_CSV = `支付宝交易记录明细查询
账号:[test@example.com]
---------------------------------交易记录明细列表------------------------------------
交易时间,交易分类,交易对方,对方账号,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注,
2026-08-16 12:00:00,转账,李四,1234@ali.com,还款,收入,500.00,余额,交易成功,20260816001,20260816002,
2026-08-15 10:00:00,餐饮美食,瑞幸咖啡,,拿铁,支出,"25.00",余额宝,交易成功,20260815001,,,
2026-08-14 09:00:00,转账,王五,,买菜,支出,80.5,余额,交易关闭,20260814001,,,
`;

describe('支付宝 CSV 解析（v1.10.6）', () => {
  it('完整字段映射 + 尾部逗号/引号包裹/空值容错', () => {
    const { records, errors } = parseAlipayCsv(ALIPAY_CSV);
    expect(errors).toEqual([]);
    expect(records).toHaveLength(3);
    expect(records[0].date).toBe('2026-08-16');
    expect(records[0].type).toBe('income');
    expect(records[0].amount).toBeCloseTo(500, 2);
    expect(records[0].description).toContain('李四');
    expect(records[1].amount).toBeCloseTo(25, 2); // 引号包裹 + 尾部逗号
    expect(records[1].type).toBe('expense');
    expect(records[2].amount).toBeCloseTo(80.5, 2);
  });

  it('自动识别：微信 CSV 与支付宝 CSV', () => {
    const wx = parseCsvAuto('微信支付账单明细\n交易时间,交易类型,交易对方,商品,收/支,金额(元)\n2026-08-16 12:00:00,商户消费,A店,咖啡,支出,20.00');
    expect(wx.format).toBe('wechat');
    const ali = parseCsvAuto(ALIPAY_CSV);
    expect(ali.format).toBe('alipay');
  });
});
