import { describe, it, expect } from 'vitest';
import { parseWechatExcel, parseAlipayCsv, parseCsvAuto, decodeCsvBuffer } from '../../src/main/services/wallet-bill-parser';

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

describe('支付宝 CSV 官方导出格式（v1.10.7）', () => {
  // 用户实测样本：表头前有导出信息 + 特别提示 + 电子客户回单分隔线（共 22 行），
  // 数据行订单号/商家订单号以制表符结尾、末尾双逗号
  const OFFICIAL_CSV = `导出信息：
姓名：蔡佩峰
支付宝账户：puifungdavid@163.com
起始时间：[2026-08-17 00:00:00]    终止时间：[2026-08-21 23:59:59]
导出交易类型：[全部]
导出时间：[2026-08-21 14:50:31]
共1笔记录
收入：0笔 0.00元
支出：1笔 39.00元
不计收支：0笔 0.00元

特别提示：
1.本回单内容可表明支付宝受理了相应支付交易申请，因系统原因或通讯故障等偶发因素导致本回单与实际交易结果不符时，以实际交易情况为准；
2.请勿将本回单作为收款方发货的凭据使用，请查证账户实际到账情况后再进行发货操作；
3.支付宝快捷支付等非余额支付方式可能既产生支付宝交易也同步产生银行交易，因此请勿使用本回单进行重复记账；
4.本回单如经任何涂改、编造，均立即失去效力；
5.部分账单如：充值提现、账户转存或者个人设置收支等不计入为收入或者支出，记为不计收支类；
6.因统计逻辑不同，明细金额直接累加后，可能会和下方统计金额不一致，请以实际交易金额为准；
7.禁止将本回单用于非法用途；
8.本明细仅供个人对账使用。

------------------------支付宝支付科技有限公司  电子客户回单------------------------
交易时间,交易分类,交易对方,对方账号,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注,
2026-08-19 17:21:00,服饰装扮,丹灵**店,ben***@163.com,手表带男款真皮磁吸扣洞洞透气表链代用卡西欧万国天梭DW浪琴天王,支出,39.00,账户余额,等待确认收货,2026081923001155711407545663	,T200P5127193551145105110	,,
`;
  it('表头在第 22 行（说明区之后）+ 制表符结尾 + 尾部双逗号容错', () => {
    const { records, errors } = parseAlipayCsv(OFFICIAL_CSV);
    expect(errors).toEqual([]);
    expect(records).toHaveLength(1);
    expect(records[0].date).toBe('2026-08-19');
    expect(records[0].type).toBe('expense');
    expect(records[0].amount).toBeCloseTo(39, 2);
    expect(records[0].description).toContain('丹灵**店');
    expect(records[0].description).toContain('手表带');
    expect(records[0].category).toBe('服饰装扮');
  });

  it('GBK 编码文件自动解码（支付宝官方导出）', () => {
    // 手工构造 GBK 字节（Node Buffer 不支持 'gbk' 编码名）：
    // 支付宝=D6A7B8B6B1A6  丹灵**店=B5A4C1E9 2A2A B5EA  支出=D6A7B3F6
    const gbk = Buffer.from([
      0xD6, 0xA7, 0xB8, 0xB6, 0xB1, 0xA6, 0x2C,
      0xB5, 0xA4, 0xC1, 0xE9, 0x2A, 0x2A, 0xB5, 0xEA, 0x2C,
      0xD6, 0xA7, 0xB3, 0xF6, 0x2C,
      0x33, 0x39, 0x2E, 0x30, 0x30,
    ]);
    const text = decodeCsvBuffer(gbk);
    expect(text).toBe('支付宝,丹灵**店,支出,39.00');
  });

  it('UTF-8 文件原样解码（不误转 GBK）', () => {
    const utf8 = Buffer.from('交易时间,收/支,金额,\n2026-08-19 17:21:00,支出,39.00', 'utf-8');
    const text = decodeCsvBuffer(utf8);
    expect(text).toContain('交易时间');
    expect(text).not.toContain('\uFFFD');
  });
});

  it('自动识别：微信 CSV 与支付宝 CSV', () => {
    const wx = parseCsvAuto('微信支付账单明细\n交易时间,交易类型,交易对方,商品,收/支,金额(元)\n2026-08-16 12:00:00,商户消费,A店,咖啡,支出,20.00');
    expect(wx.format).toBe('wechat');
    const ali = parseCsvAuto(ALIPAY_CSV);
    expect(ali.format).toBe('alipay');
  });
});
