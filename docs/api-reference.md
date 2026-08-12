# API 参考 — 数据源接口文档

本文档记录项目中使用的所有外部数据源 API。

---

## 1. 汇率 API

### exchangerate-api.com

- **免费额度**：每月 1500 次请求
- **基础URL**：`https://api.exchangerate-api.com/v4/latest/{base_currency}`
- **支持币种**：160+ 种货币

**获取美元汇率：**
```
GET https://api.exchangerate-api.com/v4/latest/USD
```

**返回示例：**
```json
{
  "base": "USD",
  "date": "2026-08-03",
  "rates": {
    "CNY": 7.25,
    "HKD": 7.82,
    "EUR": 0.92,
    "JPY": 149.5,
    "GBP": 0.79
  }
}
```

---

## 2. A股数据

### 主数据源：新浪财经 API

**实时行情：**
```
GET https://hq.sinajs.cn/list=sh600036,sz000001
```

**返回示例：**
```
var hq_str_sh600036="招商银行,38.50,38.20,38.60,39.00,38.00,...";
```

### 备用数据源：腾讯财经 API

**实时行情：**
```
GET https://qt.gtimg.cn/q=sh600036,sz000001
```

**返回格式**：`~` 分隔的字段数组（v1.4.0 新增备源）

### 市场检测规则

6 位纯数字代码 → A 股。首字符 `5/6` → `sh`（上海，含 ETF 和主板），`0/1/2/3` → `sz`（深圳）。

---

## 3. 港股数据

### 主数据源：新浪港股 API

```
GET https://hq.sinajs.cn/list=hk00700
```

### 备用数据源：腾讯港股 API

```
GET https://qt.gtimg.cn/q=hk00700
```

（v1.4.0 新增备源）

### 市场检测规则

1-5 位纯数字代码 → 港股。代码补零到 5 位后请求。

---

## 4. 美股数据

### 主数据源：Yahoo Finance v8

**基础URL**：`https://query1.finance.yahoo.com/v8/finance/chart/{symbol}`

**获取 Apple 数据：**
```
GET https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=1mo
```

### 备用数据源：新浪美股 API

```
GET https://hq.sinajs.cn/list=gb_aapl
```

### 市场检测规则

1-5 个字母代码 → 美股。

---

## 5. 基金净值

### 主数据源：东方财富历史净值 API

**获取最新净值：**
```
GET https://api.fund.eastmoney.com/f10/lsjz?fundCode={fund_code}&pageIndex=1&pageSize=1
Referer: https://fundf10.eastmoney.com/
```

**返回示例：**
```json
{
  "Data": {
    "LSJZList": [{
      "FSRQ": "2026-08-12",
      "DWJZ": "2.9500",
      "LJJZ": "2.9500"
    }]
  },
  "ErrCode": 0
}
```

> `DWJZ` = 单位净值，`LJJZ` = 累计净值，`FSRQ` = 净值日期。已公布净值每日约 20:00 更新一次。

### 备用数据源：新浪财经基金 API

```
GET https://hq.sinajs.cn/list=f_{fund_code}
Referer: https://finance.sina.com.cn
```

**返回示例：**
```
var hq_str_f_110022="易方达消费行业股票,2.95,2.95,2.953,2026-08-12,36.5105"
```

字段顺序：名称、最新净值、累计净值、前一日净值、日期、成立以来累计净值。

> v1.5.1 修复：天天基金 `fundgz.1234567.com.cn` 和东方财富 `fundgzapi.eastmoney.com` 已于 2026-08 停止返回 JSON（防盗链升级），替换为上述两个新数据源。

---

## 6. 黄金价格

### 主数据源：新浪贵金属

```
GET https://hq.sinajs.cn/list=hf_XAU
```

### 备用数据源：Gold-API（免费，无需 Key）

```
GET https://api.gold-api.com/price/XAU
```

（v1.4.0 新增备源）

---

## 7. 加密货币

### 主数据源：CoinGecko API（免费）

**基础URL**：`https://api.coingecko.com/api/v3`

**获取比特币价格（美元）：**
```
GET https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd,cny
```

**返回示例：**
```json
{
  "bitcoin": { "usd": 65000, "cny": 470000 },
  "ethereum": { "usd": 3500, "cny": 25200 }
}
```

**限制**：免费版每分钟 10-30 次请求。

### 备用数据源：Binance 公开 API

```
GET https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT
```

（v1.4.0 新增备源，不需要 API Key）

---

## 数据获取架构（v1.4.0 重构）

```
Renderer                      Main Process                         External API
   │                              │                                    │
   │  invoke('data:refreshPrices')│                                    │
   │─────────────────────────────→│                                    │
   │                              │  detectMarket(code)                │
   │                              │  fetchWithFallback(code, ...)      │
   │                              │  ─── 主源 ───→                    │
   │                              │  ←── 失败 ─── 　　                  │
   │                              │  ─── 备源 ───→                    │
   │                              │  ←── 成功 ─── 　　                  │
   │                              │  save to DB                        │
   │←─────────────────────────────│                                    │
   │  return prices               │                                    │
```

### failover 策略（`fetchWithFallback`）

1. 尝试主数据源获取价格
2. 主源返回无效值或异常 → 自动切换备用源
3. 备源也失败 → 返回 `null`，保持上次有效价格
4. 每次请求记录日志：来源、耗时、成功/失败原因

### 智能市场检测（`detectMarket`）

- 6 位纯数字 → A 股（5xxxxx/6xxxxx → sh，0xxxxx/1xxxxx/2xxxxx/3xxxxx → sz）
- 1-5 位纯数字 → 港股
- 1-5 个字母 → 美股
- 已有 `asset.market` 字段明确设置的市场优先（向后兼容）

---

## 定时更新策略

- 汇率：每 6 小时
- 全部价格（A 股/港股/美股/黄金/加密货币/基金）：每 30 分钟
- AI 日摘要：每日 15:30

> **注意**：当前版本所有价格类型统一为每 30 分钟刷新频率。未来可考虑针对各市场交易时段细化。

---

## 降级策略

1. API 请求超时 10 秒
2. 主源失败 → 自动切换到备用数据源
3. 双源均失败 → 使用最近一次成功缓存的数据
4. 数据超过 24 小时未更新，在 UI 上显示"数据可能已过期"提示
